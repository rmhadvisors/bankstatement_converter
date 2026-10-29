import {
  AMOUNT_NUMBER_SRC,
  CURRENCY_SRC,
  DATE_SRC,
  cardLast4,
  clean,
  maskCardNumbers,
  parseCcDate,
  signedAmount,
  takeTrailingAmount,
} from "../ccCommon.js";

// Shared line-based engine. Issuer files only pass options for the columns their layout adds;
// anything without its own issuer file is parsed with the defaults.
//
// options:
//   rewardPointsBeforeAmount  a small integer column sits just before the amount (ICICI, HDFC)
//   trailingSecondaryAmount   a second amount column follows the amount (Axis "cashback earned")
//
// The column layout itself is read from the table header ("DATE | DESCRIPTION | TYPE | AMOUNT |
// BALANCE"): with a BALANCE column the rightmost number is the running balance, with a TYPE
// column the word before the amount is Debit/Credit.

const LINE_DATE_RE = new RegExp(String.raw`^(${DATE_SRC})\s+(?:(${DATE_SRC})\s+)?(.+)$`, "i");
const AMOUNT_RE = new RegExp(AMOUNT_NUMBER_SRC);
const SUMMARY_AMOUNT_RE = new RegExp(
  String.raw`(?:(?:${CURRENCY_SRC})\s?)?-?${AMOUNT_NUMBER_SRC}(?:\s?(?:Cr|Dr)\b)?`,
  "gi",
);
const SUMMARY_DATE_RE = new RegExp(DATE_SRC, "gi");

const FX =
  "USD|EUR|GBP|AED|SGD|AUD|CAD|JPY|CHF|HKD|THB|MYR|SAR|QAR|NZD|CNY|LKR|NPR|ZAR|SEK|DKK|NOK|KWD|OMR|BHD";
