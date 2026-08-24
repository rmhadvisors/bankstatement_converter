import {
  isColumnarOcrLayout,
  isSocietyCoopLayout,
  parseColumnarOcrStatement,
  parseSocietyCoopStatement,
  isAxisOcrLayout,
} from "./ocrColumnarParser.js";
import { isSocietySavingsCompact, parseSocietySavingsCompact } from "./ocrSocietySavingsParser.js";
import { isSouthIndianBankLayout, parseSouthIndianBankStatement } from "./ocrSouthIndianParser.js";
import {
  isBankOfBarodaLayout,
  parseBankOfBarodaTransactions,
  isBankOfBarodaSavingsLayout,
  parseBankOfBarodaSavingsTransactions,
} from "./bobParser.js";
import {
  isBankOfBarodaWorldAppLayout,
  parseBankOfBarodaWorldAppTransactions,
  toStatementTransactions as toBobWorldAppStatementTransactions,
} from "./bobWorldAppParser.js";
import {
  isBankOfIndiaLayout as isLegacyBankOfIndiaLayout,
  parseBankOfIndiaTransactions as parseLegacyBankOfIndiaTransactions,
} from "./boiParser.js";
import { isStandardCharteredLayout, parseStandardCharteredTransactions } from "./scbParser.js";
import { isVvsbLayout, parseVvsbTransactions } from "./vvsbParser.js";
import { isHdfcOcrLayout, parseHdfcOcrStatement } from "./hdfcOcrParser.js";
import { isPassbookLayout, parsePassbookStatement } from "./passbookParser.js";
import { buildValidationReport, correctDebitCreditByBalance, removeDuplicateTransactions } from "./validation.js";
import { detectBank } from "./parsers/detector.js";
import { isAxisLayout, parseAxisTransactions } from "./parsers/axisParser.js";
import { isBankOfIndiaLayout, parseBankOfIndiaTransactions } from "./parsers/bankOfIndiaParser.js";
import { isCanaraLayout, parseCanaraTransactions } from "./parsers/canaraParser.js";
import { isFederalLayout, parseFederalTransactions } from "./parsers/federalParser.js";
import { parseFederalOcrTransactions } from "./parsers/federalOcrParser.js";
import { isIdbiLayout, parseIdbiTransactions } from "./parsers/idbiParser.js";
import { isIdbiLedgerLayout, parseIdbiLedgerTransactions } from "./parsers/idbiLedgerParser.js";
import { isBccbLedgerLayout, parseBccbLedgerTransactions } from "./parsers/bccbLedgerParser.js";
import { isFinacleTransactionInquiryLayout, parseFinacleTransactions } from "./parsers/finacleOcrParser.js";
import { isJanaLayout, parseJanaTransactions } from "./parsers/janaParser.js";
import { isUnionBankLayout, parseUnionBankTransactions } from "./parsers/unionBankParser.js";
import { isUnionBankOcrLayout, parseUnionBankOcrTransactions } from "./parsers/unionBankOcrParser.js";
import { isPnbLayout, parsePnbTransactions } from "./parsers/pnbParser.js";
import { parsePnbOcrTransactions } from "./parsers/pnbOcrParser.js";
import { isSbiLayout, parseSbiTransactions } from "./parsers/sbiParser.js";
import { isSbiOcrLayout, parseSbiOcrTransactions } from "./parsers/sbiOcrParser.js";
import { isIciciDetailedLayout, parseIciciDetailedTransactions } from "./parsers/iciciDetailedParser.js";
import {
  isGreaterBombayLayoutText,
  isGreaterBombayContinuationText,
  parseGreaterBombayTransactions,
} from "./parsers/greaterBombayParser.js";
import { clean, roundMoney, isChronological } from "./parsers/common.js";

function cleanKey(value) {
  return clean(value).replace(/\s+/g, " ");
}

function parseAmount(raw) {
  if (!raw) return null;

  const text = clean(raw);
  const normalized = text
    .replace(/^(-?)\./, "$10.")
    .replace(/[₹$€£]/g, "")
    .replace(/\s+/g, " ");

  const value = Number(normalized.replace(/,/g, "").replace(/Cr|Dr/gi, ""));
  if (!Number.isFinite(value)) return null;

  return /^-/.test(text) || /\bDr$/i.test(text) ? -Math.abs(value) : value;
}

const monthNames = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function buildDate(day, month, year) {
  let fullYear = Number(year);

  if (fullYear < 100) {
    fullYear += fullYear <= 69 ? 2000 : 1900;
  }

  return new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
}

function parseDate(raw) {
  const text = clean(raw).replace(/^'/, "");
  let match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);

  if (match) {
    return buildDate(match[1], match[2], match[3]);
  }

  match = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (match) {
    return buildDate(match[3], match[2], match[1]);
  }

  match = text.match(/^(\d{1,2})[/-]([A-Za-z]{3,})[/-](\d{4})$/);
  if (match) {
    const month = monthNames[match[2].slice(0, 3).toLowerCase()];
    return month ? buildDate(match[1], month, match[3]) : null;
  }

  match = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (match) {
    const month = monthNames[match[2].slice(0, 3).toLowerCase()];
    return month ? buildDate(match[1], month, match[3]) : null;
  }

  return null;
}

function findRowDate(line) {
  const text = clean(line);
  const patterns = [
    /^(?:\d+\s+)?'?(\d{2}[./-]\d{2}[./-]\d{2,4})\b/,
    /^(?:\d+\s+)?'?(\d{4}[./-]\d{2}[./-]\d{2})\b/,
    /^(?:\d+\s+)?'?(\d{2}[/-][A-Za-z]{3,}[/-]\d{4})\b/,
    /^(?:\d+\s+)?(\d{2}\s+[A-Za-z]{3,}\s+\d{4})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const date = parseDate(match[1]);
    if (!date) continue;

    return {
      date,
      raw: match[1],
      end: match[0].length,
    };
  }

  return null;
}

function isDateStart(line) {
  return Boolean(findRowDate(line));
}

