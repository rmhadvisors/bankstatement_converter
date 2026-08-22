import fs from "node:fs/promises";

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

async function main() {
  const cachePath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf.ocr.json";
  const ocrData = JSON.parse(await fs.readFile(cachePath, "utf8"));
  
  const pageLines = ocrData.pages[6].lines; // Page 7 is index 6
  const startIndex = pageLines.findIndex(l => 
    /(Detailed Statement for|Account Statement|Txn Date|Date\s*Transaction)/i.test(clean(l.text || l))
  );
  const statementLines = pageLines.slice(startIndex);
  
  console.log("STATEMENT LINES STATUS:");
  statementLines.forEach((l, idx) => {
    const text = clean(l.text || l);
    const skipped = isAxisSkippableDescription(text);
    console.log(`${idx}: "${text}" -> skipped=${skipped}`);
  });
}

main().catch(console.error);
