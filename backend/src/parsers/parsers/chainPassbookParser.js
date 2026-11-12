import { roundMoney } from "./common.js";
import { alignInOrder, closeDigits, mergeFragments, median, parseAmount } from "./drCrPassbookParser.js";

// Passbook photos too distorted for column geometry (curved/folded pages, columns that drift with the
// row): SBI "DATE PARTICULARS CHEQUE NO DEBIT CREDIT BALANCE ... Cr" and the Bassein Catholic savings
// passbook "LN NO Date Particulars Chq. No. Withdrawals Deposits Balance Initials". Instead of columns,
// each page's numbers are read in order and matched to the running balance: a row is an amount whose
// balance (prev -/+ amount) shows up next to it. A balance OCR missed is derived (and flagged), an
// amount OCR missed is taken from two readable balances (and flagged). Nothing is output as confirmed
// unless the chain confirms it.

function isChainPassbookLayout(lines) {
  const text = lines.map((line) => line.text || line).join("\n");
  const bassein = /Initials/i.test(text) && /LN\s*NO/i.test(text) && /Withdrawals/i.test(text) && /Deposits/i.test(text);
  const sbi = /Brough/i.test(text) && /Forw/i.test(text) && /Carried/i.test(text) && /DEBIT/.test(text) && /CREDIT/.test(text) && !/WITHDRAWN/i.test(text) && !/DR\s*Amount/i.test(text);
  return bassein || sbi;
}

const same = (a, b) => Math.abs(a - b) < 0.005;
// Every number the chain does not use costs the same, wherever it is, so a path that explains more
// of the page always beats one that explains less.
const SKIP = 1;
const BEAM = 80;

function parseDate(text) {
  const match = String(text ?? "").replace(/\s+/g, "").match(/^(\d{2})[./-](\d{2})[./-](\d{4}|\d{2})$/);
  if (!match) return null;
  const [day, month] = [Number(match[1]), Number(match[2])];
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  return month >= 1 && month <= 12 && date.getUTCDate() === day && year >= 2000 && year <= 2035 ? date : null;
}

// A number token: a 2-decimal amount, or (balances only) an integer whose cents OCR dropped.
function numeric(item) {
  if (parseDate(item.text)) return null; // "15.04.25" would read as the amount 1504.25
  const amount = parseAmount(item.text);
  if (amount !== null) return { ...item, value: amount, approx: false };
  const whole = String(item.text).replace(/\s+/g, "").match(/^\d{5,7}$/);
  return whole ? { ...item, value: Number(whole[0]), approx: true } : null;
}

