import { clean, parseDate, roundMoney } from "./common.js";

// federalParser.js's parseFederalTransactions assumes a clean, well-formed text layer: a literal
// "Tran Cheque Balance" trigger line, dates in "DD/MM/YYYY" with no internal spacing, and a
// distinct amount-line per transaction. That's the right (and simplest) parser when the PDF's own
// text layer is clean, which is the common case. Some statements arrive with a badly-OCR'd or
// badly-regenerated text layer instead (spaced-out dates, misread Tran Type abbreviations, an
// occasional dropped balance or digit) where that trigger line and date format never appear at
// all. This is a second, tolerant engine for exactly that case: one row per line, fuzzy-matched
// Tran Type, and balance-chain reconciliation used as the source of truth over individual OCR'd
// digits (a stated running balance is self-checking in a way a lone amount isn't).

const TRAN_TYPE_CANONICAL = ["NEFT", "TRF", "CLG", "IMPS", "CASH", "SBINT", "TDINT"];

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j += 1) d[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[rows - 1][cols - 1];
}

function fuzzyTranType(rawToken) {
  if (!rawToken) return null;
  const upper = rawToken.toUpperCase();
  if (TRAN_TYPE_CANONICAL.includes(upper)) return upper;

  let best = null;
  let bestDistance = Infinity;
  for (const candidate of TRAN_TYPE_CANONICAL) {
    const distance = levenshtein(upper, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= 2 ? best : null;
}

// "01 - 07 - 2026" -> "01-07-2026", "02.07-2026" / "24.07.2026" (mixed dot/dash separators) -> the
// same, and "lo-07-2026" -> "10-07-2026" (day/month digits individually misread as their visual
// lookalikes o/O/l/I -- but never the 4-digit year, which is far less likely to get misread this
// way and isn't worth the false-positive risk of guessing at it too). Deliberately narrow (exactly
// two lookalike/digit chars, a separator, two more, a separator, four real digits) so it can't
// accidentally collapse spacing inside an unrelated number.
function normalizeSpacedDates(text) {
  return text.replace(
    /\b([0-9oOlI]{2})\s*[.-]\s*([0-9oOlI]{2})\s*[.-]\s*(\d{4})\b/g,
    (_m, day, month, year) => {
      const fixDigits = (value) => value.replace(/[oO]/g, "0").replace(/[lI]/g, "1");
      return `${fixDigits(day)}-${fixDigits(month)}-${year}`;
    },
  );
}

// A real sample's baked-in OCR text layer misread a couple of "00" decimal endings as letters
// that resemble zero ("1732500.od", "140000.oo1") -- fix just the two decimal-place characters
// (mirroring how AMOUNT_REGEX itself only ever looks at the first two decimal digits and leaves
// anything past them alone) rather than touching digits anywhere else in the line.
function normalizeMoneyOcr(text) {
  return text.replace(/(\d[\d,]*)\.([0-9oOdD]{2})/g, (_m, whole, dec) => `${whole}.${dec.replace(/[oOdD]/g, "0")}`);
}

// Two more artifacts of the same baked-in OCR pass, both from the same real sample: (1) table
// border/pipe characters between columns misread as a standalone "1"/"I"/"l" token -- e.g.
// "02-07-2026 1 02-07-2026 1 FB1854266 TRF I S1042241" where every one of those lone tokens is
// noise, never real data (every genuine field in this row shape is multi-character: a full date,
// a multi-letter Tran Type, a multi-digit Tran ID, or a decimal amount). Stripping them here,
// before date/field parsing, is what lets the value-date group and the Tran Type/Tran ID split
// match at all instead of swallowing the noise into one blob. (2) a short ID token OCR-split by a
// stray space in the middle ("S1 8995728" for what should read "S18995728") -- rejoined only when
// the second half isn't immediately followed by a decimal point, so it can't merge a real
// reference number into a following money amount.
function stripLineNoise(text) {
  return text
    .replace(/(^|\s)[Il1|](?=\s|$)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/\b([A-Za-z]{1,2}\d{1,3})\s+(\d{4,9})\b(?!\.)/g, "$1$2");
}

// "sl042241" for what should read "S1042241": a digit '1' immediately after the ID's real letter
// prefix misread as a lowercase L (or capital I). Narrow to exactly that position (prefix letter,
// then l/I, then another digit) so it can't rewrite a genuine two-letter prefix.
function normalizeTranId(raw) {
  if (!raw) return raw;
  return raw.replace(/^([A-Za-z])[lI](?=\d)/, "$11").toUpperCase();
}

// Amounts always carry a decimal point in this statement; Tran IDs and Cheque Details never do.
// Requiring the decimal point is what keeps this from ever matching a reference number.
const AMOUNT_REGEX = /\d[\d,]*\.\d{1,2}/g;
const TRAN_ID_REGEX = /\b[A-Za-z]{1,2}\d{5,10}\b/g;

function removeSpans(text, spans) {
  const sorted = spans.filter(Boolean).sort((left, right) => left.start - right.start);
  let result = "";
  let cursor = 0;
  for (const span of sorted) {
    result += text.slice(cursor, span.start);
    cursor = Math.max(cursor, span.end);
  }
  result += text.slice(cursor);
  return result;
}

// GR is a one-character OCR misread of CR ("G"/"C" are a common lookalike pair); any other
// single-character-different variant is treated the same way rather than hardcoding GR alone.
function normalizeBalanceType(raw) {
  const upper = raw.toUpperCase();
  if (upper === "CR" || upper === "DR") return upper;
  return levenshtein(upper, "CR") <= 1 ? "CR" : "DR";
}

// Parses one already-clustered line into a row draft, or null if it isn't a transaction line
// (headers, footers, disclaimers, etc. never start with a date and so never reach here). Balance
// and/or amount can come back null when the OCR pass dropped them -- that's resolved afterwards by
// reconcileRows(), not guessed here.
function parseFederalOcrLine(rawText) {
  const text = stripLineNoise(normalizeMoneyOcr(normalizeSpacedDates(clean(rawText))));
  const dateMatch = text.match(/^(\d{2}-\d{2}-\d{4})(?:\s+(\d{2}-\d{2}-\d{4}))?\s*(.*)$/);
  if (!dateMatch) return null;

  const txnDate = parseDate(dateMatch[1]);
  if (!txnDate || Number.isNaN(txnDate.getTime())) return null;
  const valueDate = dateMatch[2] ? parseDate(dateMatch[2]) : txnDate;

  let rest = dateMatch[3] || "";

  let balanceType = null;
  const typeSuffixMatch = rest.match(/\s+(CR|DR|GR)\s*$/i);
  if (typeSuffixMatch) {
    balanceType = normalizeBalanceType(typeSuffixMatch[1]);
    rest = rest.slice(0, typeSuffixMatch.index);
  }

  const amounts = [...rest.matchAll(AMOUNT_REGEX)].map((m) => {
    let end = m.index + m[0].length;
    // A border/pipe character misread as "1"/"I"/"l" and fused directly onto the decimal digits
    // with no space (e.g. "158900.001") leaves that one stray character stuck right after the
    // amount once its own 2-decimal-digit match ends -- absorb it into the removed span too so it
    // doesn't end up as leftover noise in `particulars`.
    if (/[Il1|]/.test(rest[end] || "")) end += 1;
    return { start: m.index, end, value: Number(m[0].replace(/,/g, "")) };
  });

  // A letter+digits token sitting at the very start of `rest` (immediately after the date, before
  // any other text) is this statement's recurring internal-transfer reference ("FB1854266") used
  // AS the row's own Particulars/narration, not a real Tran ID -- every genuine Tran ID in this
  // statement has real narration text before it. Skipping position-0 candidates keeps that
  // narration text in `particulars` instead of misreading it as an ID and stripping it out.
  const idMatches = [...rest.matchAll(TRAN_ID_REGEX)].filter((m) => m.index > 0);
  let tranTypeRaw = null;
  let tranTypeSpan = null;
  let tranId = null;
  let idSpan = null;
  let chequeDetails = null;
  let chequeSpan = null;
  let tranIdLetterUncertain = false;

  let idMatch = idMatches.length > 0 ? idMatches[0] : null;

  // The letter-prefixed regex above found nothing -- this happens when the OCR pass misreads the
  // ID's own leading letter as a digit outright (e.g. "S99281292" -> "599281292", the digit '5'
  // being a visual lookalike for 'S'). Fall back to the longest bare digit run in the row (masked
  // against anything already claimed by an amount, so a balance/amount's own integer part is never
  // mistaken for this) as the ID, flagged so the caller can recover the missing leading letter from
  // this same statement's other, cleanly-read rows rather than guessing it here in isolation.
  if (!idMatch) {
    const digitOnlyMatches = [...rest.matchAll(/\b\d{7,10}\b/g)].filter(
      (m) => !amounts.some((a) => m.index >= a.start && m.index < a.end),
    );
    if (digitOnlyMatches.length > 0) {
      idMatch = digitOnlyMatches[0];
      tranIdLetterUncertain = true;
    }
  }

  if (idMatch) {
    tranId = normalizeTranId(idMatch[0]);
    idSpan = { start: idMatch.index, end: idMatch.index + idMatch[0].length };

    const before = rest.slice(0, idMatch.index);
    // Whole-word only (anchored at a preceding space/string-start too): without that anchor this
    // can match a trailing fragment of a longer narration word (e.g. "tomer" out of "...NEFT
    // Customer") instead of an actual short type code sitting right before the ID.
    const typeWordMatch = before.match(/(?:^|\s)([A-Za-z]{2,5})\s*$/);
    if (typeWordMatch) {
      tranTypeRaw = typeWordMatch[1];
      const wordStart = before.lastIndexOf(typeWordMatch[1]);
      tranTypeSpan = { start: wordStart, end: wordStart + typeWordMatch[1].length };
    }

    const firstAmountStart = amounts.length ? amounts[0].start : rest.length;
    const afterId = rest.slice(idSpan.end, firstAmountStart);
    const chequeMatch = afterId.match(/\b(\d{5,10})\b/);
    if (chequeMatch) {
      chequeDetails = chequeMatch[1];
      const start = idSpan.end + chequeMatch.index;
      chequeSpan = { start, end: start + chequeMatch[1].length };
    }
  }

  const particulars = clean(removeSpans(rest, [...amounts, idSpan, tranTypeSpan, chequeSpan]));

  let amount = null;
  let balance = null;
  let isBalanceMissing = false;
  let isAmountMissing = false;

  if (amounts.length >= 2) {
    amount = amounts[amounts.length - 2].value;
    balance = amounts[amounts.length - 1].value;
  } else if (amounts.length === 1) {
    // The amount always precedes the balance in this row shape, so a single surviving number is
    // almost always the amount with the balance dropped -- even when a dangling "CR"/"DR" survived
    // the OCR pass on its own (the balance *number* it belonged to didn't). Treating that dangling
    // suffix as proof the lone number is the balance instead was backwards and produced nonsense
    // balances; there's no real case in this format where the amount itself goes missing but the
    // balance survives.
    amount = amounts[0].value;
    isBalanceMissing = true;
  } else {
    isAmountMissing = true;
    isBalanceMissing = true;
  }

  return {
    txnDate,
    valueDate,
    particulars: particulars || "TRANSACTION",
    tranType: fuzzyTranType(tranTypeRaw),
    tranTypeRaw,
    tranId,
    tranIdLetterUncertain,
    chequeDetails,
    amount,
    balance,
    balanceType,
    isBalanceMissing,
    isAmountMissing,
  };
}

function extractOpeningBalance(text) {
  const match = normalizeMoneyOcr(text).match(/[' ]?pening\s+Balance\s+(\d[\d,]*\.\d{2})/i);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function extractPrintedTotals(text) {
  const match = normalizeMoneyOcr(text).match(/GRAND TOTAL\s+(\d[\d,]*\.\d{2})\s+(\d[\d,]*\.\d{2})/i);
  if (!match) return null;
  return {
    source: "printed",
    withdrawal: Number(match[1].replace(/,/g, "")),
    deposit: Number(match[2].replace(/,/g, "")),
    closingBalance: null,
  };
}

// A single row is trusted standalone (no wider search needed) only when its own reported balance
// lands within a hair of previousBalance +/- its own reported amount -- tight enough to reject a
// digit-transposition-scale error (tens to hundreds of rupees) but loose enough for paisa rounding.
const TIGHT_TOLERANCE = 0.5;
// How far a run of unresolved rows is allowed to extend looking for a closing anchor before giving
// up and falling back to a best-effort per-row guess. Real cascades in this format are 1-2 rows;
// this just bounds the (cheap but exponential) combinatorial search.
const MAX_RUN_LENGTH = 8;

// Brute-forces all 2^N deposit/withdrawal sign assignments for a run of N rows (whose own amounts
// are trusted throughout -- see the module comment for why balances, not amounts, are the field
// this format's OCR pass actually gets wrong) and returns the assignment whose cumulative balance
// lands closest to `targetBalance`. This is what lets task 2's requirement fall out naturally: if
// the run's own amounts already sum to the anchor-to-anchor delta, every row's *individual* OCR'd
// amount is kept exactly as read -- nothing gets reallocated, only each row's own balance (which is
// what was actually wrong) gets recomputed.
function searchRunSigns(runRows, startingBalance, targetBalance) {
  const n = runRows.length;
  let best = null;

  for (let mask = 0; mask < 2 ** n; mask += 1) {
    let balance = startingBalance;
    for (let i = 0; i < n; i += 1) {
      const isDeposit = (mask & (1 << i)) !== 0;
      balance = roundMoney(balance + (isDeposit ? runRows[i].amount : -runRows[i].amount));
    }
    const score = Math.abs(roundMoney(targetBalance - balance));
    if (!best || score < best.score) best = { mask, score };
  }

  if (best.score > TIGHT_TOLERANCE) return null;

  const perRow = [];
  let running = startingBalance;
  for (let i = 0; i < n; i += 1) {
    const isDeposit = (best.mask & (1 << i)) !== 0;
    running = roundMoney(running + (isDeposit ? runRows[i].amount : -runRows[i].amount));
    perRow.push({ isDeposit, balance: running });
  }
  return perRow;
}

// Digit-string similarity between two money values, used only as a last-resort tiebreaker when a
// whole run of rows can't be reconciled by trusting amounts (not exercised by any row in this
// file's actual data, where amounts always turned out reliable, but item 1 asks for the balance
// not to automatically "win" -- this is what backs that up if a future statement needs it).
function digitDistance(a, b) {
  const fmt = (v) => (v === null ? "" : v.toFixed(2));
  return levenshtein(fmt(a), fmt(b));
}

function finalizeRow(row, balance, amount, hadOcrCorrection, correctionNote) {
  return {
    ...row,
    withdrawal: amount < 0 ? roundMoney(-amount) : null,
    deposit: amount > 0 ? roundMoney(amount) : null,
    balance,
    type: row.balanceType || "CR",
    hadOcrCorrection,
    correctionNote,
  };
}

function reconcileRows(rows, openingBalance) {
  const transactions = [];
  let runningBalance = openingBalance;
  let pending = [];

  const flushBestEffort = () => {
    for (const row of pending) {
      // No anchor ever confirmed this run (ran past MAX_RUN_LENGTH or hit end of statement).
      // Digit-similarity tiebreak: if trusting this row's own amount would require a balance that
      // looks nothing like what OCR actually read, but the row *does* have an OCR'd balance, keep
      // that balance and flag the amount instead -- otherwise default to trusting the amount.
      if (runningBalance === null) {
        transactions.push(finalizeRow(row, row.balance, row.amount ?? 0, true, "No opening balance available to reconcile against; sign is unverified."));
        continue;
      }
      const impliedBalance = row.amount === null ? null : roundMoney(runningBalance + row.amount);
      const trustAmount =
        row.balance === null || impliedBalance === null || digitDistance(row.balance, impliedBalance) <= 2;
      const balance = trustAmount ? impliedBalance ?? row.balance : row.balance;
      const amount = trustAmount ? row.amount ?? 0 : roundMoney(Math.abs(balance - runningBalance));
      transactions.push(
        finalizeRow(
          row,
          balance,
          amount,
          true,
          `Run of ${pending.length} row(s) starting here never reconciled against a later known-good balance; best-effort ${
            trustAmount ? "amount trusted, balance recomputed" : "balance trusted, amount recomputed"
          }. Needs manual review.`,
        ),
      );
      runningBalance = balance;
    }
    pending = [];
  };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];

    if (runningBalance === null) {
      // No opening balance found at all -- nothing to chain from; trust each row's own reading.
      transactions.push(finalizeRow(row, row.balance, row.amount ?? 0, true, "No opening balance available to reconcile against; sign is unverified."));
      if (row.balance !== null) runningBalance = row.balance;
      continue;
    }

    // Fast path: nothing pending, and this row's own balance checks out against its own amount --
    // no wider search needed, and both fields are kept exactly as OCR'd.
    if (pending.length === 0 && row.balance !== null && row.amount !== null) {
      const delta = roundMoney(row.balance - runningBalance);
      if (Math.abs(Math.abs(delta) - row.amount) <= TIGHT_TOLERANCE) {
        transactions.push(finalizeRow(row, row.balance, delta < 0 ? -row.amount : row.amount, false, null));
        runningBalance = row.balance;
        continue;
      }

      // The row's own amount didn't reconcile against its own balance -- rather than defaulting to
      // "the balance wins" (which produced wrong per-row splits when the *amount* was actually the
      // OCR error, e.g. "954380" misread from "964380"), check whether the *next* row's own numbers
      // independently confirm this row's balance: if trusting it, plus the next row's own amount,
      // lands exactly on the next row's own reported balance, that's strong outside evidence this
      // row's balance was fine all along and its amount is the one that was misread.
      const next = rows[index + 1];
      if (next && next.balance !== null && next.amount !== null) {
        const nextDelta = roundMoney(next.balance - row.balance);
        if (Math.abs(Math.abs(nextDelta) - next.amount) <= TIGHT_TOLERANCE) {
          const correctedAmount = roundMoney(Math.abs(delta));
          transactions.push(
            finalizeRow(
              row,
              row.balance,
              delta < 0 ? -correctedAmount : correctedAmount,
              true,
              `OCR amount ${row.amount} replaced with ${correctedAmount}; this row's own balance (${row.balance}) was kept as-is because the next row's own numbers only reconcile starting from it.`,
            ),
          );
          runningBalance = row.balance;
          continue;
        }
      }
    }

    pending.push(row);

    if (pending.length > MAX_RUN_LENGTH) {
      flushBestEffort();
      continue;
    }

    if (row.balance === null) continue; // can't test as a closing anchor yet; keep accumulating

    const resolved = searchRunSigns(pending, runningBalance, row.balance);
    if (!resolved) continue; // doesn't close the run yet; keep accumulating

    for (let i = 0; i < pending.length; i += 1) {
      const r = pending[i];
      const isLast = i === pending.length - 1;
      const { isDeposit, balance } = resolved[i];
      // The run's own OCR'd amounts summed exactly to the anchor-to-anchor delta (that's what
      // searchRunSigns just confirmed), so every row's amount is kept as-is here -- only a row
      // whose own OCR'd balance disagrees with the recomputed one is flagged, and only its balance
      // (never its amount) is what gets corrected.
      const balanceWasWrong = r.balance === null || Math.abs(r.balance - balance) > TIGHT_TOLERANCE;
      transactions.push(
        finalizeRow(
          r,
          balance,
          isDeposit ? r.amount : -r.amount,
          !isLast && balanceWasWrong,
          !isLast && balanceWasWrong
            ? `OCR balance ${r.balance ?? "missing"} replaced with ${balance}; this row's own amount (${r.amount}) was kept as-is because the whole ${pending.length}-row run's amounts summed exactly to the gap between the known-good balances on either side.`
            : null,
        ),
      );
    }
    runningBalance = row.balance;
    pending = [];
  }

  flushBestEffort();
  return transactions;
}

// Two cross-row inferences, both only ever applied using evidence already present elsewhere in
// this SAME statement (never a general assumption): (1) a Tran ID whose leading letter got
// OCR-misread as a digit (parseFederalOcrLine flagged it via tranIdLetterUncertain) has that digit
// replaced with the single letter every other, cleanly-read Tran ID in this statement starts with.
// (2) a row whose Tran Type was dropped entirely by OCR gets backfilled ONLY when every row that
// did have a legible Tran Type agrees on one single value -- any disagreement leaves it null rather
// than guess.
function inferMissingFields(rows) {
  const letterCounts = {};
  for (const row of rows) {
    if (row.tranId && !row.tranIdLetterUncertain && /^[A-Za-z]/.test(row.tranId)) {
      letterCounts[row.tranId[0]] = (letterCounts[row.tranId[0]] || 0) + 1;
    }
  }
  const [majorityLetter] = Object.entries(letterCounts).sort((a, b) => b[1] - a[1])[0] || [null];

  const legibleTranTypes = new Set(rows.filter((row) => row.tranType).map((row) => row.tranType));
  const unanimousTranType = legibleTranTypes.size === 1 ? [...legibleTranTypes][0] : null;

  for (const row of rows) {
    row.fieldCorrectionNotes = [];

    if (row.tranIdLetterUncertain && row.tranId && majorityLetter) {
      const corrected = majorityLetter + row.tranId.slice(1);
      row.fieldCorrectionNotes.push(
        `Tran ID's leading letter was OCR-misread as a digit ('${row.tranId}'); corrected to '${corrected}' because every other cleanly-read Tran ID in this statement starts with '${majorityLetter}'.`,
      );
      row.tranId = corrected;
    }

    if (!row.tranType && unanimousTranType) {
      row.fieldCorrectionNotes.push(
        `Tran Type was dropped by OCR on this row; every other row in this statement that had a legible Tran Type read '${unanimousTranType}', so that value was used.`,
      );
      row.tranType = unanimousTranType;
    }
  }
}

function parseFederalOcrTransactions(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  const openingBalance = extractOpeningBalance(text);
  const printedTotals = extractPrintedTotals(text);

  const rows = [];
  for (const line of lines) {
    const raw = clean(line.text || line);
    if (!raw || /^GRAND TOTAL\b/i.test(raw) || /^[' ]?pening\s+Balance\b/i.test(raw)) continue;
    const row = parseFederalOcrLine(raw);
    if (row) rows.push(row);
  }

  inferMissingFields(rows);

  const transactions = reconcileRows(rows, openingBalance).map((transaction, index) => {
    const fieldNotes = transaction.fieldCorrectionNotes || [];
    return {
      date: transaction.txnDate,
      valueDate: transaction.valueDate,
      particulars: transaction.particulars,
      tranType: transaction.tranType || transaction.tranTypeRaw || null,
      chequeNo: transaction.tranId,
      chequeDetails: transaction.chequeDetails,
      withdrawal: transaction.withdrawal,
      deposit: transaction.deposit,
      balance: transaction.balance,
      type: transaction.type,
      hadOcrCorrection: transaction.hadOcrCorrection || fieldNotes.length > 0,
      correctionNote: [transaction.correctionNote, ...fieldNotes].filter(Boolean).join(" ") || null,
      sequence: index + 1,
    };
  });

  return { transactions, printedTotals, openingBalance };
}

export { parseFederalOcrTransactions, parseFederalOcrLine, fuzzyTranType, normalizeSpacedDates };
