import { linesToText } from "./ccCommon.js";

const ISSUERS = [
  { key: "hdfc", name: "HDFC Bank", re: /HDFC\s*Bank/gi },
  { key: "icici", name: "ICICI Bank", re: /ICICI\s*Bank/gi },
  { key: "sbi", name: "SBI Card", re: /SBI\s*Card|sbicard\.com/gi },
  { key: "axis", name: "Axis Bank", re: /Axis\s*Bank/gi },
  { key: "kotak", name: "Kotak Mahindra Bank", re: /Kotak/gi },
  { key: "amex", name: "American Express", re: /American\s*Express|americanexpress\./gi },
  { key: "idfc", name: "IDFC FIRST Bank", re: /IDFC\s*FIRST/gi },
  { key: "au", name: "AU Small Finance Bank", re: /AU\s*Small\s*Finance|aubank\./gi },
  { key: "rbl", name: "RBL Bank", re: /RBL\s*Bank/gi },
  { key: "yes", name: "YES Bank", re: /\bYES\s*BANK\b/gi },
  { key: "indusind", name: "IndusInd Bank", re: /IndusInd/gi },
  { key: "onecard", name: "OneCard", re: /\bOne\s?Card\b|getonecard/gi },
];

// A card statement names other banks too ("PAYMENT RECEIVED - HDFC BANK NEFT"), so the issuer
// is the one named most often -- its name sits in the header/footer of every page.
function detectIssuer(textOrLines) {
  const text = linesToText(textOrLines);
  let best = null;
  let bestCount = 0;
  for (const issuer of ISSUERS) {
    const count = (text.match(issuer.re) || []).length;
    if (count > bestCount) {
      best = issuer;
      bestCount = count;
    }
  }
  return best ? { key: best.key, name: best.name } : null;
}

const CARD_SIGNALS = [
  /payment\s+due\s+date|due\s+date/i,
  /total\s+(?:amount\s+)?(?:due|dues|payable)|total\s+outstanding/i,
  /credit\s+limit/i,
  /available\s+(?:credit|limit)/i,
  /credit\s+card/i,
];
const BANK_SIGNALS = [
  /\bIFSC\b/i,
  /opening\s+balance/i,
  /closing\s+balance/i,
  /withdrawals?/i,
  /deposits?/i,
  /\b(?:cheque|chq)\b/i,
  /statement\s+of\s+account/i,
];

// "Minimum amount due" is what makes this a card statement: no bank or loan account statement
// prints it. Requiring two more card-only signals keeps a bank statement whose narration happens
// to mention a credit card bill from being misclassified.
function isCreditCardStatement(textOrLines) {
  const text = linesToText(textOrLines);
  if (!/minimum\s+(?:amount\s+|payment\s+)?(?:due|payable)/i.test(text)) return false;
  return CARD_SIGNALS.filter((re) => re.test(text)).length >= 2;
}

function classifyStatement(textOrLines) {
  const text = linesToText(textOrLines);
  if (isCreditCardStatement(text)) return "credit_card";
  return BANK_SIGNALS.filter((re) => re.test(text)).length >= 2 ? "bank" : "unknown";
}

export { ISSUERS, classifyStatement, detectIssuer, isCreditCardStatement };
