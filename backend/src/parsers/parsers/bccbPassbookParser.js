import { roundMoney } from "./common.js";

// Bassein Catholic Co-op Bank PASSBOOK, photographed page by page on a phone and OCR'd
// (OCR.space). Columns: Date | Particulars | Chq/Ref No | Value Dt | Withdrawal | Deposit | Balance.
// What makes this format hard, and how each part is handled:
//   - Pages are skewed and bowed, so a row's balance can sit a full row above or below its date,
//     and by a different amount than its withdrawal/deposit does. Nearest-y matching glues amounts
//     onto the wrong row. But within ONE column, tokens are always in row order. So each page is
//     reduced to three ordered sequences -- row anchors (dates, B/F, C/F), amount tokens, balance
//     tokens -- and the balance-chain solver consumes amount/balance tokens in order, skipping
//     noise (mirrored bleed-through) at a cost. Geometry only bounds the search window.
//   - OCR misreads digits (4 read as 1, 30.00 as 230.00). The solver enforces
//     prev_balance - withdrawal + deposit == balance, scoring how far each chosen value is from what
//     OCR read. That same check decides withdrawal vs deposit, helped by the DR/CR in the
//     particulars. Rows whose values had to be derived are flagged for review, never dropped.
//   - Pages are photographed out of order: they're ordered by their row dates, and each page's
//     B/F must equal the previous page's C/F (zero-amount checkpoints in the chain). The very
//     first B/F is not trusted -- the opening balance is derived from the first row.

const DATE_YEARS = [2020, 2035];

function isBccbPassbookLayout(lines) {
  const text = lines.map((line) => line.text || line).join("\n");
  return (
    /Bassein/i.test(text) &&
    /Catholic/i.test(text) &&
    /Balance\s*[B8]\s*\/\s*[FEPY]/i.test(text) &&
    /\b\d{2}\s*\/\s*\d{2}\s*\/\s*20\d{2}\b/.test(text) &&
    // The continuous-ledger PDF export of the same bank has its own parser (bccbLedgerParser).
    !/TRANS\s+DATE\s+VALUE\s+DATE/i.test(text)
  );
}

const DIGIT_FIXES = { O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", i: "1", "|": "1", S: "5", s: "5", B: "8", Z: "2", z: "2", T: "7", G: "6", g: "9", b: "6" };

function fixDigits(text) {
  return text.replace(/[OoDQIli|SsBZzTGgb]/g, (char) => DIGIT_FIXES[char]);
}

// dd/dd/dddd after OCR letter fixes -- a row's date even when a digit is misread ("81/07/2021").
function looksLikeDate(text) {
  return /\//.test(text) && /^\d{8}$/.test(fixDigits(text).replace(/[\s/]/g, ""));
}

function parseDateToken(text) {
  if (!looksLikeDate(text)) return null;
  const digits = fixDigits(text).replace(/\D/g, "");
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4));
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < DATE_YEARS[0] || year > DATE_YEARS[1]) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCDate() === day ? date : null;
}

