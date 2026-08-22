import fs from "node:fs/promises";

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const cachePath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf.ocr.json";
  const ocrData = JSON.parse(await fs.readFile(cachePath, "utf8"));
  
  const pageLines = ocrData.pages[9].lines; // Page 10 is index 9
  console.log("Raw Page 10 Lines count:", pageLines.length);
  pageLines.forEach((l, i) => {
    console.log(`${i}: "${clean(l.text || l)}"`);
  });
}

main().catch(console.error);
