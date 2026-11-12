import { roundMoney } from "./common.js";

// Co-operative bank PASSBOOK photographed page by page (OCR.space), bilingual header
// "Date | Cheque No. | Particulars | DR Amount | CR Amount | Balance", each page closed by
// "Carried Forward / Carried Over" and reopened by "Brought Forward". Photos are tilted, the same page
// is often photographed more than once, and OCR garbles some amounts. How that is handled:
//   - Item coordinates are de-skewed (slope found by lining up the date, amount and balance columns),
//     then every row is its balance token; amount, date, cheque no. and narration join it by position.
//   - The running balance is the truth: prev -/+ amount == balance. A row whose amount is unreadable gets
//     it from the balance change; a misread balance or amount is repaired towards whichever choice the
//     NEXT row's balance confirms. Every derived/repaired row is reported (issues), never silent.
//   - Photos of the same rows are merged (same balance after the same movement), keeping the copy
//     that has a readable date.

const DEVANAGARI = /[ऀ-ॿ]/;
const HEADER_WORDS = /^(Date|Cheque|No\.?|Particulars|DR|CR|Amount|Balance|Brought|Brough|Forward|Carried|Over|Name|:)$/i;

function isDrCrPassbookLayout(lines) {
  const text = lines.map((line) => line.text || line).join("\n");
  // OCR may put "Forward" before "Brought" (separate lines), so each word is checked on its own.
  return /Brough/i.test(text) && /Forw/i.test(text) &&/Carried\s*(Forward|Over)/i.test(text) && /DR\s*Amount/i.test(text) && /CR\s*Amount/i.test(text);
}

// "12,26_759_00", "4.00.000_00", "400000-00": digits with stray separators and a 2-digit fraction.
function parseAmount(text) {
  const compact = String(text ?? "").replace(/\s+/g, "").replace(/[、，：:]/g, ".");
  const match = compact.match(/^(\d[\d,._-]*?)[.,_-](\d{2})$/);
  if (!match) return null;
  const whole = match[1].replace(/\D/g, "");
  return whole && whole.length <= 9 ? Number(`${whole}.${match[2]}`) : null;
}

function parseDate(text) {
  const match = String(text ?? "").replace(/\s+/g, "").match(/^(\d{2})[-/](\d{2})[-/](20\d{2})$/);
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return month >= 1 && month <= 12 && date.getUTCDate() === day && year <= 2035 ? date : null;
}

// OCR splits one printed number into pieces ("400000" "-" "00"); glue neighbours on one line.
function mergeFragments(items) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const out = [];
  for (const item of sorted) {
    const last = out.at(-1);
    // A separator, a 2-3 digit piece, or a 4-digit year right after a "-" or "/".
    // (OCR also reads the decimal point as the CJK marks 、 ， ：.)
    const fragment = /^[-._,:/、，：]+$/.test(item.text) || /^[-._,:、，：]?\d{2,3}$/.test(item.text) || (/^\d{4}$/.test(item.text) && /[-/]$/.test(last?.text ?? ""));
    if (last && fragment && Math.abs(item.y - last.y) < 12 && item.x > last.x && item.x - last.x < 160 && /[\d\-._,/、，：]$/.test(last.text)) {
      last.text += item.text;
    } else {
      out.push({ ...item });
    }
  }
  return out;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Threshold at the widest gap between sorted values (or, with rightmost, the last gap that is wide enough).
function splitAtWidestGap(values, minGap, { rightmost = false } = {}) {
  const sorted = [...values].sort((a, b) => a - b);
  let best = null;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index] - sorted[index - 1];
    if (gap >= minGap && (rightmost || !best || gap > best.gap)) best = { gap, threshold: (sorted[index] + sorted[index - 1]) / 2 };
  }
  return best?.threshold ?? null;
}

// Photo tilt: the slope (dy/dx) at which the date, amount and balance columns' rows line up best.
function findSlope(dates, amounts, balances) {
  let best = { cost: Infinity, slope: 0 };
  for (let slope = -0.15; slope <= 0.15; slope += 0.0025) {
    const ys = (tokens) => tokens.map((token) => token.y - slope * token.x);
    const target = ys(balances);
    if (!target.length) break;
    // Aligning to the next row down looks as good as the true tilt; a small tilt is the likelier one.
    let cost = Math.abs(slope) * 3000;
    for (const y of [...ys(dates), ...ys(amounts)]) cost += Math.min(60, Math.min(...target.map((t) => Math.abs(t - y))));
    if (cost < best.cost) best = { cost, slope };
  }
  return best.slope;
}