// ".00", "0.00", "30000.00", and OCR variants like "2000:00", "15310•00", "14428'28", "2900-90".
function parseAmountToken(text) {
  const compact = String(text ?? "").replace(/\s+/g, "");
  // Anchored at the end only: "20:23:00" (bleed-through overprint) still yields 23.00.
  const match = compact.match(/([\dOoIlSB,]*)[.:•*',-](\d{2})$/);
  if (!match) return null;
  const whole = fixDigits(match[1]).replace(/,/g, "");
  if (!/^\d{0,8}$/.test(whole)) return null;
  const value = Number(`${whole || "0"}.${match[2]}`);
  return Number.isFinite(value) ? value : null;
}

// Words OCR.space reports at the same x belong to one printed token ("12", "/", "03", "/", "2025").
function groupLineItems(line) {
  const groups = [];
  for (const item of line.items || []) {
    const text = String(item.text || "").trim();
    if (!text || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
    const last = groups.at(-1);
    if (last && Math.abs(item.x - last.x) <= 3) {
      last.parts.push(text);
      last.y = Math.max(last.y, item.y);
    } else {
      groups.push({ x: item.x, y: item.y, parts: [text] });
    }
  }
  return groups.map((group) => ({ x: group.x, y: group.y, text: group.parts.join(" ") }));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Threshold at the widest gap between sorted values (null if no gap reaches minGap).
function splitAtWidestGap(values, minGap) {
  const sorted = [...values].sort((a, b) => a - b);
  let best = null;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index] - sorted[index - 1];
    if (gap >= minGap && (!best || gap > best.gap)) best = { gap, threshold: (sorted[index] + sorted[index - 1]) / 2 };
  }
  return best?.threshold ?? null;
}

function directionHint(particulars) {
  if (/\/DR\/|\bDR\b|Drawdown|CHARGE|\bGST\b|\bTDS\b/i.test(particulars)) return "W";
  if (/\/CR\/|\bCR\b|NEFT\s*Cr|Credit|Interest|\bDIV\b|\/REV\//i.test(particulars)) return "D";
  return null;
}

function analysePage(pageNumber, pageLines) {
  const tokens = [];
  for (const line of pageLines) {
    for (const group of groupLineItems(line)) {
      // OCR sometimes glues the value date onto the Chq/Ref No ("64211312585424 / 02 / 2026").
      const glued = group.text.replace(/\s+/g, "").match(/^([A-Z0-9]{6,}?)(\d{2}\/\d{2}\/\d{4})$/i);
      if (glued && !looksLikeDate(group.text)) {
        tokens.push({ ...group, text: glued[1], dateLike: false, date: null, amount: null });
        tokens.push({ ...group, text: glued[2], dateLike: true, date: parseDateToken(glued[2]), amount: null });
        continue;
      }
      const dateLike = looksLikeDate(group.text);
      tokens.push({ ...group, dateLike, date: parseDateToken(group.text), amount: dateLike ? null : parseAmountToken(group.text) });
    }
  }

  const dateTokens = tokens.filter((token) => token.dateLike);
  const dateSplit = splitAtWidestGap(dateTokens.map((token) => token.x), 400);
  if (dateSplit === null) return null;
  const postingDates = dateTokens.filter((token) => token.x < dateSplit);
  const valueDates = dateTokens.filter((token) => token.x >= dateSplit);
  const valueX = median(valueDates.map((token) => token.x));
  const postingX = median(postingDates.map((token) => token.x));

  const postingYs = postingDates.map((token) => token.y).sort((a, b) => a - b);
  const gaps = postingYs.slice(1).map((y, index) => y - postingYs[index]).filter((gap) => gap > 20);
  const rowSpacing = Math.max(40, median(gaps) ?? 90);

  const anchors = postingDates.map((token) => ({ kind: "row", y: token.y, date: token.date, dateText: token.text, valueDate: null }));

  // "Balance B/F" / "Balance C/F" markers are anchors too (zero-amount checkpoints).
  for (const line of pageLines) {
    const text = String(line.text || "");
    const word = (line.items || []).find((item) => /^Bal/i.test(item.text || ""));
    if (!word || word.x > valueX - 300) continue;
    const kind = /Bal\w*\s*[B8]\b/i.test(text) ? "BF" : /Bal\w*\s*[Cc]/i.test(text) ? "CF" : null;
    if (kind) anchors.push({ kind, y: word.y });
  }
  anchors.sort((a, b) => a.y - b.y);

  // Value dates fill in each row's value date, and stand in for a posting date OCR missed.
  // Paired by order (monotone), since skew can shift the whole column by up to a row.
  const rowAnchors = () => anchors.filter((anchor) => anchor.kind === "row");
  const pairing = alignMonotone(
    rowAnchors().map((anchor) => anchor.y),
    valueDates.map((token) => token.y),
    rowSpacing,
    (anchorIndex, tokenIndex) => (rowAnchors()[anchorIndex].date && rowAnchors()[anchorIndex].date.getTime() === valueDates[tokenIndex].date?.getTime() ? 0 : 0.3),
  );
  const rows = rowAnchors();
  valueDates.forEach((token, tokenIndex) => {
    const anchorIndex = pairing.get(tokenIndex);
    if (anchorIndex !== undefined) Object.assign(rows[anchorIndex], { valueDate: token.date, valueDateText: token.text });
    else anchors.push({ kind: "row", y: token.y - pairing.offset, date: null, valueDate: token.date, valueDateText: token.text, fromValueDate: true });
  });
  anchors.sort((a, b) => a.y - b.y);

  // Amount columns: everything numeric right of the value date; the rightmost cluster is Balance.
  const amounts = tokens.filter((token) => token.amount !== null && token.x > valueX + 120);
  const balanceSplit = splitAtWidestGap(amounts.map((token) => token.x), 150);
  const balanceX = median(amounts.filter((token) => balanceSplit === null || token.x > balanceSplit).map((token) => token.x));
  const inBalanceColumn = (token) => token.x > balanceX - 180;
  const txnAmounts = amounts.filter((token) => !inBalanceColumn(token)).sort((a, b) => a.y - b.y);
  const wdSplit = splitAtWidestGap(txnAmounts.map((token) => token.x), 120);
  const balances = amounts.filter(inBalanceColumn).sort((a, b) => a.y - b.y);

  // Particulars: text between the date and Chq/Ref columns; wrapped lines belong to the row above.
  for (const anchor of anchors) Object.assign(anchor, { page: pageNumber, parts: [] });
  for (const token of tokens) {
    if (token.dateLike || token.x <= postingX + 100 || token.x > valueX - 420 || /[Ѐ-ӿ]/.test(token.text)) continue;
    let owner = null;
    // A row's first particulars line sits level with its date, never meaningfully above it.
    for (const anchor of anchors) if (anchor.y <= token.y + 15) owner = anchor;
    if (owner?.kind === "row" && token.y - owner.y < rowSpacing * 2.5) owner.parts.push(token);
  }
  for (const anchor of anchors) {
    anchor.particulars = anchor.parts
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((part) => part.text)
      .join(" ")
      .replace(/\s*([/-])\s*/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    delete anchor.parts;
    anchor.direction = directionHint(anchor.particulars);
    // UPI rows repeat their reference number inside the particulars; that's the Chq/Ref No.
    anchor.chequeNo = anchor.particulars.match(/(?:[DC][RP]|REV)\W{1,4}(\d{9,})/i)?.[1] ?? null;
  }

  return {
    pageNumber,
    anchors,
    rowSpacing,
    balances: balances.map((token) => ({ value: token.amount, y: token.y })),
    txnAmounts: txnAmounts.map((token) => ({
      value: token.amount,
      y: token.y,
      column: wdSplit === null ? null : token.x < wdSplit ? "W" : "D",
    })),
  };
}

// Order-preserving matching of token positions to anchor positions, allowing a constant offset
// (skew) and unmatched items on either side. Returns Map<tokenIndex, anchorIndex> plus `offset`.
function alignMonotone(anchorYs, tokenYs, spacing, extraCost = () => 0) {
  let best = { cost: Infinity, map: new Map(), offset: 0 };
  const gap = 0.6;
  for (let offset = -1.5 * spacing; offset <= 1.5 * spacing; offset += spacing / 10) {
    const n = anchorYs.length;
    const m = tokenYs.length;
    const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
    const move = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
    cost[0][0] = 0;
    for (let i = 0; i <= n; i += 1) {
      for (let j = 0; j <= m; j += 1) {
        const here = cost[i][j];
        if (here === Infinity) continue;
        if (i < n && here + gap < cost[i + 1][j]) [cost[i + 1][j], move[i + 1][j]] = [here + gap, "a"];
        if (j < m && here + gap < cost[i][j + 1]) [cost[i][j + 1], move[i][j + 1]] = [here + gap, "t"];
        if (i < n && j < m) {
          const distance = Math.abs(tokenYs[j] - offset - anchorYs[i]) / spacing;
          if (distance < 0.5) {
            const pair = here + distance + extraCost(i, j);
            if (pair < cost[i + 1][j + 1]) [cost[i + 1][j + 1], move[i + 1][j + 1]] = [pair, "p"];
          }
        }
      }
    }
    if (cost[n][m] < best.cost) {
      const map = new Map();
      for (let i = n, j = m; i > 0 || j > 0; ) {
        const step = move[i][j];
        if (step === "p") map.set(--j, --i);
        else if (step === "a") i -= 1;
        else j -= 1;
      }
      best = { cost: cost[n][m], map, offset };
    }
  }
  best.map.offset = best.offset;
  return best.map;
}

function formatMoney(value) {
  return Math.abs(value).toFixed(2);
}

// Digit pairs a phone-photo OCR commonly swaps are cheaper substitutions, keyed printed+read.
// This passbook's dot-matrix "4" is very often read as "1" (the reverse is rarer).
const CONFUSABLE = { 41: 0.1, 14: 0.8, 17: 0.5, 71: 0.5, 38: 0.4, 83: 0.4, 68: 0.4, 86: 0.4, "08": 0.4, 80: 0.4, 56: 0.4, 65: 0.4, 98: 0.4, 89: 0.4, "06": 0.4, 60: 0.4, 27: 0.5, 72: 0.5 };

const distanceCache = new Map();

// Weighted edit distance from printed `a` to read `b`. Junk read before the number (a smudge
// read as "0230.00" for "30.00") is cheaper than a wrong digit inside it.
function ocrDistance(a, b) {
  const key = `${a}|${b}`;
  let distance = distanceCache.get(key);
  if (distance === undefined) {
    distance = computeOcrDistance(a, b);
    if (distanceCache.size > 500000) distanceCache.clear();
    distanceCache.set(key, distance);
  }
  return distance;
}

function computeOcrDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index * 0.5);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : (CONFUSABLE[a[i - 1] + b[j - 1]] ?? 1);
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + substitution);
      diagonal = temp;
    }
  }
  return row[b.length];
}

