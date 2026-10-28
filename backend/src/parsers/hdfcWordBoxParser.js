import { roundMoney } from "./parsers/common.js";

// HDFC current-account statements read from word boxes (local OCR or a text layer, see
// extractPdfLocally), including merged multi-month PDFs that mix two HDFC layouts:
//   A: "Page x of N" | Txn Date (dd/mm/yyyy) | Narration | Withdrawals | Deposits | Closing Balance
//      Indian grouping, both amount columns printed, "Value Dt"/"Ref" inside the narration.
//   B: "Statement of account" | Date (dd/mm/yy) | Narration | Chq./Ref.No. | Value Dt |
//      Withdrawal Amt. | Deposit Amt. | Closing Balance, one amount column filled per row.
// Column positions shift between months, so each month's geometry is derived from its own rows
// (date tokens' left edge, amount right-edge clusters) rather than fixed pixels or header words,
// which OCR can miss entirely. Every month is validated on its own against its printed summary.

const DATE_A = /^(\d{2})\/?(\d{2})\/?(\d{4})$/;
const DATE_B = /^(\d{2})\/?(\d{2})\/?(\d{2})$/;

function rowText(row) {
  return row.words.map((word) => word.text).join(" ");
}

// Groups a page's word boxes into visual rows by vertical-center proximity.
function groupRows(words) {
  const sorted = words
    .filter((word) => word.text && Number.isFinite(word.left) && Number.isFinite(word.top))
    .map((word) => ({ ...word, cy: word.top + word.height / 2, right: word.left + word.width }))
    .sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const word of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(word.cy - row.cy) <= Math.max(8, Math.min(word.height, row.height) * 0.6)) {
      row.words.push(word);
      row.cy = row.words.reduce((sum, item) => sum + item.cy, 0) / row.words.length;
      row.height = Math.max(row.height, word.height);
    } else {
      rows.push({ cy: word.cy, height: word.height, words: [word] });
    }
  }
  for (const row of rows) {
    row.words.sort((a, b) => a.left - b.left);
    row.text = rowText(row);
    row.top = Math.min(...row.words.map((word) => word.top));
  }
  return rows;
}

