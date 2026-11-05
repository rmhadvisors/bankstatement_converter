// Indian-system amount words: crore (1e7), lakh (1e5), thousand, hundred, plus paise.
const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(n) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}`.trim();
}

function integerWords(n) {
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  if (crore) parts.push(`${integerWords(crore)} Crore`);
  for (const [size, name] of [[1e5, "Lakh"], [1e3, "Thousand"], [100, "Hundred"]]) {
    const q = Math.floor(n / size);
    n %= size;
    if (q) parts.push(`${below100(q)} ${name}`);
  }
  if (n) parts.push(below100(n));
  return parts.join(" ");
}

// 69667.2 -> "Sixty Nine Thousand Six Hundred Sixty Seven and Paise Twenty Only"
function amountToIndianWords(amount) {
  const totalPaise = Math.round(Math.abs(amount) * 100);
  const paise = totalPaise % 100;
  return `${integerWords(Math.floor(totalPaise / 100))}${paise ? ` and Paise ${below100(paise)}` : ""} Only`;
}

const SMALL = Object.fromEntries([
  ...ONES.slice(1).map((w, i) => [w.toLowerCase(), i + 1]),
  ...TENS.slice(2).map((w, i) => [w.toLowerCase(), (i + 2) * 10]),
  ["zero", 0], ["fourty", 40], ["ninty", 90], ["twelfe", 12],
]);
const SCALES = { thousand: 1e3, lakh: 1e5, million: 1e6, crore: 1e7, billion: 1e9 };
const SYNONYMS = { lakhs: "lakh", lac: "lakh", lacs: "lakh",crores: "crore", thousands: "thousand", hundreds: "hundred", paisa: "paise" };
const FILLER = new Set(["rupees", "rupee", "rs", "inr", "only", "indian"]);

// Accepts both Indian ("One Lakh Fifty Four Thousand") and international ("One Hundred Fifty Four
// Thousand") wording because each scale word multiplies what precedes it.
function wordsToInt(tokens) {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const t of tokens) {
    if (t === "and") continue;
    if (t in SMALL) current += SMALL[t];
    else if (t === "hundred") current = (current || 1) * 100;
    else if (t in SCALES) {
      total += (current || 1) * SCALES[t];
      current = 0;
    } else return null;
    seen = true;
  }
  return seen ? total + current : null;
}

// "Sixty-nine thousand six hundred sixty-seven, paise twenty" -> 69667.2; null if unparseable.
function wordsToAmount(text) {
  const tokens = String(text ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((t) => SYNONYMS[t] ?? t)
    .filter((t) => t && !FILLER.has(t));
  let rupeeTokens = tokens;
  let paiseTokens = [];
  const at = tokens.indexOf("paise");
  if (at >= 0) {
    const before = tokens.slice(0, at);
    const after = tokens.slice(at + 1);
    if (after.length && wordsToInt(after) !== null) {
      rupeeTokens = before;
      paiseTokens = after;
    } else {
      // "... and Twenty Paise": the paise number is the group after the last "and".
      const and = before.lastIndexOf("and");
      if (and < 0) return null;
      rupeeTokens = before.slice(0, and);
      paiseTokens = before.slice(and + 1);
    }
  }
  const rupees = rupeeTokens.length ? wordsToInt(rupeeTokens) : 0;
  const paise = paiseTokens.length ? wordsToInt(paiseTokens) : 0;
  if (rupees === null || paise === null || paise > 99) return null;
  return Math.round(rupees * 100 + paise) / 100;
}

export { amountToIndianWords, wordsToAmount };