// The value as read, plus every value one commonly-confused digit away (read "1927.82" may be a
// printed "4927.82"). Needed when both the amount and the balance of a row are misread.
function confusableVariants(value) {
  const text = formatMoney(value);
  const variants = new Set([roundMoney(value)]);
  // "1" is where this font's 4s and 7s end up, often several times in one number
  // ("47468.72" read as "17168.12"), so every combination of those is a candidate.
  const ones = [...text].flatMap((char, index) => (char === "1" ? [index] : []));
  if (ones.length <= 4) {
    for (let mask = 0; mask < 3 ** ones.length; mask += 1) {
      const chars = [...text];
      let rest = mask;
      for (const index of ones) {
        chars[index] = "147"[rest % 3];
        rest = Math.floor(rest / 3);
      }
      variants.add(roundMoney(Number(chars.join(""))));
    }
  }
  for (let index = 0; index < text.length; index += 1) {
    for (const key of Object.keys(CONFUSABLE)) {
      if (key[1] !== text[index]) continue;
      variants.add(roundMoney(Number(text.slice(0, index) + key[0] + text.slice(index + 1))));
    }
  }
  return variants;
}

const MISSING = 3;

function readCost(value, token) {
  if (!token) return MISSING;
  return Math.min(MISSING, ocrDistance(formatMoney(value), formatMoney(token.value)));
}

