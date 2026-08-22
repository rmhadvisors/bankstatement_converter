import { clean, roundMoney } from "./common.js";

// ICICI Bank "Detailed Statement" layout (used both for regular Cr accounts and OD accounts).
//
// Each transaction is printed as a table row spanning MULTIPLE visual PDF lines (Sl No, Tran Id,
// Value Date, Transaction Date, Transaction Posted Date, Cheque no/Ref No, Transaction Remarks,
// Withdrawal, Deposit, Balance - every one of these cells can itself wrap across several lines,
// since the columns are narrow). Two structural facts make this format tricky to read correctly:
//
//   1. LEFT-SIDE (text) columns are left-aligned, so a fragment's x-coordinate stays close to its
//      own column's anchor even when wrapped - grouping every left-zone token by NEAREST COLUMN
//      ANCHOR (detected once from the header row) reassembles each column's wrapped fragments in
//      their own natural order, independent of which other columns happen to wrap on the same
//      visual line. (Reading tokens strictly in line-then-x order instead - the previous design -
//      interleaves a wrapped Tran Id / date / time fragment with a DIFFERENT row's Remarks text
//      whenever both columns wrap on the same line, producing garbled particulars.)
//   2. RIGHT-SIDE (amount) columns are right-aligned, so a wrapped fragment's x-coordinate is a
//      function of how many digits are left to print, not which column it belongs to - a wide
//      Withdrawal figure can start at nearly the same x as a narrower Deposit figure. Fixed x-band
//      cutoffs (the previous design) misclassify these. Instead, Withdrawal-or-Deposit and Balance
//      are told apart using column ORDER, not x: Withdrawal/Deposit always precedes Balance in
//      reading order, so within any single visual line, of the (at most two) amount fragments
//      present, the first is the amount and the last is the balance; a line with only one fragment
//      continues whichever of the two is still incomplete (missing its ".XX" cents). This is exact
//      regardless of exactly where the PDF happens to wrap the number or its decimal point.
//   3. Which of Withdrawal/Deposit a row's single non-null amount belongs to is then resolved from
//      the balance CHAIN (this row's reconstructed balance vs. the previous row's), the same
//      technique validation.js's correctDebitCreditByBalance uses elsewhere - not from x-position,
//      which the statement itself doesn't render distinctly for Dr vs Cr amounts.
//   4. The statement's own "Opening Bal:" / "Closing Bal:" footer line carries the TRUE sign of the
//      balance column: a regular account prints positive balances throughout, while an overdraft
//      (OD) account prints the footer's own Opening/Closing Bal with a leading "-" because the
//      balance represents money owed to the bank. That footer sign is detected once and applied to
//      every row uniformly, rather than assumed.

function isNoiseLine(text) {
  if (!text) return true;
  return (
    /^Page\s+\d+\s+of\s*\d+/i.test(text) ||
    /^Detailed\s+Statement$/i.test(text) ||
    /^ICICI\s*Bank(\s+Ltd)?$/i.test(text) ||
    /^Name:/i.test(text) ||
    /^A\/C\s+(No|Branch|Type):/i.test(text) ||
    /^Address:/i.test(text) ||
    /^Branch Address:/i.test(text) ||
    /^Jt\.?\s*Holder:/i.test(text) ||
    /^Cust ID:/i.test(text) ||
    /^Transaction Date\s*$/i.test(text) ||
    /^from:/i.test(text) ||
    /^Branch Code:/i.test(text) ||
    /^Transaction Period:/i.test(text) ||
    /^Statement\s*$/i.test(text) ||
    /^Request\/Download/i.test(text) ||
    /^IFSC Code:/i.test(text) ||
    /^Account Currency:/i.test(text) ||
    /^Advanced Search$/i.test(text) ||
    /^Amount from:/i.test(text) ||
    /^Cheque number from:/i.test(text) ||
    /^Transaction remarks:/i.test(text) ||
    /^Transaction type:/i.test(text) ||
    /^Date:?\s*$/i.test(text) ||
    // Header row(s), whichever way the PDF happens to wrap them.
    (/\bSl\s*No\b/i.test(text) && /\bTran\s*Id\b/i.test(text)) ||
    /^(Sl|No|Tran|Id|Value|Date|Transaction|Posted|Cheque|no|\/|Ref|Remarks|Withdra|wal|\(Dr\)|Deposit|\(Cr\)|Balance)(\s+(Sl|No|Tran|Id|Value|Date|Transaction|Posted|Cheque|no|\/|Ref|Remarks|Withdra|wal|\(Dr\)|Deposit|\(Cr\)|Balance))*$/i.test(
      text,
    )
  );
}

