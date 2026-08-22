// Common OCR character confusions and layout mistakes, corrected only within numeric/date
// shaped tokens. Applying these substitutions to free-text narration would corrupt real words
// (e.g. a merchant name legitimately containing "O" or "S"), so every rule here first checks
// that the token, once confusable letters are treated as digits, looks like a date or amount.

const DIGIT_LOOKALIKES = {
  O: "0",
  o: "0",
  I: "1",
  l: "1",
  S: "5",
  s: "5",
  B: "8",
};

function swapLookalikes(text) {
  return text.replace(/[OoIlSsB]/g, (char) => DIGIT_LOOKALIKES[char] ?? char);
}

// A token is "date-shaped" once its confusable letters are swapped for digits and it matches
// dd/mm/yyyy, dd-mm-yyyy, or dd.mm.yyyy (allowing 2 or 4 digit years).
function isDateShaped(swapped) {
  return /^\d{2}[/.-]\d{2}[/.-](\d{2}|\d{4})$/.test(swapped);
}

// A token is "amount-shaped" once swapped if it matches a plain or comma-grouped decimal number.
function isAmountShaped(swapped) {
  return /^-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}$/.test(swapped);
}

// Repairs a decimal point OCR'd as a comma/letter and a thousands separator dropped or misread,
// e.g. "1,2O0,OO" -> "1,200.00", "1200,00" -> "1200.00". Only the last separator becomes the
// decimal point; earlier ones are treated as thousands separators.
function repairDecimalPoint(text) {
  const parts = text.split(/[.,]/);
  if (parts.length < 2) return text;
  const decimals = parts.pop();
  if (decimals.length > 2) return text;
  return `${parts.join(",")}.${decimals}`;
}

function correctOcrToken(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text) return text;

  const directSwap = swapLookalikes(text);
  if (isDateShaped(directSwap)) return directSwap;
  if (isAmountShaped(directSwap)) return directSwap;

  const repaired = repairDecimalPoint(directSwap);
  if (isAmountShaped(repaired)) return repaired;

  return text;
}

// Loosely-shaped runs that *might* be a date or amount once confusable letters are swapped for
// digits -- deliberately permissive (letters allowed anywhere digits would go) since the whole
// point is to catch OCR misreads; correctOcrToken() re-validates the strict shape before
// accepting a correction, so a real word that happens to match this loose shape is left alone.
const DATE_LOOKALIKE_REGEX = /\b[0-9OoIlSsB]{2}[/.-][0-9OoIlSsB]{2}[/.-][0-9OoIlSsB]{2,4}\b/g;
const AMOUNT_LOOKALIKE_REGEX = /\b[0-9OoIlSsB]{1,3}(?:,[0-9OoIlSsB]{2,3})*\.[0-9OoIlSsB]{1,2}\b/g;

// Runs correctOcrToken() over every date-shaped and amount-shaped run found in a larger block of
// OCR text (e.g. a whole reconstructed transaction row), leaving everything else -- narration,
// reference numbers, whitespace -- untouched. Returns whether anything actually changed, so
// callers can lower their confidence in a row that needed correction.
function correctOcrText(text) {
  const source = String(text ?? "");
  let hadCorrections = false;

  const correctMatch = (match) => {
    const corrected = correctOcrToken(match);
    if (corrected !== match) hadCorrections = true;
    return corrected;
  };

  const result = source.replace(DATE_LOOKALIKE_REGEX, correctMatch).replace(AMOUNT_LOOKALIKE_REGEX, correctMatch);

  return { text: result, hadCorrections };
}

export { correctOcrToken, correctOcrText };