const LOOKAHEAD = 3;
const SKIP_COST = 0.7;
const BEAM_WIDTH = 60;

// Beam search over the whole statement. State: current balance + how far into this page's
// amount/balance token sequences we've consumed. Each row picks (in order) at most one amount
// token and one balance token, and a balance; the chain prev -/+ amount == balance must hold.
function solveBalanceChain(pages) {
  let beam = [{ balance: null, opening: null, cost: 0, history: [] }];

  for (const page of pages) {
    beam = beam.map((state) => ({ ...state, bi: -1, ai: -1 }));

    for (const anchor of page.anchors) {
      const next = new Map();
      const push = (state, balance, cost, bi, ai, choice) => {
        const key = `${balance === null ? "-" : balance.toFixed(2)}|${bi}|${ai}`;
        const existing = next.get(key);
        if (existing && existing.cost <= cost) return;
        next.set(key, {
          balance,
          opening: state.opening,
          cost,
          bi,
          ai,
          history: [...state.history, choice],
          ...(choice.opening !== undefined ? { opening: choice.opening } : {}),
        });
      };
      const window = (list, from, y) => {
        const options = [{ token: null, index: from, skipped: 0 }];
        for (let index = from + 1, skipped = 0; index < list.length && skipped < LOOKAHEAD; index += 1, skipped += 1) {
          if (Math.abs(list[index].y - anchor.y) > 1.8 * page.rowSpacing) {
            if (list[index].y > anchor.y) break;
            continue;
          }
          options.push({ token: list[index], index, skipped });
        }
        return options;
      };

      for (const state of beam) {
        const prev = state.balance;
        const balanceOptions = window(page.balances, state.bi, anchor.y);

        if (anchor.kind !== "row") {
          for (const option of balanceOptions) {
            const skip = option.skipped * SKIP_COST;
            if (prev === null) {
              // The first page's B/F is not trusted as the opening (the passbook often carries a
              // stale figure there) -- only consume its token so it isn't mistaken for a row's.
              push(state, null, state.cost + skip, option.index, state.ai, { kind: anchor.kind, balance: null });
            } else {
              push(state, prev, state.cost + skip + 0.5 * (option.token ? readCost(prev, option.token) : 0), option.index, state.ai, { kind: anchor.kind, balance: prev });
              // A checkpoint that disagrees with the chain (missing/misordered page) resets it, at a price.
              if (option.token && readCost(prev, option.token) > 0) {
                push(state, roundMoney(option.token.value), state.cost + skip + 8, option.index, state.ai, { kind: anchor.kind, balance: roundMoney(option.token.value), reset: true });
              }
            }
          }
          continue;
        }

        const amountOptions = window(page.txnAmounts, state.ai, anchor.y);
        for (const balanceOption of balanceOptions) {
          for (const amountOption of amountOptions) {
            const skip = (balanceOption.skipped + amountOption.skipped) * SKIP_COST;
            const candidates = [];
            if (prev === null) {
              // First row of the statement: balance as read, amount as read, direction from DR/CR.
              if (!balanceOption.token || !amountOption.token) continue;
              const balance = roundMoney(balanceOption.token.value);
              const direction = anchor.direction ?? amountOption.token.column ?? "W";
              const delta = direction === "W" ? -amountOption.token.value : amountOption.token.value;
              candidates.push({ balance, delta, opening: roundMoney(balance - delta) });
            } else {
              const balances = new Set();
              if (balanceOption.token) for (const value of (balanceOption.token.variants ??= confusableVariants(balanceOption.token.value))) balances.add(value);
              if (amountOption.token) {
                balances.add(roundMoney(prev - amountOption.token.value));
                balances.add(roundMoney(prev + amountOption.token.value));
              }
              for (const balance of balances) candidates.push({ balance, delta: roundMoney(balance - prev) });
            }

            for (const candidate of candidates) {
              const { balance, delta } = candidate;
              let cost = state.cost + skip + readCost(balance, balanceOption.token);
              // Every passbook row moves the balance; a zero delta means tokens were misassigned.
              if (delta === 0) cost += 8;
              else {
                cost += readCost(Math.abs(delta), amountOption.token);
                const direction = delta < 0 ? "W" : "D";
                // The printed DR/CR in the particulars is near-certain; the column position is a weak hint.
                if (anchor.direction && anchor.direction !== direction) cost += 4;
                else if (!anchor.direction && amountOption.token?.column && amountOption.token.column !== direction) cost += 0.5;
              }
              push(state, balance, cost, balanceOption.index, amountOption.index, {
                kind: "row",
                balance,
                delta,
                balanceRead: balanceOption.token?.value ?? null,
                amountRead: amountOption.token?.value ?? null,
                opening: candidate.opening,
              });
            }
          }
        }

        // A spurious anchor (e.g. a stray date) contributes no transaction.
        push(state, prev, state.cost + (anchor.fromValueDate ? 2 : 6), state.bi, state.ai, { kind: "row", dropped: true, balance: prev });
      }

      beam = [...next.values()].sort((a, b) => a.cost - b.cost).slice(0, BEAM_WIDTH);
    }
  }

  return beam[0];
}