const FX_NUMBER = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?`;
const FOREIGN_RE = new RegExp(
  String.raw`\b(${FX})\s?(${FX_NUMBER})(?![\d.])|(?<![\d.,])(${FX_NUMBER})\s?(${FX})\b`,
);
const REF_RE = /\b(?:Ref(?:erence)?\.?\s*(?:No\.?|#|Number)?|ARN)\s*[:#]?\s*([A-Z0-9]{6,})\b/i;

// Headings that end the transaction table. Only checked on lines that don't start with a date, so
// a transaction like "BONUS REWARD POINTS 500.00" is still a transaction.
const IGNORE_SECTION_RE =
  /reward\s*points?\b|points?\s+summary|EMI\s*(?:schedule|offers?|plans?\s+available)|eligible\s+for\s+EMI|important\s+(?:messages?|information|notes?)|terms\s*(?:and|&)\s*conditions|schedule\s+of\s+charges|offers?\s+for\s+you|know\s+your\s+card|payment\s+remittance|remittance\s+coupon|payment\s+modes|your\s+card\s+information|^(?:yours\s+)?sincerely\b/i;
const EMI_SECTION_RE =
  /EMI\s*\/?\s*(?:installment|instalment)?\s*summary|(?:installment|instalment)\s+summary/i;
const RESUME_SECTION_RE =
  /transaction\s+details|(?:domestic|international)\s+transactions|^date\b.*\b(?:transactions?|description|details|particulars)\b.*\bamount\b/i;
const CONTINUATION_NOISE_RE =
  /page\s*\d|statement|customer\s*care|www\.|https?:|@|gstin|toll[\s-]*free|continued|^date\b|\btotal\b|\blimit\b|\bdue\b|reward|card\s*(?:no|number|ending)/i;
const TYPE_WORD_RE = /^(?:debit|credit|dr|cr)$/i;
// "Base: ₹523.81 | CGST (2.5%): ₹13.10" / "Principal: ₹4,010.00 | Interest: ₹415.25": label: amount
// pairs printed under a transaction -- a breakdown of it, not a transaction of its own.
const DETAIL_PAIR = String.raw`[A-Za-z][^:|]{0,40}:\s*(?:₹|Rs\.?|INR)?\s?[\d,]+(?:\.\d{1,2})?`;
const DETAIL_LINE_RE = new RegExp(String.raw`^${DETAIL_PAIR}(?:\s*\|\s*${DETAIL_PAIR})*$`);
const DETAIL_NOISE_RE = /\b(?:total|due|limit|balance|minimum)\b/i;
const EMI_ROW_RE = new RegExp(
  String.raw`^(.+?)\s+(\d+\s*\/\s*\d+)\s+(${AMOUNT_NUMBER_SRC})\s+(${AMOUNT_NUMBER_SRC})\s+(${AMOUNT_NUMBER_SRC})\s+(${AMOUNT_NUMBER_SRC})$`,
);
// Integers (reward points), never part of an amount, date, "4/12" or a word like "1X".
const POINTS_RE = /(?<![\w,.\/:-])(?:\d{1,3}(?:,\d{2,3})+|\d+)(?![\w,.\/:])/g;
// "REGALIA GOLD CREDIT CARD", "Mayura Credit Card" -- but not "HDFC Bank Credit Card".
const PRODUCT_RE = /\b((?:[A-Z][A-Za-z]+ ){1,3})(?:CREDIT CARD|[Cc]redit [Cc]ard)\b/;
const NOT_PRODUCT_RE = /\b(?:bank|statement|your|the|this|on|of)\b/i;
// A bare name line near the top of page 1 ("DEVENDRA MANOJ MISHRA"), when no label names the holder.
const NAME_LINE_RE = /^[A-Z][A-Z.']+(?: [A-Z][A-Z.']+){1,3}$/;
const NOT_A_NAME_RE =
  /\b(?:BANK|CARD|STATEMENT|SUMMARY|ACCOUNT|DETAILS|TRANSACTIONS?|LIMIT|DUE|BALANCE|PAYMENTS?|REWARDS?|POINTS|CREDIT|DEBIT|TOTAL|NOW|PAGE|MONTHLY|DATE|AMOUNT|FIRST|INFORMATION)\b/;
// "Customer Name    Card Account No": a header row of labels, not a label and its name.
const holderLineName = (text) => {
  const match = text.match(HOLDER_LINE_RE);
  return match && !new RegExp(NOT_A_NAME_RE.source, "i").test(match[1]) ? match : null;
};

// Summary tables whose labels sit in columns (and may wrap over several lines) with the values on
// the line below: the label is matched whole, and each value goes to the column above it by x.
const COLUMN_FIELDS = [
  [/^(?:opening|previous)\s+balance$/, "previousBalance", "amount"],
  [/^purchases?$/, "purchasesDebits", "amount"],
  [/^other\s+debits?(?:\s*(?:&|and)\s*charges)?$/, "otherDebits", "amount"],
  [/^cash\s+advances?$/, "cashAdvance", "amount"],
  [/^payments?$/, "paymentsCredits", "amount"],
  [/^(?:other\s+)?credits?$/, "otherCredits", "amount"],
  [/^total\s+(?:amount|payment)\s+due$/, "totalAmountDue", "amount"],
  [/^minimum\s+(?:amount|payment)\s+due$/, "minimumAmountDue", "amount"],
  [/^payment\s+due\s+date$/, "paymentDueDate", "date"],
  [/^statement\s+(?:generation\s+)?date$/, "statementDate", "date"],
  [/^statement\s+period$/, "period", "period"],
  [/^edge\s+reward\s+points$/, "rewardPointsClosing", "points"],
  [/^balance\s+as\s+on\s+date$/, "rewardPointsAsOf", "date"],
  [/^credit\s+limit$/, "creditLimit", "amount"],
  [/^available\s+credit\s+limit$/, "availableCreditLimit", "amount"],
  [/^cash\s+limit$/, "cashLimit", "amount"],
  [/^available\s+cash\s+limit$/, "availableCashLimit", "amount"],
  [/^rewards?\s+points\s+carried\s+over/, "rewardPointsOpening", "points"],
  [/^reward\s+points\s+earned/, "rewardPointsEarned", "points"],
  [/^bonus\s+reward\s+points/, "rewardPointsBonus", "points"],
  [/^adjusted\s*\/?\s*redeemed/, "rewardPointsAdjusted", "points"],
  [/^total\s+reward\s+points\s+available/, "rewardPointsClosing", "points"],
];
const LABEL_ALIGN = 15; // a wrapped (possibly centred) label line sits under its column's x
const VALUE_ALIGN = 40; // a value (and its "r"/"₹" glyph) sits under its column label
// Everything after this is terms, schedules of charges and worked examples -- never statement data.
const END_OF_STATEMENT_RE = /\*{2,}\s*end\s+of\s+statement\s*\*{2,}/i;
// Boilerplate blocks whose numbers ("Rs. 25000.00", "3.75% p.m.") must not feed summary fields.
const BOILERPLATE_RE =
  /important\s+(?:message|information)|schedule\s+of\s+charges|terms\s*(?:and|&)\s*conditions|finance\s+charge\s+calculation|minimum\s+amount\s+due\s+calculation/i;
const NOT_A_TRANSACTION_RE =
  /^(?:previous|opening|closing)\s+balance|^total\b|^balance\s+(?:b\/f|c\/f|brought|carried)/i;

// "4375 XXXX XXXX 1234", "4315XXXXXXXX9012", "XXXX XXXX XXXX 3456". The label form also accepts a
// full number (it is never written out -- only the last 4 are kept).
const MASKED_CARD_SRC = String.raw`\d{4,6}[ -]?[Xx*•]{2}[Xx*• -]{2,12}\d{4}|(?:[Xx*•]{4}[ -]?){2,3}\d{4}`;
const CARD_LABEL_RE = new RegExp(
  // After a label, a single masked group ("Card Number: XXXX 7845") is a card number too.
  String.raw`card\s*(?:no\.?|number|#)\s*[:.]?\s*(${MASKED_CARD_SRC}|\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}|[Xx*•]{2,4}[ -]?\d{4})\b`,
  "i",
);
const MASKED_CARD_RE = new RegExp(String.raw`\b(${MASKED_CARD_SRC})\b`);
const HOLDER_LINE_RE =
  /^(?:card\s*holder(?:'s)?(?:\s*name)?|name(?:\s+of\s+(?:the\s+)?card\s*holder)?|customer\s+name)\s*[:\-]?\s*((?:Mr|Mrs|Ms|Miss|Dr)?\.?\s*[A-Za-z][A-Za-z.' ]{2,40})$/i;
