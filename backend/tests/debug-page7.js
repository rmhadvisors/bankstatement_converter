import fs from "node:fs/promises";

// We copy the parsing logic to debug Page 7 (index 6)
function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAxisAmount(raw) {
  if (!raw) return null;
  let text = clean(raw).replace(/[₹$€£]/g, "").replace(/Cr|Dr/gi, "").trim();
  if (/\d{2}[./-]\d{2}[./-]\d{2,4}/.test(text)) return null;
  const parts = text.split(/[.,]/);
  if (parts.length > 2) {
    const decimals = parts.pop();
    const integers = parts.join("");
    text = `${integers}.${decimals}`;
  } else if (parts.length === 2) {
    text = parts.join(".");
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return /^-/.test(raw) || /\bDr$/i.test(raw) ? -Math.abs(value) : value;
}

function isAxisSkippableDescription(value) {
  const text = clean(value);
  if (!text || /^B\/F/i.test(text)) return true;
  if (/^(opening|closing|average|avg)\s+balance/i.test(text)) return true;
  if (/^average\s+balance\s+maintained/i.test(text)) return true;
  if (/^break-up\s+of\s+consolidated\s+charges/i.test(text)) return true;
  if (/^(sr\.?\s*no\.?|type\s+of\s+fee|amount|additional\s+information)$/i.test(text)) return true;
  if (/^ecs\s+nach\s+transaction\s+fee/i.test(text)) return true;
  if (/^the\s+fees\s+above\s+may\s+have\s+elements/i.test(text)) return true;
  if (/^(txn\s+date|transaction|withdrawals|deposits|balance|other\s+information)$/i.test(text)) return true;
  if (/^(detailed\s+statement\s+for|account\s+no|branch\s+name|lien\s+amount|ifsc\s+code|micr\s+code|nominee\s+name|account\s+statement|quick\s+view|savings\s+bank|branch\s+sol|regd|email\s+id|mode\s+of\s+operation|type\s+of\s+account|joint\s+holders|nomination)/i.test(text)) return true;
  return false;
}

function groupAxisDescriptions(descriptions) {
  const groups = [];
  let current = [];
  const flush = () => {
    if (current.length) {
      const cleanedParts = current.map(part => clean(part).replace(/^\d{2}[./-]\d{2}[./-]\d{2,4}\s*/, ""));
      const merged = clean(cleanedParts.filter(p => p && !isAxisSkippableDescription(p)).join(" "));
      if (merged) groups.push(merged);
      current = [];
    }
  };
  const startsNewGroup = (text) =>
    /^\d{2}[./-]\d{2}[./-]\d{2,4}\b/.test(clean(text)) ||
    /^(I\/W CHQ RETURN|INWARD RETURN|CHQ PAID-MICR INWARD|BACBH\d|NEFT CHARGES|^GST$|NEFT DR-|VENTURES|CLEARING-SSCN|TO TRF|BY TRF|BY CTS|Opening Balance|Closing Balance)/i.test(text);

  for (const text of descriptions) {
    if (isAxisSkippableDescription(text)) continue;
    if (current.length > 0 && startsNewGroup(text)) flush();
    current.push(text);
  }
  flush();
  return groups;
}

async function main() {
  const cachePath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf.ocr.json";
  const ocrData = JSON.parse(await fs.readFile(cachePath, "utf8"));
  
  const pageLines = ocrData.pages[6].lines; // Page 7 is index 6
  const startIndex = pageLines.findIndex(l => 
    /(Detailed Statement for|Account Statement|Txn Date|Date\s*Transaction)/i.test(clean(l.text || l))
  );
  const statementLines = pageLines.slice(startIndex);
  
  const texts = statementLines.map((line) => clean(line.text || line));
  const numericLines = [];
  const textLines = [];
  
  for (const text of texts) {
    if (isAxisSkippableDescription(text)) continue;
    
    if (/\d{2}[./-]\d{2}[./-]\d{2,4}/.test(text)) {
      textLines.push(text);
      continue;
    }
    
    const isNumber = /^-?[\d,.]+\.\d{2}$/.test(text) || /^-?[\d,.]+$/.test(text);
    if (isNumber && parseAxisAmount(text) !== null) {
      numericLines.push(parseAxisAmount(text));
    } else {
      textLines.push(text);
    }
  }
  
  const dates = [];
  for (const line of textLines) {
    const match = line.match(/^(\d{2})[./-](\d{2})[./-](\d{2,4})\b/);
    if (match) {
      const d = new Date(Date.UTC(Number(match[3]) < 100 ? Number(match[3])+2000 : Number(match[3]), Number(match[2]) - 1, Number(match[1])));
      dates.push(d);
    }
  }
  
  const narrationGroups = groupAxisDescriptions(textLines);
  const T_est = Math.max(dates.length, narrationGroups.length);
  const K = numericLines.length;
  
  console.log(`PAGE 7 DEBUG: K = ${K}, T_est = ${T_est}`);
  console.log("dates:", dates.map(d => d.toISOString().slice(0, 10)));
  console.log("narrationGroups:", narrationGroups);
  console.log("numericLines:", numericLines);
}

main().catch(console.error);