// Every date a misread date text could be: as read, then with each "1" as a "4" or "7".
function dateVariants(text) {
  const digits = fixDigits(text).replace(/\D/g, "");
  const ones = [...digits.slice(0, 4)].flatMap((char, index) => (char === "1" ? [index] : []));
  const variants = [];
  for (let mask = 0; mask < 3 ** ones.length; mask += 1) {
    const chars = [...digits];
    let rest = mask;
    for (const index of ones) {
      chars[index] = "147"[rest % 3];
      rest = Math.floor(rest / 3);
    }
    const date = parseDateToken(`${chars.slice(0, 2).join("")}/${chars.slice(2, 4).join("")}/${chars.slice(4).join("")}`);
    if (date) variants.push(date);
  }
  return variants;
}

// Posting dates are misread too (14/03 read as 11/03, 01/04 as 01/01). Rows are already in order,
// so a date that goes backwards or jumps far ahead falls back to the value date, then to a 1->4/7
// reading of either, then to the previous row's date.
function resolveDates(rows) {
  let previous = null;
  rows.forEach((row, index) => {
    const nextSure = rows
      .slice(index + 1, index + 4)
      .find((other) => other.date && other.date.getTime() === other.valueDate?.getTime() && (!previous || other.date >= previous))?.date;
    const fits = (date) =>
      (!previous || (date >= previous && date - previous < 120 * 86400000)) && (!nextSure || date <= nextSure);
    const candidates = [row.date, row.valueDate, ...row.dateTexts.flatMap(dateVariants)].filter(Boolean);
    row.date = candidates.find(fits) ?? previous ?? candidates[0] ?? null;
    previous = row.date ?? previous;
    delete row.dateTexts;
  });
}