const HONORIFIC_LINE_RE = /^((?:Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Za-z][A-Za-z.' ]{2,40})$/i;
// "Cardholder: MAHI SHARMA Total Due: ₹ 1,68,130.00" -- the name stops at the next label.
const HOLDER_INLINE_RE =
  /card\s*holder(?:'s)?(?:\s*name)?\s*[:\-]\s*([A-Za-z][A-Za-z.' ]{1,40}?)(?=\s+(?:total|minimum|card|payment|statement|due|mobile|billing|credit)\b|\s*$)/i;

const SUMMARY_FIELDS = [
  {
    key: "minimumAmountDue",
    re: /minimum\s+(?:amount\s+|payment\s+)?(?:due|payable)/i,
    kind: "amount",
  },
  {
    key: "totalAmountDue",
    re: /total\s+(?:amount\s+|payment\s+)?(?:due|dues|payable)|total\s+outstanding/i,
    kind: "amount",
  },
  { key: "paymentDueDate", re: /(?:payment\s+)?due\s+date/i, kind: "date" },
  { key: "statementDate", re: /statement\s+date|bill(?:ing)?\s+date/i, kind: "date" },
  {
    key: "availableCreditLimit",
    re: /available\s+(?:credit\s+limit|credit|limit)/i,
    kind: "amount",
  },
  { key: "cashLimit", re: /(?:available\s+)?cash\s+limit/i, kind: "amount" },
  {
    key: "creditLimit",
    re: /(?<!available\s+)(?<!cash\s+)(?:total\s+)?credit\s+limit/i,
    kind: "amount",
  },
  {
    key: "previousBalance",
    re: /previous\s+(?:statement\s+)?(?:balance|dues|outstanding)|opening\s+balance|last\s+statement\s+balance/i,
    kind: "amount",
  },
  {
    key: "paymentsCredits",
    re: /payments?(?:,?\s*reversals?)?\s*(?:\/|&|and)?\s*(?:other\s+)?credits?|total\s+credits/i,
    kind: "amount",
  },
  {
    key: "purchasesDebits",
    re: /purchases?\s*(?:\/|&|and)?\s*(?:other\s+)?(?:debits?|charges)|total\s+debits/i,
    kind: "amount",
  },
  {
    key: "financeCharges",
    re: /finance\s+charges?|fees?,?\s*taxes\s*(?:&|and)\s*interest\s*charges/i,
    kind: "amount",
  },
  { key: "rewardPointsOpening", re: /opening\s+reward\s+points/i, kind: "points" },
  { key: "rewardPointsEarned", re: /points\s+earned/i, kind: "points" },
  { key: "rewardPointsAdjusted", re: /points\s+(?:adjusted|redeemed)/i, kind: "points" },
  {
    key: "rewardPointsClosing",
    re: /closing\s+reward\s+(?:points\s+)?balance|closing\s+reward\s+points/i,
    kind: "points",
  },
];

function lineText(line) {
  return clean(line?.text ?? line);
}

// Every amount/date on a line, in reading order, tagged with its kind.
function valuesIn(text) {
  const values = [];
  for (const match of text.matchAll(SUMMARY_DATE_RE)) {
    const value = parseCcDate(match[0]);
    if (value)
      values.push({ kind: "date", value, index: match.index, end: match.index + match[0].length });
  }
  for (const match of text.matchAll(SUMMARY_AMOUNT_RE)) {
    // An amount inside a date ("12.03.2024") or already claimed by a date is not an amount.
    if (
      values.some(
        (v) => v.kind === "date" && match.index < v.end && match.index + match[0].length > v.index,
      )
    )
      continue;
    // "₹-1,234.00" -> "₹ -1,234.00" so the currency and the signed number are separate tokens.
    const value = signedAmount(match[0].replace(new RegExp(`^(${CURRENCY_SRC})\\s?`, "i"), "$1 "));
    if (value !== null)
      values.push({
        kind: "amount",
        value,
        index: match.index,
        end: match.index + match[0].length,
      });
  }
  for (const match of text.matchAll(POINTS_RE)) {
    const end = match.index + match[0].length;
    if (values.some((v) => match.index < v.end && end > v.index)) continue;
    values.push({
      kind: "points",
      value: Number(match[0].replace(/,/g, "")),
      index: match.index,
      end,
    });
  }
  return values.sort((a, b) => a.index - b.index);
}

function labelHits(text, summary) {
  const hits = SUMMARY_FIELDS.map((field) => ({ field, match: field.re.exec(text) }))
    .filter((hit) => hit.match && summary[hit.field.key] === undefined)
    .sort((a, b) => a.match.index - b.match.index);
  // "Payment Due Date" must not also count as a "Due Date" hit inside it, etc.
  return hits.filter(
    (hit, i) => i === 0 || hit.match.index >= hits[i - 1].match.index + hits[i - 1].match[0].length,
  );
}

function cellValue(text, kind) {
  if (kind === "date") return parseCcDate(text);
  if (kind === "period") {
    const match = text.match(
      new RegExp(String.raw`^(${DATE_SRC})\s*(?:to|-|–)\s*(${DATE_SRC})$`, "i"),
    );
    return match && { periodFrom: parseCcDate(match[1]), periodTo: parseCcDate(match[2]) };
  }
  if (kind === "points") return /^[\d,]+$/.test(text) ? Number(text.replace(/,/g, "")) : null;
  // Limits are often printed without paise ("3,52,000"); "CR" means the card is in credit.
  const match = text.match(
    new RegExp(String.raw`^(?:${CURRENCY_SRC})?\s?(-)?([\d,]+(?:\.\d+)?)\s*(DR|CR)?$`, "i"),
  );
  if (!match) return null;
  const value = Number(match[2].replace(/,/g, ""));
  return match[1] || /^cr$/i.test(match[3] || "") ? -value : value;
}

function nearestColumn(columns, x) {
  return columns.reduce((best, column) =>
    Math.abs(column.x - x) < Math.abs(best.x - x) ? column : best,
  );
}

// Needs the x-positions pdf extraction gives each line (line.items); lines without them are skipped.
function extractColumnTables(lines, summary) {
  const hasValues = (line) => valuesIn(lineText(line)).length > 0;
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i];
    if (!(head?.items?.length >= 2) || hasValues(head)) continue;
    const columns = head.items
      .filter((item) => !/^[+\-=]$/.test(clean(item.text)))
      .map((item) => ({ x: item.x, label: clean(item.text), cell: [] }));
    if (columns.length < 2) continue;

    const distance = (item) => Math.abs(nearestColumn(columns, item.x).x - item.x);
    const samePage = (line) => line && line.pageNumber === head.pageNumber && line.items?.length;
    let j = i + 1;
    while (samePage(lines[j]) && !hasValues(lines[j])) {
      const near = lines[j].items.filter((item) => distance(item) <= VALUE_ALIGN);
      // Side text printed beside the table ("For hassle free payments register for") is skipped;
      // anything else that isn't a wrapped label ends the header.
      if (near.length > 0 && !near.every((item) => distance(item) <= LABEL_ALIGN)) break;
      for (const item of near) nearestColumn(columns, item.x).label += ` ${clean(item.text)}`;
      j += 1;
    }
    if (!samePage(lines[j]) || !hasValues(lines[j])) continue;

    for (const item of lines[j].items) {
      if (distance(item) <= VALUE_ALIGN) nearestColumn(columns, item.x).cell.push(clean(item.text));
    }
    for (const column of columns) {
      const field = COLUMN_FIELDS.find(([re]) => re.test(column.label.toLowerCase()));
      if (!field || summary[field[1]] !== undefined) continue;
      const value = cellValue(column.cell.join(" "), field[2]);
      if (value === null) continue;
      if (field[2] === "period") Object.assign(summary, value);
      else summary[field[1]] = value;
    }
  }
}