// Slash/dash-separated dates (02/04/2025) are already immune to being mistaken for
// amounts below, because "/" sits in the disallowed-neighbor set. Space-separated dates
// (01 Apr 2025) are not: "01" and "2025" are bounded by spaces just like a real amount
// would be. Mask every date occurrence (leading serial number included, since that only
// ever appears glued to a line-starting date) before scanning for amounts, so date digits
// never get miscounted as debit/credit/balance values.
const anchoredDatePatterns = [
  /^(?:\d+\s+)?'?\d{2}[./-]\d{2}[./-]\d{2,4}\b/,
  /^(?:\d+\s+)?'?\d{4}[./-]\d{2}[./-]\d{2}\b/,
  /^(?:\d+\s+)?'?\d{2}[/-][A-Za-z]{3,}[/-]\d{4}\b/,
  /^(?:\d+\s+)?\d{2}\s+[A-Za-z]{3,}\s+\d{4}\b/,
];
const embeddedDatePatterns = [
  /\b\d{2}[./-]\d{2}[./-]\d{2,4}\b/g,
  /\b\d{4}[./-]\d{2}[./-]\d{2}\b/g,
  /\b\d{2}[/-][A-Za-z]{3,}[/-]\d{4}\b/g,
  /\b\d{2}\s+[A-Za-z]{3,}\s+\d{4}\b/g,
];

function maskDates(text) {
  let masked = text;

  for (const pattern of anchoredDatePatterns) {
    const match = masked.match(pattern);
    if (match) {
      masked = " ".repeat(match[0].length) + masked.slice(match[0].length);
      break;
    }
  }

  for (const pattern of embeddedDatePatterns) {
    masked = masked.replace(pattern, (found) => " ".repeat(found.length));
  }

  return masked;
}

