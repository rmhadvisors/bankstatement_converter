// GSTIN = 2-digit state code + 10-char PAN + entity digit + "Z" + check character.
// The check character is a Luhn mod-36 over the first 14 characters; a failure usually means one
// character was misread (OCR or handwriting), so it is reported, never corrected.
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_FORMAT = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function cleanGstin(raw) {
  return String(raw ?? "").replace(/\s+/g, "").toUpperCase();
}

function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

// 01-38 are states/UTs, 97 "Other Territory", 99 "Centre Jurisdiction".
function isStateCode(code) {
  const n = Number(code);
  return (n >= 1 && n <= 38) || n === 97 || n === 99;
}

// null when valid, otherwise a short human reason.
function gstinProblem(raw) {
  const gstin = cleanGstin(raw);
  if (gstin.length !== 15) return `should be 15 characters, has ${gstin.length}`;
  const match = GSTIN_FORMAT.exec(gstin);
  if (!match) return "doesn't match the GSTIN pattern (state code + PAN + entity + Z + check)";
  if (!isStateCode(match[1])) return `${match[1]} is not a valid state code`;
  const expected = gstinCheckChar(gstin);
  if (expected !== gstin[14]) return `check character should be ${expected}, not ${gstin[14]}`;
  return null;
}

// State code of a well-formed GSTIN, else null.
function gstinStateCode(raw) {
  const match = GSTIN_FORMAT.exec(cleanGstin(raw));
  return match && isStateCode(match[1]) ? match[1] : null;
}

export { cleanGstin, gstinCheckChar, gstinProblem, gstinStateCode };