// "Previous Balance - Payments - Credits + Purchase + Cash Advance + Other Debit&Charges =Total
// Payment Due" printed as ONE text run (Axis), its amounts on the next line in the same order.
// Lines without items use their whole text.
function extractEquationRows(lines, summary) {
  for (let i = 0; i < lines.length; i += 1) {
    const head = clean(lines[i]?.items?.[0]?.text ?? lineText(lines[i]));
    const parts = head.split(/\s*[-+=]\s*/).map((part) => part.toLowerCase());
    if (parts.length < 4 || !/=/.test(head)) continue;
    const fields = parts.map((part) => COLUMN_FIELDS.find(([re]) => re.test(part)));
    if (fields.some((field) => !field || field[2] !== "amount")) continue;

    const valueLine = lines
      .slice(i + 1, i + 4)
      .find((line) => line.pageNumber === lines[i].pageNumber && valuesIn(lineText(line)).length);
    const amounts = valueLine
      ? valuesIn(lineText(valueLine)).filter((v) => v.kind === "amount")
      : [];
    if (amounts.length < fields.length) continue;
    fields.forEach(([, key], k) => {
      if (summary[key] === undefined) summary[key] = amounts[k].value;
    });
  }
}

function extractSummary(lines) {
  const texts = lines.map(lineText);
  const summary = {};
  extractColumnTables(lines, summary);
  extractEquationRows(lines, summary);

  // Label/value scanning skips boilerplate blocks (to the end of their page): their example
  // figures must never become statement fields.
  let boilerplatePage = null;
  for (let i = 0; i < texts.length; i += 1) {
    const text = texts[i];
    if (BOILERPLATE_RE.test(text)) boilerplatePage = lines[i]?.pageNumber ?? true;
    if (boilerplatePage !== null && boilerplatePage === (lines[i]?.pageNumber ?? true)) continue;
    boilerplatePage = null;
    const allHits = labelHits(text, {});
    const hits = allHits.filter((hit) => summary[hit.field.key] === undefined);
    if (hits.length === 0) continue;

    const ownValues = valuesIn(text);
    // A row of labels with the values printed underneath, in the same order (summary tables).
    // Positions come from every label on the row -- including fields already filled by
    // extractColumnTables -- or each value would shift into the wrong field.
    if (allHits.length >= 2 && ownValues.every((v) => v.kind === "points")) {
      const below = valuesIn(texts[i + 1] || "");
      let cursor = 0;
      for (const hit of allHits) {
        while (cursor < below.length && below[cursor].kind !== hit.field.kind) cursor += 1;
        if (cursor >= below.length) break;
        const { value } = below[cursor++];
        if (summary[hit.field.key] === undefined) summary[hit.field.key] = value;
      }
      continue;
    }

    hits.forEach((hit, k) => {
      const start = hit.match.index + hit.match[0].length;
      const end = hits[k + 1]?.match.index ?? text.length;
      let found = ownValues.find(
        (v) => v.kind === hit.field.kind && v.index >= start && v.index < end,
      );
      // "Total Amount Due" on one line, its value alone on the next.
      if (!found && hits.length === 1 && labelHits(texts[i + 1] || "", {}).length === 0) {
        found = valuesIn(texts[i + 1] || "").find((v) => v.kind === hit.field.kind);
      }
      if (found) summary[hit.field.key] = found.value;
    });
  }

  const allText = texts.join("\n");
  const period = allText.match(
    new RegExp(
      String.raw`(?:statement|billing)\s+(?:period|cycle)\s*:?\s*(?:from\s+)?(${DATE_SRC})\s*(?:to|-|–)\s*(${DATE_SRC})`,
      "i",
    ),
  );
  if (period) {
    summary.periodFrom = parseCcDate(period[1]);
    summary.periodTo = parseCcDate(period[2]);
  }

  const holder =
    texts
      .map((text) => holderLineName(text) || text.match(HONORIFIC_LINE_RE))
      .find(Boolean) || allText.match(HOLDER_INLINE_RE);
  // Then the name printed beside the card number ("MAHI SHARMA Card No: XXXX-...-4821"), then a
  // bare name line near the top of page 1.
  const holderBesideCard = texts.map(readCardMarker).find((marker) => marker?.holder)?.holder;
  const nameLine = texts
    .slice(0, 15)
    .find((text) => NAME_LINE_RE.test(text) && !NOT_A_NAME_RE.test(text));
  const cardHolder = holder ? clean(holder[1]) : holderBesideCard || nameLine;
  if (cardHolder) summary.cardHolder = cardHolder;

  const card = allText.match(CARD_LABEL_RE) || allText.match(MASKED_CARD_RE);
  if (card) summary.cardLast4 = cardLast4(card[1]);

  const product = texts
    .map((text) => text.match(PRODUCT_RE))
    .find((match) => match && !NOT_PRODUCT_RE.test(match[1]));
  if (product) summary.cardProduct = product[0];

  return summary;
}