function amountMatches(line, items = null) {
  const maskedLine = maskDates(line);
  const pattern = /-?(?:(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?|\.\d{1,2})(?:\s*(?:Cr|Dr))?/gi;
  const itemPattern = /^-?(?:(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?|\.\d{1,2})(?:\s*(?:Cr|Dr))?$/i;
  const itemAmounts = Array.isArray(items)
    ? items
        .map((item) => ({
          raw: clean(item.text),
          x: item.x,
          used: false,
        }))
        .filter((item) => itemPattern.test(item.raw))
    : [];

  return [...maskedLine.matchAll(pattern)]
    .filter((match) => {
      const before = maskedLine[match.index - 1] || "";
      const after = maskedLine[match.index + match[0].length] || "";
      // A leading "-" in the match is only a sign if it isn't itself the hyphen inside a
      // reference code (e.g. "MB-998494379184", "UPI-509193420633", "NEFTINW-1197045905"):
      // that hyphen directly follows a letter/digit, whereas a real negative-amount sign
      // is preceded by whitespace or punctuation.
      if (/^-/.test(match[0]) && /[A-Za-z0-9]/.test(before)) return false;
      // A real amount is bounded by whitespace/punctuation, never by a letter: reference
      // codes glued directly to digits with no separator (e.g. "FDRLM8119246233",
      // "NEFTINW1197045905") must not be mistaken for a debit/credit/balance figure.
      return !/[.\dA-Za-z/:-]/.test(before) && !/[.\dA-Za-z/:-]/.test(after);
    })
    .map((match) => {
      const raw = clean(match[0]);
      const item = itemAmounts.find((candidate) => !candidate.used && candidate.raw === raw);
      if (item) item.used = true;

      return {
        raw: match[0],
        index: match.index,
        column: item ? item.x : match.index,
        value: parseAmount(match[0]),
      };
    });
}

function isTransactionHeader(line) {
  const text = clean(line);
  return (
    /^date\s+particulars/i.test(text) ||
    /^date\s+narration/i.test(text) ||
    /^#\s+date\s+description/i.test(text) ||
    /^sr\.?\s*no\.?\s+date\s+particulars/i.test(text) ||
    /^tran date\s+chq no\s+particulars/i.test(text) ||
    /^trans date\s+value date/i.test(text) ||
    /^transaction\s+withdrawal\s+deposit\s+balance/i.test(text) ||
    /^s no\.\s+cheque number transaction remarks/i.test(text) ||
    /^date\s+amount\s+\(inr\)/i.test(text) ||
    /^date\s+value date\s+particulars/i.test(text) ||
    /^tran date\s+chq no\s+particulars\s+debit\s+credit\s+balance/i.test(text) ||
    /^tran date\s+value date\s+narration/i.test(text) ||
    /^si\s+date\s+particulars\s+chq\s+num\s+withdrawal\s+deposit\s+balance/i.test(text) ||
    /^description\s+cheque\s+no\.?\s+debit\s+credit\s+balance/i.test(text) ||
    /^#\s+transaction date\s+value date\s+transaction details\s+chq\s*\/\s*ref no\.?\s+debit\s*\/\s*credit/i.test(
      text,
    )
  );
}

function isTerminalSummaryLine(line) {
  const text = clean(line);
  return (
    /^grand total\b/i.test(text) ||
    /^totals?\s*\/\s*balance/i.test(text) ||
    /^transaction total\b/i.test(text) ||
    /^statement summary\b/i.test(text) ||
    /^b\.\s+summary\b/i.test(text) ||
    /^account summary\b/i.test(text) ||
    /^end of statement\b/i.test(text) ||
    /^\*+\s*end of statement/i.test(text) ||
    /^\+{2,}\s*end of statement/i.test(text) ||
    /^closing balance\b/i.test(text) ||
    /^total debits?\s*:/i.test(text) ||
    /^summary\s*:\s*closing balance\s*:/i.test(text) ||
    /^total credits?\s*:/i.test(text) ||
    /^other account details\b/i.test(text) ||
    /^sincerly,?$/i.test(text) ||
    /^team icici bank$/i.test(text) ||
    /^legends?\s/i.test(text) ||
    /^balance as on\b/i.test(text) ||
    /^transaction summary\b/i.test(text) ||
    /^total balance\s*:/i.test(text)
  );
}

function isNoiseLine(line) {
  const text = clean(line);
  if (!text) return true;
  if (/^-{5,}$/.test(text)) return true;
  if (/^\*{5,}$/.test(text)) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^\d+\s+of\s+\d+$/i.test(text)) return true;
  if (/^date\s+particulars/i.test(text)) return true;
  if (/^date\s+narration/i.test(text)) return true;
  if (/^si\s+date\s+particulars\s+chq\s+num\s+withdrawal\s+deposit\s+balance/i.test(text))
    return true;
  if (/^s no\.\s+cheque number transaction remarks/i.test(text)) return true;
  if (/^date\s+amount\s+\(inr\)/i.test(text)) return true;
  if (/^page\s+(no|total|\d+)/i.test(text)) return true;
  if (/^grand total:/i.test(text)) return true;
  if (/^grand total\b/i.test(text)) return true;
  if (/^totals?\s*\/\s*balance/i.test(text)) return true;
  if (/^transaction total\b/i.test(text)) return true;
  if (/^closing balance\b/i.test(text)) return true;
  if (/^total debits?\s*:/i.test(text)) return true;
  if (/^summary\s*:\s*closing balance\s*:/i.test(text)) return true;
  if (/^total credits?\s*:/i.test(text)) return true;
  if (/^other account details\b/i.test(text)) return true;
  if (/^linked (casa accounts|deposits|loan & advances|lockers)\b/i.test(text)) return true;
  if (/^other digital products\b/i.test(text)) return true;
  if (/^no records found$/i.test(text)) return true;
  if (/^this is system generated statement/i.test(text)) return true;
  if (/^request to our customers/i.test(text)) return true;
  if (/^registered office:/i.test(text)) return true;
  if (/^disclaimer:/i.test(text)) return true;
  if (/^total number of transactions/i.test(text)) return true;
  if (/^turnover\b/i.test(text)) return true;
  if (/^all amounts are in/i.test(text)) return true;
  if (/^\*?\s*as on\b/i.test(text)) return true;
  if (/^clrbal:/i.test(text)) return true;
  if (/^transaction details page/i.test(text)) return true;
  if (/^note\s*:/i.test(text)) return true;
  if (/^td sweep unit balance/i.test(text)) return true;
  if (/^account currency\b/i.test(text)) return true;
  if (/^transaction$/i.test(text)) return true;
  if (/^date$/i.test(text)) return true;
  if (/^generation channel\s*:/i.test(text)) return true;
  if (/^generated by\s*:/i.test(text)) return true;
  if (/^unless\s+/i.test(text)) return true;
  if (/^returning\s+/i.test(text)) return true;
  if (/^cheques received/i.test(text)) return true;
  if (/^we are committed/i.test(text)) return true;
  if (/^commitment to customers/i.test(text)) return true;
  if (/^for details please/i.test(text)) return true;
  if (/^within 15 days/i.test(text)) return true;
  if (/^transaction\(s\) in the statement/i.test(text)) return true;
  if (/^please contact/i.test(text)) return true;
  if (/^to get transaction alerts/i.test(text)) return true;
  if (/^abbreviations used/i.test(text)) return true;
  if (/^(retd|si|ec|cbi|sp|ecs|int|inchgs|obc|mb|daue|islixn)\s+-/i.test(text)) return true;
  if (/^pending penal charges/i.test(text)) return true;
  if (/^pending charges/i.test(text)) return true;
  if (/^recovered charges/i.test(text)) return true;
  if (/^nominee details/i.test(text)) return true;
  if (/^important information/i.test(text)) return true;
  if (/^for clarification kindly contact/i.test(text)) return true;
  if (/^non resident indian customers/i.test(text)) return true;
  if (/^\d+\.\s+/.test(text)) return true;
  if (/^this is a computer generated statement/i.test(text)) return true;
  if (/^\+{2,}\s*end of statement\s*\+{2,}$/i.test(text)) return true;
  if (/^\*{2,}\s*end of statement\s*\*{2,}$/i.test(text)) return true;
  if (/^sincerly,?$/i.test(text)) return true;
  if (/^team icici bank$/i.test(text)) return true;
  if (/^legends?\s/i.test(text)) return true;
  if (/^never share your otp/i.test(text)) return true;
  if (/^www\.icici/i.test(text)) return true;
  if (/^please call from/i.test(text)) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^bank of baroda\b/i.test(text)) return true;
  if (/^statement of accounts?/i.test(text)) return true;
  if (/^statement of transactions/i.test(text)) return true;
  if (/^statement summary\b/i.test(text)) return true;
  if (/^statement generated on/i.test(text)) return true;
  if (/^current account transactions/i.test(text)) return true;
  if (/^account statement\b/i.test(text)) return true;
  if (/^[A-Z][A-Z ]+\s+Time\s*:/i.test(text)) return true;
  if (/^hdfc bank limited$/i.test(text)) return true;
  if (/^dcb bank limited$/i.test(text)) return true;
  if (/^the federal bank ltd/i.test(text)) return true;
  if (/^registered office/i.test(text)) return true;
  if (/^contents of this statement/i.test(text)) return true;
  if (/^state account branch gstn/i.test(text)) return true;
  if (/^hdfc bank gstin/i.test(text)) return true;
  if (
    /^(address|branch|helpline no\.?|branch phone no\.?|micr code|ifsc code|gst registration|gst number|currentroi|limit|purpose code|total sanction|from date|phone #|run date|product|period|name currency)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /^(a\/c number|account no|account branch|account type|account status|a\/c open date|statement from|statement of account|rtgs\/neft ifsc|branch code|nomination|joint holders|cust id|email|phone no\.?|city|state|customer id|name|communication address|regd\. mobile number|type of account|scheme|swift code|effective available balance|date of issue|portfolio summary|account details|customer details|home branch details|mode of operation|account holder names|kyc complied|primary id type)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  return false;
}

function looksGenericParticulars(value) {
  const text = clean(value);
  return (
    /^DIGITA-MUMBAI\/?$/i.test(text) ||
    /^EBANK:WIB\/\d+$/i.test(text) ||
    /^UPI\/\d+$/i.test(text) ||
    /^IMPS\/P2A\/\d+$/i.test(text) ||
    /^CHARGES FOR$/i.test(text)
  );
}

function classifyTransaction({ particulars, amount, balance, previousBalance }) {
  if (previousBalance !== null && previousBalance !== undefined) {
    const diff = roundMoney(balance - previousBalance);

    if (Math.abs(diff - amount) <= 0.02) return "deposit";
    if (Math.abs(diff + amount) <= 0.02) return "withdrawal";
  }

  const text = clean(particulars).toUpperCase();
  if (/\b(CR|CREDIT|DEPOSIT)\b/.test(text) || /RTGS CR|FT - CR/.test(text)) {
    return "deposit";
  }

  if (/\b(DR|DEBIT|WITHDRAWAL|CBDT)\b/.test(text) || /NEFT DR/.test(text)) {
    return "withdrawal";
  }

  return "deposit";
}

function splitNarrationAndReference(value) {
  const text = clean(value);
  const tokens = text.split(" ");
  if (tokens.length < 2) {
    return { particulars: text, chequeNo: null };
  }

  const last = tokens[tokens.length - 1];
  if (/^[A-Z0-9]{6,}$/i.test(last) && /\d/.test(last)) {
    return {
      particulars: clean(tokens.slice(0, -1).join(" ")),
      chequeNo: last,
    };
  }

  return { particulars: text, chequeNo: null };
}

function stripSecondDate(value) {
  const text = clean(value);
  const secondDate = findRowDate(text);
  return secondDate ? clean(text.slice(secondDate.end)) : text;
}

function normalizeNarration(value) {
  return clean(value)
    .replace(/^[-#]+\s*/, "")
    .replace(/\s+-\s*$/, "")
    .replace(/\s+/g, " ");
}

function parseTransactionLine(
  line,
  previousBalance,
  pendingNarration = "",
  amountColumns = null,
  items = null,
) {
  const rowDate = findRowDate(line);
  if (!rowDate) return null;

  const date = rowDate.date;
  const amounts = amountMatches(line, items);
  if (!date || amounts.length === 0) return null;

  const balanceMatch = amounts[amounts.length - 1];
  const balance = balanceMatch.value;

  if (amounts.length === 1) {
    return {
      date,
      particulars: normalizeNarration(pendingNarration) || "OPENING BALANCE",
      chequeNo: null,
      withdrawal: null,
      deposit: null,
      balance,
    };
  }

  // A single signed DEBIT/CREDIT column only ever carries one transaction amount plus the
  // balance; any earlier numeric match is stray narration noise (e.g. an unlabeled
  // reference number), not a second debit/credit figure, so don't apply the
  // amounts.length >= 3 "explicit separate debit and credit columns" heuristic to it.
  const hasExplicitDebitCredit = !amountColumns?.signedColumn && amounts.length >= 3;
  const transactionAmountMatch = hasExplicitDebitCredit
    ? amounts[amounts.length - 3]
    : amounts[amounts.length - 2];
  const narrationStart = rowDate.end;
  const narrationEnd = transactionAmountMatch.index;
  let particulars = stripSecondDate(line.slice(narrationStart, narrationEnd));
  let chequeNo = null;

  if (pendingNarration) {
    particulars = clean(`${pendingNarration} ${particulars}`);
  }

  particulars = clean(particulars.replace(/\b\d{2}[/-]\d{2}[/-]\d{2,4}\s*$/, ""));

  const split = splitNarrationAndReference(particulars);
  particulars = normalizeNarration(split.particulars);
  chequeNo = split.chequeNo;

  let withdrawal = null;
  let deposit = null;

  if (amountColumns && amountColumns.signedColumn) {
    const signedValue = transactionAmountMatch.value;
    if (signedValue < 0) {
      withdrawal = Math.abs(signedValue);
    } else if (signedValue > 0) {
      deposit = signedValue;
    }
  } else if (amountColumns && (amountColumns.debit !== null || amountColumns.credit !== null)) {
    const balanceIndex = balanceMatch.index;
    const candidates = amounts.filter((match) => match.index !== balanceIndex);

    for (const match of candidates) {
      const column = match.column ?? match.index;
      const amount = Math.abs(match.value);

      if (
        amountColumns.coordinateBased &&
        amountColumns.debit !== null &&
        amountColumns.credit !== null &&
        amountColumns.debit < amountColumns.credit
      ) {
        if (column < amountColumns.credit) {
          withdrawal = amount;
        } else if (amountColumns.balance === null || column < amountColumns.balance) {
          deposit = amount;
        }
      } else {
        const distanceToDebit =
          amountColumns.debit === null
            ? Number.POSITIVE_INFINITY
            : Math.abs(column - amountColumns.debit);
        const distanceToCredit =
          amountColumns.credit === null
            ? Number.POSITIVE_INFINITY
            : Math.abs(column - amountColumns.credit);

        if (distanceToDebit < distanceToCredit) {
          withdrawal = amount;
        } else if (distanceToCredit < distanceToDebit) {
          deposit = amount;
        }
      }
    }
  }

  if (withdrawal === null && deposit === null) {
    if (hasExplicitDebitCredit) {
      const debit = Math.abs(amounts[amounts.length - 3].value);
      const credit = Math.abs(amounts[amounts.length - 2].value);
      withdrawal = debit > 0 ? debit : null;
      deposit = credit > 0 ? credit : null;
    } else {
      const amount = Math.abs(transactionAmountMatch.value);
      const type = classifyTransaction({
        particulars,
        amount,
        balance,
        previousBalance,
      });

      withdrawal = type === "withdrawal" ? amount : null;
      deposit = type === "deposit" ? amount : null;
    }
  }

  return {
    date,
    particulars: particulars || "TRANSACTION",
    chequeNo,
    withdrawal,
    deposit,
    balance,
  };
}

function appendContinuation(row, line) {
  const continuation = clean(line);
  if (!continuation || isNoiseLine(continuation)) return;

  if (looksGenericParticulars(row.particulars)) {
    row.particulars = continuation;
    return;
  }

  row.particulars = clean(`${row.particulars} ${continuation}`);
}

function parseOpeningBalance(line) {
  const text = clean(line);
  if (!/opening balance/i.test(text)) {
    if (/^-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}\s*(?:Cr|Dr)$/i.test(text)) {
      return parseAmount(text);
    }

    return null;
  }

  const amounts = amountMatches(text);
  if (amounts.length === 0) return null;

  return amounts[amounts.length - 1].value;
}

function extractOpeningBalance(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = clean(lines[index].text || lines[index]);
    if (!line) continue;

    if (/^opening balance\s+dr count\s+cr count\s+debits\s+credits\s+closing bal/i.test(line)) {
      const nextLine = clean(lines[index + 1]?.text || lines[index + 1]);
      const amounts = amountMatches(nextLine);
      if (amounts.length > 0) return amounts[0].value;
    }

    if (!/opening balance/i.test(line)) continue;

    const amounts = amountMatches(line);
    if (amounts.length === 0) continue;
    return amounts[amounts.length - 1].value;
  }

  return null;
}

function detectAmountColumnPositions(entry) {
  const line = entry?.text || entry;
  const items = entry?.items;

  // Some statements (e.g. Kotak) print a single signed "DEBIT/CREDIT" column instead of
  // separate debit and credit columns; there the amount's own sign tells withdrawal from
  // deposit, and column position is meaningless for that split.
  const isSignedColumnHeader = (text) => /^(debit\s*\/\s*credit|dr\s*\/\s*cr)\b/i.test(clean(text));

  if (Array.isArray(items) && items.length > 0) {
    const findItem = (pattern) => items.find((item) => pattern.test(clean(item.text)));

    const signedItem = items.find((item) => isSignedColumnHeader(item.text));
    const debitItem = findItem(/^(debit|withdrawal|dr)\b/i);
    const creditItem = findItem(/^(credit|deposit|cr)\b/i);
    const balanceItem = findItem(/^balance\b/i);

    if (signedItem) {
      return {
        debit: null,
        credit: null,
        balance: balanceItem ? balanceItem.x : null,
        coordinateBased: true,
        signedColumn: true,
      };
    }

    if (debitItem || creditItem || balanceItem) {
      return {
        debit: debitItem ? debitItem.x : null,
        credit: creditItem ? creditItem.x : null,
        balance: balanceItem ? balanceItem.x : null,
        coordinateBased: true,
      };
    }
  }

  const text = clean(line).toLowerCase();

  if (isSignedColumnHeader(text)) {
    const balanceMatch = text.match(/\bbalance\b/);
    return {
      debit: null,
      credit: null,
      balance: balanceMatch ? text.indexOf(balanceMatch[0]) : null,
      coordinateBased: false,
      signedColumn: true,
    };
  }

  const debitMatch = text.match(/\b(debit|withdrawal|dr)\b/);
  const creditMatch = text.match(/\b(credit|deposit|cr)\b/);
  const balanceMatch = text.match(/\bbalance\b/);

  return {
    debit: debitMatch ? text.indexOf(debitMatch[0]) : null,
    credit: creditMatch ? text.indexOf(creditMatch[0]) : null,
    balance: balanceMatch ? text.indexOf(balanceMatch[0]) : null,
    coordinateBased: false,
  };
}

function detectPrefixNarrationMode(lines) {
  const text = lines
    .slice(0, 80)
    .map((line) => clean(line.text || line))
    .join("\n");

  return (
    /Tran Date Chq No Particulars Debit Credit Balance/i.test(text) ||
    /S No\.\s+Cheque Number Transaction Remarks/i.test(text) ||
    /Date Particulars Instruments Dr Amount Cr Amount Total Amount/i.test(text) ||
    /Sr No Date Particulars Debit Credit Balance/i.test(text)
  );
}

function getNextMeaningfulLine(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = clean(lines[index].text || lines[index]);
    if (!line || isNoiseLine(line)) continue;
    return line;
  }

  return "";
}