function isTerminalLine(text) {
  return (
    /^Legends Used in Account Statement/i.test(text) ||
    /^-{5,}\s*End Of Statement\s*-{5,}/i.test(text) ||
    /^Page Total$/i.test(text) ||
    /^Opening Bal:/i.test(text)
  );
}

function isIciciDetailedLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join(" ");
  if (!/ICICI/i.test(text) || !/Detailed\s+Statement/i.test(text)) return false;
  if (!/IFSC Code:\s*ICIC/i.test(text)) return false;
  if (!/\bTran\b/i.test(text) || !/\bId\b/i.test(text)) return false;
  return /\bWithdra/i.test(text) && /\bDeposit\b/i.test(text) && /\bBalance\b/i.test(text);
}

// A row's leftmost token, in x order (pdfExtractor sorts items left-to-right).
function firstToken(line) {
  const item = (line.items || [])[0];
  return item ? clean(item.text) : "";
}

const MAX_SEQUENCE_JUMP = 8;

function isRowStart(line, lastSeq) {
  const items = line.items || [];
  const text = firstToken(line);
  if (!/^\d+$/.test(text)) return false;
  const value = Number(text);
  if (!(value > lastSeq && value <= lastSeq + MAX_SEQUENCE_JUMP)) return false;

  // A genuine Sl No is always printed together with the start of the Tran
  // Id on the same visual line (e.g. "1 S6918"), never alone. A narration
  // fragment that wraps onto its own line can itself be a bare digit run
  // (e.g. the orphaned tail "5" of a UPI reference code); without this
  // check such a fragment can coincidentally fall inside the jump window
  // and be mistaken for the next row, truncating the real transaction and
  // corrupting the one after it.
  return items.length >= 2;
}

// --- column anchors (x-coordinate based) ------------------------------------

// The header prints all ten columns on one clustered line: "Sl Tran Value Transaction
// Transaction Cheque no / Transaction Withdra Deposit Balance". Three of those labels are the
// literal word "Transaction" (Transaction Date, Transaction Posted Date, Transaction Remarks) -
// they're disambiguated purely by their fixed left-to-right position in that single line, not by
// their text, since the text alone can't tell them apart.
function detectColumnAnchors(lines) {
  for (const line of lines) {
    const items = line.items || [];
    if (items.length !== 10) continue;
    const texts = items.map((item) => clean(item.text));
    const matches =
      /^Sl$/i.test(texts[0]) &&
      /^Tran$/i.test(texts[1]) &&
      /^Value$/i.test(texts[2]) &&
      /^Transaction$/i.test(texts[3]) &&
      /^Transaction$/i.test(texts[4]) &&
      /^Cheque no\s*\/$/i.test(texts[5]) &&
      /^Transaction$/i.test(texts[6]) &&
      /^Withdra/i.test(texts[7]) &&
      /^Deposit$/i.test(texts[8]) &&
      /^Balance$/i.test(texts[9]);
    if (!matches) continue;

    return {
      sl: items[0].x,
      tranId: items[1].x,
      valueDate: items[2].x,
      txnDate: items[3].x,
      posted: items[4].x,
      cheque: items[5].x,
      remarks: items[6].x,
      withdrawal: items[7].x,
    };
  }
  return null;
}

// --- token classification helpers -----------------------------------------

const DATE_NUMERIC_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?$/i;
const AMPM_RE = /^(AM|PM)$/i;

