import { clean, parseAmount, parseDate, roundMoney } from "./common.js";

const amountPattern = "(?:\\d{1,3}(?:,\\d{2,3})+|\\d+)\\.\\d{2}";

// A statement whose own text layer was baked in badly (e.g. produced by a lossy scan-to-PDF
// tool, not this app's own OCR) can have its header row garbled beyond recognition even though
// "The Federal Bank Ltd.", the column names, and the "for ... period" phrase all still survive
// individually -- one real sample had "Statement of Account forthe period" (space dropped) and a
// header line mangled past matching any fixed multi-word sequence at all. Requiring the header as
// one exact phrase made detection fail outright on an otherwise financially-parseable statement;
// checking for the column names independently is far more tolerant of that kind of corruption.
//
// "Particulars" itself is deliberately NOT required here: one real sample had it letter-spaced
// into unrecognizable noise ("P a r t i CU1a r S 1;;= ...") by the PDF's own baked-in OCR text
// layer while "Withdrawals"/"Deposits"/"Balance" on the very same header line survived intact.
// Those three column names plus the bank name and statement-period phrase are already a specific
// enough fingerprint on their own.
function isFederalLayoutText(text) {
  return (
    /The\s+Federal\s+Bank\s+Ltd\s*\./i.test(text) &&
    /Statement of Account for\s*the\s+period/i.test(text) &&
    /\bWithdrawals\b/i.test(text) &&
    /\bDeposits\b/i.test(text) &&
    /\bBalance\b/i.test(text)
  );
}

function isFederalLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return isFederalLayoutText(text);
}

function extractOpeningBalance(lines) {
  for (const line of lines) {
    const text = clean(line.text || line);
    const match = text.match(/Opening Balance\s*:\s*(-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2})/i);
    if (match) return parseAmount(match[1]);
  }

  return null;
}

function extractPrintedTotals(lines) {
  for (const line of lines) {
    const text = clean(line.text || line);
    const match = text.match(new RegExp(`^GRAND TOTAL\\s+(${amountPattern})\\s+(${amountPattern})`, "i"));
    if (!match) continue;

    return {
      source: "printed",
      withdrawal: Math.abs(parseAmount(match[1])),
      deposit: Math.abs(parseAmount(match[2])),
      closingBalance: null,
    };
  }

  return null;
}

function isHeaderOrFooter(text) {
  return (
    !text ||
    /^Name\b/i.test(text) ||
    /^Communication Address\b/i.test(text) ||
    /^Branch (Name|Sol Id)\b/i.test(text) ||
    /^(Palghar|House Dreams|401202 India)\b/i.test(text) ||
    /^(Account Number|Customer Id|Address Last Updated On|Account Open Date)\b/i.test(text) ||
    /^(Regd\. Mobile Number|Account Status|Email Id|Mode of Operation)\b/i.test(text) ||
    /^(Type of Account|Joint Holders|Scheme|IFSC|MICR Code|SWIFT Code)\b/i.test(text) ||
    /^(Effective Available Balance|Opening Balance|Statement of Account)\b/i.test(text) ||
    /^Tran\s+Cheque\s+Balance$/i.test(text) ||
    /^Date\s+Value Date\s+Particulars\s+Tran ID\s+Withdrawals\s+Deposits\s+Balance$/i.test(text) ||
    /^Type\s+Details\s+Type$/i.test(text) ||
    /^Page\s+\d+\s+of\s+\d+$/i.test(text) ||
    /^The Federal Bank Ltd\./i.test(text) ||
    /^Ph:/i.test(text) ||
    /^Abbreviations Used:/i.test(text) ||
    /^(CASH|IB|SBINT|NEFT|CBDC)\s*:/i.test(text) ||
    /^DISCLAIMER:/i.test(text) ||
    /^day end operations/i.test(text) ||
    /^acount, if any/i.test(text) ||
    /^genration of this statement/i.test(text) ||
    /^This is a computer generated statement/i.test(text) ||
    /^within 21 days/i.test(text) ||
    /^\*+\s*END OF STATEMENT/i.test(text)
  );
}