function shouldAttachToCurrentInPrefixMode(line) {
  const text = clean(line);
  if (
    /^(UPI|IMPS|NEFT|RTGS|MMT|BIL|MOB|NFS|ATM|CLG|CHRG|EBA|FT|CBDT|BY CLG|SENTIMPS)\b[/: -]/i.test(
      text,
    )
  ) {
    return false;
  }

  return (
    /^\d{4}-/.test(text) ||
    /^[A-Z]{4}\d{7,}/i.test(text) ||
    /^(BANK|BRANCH|CELL|SERVICE|CHARGES?\.|GST|CLEARING|LTD\.?|PVT|PRIVATE|ACCOUNT)\b/i.test(
      text,
    ) ||
    /^\/?[A-Z0-9 ]{2,}\/[A-Z0-9]/i.test(text)
  );
}

// A transaction's description can wrap across several visual lines that are split
// around its date/amount line (some wrap before the date, some after), rather than
// only trailing it. When Y-coordinates are available, resolve which side a line
// belongs to geometrically: it's closer to whichever adjacent date-row's position it
// sits nearer to, split at the midpoint between the two rows.
function computeNarrationRoles(lines) {
  const roles = new Array(lines.length).fill(false);
  const dateIndices = [];

  for (let index = 0; index < lines.length; index += 1) {
    const entry = lines[index];
    if (typeof entry?.y !== "number") continue;
    const text = clean(entry.text || entry);
    if (text && isDateStart(text)) dateIndices.push(index);
  }

  if (dateIndices.length > 0) {
    for (let k = 0; k < dateIndices[0]; k += 1) {
      roles[k] = true;
    }
  }

  for (let d = 0; d < dateIndices.length - 1; d += 1) {
    const i1 = dateIndices[d];
    const i2 = dateIndices[d + 1];
    const y1 = lines[i1].y;
    const y2 = lines[i2].y;
    const midpoint = (y1 + y2) / 2;

    for (let k = i1 + 1; k < i2; k += 1) {
      const y = lines[k]?.y;
      if (typeof y !== "number") continue;
      roles[k] = y <= midpoint;
    }
  }

  return roles;
}