// A time fragment is unambiguous by shape alone, so it's always routed to the Posted column
// regardless of exactly which x it renders at (some statements render it at the same x as the
// Posted Date itself; others give it a slightly different offset) - checking shape first, before
// falling back to nearest-anchor, keeps that column assembly correct either way.
function classifyLeftColumn(token, x, anchors) {
  if (TIME_RE.test(token) || AMPM_RE.test(token)) return "posted";

  const candidates = [
    ["sl", anchors.sl],
    ["tranId", anchors.tranId],
    ["valueDate", anchors.valueDate],
    ["txnDate", anchors.txnDate],
    ["posted", anchors.posted],
    ["cheque", anchors.cheque],
    ["remarks", anchors.remarks],
  ];

  let best = "remarks";
  let bestDistance = Infinity;
  for (const [name, anchorX] of candidates) {
    const distance = Math.abs(x - anchorX);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}

function parseAmountBlob(blob) {
  const text = String(blob || "").replace(/\s+/g, "").replace(/,/g, "");
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// True once the concatenated fragments form a complete "N,NNN.NN"-shaped figure - i.e. nothing
// more is coming for this column. Used to tell a lone continuation fragment on its own line apart
// (it belongs to whichever of Withdrawal/Deposit-amount or Balance is still incomplete).
function isCompleteAmount(tokens) {
  return /^[\d,]+\.\d{2}$/.test(tokens.join(""));
}

function reconstructAmount(tokens) {
  return parseAmountBlob(tokens.join(""));
}

function buildDate(day, month, year) {
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

// Recognizable transaction-type prefixes, taken from this statement's own "Legends Used in
// Account Statement" section plus the handful of plain-English prefixes (CASH, SELF, TRF) ICICI
// prints that aren't in that legend. Longest-first so e.g. "INF/NEFT" wins over the bare "INF".
const TRAN_TYPE_PREFIXES = [
  "INF/NEFT",
  "LCCBRN",
  "UCCBRN",
  "NMQAB",
  "BBPS",
  "BCTT",
  "BPAY",
  "CCWD",
  "DTAX",
  "IDTX",
  "IMPS",
  "INFT",
  "LNPY",
  "NEFT",
  "RTGS",
  "RCHG",
  "RCHG",
  "PAVC",
  "PAYC",
  "CHRG",
  "CASH",
  "SELF",
  "CLG",
  "UPI",
  "ATM",
  "TRF",
  "EBA",
  "BIL",
  "TOP",
  "ONL",
  "PAC",
  "SMO",
  "VAT",
  "MAT",
  "NFS",
  "VPS",
  "IPS",
  "GIB",
  "CMS",
  "INF",
];

function inferTranType(narration) {
  const text = clean(narration).toUpperCase().replace(/^BY\s+/, "");
  for (const prefix of TRAN_TYPE_PREFIXES) {
    if (text.startsWith(prefix)) return prefix;
  }
  return null;
}

// The statement's own "Opening Bal:" / "Withdrawls:" / "Deposits:" / "Closing Bal:" footer is
// authoritative: it carries the true sign of the balance column (see file header, point 4) and,
// separately, gives a printed total to reconcile the extracted rows against (buildValidationReport
// already does this generically once printedTotals is populated).
function detectFooterTotals(lines) {
  let openingMagnitude = null;
  let openingNegative = false;
  let closingMagnitude = null;
  let closingNegative = false;
  let withdrawalsTotal = null;
  let depositsTotal = null;

  for (const line of lines) {
    const text = clean(line.text || line);
    let match = text.match(/^Opening Bal:\s*(-?)([\d,]+\.\d{2})$/i);
    if (match) {
      openingNegative = match[1] === "-";
      openingMagnitude = Number(match[2].replace(/,/g, ""));
      continue;
    }
    match = text.match(/^Withdrawls?:\s*(-?)([\d,]+\.\d{2})$/i);
    if (match) {
      withdrawalsTotal = Number(match[2].replace(/,/g, ""));
      continue;
    }
    match = text.match(/^Deposits:\s*(-?)([\d,]+\.\d{2})$/i);
    if (match) {
      depositsTotal = Number(match[2].replace(/,/g, ""));
      continue;
    }
    match = text.match(/^Closing Bal:\s*(-?)([\d,]+\.\d{2})$/i);
    if (match) {
      closingNegative = match[1] === "-";
      closingMagnitude = Number(match[2].replace(/,/g, ""));
    }
  }

  const balanceSign = openingNegative || closingNegative ? -1 : 1;

  return {
    balanceSign,
    openingBalance: openingMagnitude !== null ? roundMoney(openingMagnitude * balanceSign) : null,
    closingBalance: closingMagnitude !== null ? roundMoney(closingMagnitude * balanceSign) : null,
    withdrawalsTotal: withdrawalsTotal !== null ? roundMoney(withdrawalsTotal) : null,
    depositsTotal: depositsTotal !== null ? roundMoney(depositsTotal) : null,
  };
}

// Reconstructs one transaction from every visual line between this row's Sl No and the next.
// `rowLines` are the raw pdfExtractor line objects (each with its own `items`), in document order.
function buildRow(rowLines, anchors) {
  const leftBoundary = (anchors.remarks + anchors.withdrawal) / 2;
  const leftGroups = { tranId: [], posted: [], cheque: [], remarks: [] };

  const amountTokens = [];
  const balanceTokens = [];
  let phase = "amount"; // "amount" -> "balance" -> "done", strictly forward (see file header, point 2)

  for (const line of rowLines) {
    const items = line.items || [];
    const leftItems = [];
    const amountItems = [];

    for (const item of items) {
      const token = clean(item.text);
      if (!token) continue;
      if (item.x >= leftBoundary) amountItems.push({ x: item.x, text: token });
      else leftItems.push({ x: item.x, text: token });
    }

    for (const item of leftItems) {
      const column = classifyLeftColumn(item.text, item.x, anchors);
      if (column === "sl" || column === "valueDate" || column === "txnDate") continue;
      leftGroups[column].push(item.text);
    }

    // The empty-column filler ("-") and any dash glued directly onto a neighbouring amount with
    // no separator (e.g. "49,990.00-") never carry a value; strip it before reconstruction so it
    // can't be misread as part of either figure.
    const amountFragments = amountItems
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text.replace(/-+$/, ""))
      .filter(Boolean);

    if (amountFragments.length === 2) {
      amountTokens.push(amountFragments[0]);
      balanceTokens.push(amountFragments[1]);
      phase = isCompleteAmount(balanceTokens) ? "done" : "balance";
    } else if (amountFragments.length === 1) {
      if (phase === "amount") {
        amountTokens.push(amountFragments[0]);
        if (isCompleteAmount(amountTokens)) phase = "balance";
      } else if (phase === "balance") {
        balanceTokens.push(amountFragments[0]);
        if (isCompleteAmount(balanceTokens)) phase = "done";
      }
    }
  }

  let postedDate = null;
  const timeParts = [];
  for (const token of leftGroups.posted) {
    if (!postedDate && DATE_NUMERIC_RE.test(token)) {
      postedDate = token;
      continue;
    }
    if (TIME_RE.test(token) || AMPM_RE.test(token)) timeParts.push(token);
  }
  if (!postedDate) return null;

  const date = buildDate(postedDate.slice(0, 2), postedDate.slice(3, 5), postedDate.slice(6, 10));
  const tranId = leftGroups.tranId.join("");
  const chequeNo = leftGroups.cheque.length ? clean(leftGroups.cheque.join(" ")) : null;
  const narration = clean(leftGroups.remarks.join(" ")) || "TRANSACTION";

  const descriptionParts = [tranId];
  if (chequeNo) descriptionParts.push(`[Ref/Chq: ${chequeNo}]`);
  descriptionParts.push(narration);
  const timestamp = [postedDate, timeParts.join(" ")].filter(Boolean).join(" ");
  if (timestamp) descriptionParts.push(`(${timestamp})`);

  const amount = reconstructAmount(amountTokens);
  const balance = reconstructAmount(balanceTokens);

  return {
    date,
    particulars: clean(descriptionParts.filter(Boolean).join(" ")),
    chequeNo,
    tranType: inferTranType(narration),
    amount: amount !== null ? roundMoney(amount) : null,
    balance: balance !== null ? roundMoney(balance) : null,
  };
}

function parseIciciDetailedTransactions(lines) {
  const anchors = detectColumnAnchors(lines);
  const footer = detectFooterTotals(lines);
  const transactions = [];
  let lastSeq = 0;
  let maxSeq = 0;
  let currentLines = null;
  let stopped = false;
  // Balance-delta sign (not magnitude - see buildRow's self-heal note) decides Withdrawal vs.
  // Deposit; the footer's own Opening Bal seeds it so even the very first row can be classified.
  let previousBalance = footer.openingBalance;

  const flush = () => {
    if (!currentLines || currentLines.length === 0 || !anchors) {
      currentLines = null;
      return;
    }
    const row = buildRow(currentLines, anchors);
    if (row) {
      const signedBalance = row.balance !== null ? roundMoney(row.balance * footer.balanceSign) : null;

      let withdrawal = null;
      let deposit = null;
      if (row.amount !== null) {
        if (previousBalance !== null && signedBalance !== null) {
          const delta = roundMoney(signedBalance - previousBalance);
          if (delta < 0) withdrawal = row.amount;
          else deposit = row.amount;
        } else {
          deposit = row.amount;
        }
      }

      if (signedBalance !== null) previousBalance = signedBalance;

      transactions.push({
        date: row.date,
        particulars: row.particulars,
        chequeNo: row.chequeNo,
        tranType: row.tranType,
        withdrawal,
        deposit,
        balance: signedBalance,
      });
    }
    currentLines = null;
  };

  for (const line of lines) {
    const text = clean(line.text || line);
    if (!text) continue;

    if (isTerminalLine(text)) {
      stopped = true;
      flush();
      continue;
    }
    if (stopped) continue;

    if (isNoiseLine(text)) continue;

    if (isRowStart(line, lastSeq)) {
      flush();
      currentLines = [];
      lastSeq = Number(firstToken(line));
      maxSeq = Math.max(maxSeq, lastSeq);
    }

    if (!currentLines) continue;
    currentLines.push(line);
  }

  flush();

  const printedTotals =
    footer.withdrawalsTotal !== null && footer.depositsTotal !== null
      ? {
          source: "printed",
          withdrawal: footer.withdrawalsTotal,
          deposit: footer.depositsTotal,
          closingBalance: footer.closingBalance,
        }
      : null;

  return { transactions, maxSlNo: maxSeq, printedTotals };
}

export { isIciciDetailedLayout, parseIciciDetailedTransactions };