function parseDateToken(text, layout) {
  const digits = String(text).replace(/[^\d/]/g, "");
  const match = digits.match(layout === "A" ? DATE_A : DATE_B);
  if (!match) return null;
  const year = layout === "A" ? Number(match[3]) : 2000 + Number(match[3]);
  const month = Number(match[2]);
  const day = Number(match[1]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function parseAnyDate(text) {
  const match = String(text).match(/(\d{2})\/(\d{2})\/(\d{4}|\d{2})\b/);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
}

// OCR noise like "853,284.69)" or "9,24 ,989.69": keep digits, "." and a leading minus, and
// require exactly two decimals. Returns NaN when the text can't be read as an amount.
function parseAmountText(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const negative = /^[-–—]/.test(text);
  const match = text.replace(/[^\d.]/g, "").match(/^(\d+)\.(\d{2})$/);
  if (!match) return NaN;
  return (negative ? -1 : 1) * Number(`${match[1]}.${match[2]}`);
}

// Rows that close the page header block; the table (or the previous page's continuation) follows.
const HEADER_BLOCK = /From\D{0,8}\d{2}\/\d{2}\/\d{4}|arration|ithdraw|Closing\s*Balance|Statement\s*of\s*account/i;
const AMOUNT_TOKEN = /\d[.,]\d{2}\W?$/;
const DIGIT_FRAGMENT = /^[\d,.\-()]+$/;
const GRID_TOKEN = /^[|[\]{}!]+$/;

function isFooterRow(text) {
  return /^HDFC\s*BANK\s*LIMITED/i.test(text) || /Closing balance includes/i.test(text);
}

function readSummaryNumbers(text) {
  return String(text)
    .split(/\s+/)
    .map((token) => token.replace(/[^\d.,-]/g, ""))
    .filter((token) => /\d/.test(token));
}

// Grid-line artifacts OCR prepends to continuation lines: "IESCROW-...", "|ESCROW", "+1 ESCROW".
function stripGridArtifact(text) {
  return text.replace(/^(?:\+1\s*|[|I!l](?=[A-Z0-9-]))/, "");
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// 1-D clusters of positions: a new cluster starts after a gap wider than `gap`.
function cluster(values, gap) {
  const groups = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    const group = groups.at(-1);
    if (group && value - group.at(-1) <= gap) group.push(value);
    else groups.push([value]);
  }
  return groups;
}

function rowDateWord(row, layout) {
  return row.words.slice(0, 2).find((word) => parseDateToken(word.text, layout));
}

// Column geometry for one month, from its own rows (positions shift between months, never within
// one): the date column's left edge, the right edges of the right-aligned amount columns, and for
// layout B the value-date column's left edge and the Chq./Ref.No. column's right edge.
function deriveGeometry(segment) {
  const rows = segment.pages.flatMap((page) => page.tableRows);
  const words = rows.flatMap((row) => row.words);
  const charW = median(words.filter((word) => word.text.length >= 4).map((word) => word.width / word.text.length)) || 20;
  const tolerance = charW * 2;

  const dateLefts = rows.map((row) => rowDateWord(row, segment.layout)?.left).filter(Number.isFinite);
  const dateGroup = cluster(dateLefts, tolerance).find((group) => group.length >= 3);
  if (!dateGroup) return null;
  const dateLeft = median(dateGroup);
  const isStart = (row) => {
    const word = rowDateWord(row, segment.layout);
    return word && Math.abs(word.left - dateLeft) <= tolerance ? word : null;
  };

  const startRows = rows.filter(isStart);
  const amountRights = startRows.flatMap((row) => row.words.filter((word) => AMOUNT_TOKEN.test(word.text)).map((word) => word.right));
  // The three most populated right-edge clusters, left to right: withdrawals, deposits, balance.
  const amountGroups = cluster(amountRights, charW * 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, 3)
    .sort((a, b) => a[0] - b[0]);
  if (amountGroups.length < 3) return null;
  const amountColumns = ["withdrawal", "deposit", "balance"].map((key, index) => ({
    key,
    right: median(amountGroups[index]),
  }));
  const firstAmountRight = Math.min(...amountGroups[0]);

  let valueDateLeft = null;
  let refRight = null;
  if (segment.layout === "B") {
    const valueDates = startRows
      .map((row) => {
        const index = row.words.findLastIndex((word) => word.right < firstAmountRight && parseDateToken(word.text, "B"));
        return index > 0 && row.words[index] !== isStart(row) ? { row, index } : null;
      })
      .filter(Boolean);
    valueDateLeft = median(valueDates.map(({ row, index }) => row.words[index].left));
    refRight = median(
      valueDates
        .map(({ row, index }) => row.words[index - 1])
        .filter((word) => /\d{5,}/.test(word.text))
        .map((word) => word.right),
    );
  }

  return { charW, tolerance, dateLeft, isStart, amountColumns, valueDateLeft, refRight };
}

// Splits one table row into cells using the month's geometry.
function splitRow(row, geometry, startWord) {
  const { tolerance, charW, amountColumns, valueDateLeft, refRight } = geometry;
  const taken = new Set();
  const cells = { amounts: {}, ref: [], valueDate: null, narration: [] };
  const words = row.words;

  // Right-aligned cells: the word ending at the column's right edge, plus digit fragments OCR split
  // off to its left ("2,51 4.94", "106,521 .00").
  const takeRightAligned = (right) => {
    const end = words.findIndex((word) => !taken.has(word) && Math.abs(word.right - right) <= tolerance && /\d/.test(word.text));
    if (end < 0) return null;
    let start = end;
    while (
      start > 0 &&
      !taken.has(words[start - 1]) &&
      DIGIT_FRAGMENT.test(words[start - 1].text) &&
      words[start].left - words[start - 1].right < charW * 1.5
    ) {
      start -= 1;
    }
    const parts = words.slice(start, end + 1);
    parts.forEach((word) => taken.add(word));
    return parts;
  };

  if (startWord) taken.add(startWord);
  for (const column of amountColumns) {
    const parts = startWord ? takeRightAligned(column.right) : null;
    if (parts) cells.amounts[column.key] = parts.map((word) => word.text).join("");
  }
  if (valueDateLeft !== null) {
    const word = words.find((item) => !taken.has(item) && Math.abs(item.left - valueDateLeft) <= tolerance && /\d/.test(item.text));
    if (word) {
      taken.add(word);
      cells.valueDate = parseDateToken(word.text, "B");
    }
  }
  if (refRight !== null) {
    const parts = takeRightAligned(refRight);
    if (parts) cells.ref = parts.map((word) => word.text);
  }
  const narrationFrom = startWord ? startWord.right : -Infinity;
  // Chq./Ref.No. cells are right-aligned and at most ~16 characters wide; anything between the
  // narration and the ref (stray OCR marks) stays out of the narration.
  const narrationTo = refRight !== null ? refRight - charW * 18 : Infinity;
  cells.narration = words.filter((word) => !taken.has(word) && word.left > narrationFrom && word.right < narrationTo);
  // A standalone "|" at either end of a cell is a leftover table border, never text.
  while (GRID_TOKEN.test(cells.narration[0]?.text)) cells.narration.shift();
  while (GRID_TOKEN.test(cells.narration.at(-1)?.text)) cells.narration.pop();
  return cells;
}

function newSegment(from, to, layout) {
  return { from, to, layout, pages: [], rows: [], opening: null, summary: null, accountType: null };
}

function parseHdfcWordBoxStatement(extraction) {
  const segments = [];
  const logs = [];
  let segment = null;

  // Pass 1: rows per page, pages per month.
  for (const page of extraction.pages || []) {
    const rows = groupRows(page.words || []);
    const pageText = rows.map((row) => row.text).join("\n");
    if (/Account Relationship Summary/i.test(pageText)) continue;

    const period = pageText.match(/From\D{0,8}(\d{2}\/\d{2}\/\d{4})\s*To\D{0,8}(\d{2}\/\d{2}\/\d{4})/i);
    if (period) {
      const from = parseAnyDate(period[1]);
      if (!segment || segment.from.getTime() !== from.getTime()) {
        segment = newSegment(from, parseAnyDate(period[2]), /Page\s*No/i.test(pageText) ? "B" : "A");
        segments.push(segment);
      }
    }
    if (!segment) continue;
    segment.accountType ??= pageText.match(/Account\s*Type\s*:?\s*([A-Z][A-Z ]+ACCOUNT\s*\(\d+\))/i)?.[1]?.replace(/\s+/g, " ");
    const opening = pageText.match(/Opening Balance\s*:\s*(-?[\d,]+\.\d{2})/i);
    if (opening && segment.opening === null) segment.opening = parseAmountText(opening[1]);

    const firstDateRow = rows.findIndex(
      (row) => (rowDateWord(row, segment.layout) && !HEADER_BLOCK.test(row.text)) || /SUMMARY/i.test(row.text),
    );
    const limit = firstDateRow < 0 ? rows.length : firstDateRow;
    let headerEnd = -1;
    for (let index = 0; index < limit; index += 1) {
      if (HEADER_BLOCK.test(rows[index].text) && !isFooterRow(rows[index].text)) headerEnd = index;
    }
    segment.pages.push({ pageNumber: page.pageNumber, tableRows: rows.slice(headerEnd + 1) });
  }

  // Pass 2: per month, split rows into transactions using that month's geometry.
  for (const month of segments) {
    const geometry = deriveGeometry(month);
    if (!geometry) {
      logs.push({ level: "error", stage: "parse", message: `Could not locate the transaction columns for the statement from ${month.from.toISOString().slice(0, 10)}.` });
      continue;
    }
    let current = null;
    let summaryPending = false;
    const narrationLines = [];

    for (const page of month.pages) {
      const pageLines = [];
      for (let index = 0; index < page.tableRows.length; index += 1) {
        const row = page.tableRows[index];
        const text = row.text;

        if (summaryPending && month.layout === "B") {
          const numbers = readSummaryNumbers(text);
          if (numbers.length === 6 && /^\d+$/.test(numbers[1]) && /^\d+$/.test(numbers[2])) {
            const [openingBalance, , , debits, credits, closing] = numbers.map(parseAmountText);
            month.summary = { opening: openingBalance, drCount: +numbers[1], crCount: +numbers[2], debits, credits, closing };
            summaryPending = false;
          }
          continue;
        }
        if (/STATEMENT\s*SUMMARY/i.test(text) || (month.layout === "A" && /^SUMMARY\b/i.test(text.trim()))) {
          if (current) month.rows.push(current);
          current = null;
          summaryPending = true;
          if (month.layout === "A") {
            const following = page.tableRows.slice(index + 1, index + 6).map((item) => readSummaryNumbers(item.text));
            const amounts = following.find((numbers) => numbers.length === 4 && numbers.every((n) => /\.\d{2}$/.test(n)));
            const counts = following.find((numbers) => numbers.length === 2 && numbers.every((n) => /^\d+$/.test(n)));
            if (amounts) {
              const [openingBalance, debits, credits, closing] = amounts.map(parseAmountText);
              month.summary = {
                opening: openingBalance,
                debits,
                credits,
                closing,
                drCount: counts ? +counts[0] : null,
                crCount: counts ? +counts[1] : null,
              };
            }
            break;
          }
          continue;
        }
        if (summaryPending) continue;
        // The footer only ends this page: the last transaction can continue on the next one.
        if (isFooterRow(text)) break;
        if (/End of Statement/i.test(text)) break;
        if (/Opening Balance\s*:|Current Account Details/i.test(text)) continue;

        const startWord = geometry.isStart(row);
        const cells = splitRow(row, geometry, startWord);
        if (startWord) {
          if (current) month.rows.push(current);
          current = {
            date: parseDateToken(startWord.text, month.layout),
            page: page.pageNumber,
            narrationLines: [],
            refParts: [],
            valueDate: cells.valueDate,
            amountTexts: cells.amounts,
          };
        } else if (!current) {
          continue;
        }
        current.refParts.push(...cells.ref);
        if (cells.narration.length) {
          const line = {
            text: cells.narration.map((word) => word.text).join(" "),
            left: cells.narration[0].left,
            right: cells.narration.at(-1).right,
            continuation: !startWord,
          };
          current.narrationLines.push(line);
          pageLines.push(line);
        }
      }
      narrationLines.push(...pageLines);
    }
    if (current) month.rows.push(current);

    // A line that fills the narration column was hard-wrapped mid-word, so the next line joins
    // without a space. B wraps at a fixed character count; A wraps by width in a proportional font
    // and only splits a token that is wider than the column on its own.
    // ponytail: percentile-based "fills the column"; a word-wrapped line that happens to fill it
    // loses one space. Narration text isn't balance-checked.
    const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)] ?? 0;
    const wrapChars = percentile(narrationLines.map((line) => line.text.length), 0.9);
    const wrapWidth = percentile(narrationLines.map((line) => line.right - line.left), 0.95);
    const normalLeft = median(narrationLines.filter((line) => !line.continuation).map((line) => line.left));
    for (const line of narrationLines) {
      line.atEdge =
        month.layout === "B"
          ? line.text.length >= wrapChars - 1
          : !/\s/.test(line.text) && line.right - line.left >= wrapWidth * 0.8;
      line.indentedLeft = line.continuation && line.left < normalLeft - geometry.charW * 0.5;
    }
    if (summaryPending && !month.summary) {
      logs.push({ level: "warn", stage: "parse", message: `${month.from.toISOString().slice(0, 7)}: summary header found but its values were not.` });
    }
  }

  return buildResult(segments, logs);
}