// allowEmpty: accept a date+amount line with no description text (its description was printed on
// the line above -- see the "leading" handling in parseCardStatement).
function parseTransactionLine(text, options = {}, layout = {}, allowEmpty = false) {
  const match = text.match(LINE_DATE_RE);
  if (!match) return null;
  const date = parseCcDate(match[1]);
  if (!date) return null;

  // Read from the right: "... Debit 550.00 2,90,464.50" is TYPE AMOUNT BALANCE.
  const rightmost = takeTrailingAmount(match[3].split(" "));
  if (!rightmost) return null;
  let taken = rightmost;
  let balance = null;
  const second = takeTrailingAmount(rightmost.rest);
  if (second && (layout.balance || TYPE_WORD_RE.test(second.rest.at(-1) || ""))) {
    balance = rightmost.type === "credit" ? -rightmost.amount : rightmost.amount;
    taken = second;
  } else if (second && options.trailingSecondaryAmount) {
    taken = second;
  }

  const tokens = taken.rest;
  let type = taken.type;
  const hasTypeColumn = layout.type || balance !== null;
  if (hasTypeColumn && tokens.length > 1 && TYPE_WORD_RE.test(tokens.at(-1))) {
    type = /^(?:credit|cr)$/i.test(tokens.pop()) ? "credit" : "debit";
  }
  // ICICI's "Intl.# amount" column sits between the reward points and the INR amount.
  let foreign = null;
  const fxCode = new RegExp(`^(?:${FX})$`);
  if (fxCode.test(tokens.at(-2) || "") && /^[\d,]+(?:\.\d{1,2})?$/.test(tokens.at(-1) || "")) {
    const amount = tokens.pop();
    foreign = { foreignCurrency: tokens.pop(), foreignAmount: Number(amount.replace(/,/g, "")) };
  }
  // IDFC's "EMI Eligibility" column prints "Convert" for eligible rows.
  let emiEligible = false;
  if (layout.emi && tokens.length > 1 && /^convert$/i.test(tokens.at(-1))) {
    tokens.pop();
    emiEligible = true;
  }

  let rewardPoints = null;
  if (
    options.rewardPointsBeforeAmount &&
    !hasTypeColumn &&
    /^[-+]?\d{1,5}$/.test(tokens.at(-1) || "") &&
    tokens.length > 1
  ) {
    rewardPoints = Number(tokens.pop());
    if (/^[-+]$/.test(tokens.at(-1) || ""))
      rewardPoints = tokens.pop() === "-" ? -rewardPoints : rewardPoints;
  }

  // ICICI's "Intl. amount" column with no currency code: "... MUMBAI IN 0.00 399.00".
  if (layout.currency && !foreign && /^-?[\d,]+\.\d{2}$/.test(tokens.at(-1) || "") && tokens.length > 1) {
    const amount = Number(tokens.pop().replace(/,/g, ""));
    if (amount !== 0) foreign = { foreignAmount: amount };
  }

  // Under a "Ref. Number" column, refs can be alphanumeric ("DP115163112701ebYzOf").
  const refToken = layout.ref ? /^(?=(?:\D*\d){8})[A-Za-z0-9]{10,}$/ : /^\d{8,}$/;
  let refNo = null;
  if (refToken.test(tokens[0] || "") && tokens.length > 1) refNo = tokens.shift();

  const description = tokens.join(" ");
  const usable = /[A-Za-z]/.test(description) || (allowEmpty && description === "");
  if (!usable || NOT_A_TRANSACTION_RE.test(description)) return null;

  return {
    date,
    postDate: match[2] ? parseCcDate(match[2]) : null,
    description,
    refNo,
    amount: taken.amount,
    type,
    balance,
    rewardPoints,
    emiEligible,
    details: null,
    ...foreign,
  };
}

