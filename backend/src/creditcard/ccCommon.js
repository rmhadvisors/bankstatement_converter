import { clean, roundMoney } from "../parsers/parsers/common.js";

const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const MONTH_SRC = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*";

// One date token in any layout Indian card issuers print: 12/03/2024, 12-03-24, 12/03/2024 14:05:33,
// 12 Mar 24, 12-Mar-2024, 22/Jul/2026, 12 March, 2024, March 12, 2024.
const DATE_SRC = String.raw`\d{1,2}[/-]\d{1,2}[/-](?:\d{4}|\d{2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}[ /-]${MONTH_SRC}[ ,/-]+(?:\d{4}|\d{2})|${MONTH_SRC}\s+\d{1,2},?\s+\d{4}`;
const AMOUNT_NUMBER_SRC = String.raw`(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}`;
// Some PDFs (IDFC FIRST) embed the rupee sign in a font that extracts as a lone "r".
const CURRENCY_SRC = String.raw`₹|Rs\.?|INR|r`;
const CURRENCY_TOKEN = new RegExp(`^(?:${CURRENCY_SRC})$`, "i");

function makeDate(rawYear, monthIndex, rawDay) {
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  const day = Number(rawDay);
  const date = new Date(Date.UTC(year, monthIndex, day));
  // Rejects impossible dates (31/02) instead of letting Date roll them into the next month.
  return date.getUTCMonth() === monthIndex && date.getUTCDate() === day ? date : null;
}

function parseCcDate(raw) {
  const text = clean(raw);
  let match = text.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/,
  );
  if (match) return makeDate(match[3], Number(match[2]) - 1, match[1]);

  match = text.match(/^(\d{1,2})[ /-]([A-Za-z]{3,9})[ ,/-]+(\d{4}|\d{2})$/);
  if (match) {
    const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
    return month === undefined ? null : makeDate(match[3], month, match[1]);
  }

  match = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  const month = match && MONTHS[match[1].slice(0, 3).toLowerCase()];
  return month === undefined || month === null ? null : makeDate(match[3], month, match[2]);
}

// Pops one amount (plus its credit/debit marker and currency symbol) off the END of a token list.
// Returns { amount, type, rest } or null. Credits are written "Cr", "CR", "C", "+", a trailing "-",
// or a leading "-"/"+"; anything else ("Dr", "D", no marker) is a debit.
function takeTrailingAmount(tokens) {
  const rest = [...tokens];
  let marker = /^(?:cr|dr|c|d|[-+])$/i.test(rest.at(-1) || "") ? rest.pop() : "";

  const match = (rest.pop() || "").match(
    new RegExp(String.raw`^([-+])?(${CURRENCY_SRC})?(${AMOUNT_NUMBER_SRC})(cr|dr|[-+])?$`, "i"),
  );
  if (!match) return null;

  let sign = match[1] || "";
  marker = marker || match[4] || "";
  // "+ ₹ 1,000.00": a separate currency token, optionally with a separate sign before it. A bare
  // sign token without a currency symbol is NOT taken -- "AMAZON - 450.00" is a dash in the text.
  if (!match[2] && CURRENCY_TOKEN.test(rest.at(-1) || "")) {
    rest.pop();
    if (!sign && /^[-+]$/.test(rest.at(-1) || "")) sign = rest.pop();
  }

  const lowered = marker.toLowerCase();
  const isCredit =
    sign !== "" || lowered === "cr" || lowered === "c" || lowered === "+" || lowered === "-";
  return {
    amount: roundMoney(Number(match[3].replace(/,/g, ""))),
    type: isCredit ? "credit" : "debit",
    rest,
  };
}

function parseCcAmount(raw) {
  const tokens = clean(raw).split(" ").filter(Boolean);
  const result = takeTrailingAmount(tokens);
  return result && result.rest.length === 0 ? { amount: result.amount, type: result.type } : null;
}

// Signed value for summary fields: a "Cr" balance (card in credit) is negative.
function signedAmount(raw) {
  const parsed = parseCcAmount(raw);
  if (!parsed) return null;
  return parsed.type === "credit" ? -parsed.amount : parsed.amount;
}

function cardLast4(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function maskCard(rawOrLast4) {
  const last4 = cardLast4(rawOrLast4);
  return last4 ? `XXXX XXXX XXXX ${last4}` : "";
}

function passesLuhn(digits) {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

// Masks anything in free text that is (or partially shows) a card number, keeping the last 4.
// Full numbers must pass Luhn so long reference/ARN numbers are left alone.
function maskCardNumbers(text) {
  return String(text || "")
    .replace(/\b\d{4,6}[ -]?[Xx*•]{2,}[Xx*• -]*\d{4}\b/g, (match) => maskCard(match))
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, (match) => {
      const digits = match.replace(/\D/g, "");
      return passesLuhn(digits) ? maskCard(digits) : match;
    });
}

function linesToText(textOrLines) {
  return Array.isArray(textOrLines)
    ? textOrLines.map((line) => clean(line?.text ?? line)).join("\n")
    : String(textOrLines || "");
}

export {
  AMOUNT_NUMBER_SRC,
  CURRENCY_SRC,
  DATE_SRC,
  cardLast4,
  clean,
  linesToText,
  maskCard,
  maskCardNumbers,
  parseCcAmount,
  parseCcDate,
  roundMoney,
  signedAmount,
  takeTrailingAmount,
};