function parseTransactions(lines) {
  const transactions = [];
  let current = null;
  let previousBalance = extractOpeningBalance(lines);
  let pendingNarration = [];
  const prefixNarrationMode = detectPrefixNarrationMode(lines);
  let started = !prefixNarrationMode;
  let amountColumns = null;
  const narrationRoles = prefixNarrationMode ? null : computeNarrationRoles(lines);

  for (let index = 0; index < lines.length; index += 1) {
    const entry = lines[index];
    const line = clean(entry.text || entry);
    if (!line) continue;

    if (isTransactionHeader(line)) {
      started = true;
      pendingNarration = [];
      amountColumns = detectAmountColumnPositions(entry);
      continue;
    }

    // A multi-statement PDF (e.g. 12 concatenated monthly HDFC statements) repeats this footer
    // once per month, followed by the next month's header/account-info boilerplate and its own
    // transaction table. Treat it like pre-table boilerplate (skip until the next date row or
    // table header) instead of stopping the scan for good, so later months still get parsed.
    if (started && transactions.length > 0 && isTerminalSummaryLine(line)) {
      started = false;
      current = null;
      pendingNarration = [];
      continue;
    }

    const openingBalance = parseOpeningBalance(line);
    if (openingBalance !== null) {
      previousBalance = openingBalance;
      started = true;
      pendingNarration = [];
      continue;
    }

    if (!started && !isDateStart(line)) {
      continue;
    }

    if (isDateStart(line)) {
      started = true;
      const parsed = parseTransactionLine(
        line,
        previousBalance,
        clean(pendingNarration.join(" ")),
        amountColumns,
        entry.items,
      );
      if (parsed) {
        transactions.push(parsed);
        current = parsed;
        previousBalance = parsed.balance;
        pendingNarration = [];
      }
      continue;
    }

    if (isNoiseLine(line)) {
      continue;
    }

    if (prefixNarrationMode) {
      const nextLine = getNextMeaningfulLine(lines, index + 1);
      if (nextLine && isDateStart(nextLine) && !shouldAttachToCurrentInPrefixMode(line)) {
        pendingNarration.push(line);
        continue;
      }

      if (current && pendingNarration.length === 0) {
        appendContinuation(current, line);
      } else {
        pendingNarration.push(line);
      }
      continue;
    }

    if (narrationRoles && narrationRoles[index]) {
      pendingNarration.push(line);
      continue;
    }

    if (current) {
      appendContinuation(current, line);
    }
  }

  return transactions;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return clean(match[1]);
  }

  return "";
}

