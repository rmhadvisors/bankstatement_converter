import { detectIssuer } from "../ccDetector.js";
import { clean } from "../ccCommon.js";
import { parseCardStatement } from "./genericCard.js";

// SBI Card: "DD MMM YY" dates and a "D"/"C" marker after every amount -- both handled by the
// engine's defaults.
const isSbiCardLayout = (lines) => detectIssuer(lines)?.key === "sbi";

// ACCOUNT SUMMARY: five columns whose labels wrap over up to four lines ("Payments," above the row, "Purchases &
// Other" / "Debits" below it, a "( ` )" glyph line) with the five amounts on one line underneath. The shared column
// reader gives up on that header, so each amount goes to the label whose x is nearest to it.
const SUMMARY_COLUMNS = [
  [/^Previous Balance$/i, "previousBalance"],
  [/^(?:Reversals & other|Payments,)$/i, "paymentsCredits"],
  [/^Purchases & Other$/i, "purchasesDebits"],
  [/^Fee, Taxes &$/i, "financeCharges"],
  [/^Total Outstanding$/i, "totalAmountDue"],
];
const AMOUNT_ITEM = /^\d{1,3}(?:,\d{2,3})*\.\d{2}$/;
const BAND_LINES = 8; // the label lines and the amounts line all sit within a few lines of "ACCOUNT SUMMARY"

function readAccountSummary(lines, summary) {
  const start = lines.findIndex((line) => /^ACCOUNT SUMMARY$/i.test(clean(line.text ?? "")));
  if (start < 0) return;
  const band = lines.slice(start + 1, start + 1 + BAND_LINES).filter((line) => line.pageNumber === lines[start].pageNumber);
  const values = band.find((line) => (line.items ?? []).filter((item) => AMOUNT_ITEM.test(clean(item.text))).length >= 4);
  if (!values) return;

  const labels = band
    .flatMap((line) => line.items ?? [])
    .map((item) => ({ x: item.x, key: SUMMARY_COLUMNS.find(([pattern]) => pattern.test(clean(item.text)))?.[1] }))
    .filter((label) => label.key);
  if (new Set(labels.map((label) => label.key)).size < SUMMARY_COLUMNS.length) return; // not this table: leave it alone

  const found = {};
  for (const item of values.items.filter((entry) => AMOUNT_ITEM.test(clean(entry.text)))) {
    const { key } = labels.reduce((best, label) => (Math.abs(label.x - item.x) < Math.abs(best.x - item.x) ? label : best));
    if (key in found) return; // two amounts under one label: the table is not what we think it is
    found[key] = Number(clean(item.text).replace(/,/g, ""));
  }
  if (Object.keys(found).length < SUMMARY_COLUMNS.length) return;

  // The table is identified, so its five amounts replace what the label scan guessed: it read the fine print's
  // "3.75% p.m." as the finance charge and "Reversals & other Credits" a second time as other credits.
  Object.assign(summary, found);
  if (summary.otherCredits === found.paymentsCredits) delete summary.otherCredits;
}

// "**Minimum Amount Due ( ` )" sits in the top-right box; its amount is printed a line or two below, further right.
function readMinimumDue(lines, summary) {
  const at = lines.findIndex((line) => (line.items ?? []).some((item) => /^\**\s*Minimum Amount Due$/i.test(clean(item.text))));
  if (at < 0 || summary.minimumAmountDue !== undefined) return;
  const label = lines[at].items.find((item) => /Minimum Amount Due$/i.test(clean(item.text)));
  const amount = lines
    .slice(at + 1, at + 5)
    .filter((line) => line.pageNumber === lines[at].pageNumber)
    .flatMap((line) => line.items ?? [])
    .find((item) => AMOUNT_ITEM.test(clean(item.text)) && Math.abs(item.x - label.x) < 60);
  if (amount) summary.minimumAmountDue = Number(clean(amount.text).replace(/,/g, ""));
}

function parseSbiCard(lines) {
  const parsed = parseCardStatement(lines);
  readAccountSummary(lines, parsed.summary);
  readMinimumDue(lines, parsed.summary);
  return parsed;
}

export { isSbiCardLayout, parseSbiCard };