// Order-preserving matching of token positions to row positions; unmatched items on either side cost
// a little, a pairing costs its distance (in row spacings) and is refused beyond 0.8 of a spacing.
function alignInOrder(rowYs, tokenYs, spacing) {
  const n = rowYs.length;
  const m = tokenYs.length;
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  const move = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  cost[0][0] = 0;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      const here = cost[i][j];
      if (here === Infinity) continue;
      if (i < n && here + 0.5 < cost[i + 1][j]) [cost[i + 1][j], move[i + 1][j]] = [here + 0.5, "row"];
      if (j < m && here + 0.5 < cost[i][j + 1]) [cost[i][j + 1], move[i][j + 1]] = [here + 0.5, "token"];
      if (i < n && j < m) {
        const distance = Math.abs(tokenYs[j] - rowYs[i]) / spacing;
        if (distance <= 0.8 && here + distance < cost[i + 1][j + 1]) [cost[i + 1][j + 1], move[i + 1][j + 1]] = [here + distance, "pair"];
      }
    }
  }
  const map = new Map();
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const step = move[i][j];
    if (step === "pair") map.set(--j, --i);
    else if (step === "row") i -= 1;
    else j -= 1;
  }
  return map;
}

function analysePage(pageNumber, pageLines) {
  // Fragments are only glued within one OCR line.
  const items = pageLines.flatMap((line) =>
    mergeFragments(
      (line.items || [])
        .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && String(item.text || "").trim())
        .map((item) => ({ x: item.x, y: item.y, text: String(item.text).trim() })),
    ),
  );
  const tokens = items.map((item) => ({ ...item, amount: parseAmount(item.text), date: parseDate(item.text) }));
  const amountTokens = tokens.filter((token) => token.amount !== null);
  // DR and CR columns sit left of Balance: the Balance column starts after the rightmost wide gap.
  const balanceSplit = splitAtWidestGap(amountTokens.map((token) => token.x), 150, { rightmost: true });
  if (balanceSplit === null) return null;
  const isBalance = (token) => token.x > balanceSplit;
  const balanceTokens = amountTokens.filter(isBalance);
  const sideTokens = amountTokens.filter((token) => !isBalance(token));
  // Number-like scraps inside narrations ("01-09" read as 1.09) sit far left of the DR/CR columns.
  const sideMedianX = median(sideTokens.map((token) => token.x));
  const txnTokens = sideTokens.filter((token) => token.x > sideMedianX - 500);
  // Row dates sit in the left column; dates inside narrations ("Int.Pd:01-12-2023") are not row dates.
  const particularsX = tokens.find((token) => /^Particulars$/i.test(token.text))?.x ?? Infinity;
  const allDates = tokens.filter((token) => token.date);
  const dateLeft = Math.min(...allDates.map((token) => token.x));
  const dateTokens = allDates.filter((token) => token.x < Math.min(particularsX - 100, dateLeft + 400));
  if (!balanceTokens.length) return null;

  const slope = findSlope(dateTokens, txnTokens, balanceTokens);
  const fix = (token) => ({ ...token, y: token.y - slope * token.x });
  let balances = balanceTokens.map(fix).sort((a, b) => a.y - b.y);
  const amounts = txnTokens.map(fix).sort((a, b) => a.y - b.y);
  const dates = dateTokens.map(fix);

  // Brought Forward / Carried Forward lines carry a balance that is not a row.
  const marker = (pattern) => tokens.filter((token) => pattern.test(token.text)).map(fix)[0];
  const brought = marker(/^Brough/i);
  const carried = marker(/^Carried$/i);
  let broughtBalance = null;
  if (brought) {
    const candidate = balances.find((balance) => balance.y <= brought.y + 40);
    if (candidate) [broughtBalance, balances] = [candidate.amount, balances.filter((balance) => balance !== candidate)];
  }
  if (carried) balances = balances.filter((balance) => balance.y < carried.y - 25);

  const gaps = balances.slice(1).map((balance, index) => balance.y - balances[index].y).filter((gap) => gap > 25);
  const spacing = Math.max(50, median(gaps) ?? 100);
  const sideSplit = splitAtWidestGap(txnTokens.map((token) => token.x), 120);

  const rows = balances.map((balance) => ({ balance: balance.amount, y: balance.y, amount: null, side: null, date: null, dateText: "", cheque: null, parts: [] }));
  // Amounts and dates are matched to rows in order (a monotone alignment), not each to its nearest row:
  // in cramped rows two amounts can both be nearest to the same balance.
  const amountRows = alignInOrder(rows.map((row) => row.y), amounts.map((token) => token.y), spacing);
  amounts.forEach((amount, index) => {
    const row = rows[amountRows.get(index)];
    if (!row) return;
    row.amount = amount.amount;
    row.side = sideSplit === null ? null : amount.x < sideSplit ? "W" : "D";
  });
  const orderedDates = [...dates].sort((a, b) => a.y - b.y);
  const dateRows = alignInOrder(rows.map((row) => row.y), orderedDates.map((token) => token.y), spacing);
  orderedDates.forEach((date, index) => {
    const row = rows[dateRows.get(index)];
    if (row) row.date = date.date;
  });

  const dateX = median(dates.map((token) => token.x)) ?? 0;
  const amountMinX = Math.min(...txnTokens.map((token) => token.x), balanceSplit);
  const firstY = rows[0]?.y ?? 0;
  for (const token of tokens.map(fix)) {
    if (token.amount !== null || token.date || DEVANAGARI.test(token.text) || HEADER_WORDS.test(token.text)) continue;
    if (token.x <= dateX + 60 || token.x >= amountMinX - 20 || token.y < firstY - spacing * 0.6) continue;
    // Narration lines (a wrapped second line included) belong to the row whose balance is nearest.
    let owner = null;
    rows.forEach((row) => {
      if (!owner || Math.abs(row.y - token.y) < Math.abs(owner.y - token.y)) owner = row;
    });
    if (!owner || Math.abs(owner.y - token.y) > spacing * 0.9) continue;
    if (/^\d{6}$/.test(token.text) && token.x < dateX + 500) owner.cheque = token.text;
    else owner.parts.push(token);
  }
  for (const row of rows) {
    // Reading order: words within 14 px of a line's first word are on that line, left to right.
    const textLines = [];
    for (const word of row.parts.sort((a, b) => a.y - b.y)) {
      const line = textLines.find((candidate) => Math.abs(candidate.y - word.y) <= 14);
      if (line) line.words.push(word);
      else textLines.push({ y: word.y, words: [word] });
    }
    row.particulars = textLines.map((line) => line.words.sort((a, b) => a.x - b.x).map((word) => word.text).join(" ")).join(" ").replace(/\s+/g, " ").trim();
    delete row.parts;
  }
  return { pageNumber, broughtBalance, rows };
}