function extractAccountInfo(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  const allLines = text.split("\n").map(clean).filter(Boolean);
  const info = [];

  const fields = [
    [
      "Bank",
      [/BANK OF BARODA/i, /HDFC BANK/i, /UNION BANK OF INDIA/i],
      (match) => {
        const value = match[0].toUpperCase();
        if (value.includes("HDFC")) return "HDFC BANK";
        if (value.includes("UNION")) return "UNION BANK OF INDIA";
        return "BANK OF BARODA";
      },
    ],
    ["Branch", [/Account Branch\s*:\s*([^\n]+)/i, /^([A-Z ]+)\s+Time\s*:/im]],
    ["IFSC Code", [/IFSC\s*CODE\s*:\s*([A-Z0-9]+)/i, /RTGS\/NEFT IFSC\s*:\s*([A-Z0-9]+)/i]],
    ["MICR Code", [/MICR\s*(?:CODE)?\s*:\s*([0-9]+)/i]],
    ["Account Name", [/A\/C\s*Name\s*:\s*([^\n]+)/i, /\n(M\/S\.\s*[^\n]+)/i]],
    ["Account Number", [/A\/C\s*Number\s*:\s*([0-9]+)/i, /Account No\s*:\s*([0-9]+)/i]],
    ["Account Type", [/Scheme Description\s*:\s*([^\n]+)/i, /Account Type\s*:\s*([^\n]+)/i]],
    [
      "Account Open Date",
      [/Account Open Date\s*:\s*([0-9/-]+)/i, /A\/C Open Date\s*:\s*([0-9/-]+)/i],
    ],
    [
      "Statement Period",
      [
        /period of\s*([0-9/-]+\s*to\s*[0-9/-]+)/i,
        /Statement From\s*:\s*([0-9/-]+\s*To\s*[0-9/-]+)/i,
      ],
    ],
    ["Address", [/Address\s*:\s*([^\n]+)/i]],
    ["City", [/City\s*:\s*([^\n]+)/i]],
    ["Customer ID", [/Cust ID\s*:\s*([0-9]+)/i]],
    ["Nominee", [/Nominee Name\s*:\s*([^\n]+)/i, /Nomination\s*:\s*([^\n]+)/i]],
    ["Joint Holders", [/Joint Holders\s*:\s*([^\n]+)/i]],
  ];

  for (const field of fields) {
    const [label, patterns, mapper] = field;
    let value = "";

    if (mapper) {
      const match = patterns.map((pattern) => text.match(pattern)).find(Boolean);
      value = match ? mapper(match) : "";
    } else {
      value = firstMatch(text, patterns);
    }

    if (value) {
      info.push({ label: cleanKey(label), value });
    }
  }

  for (const line of allLines) {
    const match = line.match(/^([A-Za-z][A-Za-z ./&-]{2,30})\s*:\s*(.+)$/);
    if (!match) continue;

    const label = cleanKey(match[1]);
    const value = clean(match[2]);
    if (!value) continue;
    if (info.some((entry) => entry.label.toLowerCase() === label.toLowerCase())) continue;
    if (/^(date|time|page no|helpline no|branch phone no)$/i.test(label)) continue;

    info.push({ label, value });
  }

  return info;
}

function extractPrintedTotals(lines) {
  let closingBalance = null;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = clean(lines[index].text || lines[index]);
    if (/^total debits?\s*:/i.test(line)) {
      const debitAmounts = amountMatches(line);
      let credit = null;
      let closing = null;

      for (
        let lookahead = index + 1;
        lookahead < Math.min(lines.length, index + 8);
        lookahead += 1
      ) {
        const nextLine = clean(lines[lookahead].text || lines[lookahead]);
        const amounts = amountMatches(nextLine);

        if (/^total credits?\s*:/i.test(nextLine) && amounts.length > 0) {
          credit = amounts[0].value;
        }

        if (/^summary\s*:\s*closing balance\s*:/i.test(nextLine) && amounts.length > 0) {
          closing = amounts[0].value;
        }
      }

      if (debitAmounts.length > 0 && credit !== null) {
        return {
          source: "printed",
          withdrawal: Math.abs(debitAmounts[0].value),
          deposit: Math.abs(credit),
          closingBalance: closing,
        };
      }
    }

    if (/^opening balance\s+dr count\s+cr count\s+debits\s+credits\s+closing bal/i.test(line)) {
      const nextLine = clean(lines[index + 1]?.text || lines[index + 1]);
      const amounts = amountMatches(nextLine);

      if (amounts.length >= 6) {
        return {
          source: "printed",
          withdrawal: Math.abs(amounts[3].value),
          deposit: Math.abs(amounts[4].value),
          closingBalance: amounts[5].value,
        };
      } else if (amounts.length >= 4) {
        return {
          source: "printed",
          withdrawal: Math.abs(amounts[1].value),
          deposit: Math.abs(amounts[2].value),
          closingBalance: amounts[3].value,
        };
      }
    }

    if (closingBalance === null && /^closing balance\b/i.test(line)) {
      const amounts = amountMatches(line);
      if (amounts.length > 0) {
        closingBalance = amounts[amounts.length - 1].value;
      }
    }

    const isTotalLine =
      /^grand total\b/i.test(line) ||
      /^totals?\s*\/\s*balance/i.test(line) ||
      /^transaction total\b/i.test(line) ||
      /^turnover\b/i.test(line);

    if (!isTotalLine) continue;

    const amounts = amountMatches(line);
    if (amounts.length < 2) return null;

    return {
      source: "printed",
      withdrawal: Math.abs(amounts[0].value),
      deposit: Math.abs(amounts[1].value),
      closingBalance: amounts.length >= 3 ? amounts[2].value : closingBalance,
    };
  }

  return null;
}

function getClosingBalance(transactions) {
  if (transactions.length === 0) return null;
  const closingRow = isChronological(transactions) ? transactions[transactions.length - 1] : transactions[0];
  return closingRow.balance === null ? null : roundMoney(closingRow.balance);
}

function calculateTotalsInStatementOrder(transactions) {
  const totals = transactions.reduce(
    (result, transaction) => {
      result.withdrawal += Number(transaction.withdrawal || 0);
      result.deposit += Number(transaction.deposit || 0);
      return result;
    },
    { withdrawal: 0, deposit: 0 },
  );

  return {
    source: "calculated",
    withdrawal: roundMoney(totals.withdrawal),
    deposit: roundMoney(totals.deposit),
    closingBalance: getClosingBalance(transactions),
  };
}