function parseDateLine(text) {
  const match = clean(text).match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})(?:\s+(.*))?$/);
  if (!match) return null;

  return {
    date: parseDate(match[1]),
    valueDate: parseDate(match[2]),
    particulars: clean(match[3] || ""),
  };
}

function parseAmountLine(text) {
  const match = clean(text).match(
    new RegExp(`^(?:(.*?)\\s+)?([A-Z]{2,5})\\s+([A-Z]\\d+)\\s+(${amountPattern})\\s+(${amountPattern})\\s+(CR|DR)$`, "i"),
  );
  if (!match) return null;

  return {
    particulars: clean(match[1] || ""),
    tranType: clean(match[2]).toUpperCase(),
    tranId: clean(match[3]),
    amount: Math.abs(parseAmount(match[4])),
    balance: parseAmount(`${match[5]} ${match[6]}`),
    // The "Cr"/"Dr" printed directly next to this row's own balance -- captured separately from
    // `balance` itself, which only keeps that suffix as a sign (parseAmount negates for "Dr"). A
    // withdrawal row's own balance is routinely still printed "Cr" whenever the account stays
    // positive, so this must never be derived from whether the row is a debit or a credit.
    balanceType: match[6].toUpperCase(),
  };
}

function classifyByBalance(amount, balance, previousBalance) {
  if (previousBalance !== null && previousBalance !== undefined) {
    const delta = roundMoney(balance - previousBalance);
    if (Math.abs(delta - amount) <= 0.05) return { withdrawal: null, deposit: amount };
    if (Math.abs(delta + amount) <= 0.05) return { withdrawal: amount, deposit: null };
  }

  return { withdrawal: amount, deposit: null };
}

function compactParticulars(parts) {
  return clean(parts.filter(Boolean).join(" ")) || "TRANSACTION";
}

function isLikelyNextTransactionPrefix(text) {
  return /^(POS\/|NFT\/|FN(?:\/|$)|FT$|TO(?:\s+ATM|$)|ATM\/)/i.test(clean(text));
}

function parseFederalTransactions(lines) {
  const transactions = [];
  const printedTotals = extractPrintedTotals(lines);
  let previousBalance = extractOpeningBalance(lines);
  let started = false;
  let pending = [];
  let draft = null;
  let current = null;

  const flushPendingToDraft = () => {
    if (!draft || pending.length === 0) return;
    draft.parts.push(...pending);
    pending = [];
  };

  for (const line of lines) {
    const text = clean(line.text || line);

    if (/^Tran\s+Cheque\s+Balance$/i.test(text)) {
      started = true;
      pending = [];
      draft = null;
      current = null;
      continue;
    }

    if (!started) continue;
    if (/^GRAND TOTAL\b/i.test(text)) break;
    if (isHeaderOrFooter(text)) continue;

    const dateLine = parseDateLine(text);
    if (dateLine) {
      draft = {
        date: dateLine.date,
        valueDate: dateLine.valueDate,
        parts: [...pending, dateLine.particulars].filter(Boolean),
      };
      pending = [];
      current = null;
      continue;
    }

    const amountLine = parseAmountLine(text);
    if (amountLine && draft) {
      flushPendingToDraft();
      const { withdrawal, deposit } = classifyByBalance(
        amountLine.amount,
        amountLine.balance,
        previousBalance,
      );

      current = {
        sequence: transactions.length + 1,
        date: draft.date,
        valueDate: draft.valueDate,
        particulars: compactParticulars([...draft.parts, amountLine.particulars]),
        chequeNo: amountLine.tranId,
        tranType: amountLine.tranType,
        withdrawal,
        deposit,
        balance: amountLine.balance,
        type: amountLine.balanceType,
      };

      transactions.push(current);

      previousBalance = amountLine.balance;
      draft = null;
      pending = [];
      continue;
    }

    if (draft) {
      draft.parts.push(text);
    } else if (current) {
      if (isLikelyNextTransactionPrefix(text)) {
        pending = [text];
        current = null;
      } else {
        current.particulars = compactParticulars([current.particulars, text]);
      }
    } else {
      pending.push(text);
    }
  }

  return {
    transactions,
    printedTotals,
  };
}

export { isFederalLayout, isFederalLayoutText, parseFederalTransactions };