const same = (a, b) => Math.abs(a - b) < 0.005;
const directionHint = (particulars) => (/CHRG|CHARGE|ATM|\bDR\b|BHARAT|CHQ/i.test(particulars) ? "W" : "D");

// Walks one page's rows in order, fixing amounts/balances against the running balance.
// OCR cut or mis-typed a number: same digits except a cut-off front/back or at most two wrong digits.
function closeDigits(a, b) {
  const x = a.toFixed(2).replace(/\D/g, "");
  const y = b.toFixed(2).replace(/\D/g, "");
  if (x === y || x.endsWith(y) || y.endsWith(x)) return true;
  return x.length === y.length && [...x].filter((char, index) => char !== y[index]).length <= 2;
}

// Walks one page's rows in order, fixing amounts/balances against the running balance. A fix is
// "confirmed" (no flag) when the NEXT row's balance agrees with it and the read value was only a small
// OCR slip away; anything else is reported.
function resolvePage(page) {
  const { rows } = page;
  const out = [];
  let previous = page.broughtBalance;
  // Does the NEXT row continue from `balance`? exact: its balance matches to the cent; loose: it may itself
  // be OCR-cut ("244.00" for 12,19,244.00), so a close match counts.
  const nextConfirms = (index, balance, loose = false) => {
    const next = rows[index + 1];
    if (!next) return true;
    const fits = (candidate) => same(candidate, next.balance) || (loose && closeDigits(Math.abs(candidate), next.balance));
    return next.amount !== null && (fits(balance + next.amount) || fits(balance - next.amount));
  };
  rows.forEach((row, index) => {
    let { amount, balance } = row;
    let note = null;
    let confirmed = true;
    if (previous === null) {
      // First row of a page with no readable Brought Forward: the opening balance comes from this row.
      if (amount === null) return;
      const side = row.side ?? directionHint(row.particulars);
      previous = roundMoney(side === "W" ? balance + amount : balance - amount);
    } else if (amount === null) {
      amount = roundMoney(Math.abs(balance - previous));
      note = "amount unreadable, taken from the balance change";
      confirmed = nextConfirms(index, balance, true);
    } else if (!same(previous + amount, balance) && !same(previous - amount, balance)) {
      const side = row.side ?? (balance >= previous ? "D" : "W");
      const repaired = roundMoney(side === "D" ? previous + amount : previous - amount);
      if (nextConfirms(index, balance) && !nextConfirms(index, repaired)) {
        amount = roundMoney(Math.abs(balance - previous));
        note = `amount ${row.amount.toFixed(2)} did not fit the balance, taken from the balance change`;
        confirmed = nextConfirms(index, balance, true) && closeDigits(row.amount, amount);
      } else {
        balance = repaired;
        note = `balance ${row.balance.toFixed(2)} did not fit the amount, recomputed`;
        confirmed = nextConfirms(index, repaired, true) && closeDigits(row.balance, repaired);
      }
    }
    const delta = roundMoney(balance - previous);
    out.push({ ...row, amount, balance, delta, previous, note, flagged: Boolean(note) && !confirmed });
    previous = balance;
  });
  return out;
}