function readCardMarker(text) {
  const match = text.match(CARD_LABEL_RE) || text.match(MASKED_CARD_RE);
  if (!match) return null;
  const rest = clean(
    text
      .replace(match[0], " ")
      .replace(/card\s*(?:no\.?|number|#)|primary|add[\s-]?on|holder|name|[:()\-]/gi, " "),
  );
  return {
    last4: cardLast4(match[1]),
    holder: /^[A-Za-z][A-Za-z.']*(?: [A-Za-z][A-Za-z.']*){1,3}$/.test(rest) ? rest : null,
  };
}

function finalize(transaction) {
  let description = transaction.description;

  if (!transaction.refNo) {
    const ref = description.match(REF_RE);
    if (ref) {
      transaction.refNo = ref[1];
      description = description.replace(ref[0], " ");
    }
  }

  const foreign = !transaction.foreignCurrency && description.match(FOREIGN_RE);
  if (foreign) {
    transaction.foreignCurrency = (foreign[1] || foreign[4]).toUpperCase();
    transaction.foreignAmount = Number((foreign[2] || foreign[3]).replace(/,/g, ""));
    description = description.replace(foreign[0], " ");
  }

  transaction.description = maskCardNumbers(clean(description));
  delete transaction.leadingX;
  return transaction;
}

// The x-range of a "MERCHANT CATEGORY" column, from the table header's item positions: halfway to
// the header on each side (cells are left-aligned under centred headers).
function categoryColumn(line) {
  const items = [...(line.items || [])].sort((a, b) => a.x - b.x);
  const index = items.findIndex((item) => /category/i.test(item.text));
  if (index <= 0) return null;
  return {
    from: (items[index - 1].x + items[index].x) / 2,
    to: index + 1 < items.length ? (items[index].x + items[index + 1].x) / 2 : Infinity,
  };
}

function parseCardStatement(allLines, options = {}) {
  const end = allLines.findIndex((line) => END_OF_STATEMENT_RE.test(lineText(line)));
  const lines = end === -1 ? allLines : allLines.slice(0, end);
  const summary = extractSummary(lines);
  const transactions = [];
  const emiSummary = [];
  let card = { last4: summary.cardLast4 ?? null, holder: summary.cardHolder ?? null };
  let layout = { balance: false, type: false };
  let section = null; // null = transactions, "ignore", or "emi"
  let page;
  let last = null;
  let lastEmiOpen = false;
  let continuations = 0;
  let leading = null;
  const firstX = (line) => line?.items?.[0]?.x;
  // A date+amount line with no description text of its own.
  const isBareDated = (line) =>
    parseTransactionLine(lineText(line), options, layout, true)?.description === "";

  for (const [index, line] of lines.entries()) {
    const text = lineText(line);
    const pendingLeading = leading;
    leading = null;
    const pageNumber = line?.pageNumber ?? null;
    if (pageNumber !== page) {
      // Each page starts fresh: an "Important messages" box on page 2 must not swallow the
      // transactions that continue at the top of page 3 without a repeated table header.
      page = pageNumber;
      section = null;
      last = null;
    }
    if (!text) continue;

    if (RESUME_SECTION_RE.test(text)) {
      section = null;
      last = null;
      if (/^date\b/i.test(text)) {
        layout = {
          balance: /\bbalance\b/i.test(text),
          type: /\btype\b|\bdr\s*\/\s*cr\b/i.test(text),
          emi: /\bemi\s+eligib/i.test(text),
          currency: /\bcurrency\b/i.test(text),
          ref: /\bref(?:erence)?\.?\s*(?:no|number)\b/i.test(text),
          category: categoryColumn(line),
        };
      }
      continue;
    }
    if (!LINE_DATE_RE.test(text) && (EMI_SECTION_RE.test(text) || IGNORE_SECTION_RE.test(text))) {
      section = EMI_SECTION_RE.test(text) ? "emi" : "ignore";
      last = null;
      lastEmiOpen = false;
      continue;
    }
    if (section === "emi") {
      const row = text.match(EMI_ROW_RE);
      const money = (raw) => Number(raw.replace(/,/g, ""));
      if (row) {
        emiSummary.push({
          merchant: row[1],
          tenure: row[2].replace(/\s+/g, ""),
          originalPrincipal: money(row[3]),
          principalPaid: money(row[4]),
          outstanding: money(row[5]),
          monthlyEmi: money(row[6]),
        });
        lastEmiOpen = true;
      } else if (lastEmiOpen && /^[A-Z][A-Z &.'\/-]{1,40}$/.test(text)) {
        emiSummary.at(-1).merchant += ` ${text}`; // wrapped merchant name ("CONVERSION")
      } else {
        lastEmiOpen = false;
      }
      continue;
    }
    if (section === "ignore") continue;

    // A merchant category column is cut out by x before the row is read, so multi-word categories
    // ("CLOTH STORES") never end up in the description.
    let rowText = text;
    let category;
    if (layout.category && line.items?.length && LINE_DATE_RE.test(text)) {
      const inColumn = (item) => item.x >= layout.category.from && item.x < layout.category.to;
      const join = (items) =>
        clean(
          [...items]
            .sort((a, b) => a.x - b.x)
            .map((item) => item.text)
            .join(" "),
        );
      category = join(line.items.filter(inColumn));
      rowText = join(line.items.filter((item) => !inColumn(item)));
    }

    const transaction = parseTransactionLine(rowText, options, layout, Boolean(pendingLeading));
    if (transaction) {
      if (transaction.description === "") {
        transaction.description = pendingLeading.text;
        transaction.leadingX = pendingLeading.x;
      }
      if (category !== undefined) transaction.category = category;
      transactions.push({
        ...transaction,
        cardLast4: card.last4,
        cardHolder: card.holder,
        page: pageNumber,
      });
      last = transactions.at(-1);
      continuations = 0;
      continue;
    }

    if (last && DETAIL_LINE_RE.test(text) && !DETAIL_NOISE_RE.test(text)) {
      last.details = last.details ? `${last.details} | ${text}` : text;
      continue;
    }

    const holderLine = holderLineName(text);
    if (holderLine) {
      card = { ...card, holder: clean(holderLine[1]) };
      last = null;
      continue;
    }

    const marker = readCardMarker(text);
    if (marker) {
      const isPrimary = marker.last4 === summary.cardLast4;
      card = {
        last4: marker.last4,
        holder: marker.holder ?? (isPrimary ? (summary.cardHolder ?? null) : null),
      };
      last = null;
      continue;
    }

    const plainText =
      text.length <= 60 &&
      /[A-Za-z]/.test(text) &&
      (!AMOUNT_RE.test(text) || FOREIGN_RE.test(text));

    // A description cell taller than its row is printed around the date line:
    //     Interest charges for JULY-2026
    //     22/07/2026 10,219.27 DR
    //     Statement
    // Text directly above a date+amount line with no description of its own belongs to that row.
    if (plainText && isBareDated(lines[index + 1])) {
      leading = { text, x: firstX(line) };
      last = null;
      continue;
    }

    // A dateless line right under a transaction continues its description (wrapped merchant name,
    // city, or the foreign amount) -- but never a page footer, label, or a line carrying an INR amount.
    // The tail of a cell that started above its date line is recognised by starting at the same x
    // as the text above it, so even a word like "Statement" is taken there.
    const alignsWithLeading =
      last?.leadingX !== undefined &&
      firstX(line) !== undefined &&
      Math.abs(firstX(line) - last.leadingX) <= 3;
    const isContinuation =
      last &&
      continuations < 2 &&
      plainText &&
      (alignsWithLeading || !CONTINUATION_NOISE_RE.test(text));
    if (isContinuation) {
      last.description = `${last.description} ${text}`;
      continuations += 1;
      continue;
    }
    last = null;
  }

  return { summary, transactions: transactions.map(finalize), emiSummary };
}

const isGenericCardLayout = () => true;
const parseGenericCard = (lines) => parseCardStatement(lines);

export {
  extractSummary,
  isGenericCardLayout,
  parseCardStatement,
  parseGenericCard,
  parseTransactionLine,
};