function parseBccbPassbookTransactions(lines) {
  const byPage = new Map();
  for (const line of lines) {
    const page = line.pageNumber ?? 1;
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push(line);
  }

  const pages = [];
  const skippedPages = [];
  for (const [pageNumber, pageLines] of byPage) {
    const page = analysePage(pageNumber, pageLines);
    if (page?.anchors.some((anchor) => anchor.kind === "row")) pages.push(page);
    else skippedPages.push(pageNumber);
  }

  // Out-of-order photos: order pages by the median of their row dates.
  const pageKey = (page) =>
    median(page.anchors.map((anchor) => (anchor.date || anchor.valueDate)?.getTime()).filter(Boolean)) ?? 0;
  pages.sort((a, b) => pageKey(a) - pageKey(b));

  const solution = solveBalanceChain(pages);
  const anchors = pages.flatMap((page) => page.anchors);

  const transactions = [];
  const flaggedRows = [];
  const chainResets = [];
  solution.history.forEach((choice, index) => {
    const anchor = anchors[index];
    if (choice.reset) chainResets.push(`Page ${anchor.page}: ${choice.kind} balance ${choice.balance} does not continue the previous page's balance.`);
    if (choice.kind !== "row") return;
    if (choice.dropped) {
      flaggedRows.push({ page: anchor.page, date: anchor.date ?? anchor.valueDate, particulars: anchor.particulars, reason: "Date found but no amount/balance could be matched; not output as a transaction." });
      return;
    }
    const row = {
      date: anchor.date,
      valueDate: anchor.valueDate,
      dateTexts: [anchor.dateText, anchor.valueDateText].filter(Boolean),
      particulars: anchor.particulars,
      chequeNo: anchor.chequeNo,
      withdrawal: choice.delta < 0 ? roundMoney(-choice.delta) : null,
      deposit: choice.delta > 0 ? roundMoney(choice.delta) : null,
      balance: choice.balance,
      page: anchor.page,
    };
    const balanceOk = choice.balanceRead !== null && formatMoney(choice.balanceRead) === formatMoney(choice.balance);
    const amountOk = choice.amountRead !== null && formatMoney(choice.amountRead) === formatMoney(choice.delta);
    if (!balanceOk || !amountOk) {
      row.hadOcrCorrection = true;
      row.correctionNote = [
        `page ${anchor.page}`,
        !amountOk && `amount set to ${formatMoney(choice.delta)} from the balance chain (OCR read ${choice.amountRead ?? "nothing"})`,
        !balanceOk && `balance set to ${choice.balance} from the balance chain (OCR read ${choice.balanceRead ?? "nothing"})`,
      ]
        .filter(Boolean)
        .join("; ");
      flaggedRows.push({ ...row, reason: row.correctionNote });
    }
    transactions.push(row);
  });

  resolveDates(transactions);

  return { transactions, openingBalance: solution.opening, flaggedRows, chainResets, skippedPages, chainCost: solution.cost };
}

export { isBccbPassbookLayout, parseBccbPassbookTransactions, parseAmountToken, parseDateToken, alignMonotone };