// Orders merged rows so each starts from the balance the one before it ended on. Pages are photographed
// out of order; rows that cannot be linked keep their file order at the end.
function chainOrder(rows) {
  const left = [...rows];
  const ordered = [];
  const balances = new Set(rows.map((row) => row.balance));
  let current = left.find((row) => !balances.has(row.previous)) ?? left[0];
  while (current) {
    ordered.push(current);
    left.splice(left.indexOf(current), 1);
    const balance = current.balance;
    current = left.find((row) => same(row.previous, balance));
  }
  return [...ordered, ...left];
}

function parseDrCrPassbook(lines) {
  const byPage = new Map();
  for (const line of lines) byPage.set(line.pageNumber, [...(byPage.get(line.pageNumber) || []), line]);

  // The same printed row photographed again (same balance after the same movement) is kept once, with
  // every copy's date as a candidate and the best narration.
  const seen = new Map();
  const merged = [];
  for (const [pageNumber, pageLines] of [...byPage].sort((a, b) => a[0] - b[0])) {
    const page = analysePage(pageNumber, pageLines);
    if (!page) continue;
    for (const row of resolvePage(page)) {
      const key = `${row.balance}|${row.delta}`;
      const earlier = seen.get(key);
      if (!earlier) {
        const entry = { ...row, dates: row.date ? [row.date] : [] };
        seen.set(key, entry);
        merged.push(entry);
        continue;
      }
      if (row.date) earlier.dates.push(row.date);
      if (row.particulars.length > earlier.particulars.length) earlier.particulars = row.particulars;
      earlier.cheque ??= row.cheque;
      // One clean photo of a row is enough: its copies' repair notes no longer apply.
      if (!row.flagged) earlier.flagged = false;
    }
  }

  const ordered = chainOrder(merged);
  // A row's date: the most-read candidate that does not go back in time (misread years are the usual error).
  let last = null;
  for (const row of ordered) {
    const counts = new Map();
    for (const date of row.dates) if (!last || date >= last) counts.set(date.getTime(), (counts.get(date.getTime()) ?? 0) + 1);
    // Most-read wins; on a tie the first page's reading (Map keeps insertion order) stays.
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    row.chosen = best ? new Date(best[0]) : null;
    last = row.chosen ?? last;
  }
  // No readable date but the neighbours agree: it can only be that date.
  ordered.forEach((row, index) => {
    const [before, after] = [ordered[index - 1]?.chosen, ordered[index + 1]?.chosen];
    if (!row.chosen && before && after && before.getTime() === after.getTime()) row.chosen = before;
  });

  const issues = [];
  const transactions = ordered.map((row, index) => {
    const label = `${row.particulars || "row"} (${row.balance.toFixed(2)})`;
    if (row.flagged) issues.push(`${row.note}: ${label}`);
    if (!row.chosen) issues.push(`date unreadable: ${label}`);
    if (index > 0 && !same(row.previous, ordered[index - 1].balance)) issues.push(`does not continue from the previous balance (a page may be missing): ${label}`);
    return {
      date: row.chosen,
      particulars: row.particulars || "TRANSACTION",
      chequeNo: row.cheque,
      withdrawal: row.delta < 0 ? Math.abs(row.delta) : null,
      deposit: row.delta > 0 ? row.delta : null,
      balance: row.balance,
      ...(row.note ? { hadOcrCorrection: true, correctionNote: row.note } : {}),
    };
  });
  return { transactions, issues };
}

export { isDrCrPassbookLayout, parseDrCrPassbook, parseAmount, analysePage, resolvePage, mergeFragments, closeDigits, alignInOrder, median };