function joinNarration(lines) {
  let text = "";
  lines.forEach((line, position) => {
    const part = line.indentedLeft ? stripGridArtifact(line.text) : line.text;
    if (position === 0) text = part;
    // ponytail: "reaches the right edge" is a per-page max-right heuristic; a word-wrapped line
    // that happens to end at the edge loses one space. Narration text isn't balance-checked.
    else text += lines[position - 1].atEdge ? part : ` ${part}`;
  });
  return text.replace(/\s+/g, " ").trim();
}

function finalizeRow(row, layout) {
  let particulars = joinNarration(row.narrationLines);
  let chequeNo = row.refParts.join("").replace(/[^\dA-Z]/gi, "");
  let valueDate = row.valueDate;
  if (layout === "A") {
    const value = particulars.match(/\s*Value\s*Dt\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (value) {
      valueDate = parseAnyDate(value[1]);
      particulars = particulars.replace(value[0], " ");
    }
    const ref = particulars.match(/\s*\bRef\s*([0-9A-Z]+)\s*$/i);
    if (ref) {
      chequeNo = ref[1];
      particulars = particulars.replace(ref[0], "");
    }
  }
  if (/^0+$/.test(chequeNo)) chequeNo = "";
  const amount = (key) => (row.amountTexts[key] === undefined ? null : parseAmountText(row.amountTexts[key]));
  let withdrawal = amount("withdrawal");
  let deposit = amount("deposit");
  if (withdrawal === 0) withdrawal = null;
  if (deposit === 0) deposit = null;
  return {
    date: row.date,
    valueDate: valueDate || row.date,
    particulars: particulars.replace(/\s+/g, " ").trim(),
    chequeNo: chequeNo || null,
    chequeDetails: chequeNo || null,
    withdrawal,
    deposit,
    balance: amount("balance"),
    page: row.page,
    amountTexts: row.amountTexts,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const eq = (a, b) => a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005;

function buildResult(segments, logs) {
  const ordered = [...segments].sort((a, b) => a.from - b.from);
  const transactions = [];
  const monthlyCheck = [];
  let previousClosing = null;

  for (const segment of ordered) {
    const label = `${MONTHS[segment.from.getUTCMonth()]} ${segment.from.getUTCFullYear()}`;
    const rows = segment.rows.map((row) => finalizeRow(row, segment.layout));
    const opening = segment.opening ?? segment.summary?.opening ?? previousClosing;
    if (previousClosing !== null && !eq(opening, previousClosing)) {
      logs.push({
        level: "error",
        stage: "validation",
        message: `${label}: opening balance ${opening} does not match the previous month's closing ${previousClosing}.`,
      });
    }

    // Running balance, row by row. An amount that couldn't be read at all (NaN) is the only thing
    // ever derived from the chain; a readable amount that breaks the chain is reported, not fixed.
    let balance = opening;
    let breaks = 0;
    for (const row of rows) {
      const unreadable = ["withdrawal", "deposit", "balance"].filter((key) => Number.isNaN(row[key]));
      if (unreadable.length === 1 && balance !== null) {
        const [key] = unreadable;
        const w = row.withdrawal || 0;
        const d = row.deposit || 0;
        if (key === "balance") row.balance = roundMoney(balance - w + d);
        if (key === "withdrawal") row.withdrawal = roundMoney(balance + d - row.balance) || null;
        if (key === "deposit") row.deposit = roundMoney(row.balance - balance + w) || null;
        row.hadOcrCorrection = true;
        row.correctionNote = `Unreadable ${key} "${row.amountTexts[key]}" (page ${row.page}) derived from the running balance.`;
        logs.push({ level: "warn", stage: "parse", message: `${label}: ${row.correctionNote}` });
      }
      const expected = balance === null ? null : roundMoney(balance - (row.withdrawal || 0) + (row.deposit || 0));
      if (!eq(expected, row.balance)) {
        breaks += 1;
        logs.push({
          level: "error",
          stage: "validation",
          message:
            `${label} page ${row.page}: running balance break on ${row.date.toISOString().slice(0, 10)} ` +
            `"${row.particulars.slice(0, 40)}" -- expected ${expected}, row shows ${row.balance} ` +
            `(withdrawal ${row.withdrawal}, deposit ${row.deposit}). A row may have been missed or misread.`,
        });
      }
      balance = Number.isFinite(row.balance) ? row.balance : expected;
      delete row.amountTexts;
    }

    const debits = roundMoney(rows.reduce((sum, row) => sum + (row.withdrawal || 0), 0));
    const credits = roundMoney(rows.reduce((sum, row) => sum + (row.deposit || 0), 0));
    const drCount = rows.filter((row) => row.withdrawal).length;
    const crCount = rows.filter((row) => row.deposit).length;
    const closing = rows.length ? rows.at(-1).balance : opening;
    const summary = segment.summary;
    const matches =
      summary &&
      eq(summary.debits, debits) &&
      eq(summary.credits, credits) &&
      eq(summary.closing, closing) &&
      (summary.drCount === null || summary.drCount === drCount) &&
      (summary.crCount === null || summary.crCount === crCount);
    if (!summary) {
      logs.push({ level: "error", stage: "validation", message: `${label}: printed statement summary not found.` });
    } else if (!matches) {
      logs.push({
        level: "error",
        stage: "validation",
        message:
          `${label}: converted totals differ from the printed summary -- debits ${debits} vs ${summary.debits}, ` +
          `credits ${credits} vs ${summary.credits}, Dr/Cr count ${drCount}/${crCount} vs ${summary.drCount}/${summary.crCount}, ` +
          `closing ${closing} vs ${summary.closing}.`,
      });
    }

    monthlyCheck.push({
      month: label,
      from: segment.from,
      to: segment.to,
      pages: segment.pages.length ? `${segment.pages[0].pageNumber}-${segment.pages.at(-1).pageNumber}` : "",
      layout: segment.layout,
      opening,
      transactions: rows.length,
      bankDebits: summary?.debits ?? null,
      debits,
      bankCredits: summary?.credits ?? null,
      credits,
      bankDrCount: summary?.drCount ?? null,
      drCount,
      bankCrCount: summary?.crCount ?? null,
      crCount,
      bankClosing: summary?.closing ?? null,
      closing,
      balanceBreaks: breaks,
      status: matches && breaks === 0 ? "MATCH" : "MISMATCH",
    });
    transactions.push(...rows);
    previousClosing = closing;
  }

  const firstOpening = monthlyCheck[0]?.opening ?? null;
  return {
    transactions: transactions.map((row) => ({
      ...row,
      type: row.balance < 0 ? "DR" : "CR",
      ...(row.deposit < 0 ? { isReversal: true } : {}),
    })),
    printedTotals: monthlyCheck.every((month) => month.bankDebits !== null)
      ? {
          openingBalance: firstOpening,
          withdrawal: roundMoney(monthlyCheck.reduce((sum, month) => sum + month.bankDebits, 0)),
          deposit: roundMoney(monthlyCheck.reduce((sum, month) => sum + month.bankCredits, 0)),
          closingBalance: monthlyCheck.at(-1)?.bankClosing ?? null,
        }
      : null,
    openingBalance: firstOpening,
    monthlyCheck,
    logs,
  };
}

// Word boxes from local extraction plus HDFC's own table header on some page.
function isHdfcWordBoxLayout(extraction) {
  const pages = extraction.pages || [];
  if (!pages.some((page) => page.words?.length)) return false;
  const text = String(extraction.text || "");
  return /HDFC\s*BANK/i.test(text) && /Closing\s*Balance/i.test(text) && /(?:Page\s*\d+\s*of\s*\d+|Statement\s*of\s*account)/i.test(text);
}

export { isHdfcWordBoxLayout, parseHdfcWordBoxStatement, parseAmountText, groupRows };