// Everything on one page: number tokens in reading order, plus the dates, narration words and the page's
// Brought/Carried Forward balances.
function readPage(pageNumber, pageLines) {
  const items = pageLines.flatMap((line) =>
    mergeFragments(
      (line.items || [])
        .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && String(item.text || "").trim())
        .map((item) => ({ x: item.x, y: item.y, text: String(item.text).trim(), line })),
    ),
  );
  // Lines holding a Brought/Carried Forward marker: their numbers are checkpoints, not rows.
  const markerLines = new Map();
  for (const line of pageLines) {
    const text = String(line.text || "");
    if (/Brough|Balance\s*B\s*\//i.test(text) || (/Forw/i.test(text) && !/Carried/i.test(text))) markerLines.set(line, "BF");
    else if (/Carried|Balance\s*C\s*\//i.test(text)) markerLines.set(line, "CF");
  }
  const markerY = (kind) => items.filter((item) => markerLines.get(item.line) === kind && /^(Brough|Forw|Carried|Over|Balance)/i.test(item.text)).map((item) => item.y);
  const [bfYs, cfYs] = [markerY("BF"), markerY("CF")];
  // Brought Forward's number sits on the marker's line; Carried Forward's on or below it. Rows end above it.
  const nearBf = (item) => bfYs.some((y) => Math.abs(item.y - y) < 25);
  const nearCf = (item) => cfYs.some((y) => item.y > y - 15);

  const all = items.map((item) => ({ ...item, number: numeric(item), date: parseDate(item.text) }));
  const exact = all.filter((item) => item.number && !item.number.approx);
  const minNumberX = exact.length ? Math.min(...exact.map((item) => item.x)) : 0;
  // Integers only count in the number columns (not cheque numbers, years, references).
  const columnX = median(exact.map((item) => item.x)) ?? 0;
  const numbers = all
    .filter((item) => item.number && (!item.number.approx || item.x > columnX - 100))
    .filter((item) => item.number.approx || item.x >= minNumberX - 50)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const marks = { bf: null, cf: null };
  const rowNumbers = [];
  for (const item of numbers) {
    if (nearBf(item)) marks.bf = item.number.approx ? marks.bf : item.number.value;
    else if (nearCf(item)) marks.cf = item.number.approx ? marks.cf : item.number.value;
    else rowNumbers.push({ x: item.x, y: item.y, value: item.number.value, approx: item.number.approx, text: item.text });
  }
  const firstMarker = Math.min(...[...bfYs, 1e9]);
  const lastMarker = Math.max(...[...cfYs, -1]);
  return {
    pageNumber,
    tokens: rowNumbers.filter((token) => token.y > (bfYs.length ? firstMarker - 45 : -1) && (cfYs.length ? token.y < lastMarker + 1 : true)),
    marks,
    dates: all.filter((item) => item.date),
    words: all.filter((item) => !item.number && !item.date),
    particularsX: all.find((item) => /^PARTICULARS$/i.test(item.text))?.x ?? Infinity,
    amountSplit: null,
  };
}

// Debit/credit side from where an amount sits relative to the other amounts on the page.
function sideHints(tokens) {
  const xs = tokens.filter((token) => !token.approx && token.value < 1e7).map((token) => token.x).sort((a, b) => a - b);
  let best = null;
  for (let index = 1; index < xs.length; index += 1) {
    const gap = xs[index] - xs[index - 1];
    if (gap >= 100 && (!best || gap > best.gap)) best = { gap, split: (xs[index] + xs[index - 1]) / 2 };
  }
  return best?.split ?? null;
}

// Beam search over one page's number tokens, starting from the balance the page opens with.
function solvePage(page, startBalance, narrationHint) {
  const tokens = page.tokens;
  const split = sideHints(tokens);
  const sideOf = (token) => (split === null ? null : token.x < split ? "W" : "D");
  let beam = [{ i: 0, balance: startBalance, cost: 0, rows: [] }];
  const finished = [];

  while (beam.length) {
    const next = new Map();
    const push = (state, row, cost, i) => {
      const key = `${i}|${row.balance}|${state.rows.length}`;
      const existing = next.get(key);
      if (existing && existing.cost <= cost) return;
      next.set(key, { i, balance: row.balance, cost, rows: [...state.rows, row] });
    };
    for (const state of beam) {
      finished.push({ ...state, cost: state.cost + SKIP * Math.max(0, tokens.length - state.i) });
      for (let ia = state.i; ia < Math.min(tokens.length, state.i + 6); ia += 1) {
        const amountToken = tokens[ia];
        if (amountToken.approx || amountToken.value <= 0) continue;
        const skipCost = state.cost + SKIP * (ia - state.i);

        if (state.balance === null) {
          // No balance to continue from (first page, no Brought Forward): the first amount and its
          // balance start the chain; the opening is derived.
          for (let ib = state.i; ib < Math.min(tokens.length, ia + 4); ib += 1) {
            const balanceToken = tokens[ib];
            if (ib === ia || balanceToken.approx) continue;
            const side = sideOf(amountToken) ?? narrationHint(amountToken);
            const delta = side === "W" ? -amountToken.value : amountToken.value;
            push(state, { balance: balanceToken.value, delta, opening: roundMoney(balanceToken.value - delta), y: amountToken.y, confirmed: true, amountText: amountToken.text }, state.cost + 0.5 + SKIP * (Math.min(ia, ib) - state.i + Math.abs(ib - ia) - 1), Math.max(ia, ib) + 1);
          }
          continue;
        }

        // The amount as read, or (cents OCR-garbled: "21259.06") the whole number.
        const amountReads = [[amountToken.value, 0]];
        if (amountToken.value % 1 !== 0 && amountToken.value >= 100) amountReads.push([Math.floor(amountToken.value), 0.4]);
        for (const [amountValue, amountCost] of amountReads) {
          for (const sign of [1, -1]) {
            const expected = roundMoney(state.balance + sign * amountValue);
            if (expected < 0) continue;
            const sideCost = sideOf(amountToken) && sideOf(amountToken) !== (sign > 0 ? "D" : "W") ? 0.6 : 0;
            let matched = false;
            for (let ib = state.i; ib < Math.min(tokens.length, ia + 4); ib += 1) {
              if (ib === ia) continue;
              const balanceToken = tokens[ib];
              const read = balanceToken.approx ? (Math.floor(expected) === balanceToken.value ? 0.3 : null) : same(expected, balanceToken.value) ? 0 : closeDigits(expected, balanceToken.value) ? 0.8 : null;
              if (read === null) continue;
              matched = true;
              push(state, { balance: expected, delta: roundMoney(sign * amountValue), y: amountToken.y, confirmed: read <= 0.3 || (amountCost > 0 && read <= 0.8), note: read > 0.3 ? "balance misread" : null }, state.cost + read + amountCost + sideCost * 0.5 + SKIP * (Math.min(ia, ib) - state.i + Math.abs(ib - ia) - 1), Math.max(ia, ib) + 1);
            }
            // Balance unreadable: the row is kept (amount + chain) but is not confirmed.
            // (A number as big as the balance itself is a misread balance, not an amount.)
            if (!matched && amountCost === 0 && amountValue <= 0.8 * state.balance) push(state, { balance: expected, delta: roundMoney(sign * amountValue), y: amountToken.y, confirmed: false, note: "balance unreadable, computed from the amount" }, skipCost + 0.8 + sideCost, ia + 1);
          }
        }
      }
      // Amount unreadable: two readable balances give it.
      if (state.balance !== null) {
        for (let ib = state.i; ib < Math.min(tokens.length, state.i + 4); ib += 1) {
          const balanceToken = tokens[ib];
          if (balanceToken.approx || same(balanceToken.value, state.balance)) continue;
          push(state, { balance: balanceToken.value, delta: roundMoney(balanceToken.value - state.balance), y: balanceToken.y, confirmed: false, note: "amount unreadable, taken from the balance change" }, state.cost + SKIP * (ib - state.i) + 0.9, ib + 1);
        }
      }
    }
    beam = [...next.values()].sort((a, b) => a.cost - b.cost).slice(0, BEAM);
  }
  return finished.sort((a, b) => a.cost - b.cost || b.rows.length - a.rows.length)[0];
}

function parseChainPassbook(lines) {
  const byPage = new Map();
  for (const line of lines) byPage.set(line.pageNumber, [...(byPage.get(line.pageNumber) || []), line]);

  const rows = [];
  const issues = [];
  let balance = null;
  for (const [pageNumber, pageLines] of [...byPage].sort((a, b) => a[0] - b[0])) {
    const page = readPage(pageNumber, pageLines);
    if (page.marks.bf !== null && balance !== null && !same(page.marks.bf, balance)) issues.push(`Page ${pageNumber}: Brought Forward ${page.marks.bf.toFixed(2)} does not match the previous page's closing balance ${balance.toFixed(2)}.`);
    const start = balance ?? page.marks.bf;
    if (!page.tokens.length) {
      issues.push(`Page ${pageNumber}: no readable amounts (rotated or too blurred); its rows are missing.`);
      continue;
    }
    const narrationHint = () => "D";
    const solved = solvePage(page, start, narrationHint);
    if (!solved?.rows.length) {
      issues.push(`Page ${pageNumber}: no rows could be matched to the running balance.`);
      continue;
    }
    // A page where most rows could not be confirmed is too blurred to read: its rows would be mostly
    // guesses, so none are output and the page is reported instead.
    const unconfirmed = solved.rows.filter((row) => !row.confirmed).length;
    if (unconfirmed / solved.rows.length > 0.4) {
      issues.push(`Page ${pageNumber}: too blurred to read reliably (${unconfirmed} of ${solved.rows.length} rows could not be checked against the balance); its rows are missing.`);
      balance = page.marks.cf;
      continue;
    }
    const pageRows = solved.rows.map((row) => ({ ...row, page: pageNumber, particulars: "", dateCandidates: [] }));
    if (balance === null && pageRows[0].opening !== undefined) rows.opening = pageRows[0].opening;

    // Dates (left column) in order against the rows; narration lines belong to the row printed above them.
    const dateLeft = page.dates.length ? Math.min(...page.dates.map((item) => item.x)) : 0;
    const leftDates = page.dates.filter((item) => item.x < Math.min(page.particularsX - 150, dateLeft + 700)).sort((a, b) => a.y - b.y);
    const spacing = Math.max(60, median(pageRows.slice(1).map((row, index) => row.y - pageRows[index].y).filter((gap) => gap > 25)) ?? 110);
    const dateRows = alignInOrder(pageRows.map((row) => row.y), leftDates.map((item) => item.y), spacing);
    leftDates.forEach((item, index) => {
      const row = pageRows[dateRows.get(index)];
      if (row && !row.date) row.date = item.date;
    });
    const amountMinX = Math.min(...page.tokens.filter((token) => !token.approx).map((token) => token.x), Infinity) - 20;
    const dateX = leftDates.length ? median(leftDates.map((item) => item.x)) : 0;
    const orphan = [];
    for (const word of page.words.sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (word.x <= dateX + 60 && dateX > 0 && word.x < page.particularsX - 300) continue;
      if (word.x >= amountMinX || /[ऀ-ॿ]/.test(word.text) || /^(DATE|PARTICULARS|CHEQUE|NO|DEBIT|CREDIT|BALANCE|END|Cr|CR|LN|Date|Particulars|Chq\.?|No\.?|Withdrawals|Deposits|Initials|Balance|Brought|Forward|Carried|Over|C\/F|B\/F)$/i.test(word.text)) continue;
      let owner = null;
      for (const row of pageRows) if (row.y <= word.y + 20) owner = row;
      if (owner) owner.particulars = `${owner.particulars} ${word.text}`;
      else orphan.push(word.text);
    }
    // Lines printed above a page's first row continue the previous page's last row.
    if (orphan.length && rows.length) rows.at(-1).particulars = `${rows.at(-1).particulars} ${orphan.join(" ")}`;
    rows.push(...pageRows);
    balance = pageRows.at(-1).balance;
    if (page.marks.cf !== null && !same(page.marks.cf, balance)) issues.push(`Page ${pageNumber}: Carried Forward ${page.marks.cf.toFixed(2)} does not match the last balance ${balance.toFixed(2)}.`);
  }

  const transactions = [];
  let last = null;
  rows.forEach((row, index) => {
    const before = rows[index - 1]?.date ?? null;
    const after = rows.slice(index + 1).find((candidate) => candidate.date)?.date ?? null;
    let date = row.date ?? null;
    if (date && ((before && date < before) || (after && date > after))) date = null; // a misread date never goes back in time
    if (!date && before && after && before.getTime() === after.getTime()) date = before;
    const label = `${String(row.particulars || "row").trim().slice(0, 60)} (${row.balance.toFixed(2)})`;
    if (!row.confirmed) issues.push(`${row.note ?? "balance misread"}: ${label}`);
    if (!date) issues.push(`date unreadable: ${label}`);
    last = date ?? last;
    transactions.push({
      date,
      particulars: String(row.particulars || "").replace(/\s+/g, " ").trim() || "TRANSACTION",
      chequeNo: null,
      withdrawal: row.delta < 0 ? Math.abs(row.delta) : null,
      deposit: row.delta > 0 ? row.delta : null,
      balance: row.balance,
      ...(row.confirmed ? {} : { hadOcrCorrection: true, correctionNote: row.note ?? "balance misread" }),
    });
    rows[index].date = date ?? row.date;
  });
  return { transactions, issues };
}

export { isChainPassbookLayout, parseChainPassbook, readPage, solvePage };