function parseStatement(extraction) {
  const lines = extraction.lines || [];
  const accountInfo = extractAccountInfo(lines);
  const logs = [];
  let detectedFormat = detectBank(extraction.text || lines);
  let transactions;
  let parserPrintedTotals = null;
  let parsingErrors = [];
  let reviewRows = [];
  let finacleAccountInfo = null;

  if (detectedFormat === "icici-detailed" || isIciciDetailedLayout(lines)) {
    detectedFormat = "icici-detailed";
    const icici = parseIciciDetailedTransactions(lines);
    transactions = icici.transactions;
    parserPrintedTotals = icici.printedTotals;

    // Whole pages of transactions can vanish from the output with no error at all if a table-
    // detection quirk on one page silently returns zero rows (see BUG 1 in the ICICI fix) -- the
    // statement's own "Sl No" column is a ground-truth count of exactly how many transactions it
    // contains, so a mismatch here means rows were dropped and must be surfaced loudly rather than
    // silently truncating the output.
    if (icici.maxSlNo > 0 && icici.maxSlNo !== transactions.length) {
      logs.push({
        level: "error",
        stage: "parse",
        message: `Extracted ${transactions.length} transaction row(s), but the statement's own Sl No column reaches ${icici.maxSlNo}. Some rows were dropped during parsing -- do not treat this file as fully converted.`,
      });
    }
  } else if (detectedFormat === "finacle-transaction-inquiry" || isFinacleTransactionInquiryLayout(lines)) {
    detectedFormat = "finacle-transaction-inquiry";
    const finacle = parseFinacleTransactions(lines, { parsingErrors, reviewRows });
    transactions = finacle.transactions;
    finacleAccountInfo = finacle.accountInfo;
    if (parsingErrors.length) {
      logs.push(
        ...parsingErrors.map((error) => ({
          level: "warn",
          stage: "parse",
          message: error.reason,
          transaction: error.lineText,
        })),
      );
    }
  } else if (detectedFormat === "bccb-ledger" || isBccbLedgerLayout(lines)) {
    detectedFormat = "bccb-ledger";
    const bccb = parseBccbLedgerTransactions(lines);
    transactions = bccb.transactions;
    parserPrintedTotals = bccb.printedTotals;
    if (bccb.flaggedRows?.length) reviewRows.push(...bccb.flaggedRows);

    // Ground truth for this format's fail-fast checks is the statement's own printed Statement
    // Summary block (opening/closing balance, Total Debit/Credit, Debit+Credit Count) -- a
    // row-boundary bug here used to merge and drop transactions while still producing a
    // plausible-looking file, so these must be surfaced loudly rather than trusted implicitly.
    for (const issue of bccb.reconciliationIssues) {
      logs.push({ level: "error", stage: "parse", message: issue });
    }
  } else if (detectedFormat === "idbi-ledger" || isIdbiLedgerLayout(lines)) {
    detectedFormat = "idbi-ledger";
    const idbiLedger = parseIdbiLedgerTransactions(lines);
    transactions = idbiLedger.transactions;
    parserPrintedTotals = idbiLedger.printedTotals;

    // This report's own per-page and whole-statement checkpoints ("Page Total Credit/Debit",
    // "Total Credit"/"Total Debit") are the ground truth for whether column assignment and
    // pagination-boilerplate stripping worked -- a chain of column-swap errors can still net out
    // to a correct-looking closing balance while individual rows and totals are badly wrong, so
    // these must be surfaced loudly rather than relying on the closing balance alone.
    for (const issue of idbiLedger.reconciliationIssues) {
      logs.push({ level: "error", stage: "parse", message: issue });
    }
  } else if (detectedFormat === "idbi" || isIdbiLayout(lines)) {
    detectedFormat = "idbi";
    transactions = parseIdbiTransactions(lines);
  } else if (detectedFormat === "axis" || isAxisLayout(lines)) {
    detectedFormat = "axis";
    const axis = parseAxisTransactions(lines);
    transactions = axis.transactions;
    parserPrintedTotals = axis.printedTotals;
  } else if (detectedFormat === "federal" || isFederalLayout(lines)) {
    detectedFormat = "federal";
    const federal = parseFederalTransactions(lines);
    transactions = federal.transactions;
    parserPrintedTotals = federal.printedTotals;

    // The strict parser above assumes a clean text layer (an exact "Tran Cheque Balance" trigger
    // line, unspaced dates). When that's not what came out of extraction -- a badly-OCR'd or
    // badly-regenerated PDF text layer -- it correctly finds nothing rather than guessing, so fall
    // back to the tolerant OCR engine instead of surfacing an empty/garbled result.
    if (transactions.length === 0) {
      const federalOcr = parseFederalOcrTransactions(lines);
      if (federalOcr.transactions.length > 0) {
        transactions = federalOcr.transactions;
        parserPrintedTotals = federalOcr.printedTotals;
        logs.push({
          level: "warn",
          stage: "parse",
          message:
            "Federal Bank statement's text layer didn't match the standard clean-PDF layout; used the OCR-tolerant parser instead. Rows marked hadOcrCorrection had their balance and/or withdrawal/deposit amount reconstructed from the balance chain rather than read directly.",
        });
      }
    }
  } else if (
    detectedFormat === "greater-bombay" ||
    isGreaterBombayLayoutText(extraction.text || lines.map((line) => line.text || line).join("\n")) ||
    isGreaterBombayContinuationText(lines)
  ) {
    detectedFormat = "greater-bombay";
    const greaterBombay = parseGreaterBombayTransactions(lines);
    transactions = greaterBombay.transactions;
    parserPrintedTotals = greaterBombay.printedTotals;
  } else if (detectedFormat === "pnb" || isPnbLayout(lines)) {
    detectedFormat = "pnb";
    transactions = parsePnbTransactions(lines);

    // The strict parser above reads each row off real PDF word x-coordinates, which only exist
    // for a native text layer. A scanned PNB statement (this app's own OCR.space pass used
    // instead) reports word positions in image pixel space that don't line up with those column
    // boundaries at all, so it correctly finds nothing rather than guessing -- fall back to the
    // date-block-reconstruction engine instead of surfacing an empty result.
    if (transactions.length === 0) {
      const pnbOcr = parsePnbOcrTransactions(lines);
      if (pnbOcr.transactions.length > 0) {
        transactions = pnbOcr.transactions;
        if (pnbOcr.reviewRows.length) reviewRows.push(...pnbOcr.reviewRows);
        logs.push({
          level: "warn",
          stage: "parse",
          message:
            "PNB statement's text layer didn't match the standard clean-PDF layout; used the OCR-tolerant parser instead.",
        });
      }
    }
  } else if (detectedFormat === "sbi-ocr" || isSbiOcrLayout(lines)) {
    detectedFormat = "sbi-ocr";
    const sbi = parseSbiOcrTransactions(lines);
    transactions = sbi.transactions;
    parserPrintedTotals = sbi.printedTotals;
  } else if (detectedFormat === "sbi" || isSbiLayout(lines)) {
    detectedFormat = "sbi";
    const sbi = parseSbiTransactions(lines);
    transactions = sbi.transactions;
    parserPrintedTotals = sbi.printedTotals;
  } else if (detectedFormat === "canara" || isCanaraLayout(lines)) {
    detectedFormat = "canara";
    transactions = parseCanaraTransactions(lines);
  } else if (isUnionBankOcrLayout(lines)) {
    detectedFormat = "union-bank-ocr";
    const unionBankOcr = parseUnionBankOcrTransactions(lines);
    transactions = unionBankOcr.transactions;
    parserPrintedTotals = unionBankOcr.printedTotals;
  } else if (detectedFormat === "union-bank" || isUnionBankLayout(lines)) {
    detectedFormat = "union-bank";
    const unionBank = parseUnionBankTransactions(lines);
    transactions = unionBank.transactions;
    parserPrintedTotals = unionBank.printedTotals;
  } else if (detectedFormat === "jana" || isJanaLayout(lines)) {
    detectedFormat = "jana";
    transactions = parseJanaTransactions(lines);
  } else if (isLegacyBankOfIndiaLayout(lines)) {
    detectedFormat = "bank-of-india";
    transactions = parseLegacyBankOfIndiaTransactions(lines);
  } else if (detectedFormat === "bank-of-india" || isBankOfIndiaLayout(lines)) {
    detectedFormat = "bank-of-india";
    transactions = parseBankOfIndiaTransactions(lines);
  } else if (isStandardCharteredLayout(lines)) {
    detectedFormat = "standard-chartered";
    transactions = parseStandardCharteredTransactions(lines);
  } else if (isBankOfBarodaLayout(lines)) {
    detectedFormat = "bank-of-baroda";
    transactions = parseBankOfBarodaTransactions(lines);
  } else if (isBankOfBarodaSavingsLayout(lines)) {
    detectedFormat = "bank-of-baroda-savings";
    transactions = parseBankOfBarodaSavingsTransactions(lines);
  } else if (isBankOfBarodaWorldAppLayout(lines)) {
    detectedFormat = "bank-of-baroda-world-app";
    transactions = toBobWorldAppStatementTransactions(parseBankOfBarodaWorldAppTransactions(lines));
  } else if (isVvsbLayout(lines)) {
    detectedFormat = "vvsb";
    const vvsb = parseVvsbTransactions(lines);
    transactions = vvsb.transactions;
    parserPrintedTotals = vvsb.printedTotals;
  } else if (isHdfcOcrLayout(lines)) {
    detectedFormat = "hdfc-ocr";
    const hdfc = parseHdfcOcrStatement(lines);
    transactions = hdfc.transactions;
    parserPrintedTotals = hdfc.printedTotals;
  } else if (isPassbookLayout(lines)) {
    detectedFormat = "passbook";
    const passbook = parsePassbookStatement(lines);
    transactions = passbook.transactions;
    parserPrintedTotals = passbook.printedTotals;
  } else if (isColumnarOcrLayout(lines)) {
    detectedFormat = "columnar-ocr";
    const columnar = parseColumnarOcrStatement(lines);
    transactions = columnar.transactions;
    parserPrintedTotals = columnar.printedTotals;
  } else {
    transactions = parseTransactions(lines);
  }

  if (
    detectedFormat !== "icici-detailed" &&
    detectedFormat !== "bccb-ledger" &&
    !(detectedFormat === "columnar-ocr" && isAxisOcrLayout(lines))
  ) {
    transactions = correctDebitCreditByBalance(transactions);
  }

  logs.push({
    level: "info",
    stage: "parse",
    message: `Detected statement format: ${detectedFormat}.`,
  });

  const beforeDedupe = transactions.length;
  transactions = removeDuplicateTransactions(transactions, logs);
  if (transactions.length !== beforeDedupe) {
    logs.push({
      level: "warn",
      stage: "validation",
      message: `${beforeDedupe - transactions.length} duplicate transaction(s) removed.`,
    });
  }

  let printedTotals = parserPrintedTotals || extractPrintedTotals(lines);

  if (transactions.length === 0 && isSocietySavingsCompact(lines)) {
    const savings = parseSocietySavingsCompact(lines);
    transactions = savings.transactions;
    if (savings.printedTotals) printedTotals = savings.printedTotals;
  } else if (transactions.length === 0 && isSouthIndianBankLayout(lines)) {
    const sib = parseSouthIndianBankStatement(lines);
    transactions = sib.transactions;
    if (sib.printedTotals) printedTotals = sib.printedTotals;
  } else if (transactions.length === 0 && isSocietyCoopLayout(lines)) {
    const society = parseSocietyCoopStatement(lines);
    transactions = society.transactions;
    if (society.printedTotals) printedTotals = society.printedTotals;
  } else if (transactions.length === 0 && isColumnarOcrLayout(lines)) {
    const columnar = parseColumnarOcrStatement(lines);
    transactions = columnar.transactions;
    if (columnar.printedTotals) printedTotals = columnar.printedTotals;
  }

  const calculatedTotals = calculateTotalsInStatementOrder(transactions);
  const totals =
    printedTotals &&
    printedTotals.withdrawal !== null &&
    printedTotals.deposit !== null
      ? {
          source: "printed",
          withdrawal: printedTotals.withdrawal,
          deposit: printedTotals.deposit,
          closingBalance: printedTotals.closingBalance,
        }
      : calculatedTotals;

  const statement = {
    accountInfo,
    finacleAccountInfo,
    transactions,
    totals,
    printedTotals: printedTotals || null,
    pageCount: extraction.pageCount,
    detectedFormat,
    ocrSourced: extraction.source === "ocr",
    parsingErrors,
    reviewRows,
    logs,
  };

  statement.reconciliation = buildValidationReport(statement, lines);
  statement.reviewRows = statement.reconciliation.reviewRows || [];

  for (const issue of statement.reconciliation.issues) {
    logs.push({
      level: issue.severity || "error",
      stage: "validation",
      message: issue.message,
      rowNumber: issue.rowNumber,
      difference: issue.difference,
    });
  }

  for (const warning of statement.reconciliation.warnings) {
    logs.push({
      level: warning.severity || "warn",
      stage: "validation",
      message: warning.message,
    });
  }

  return statement;
}

export { parseStatement, parseTransactions, extractAccountInfo };
