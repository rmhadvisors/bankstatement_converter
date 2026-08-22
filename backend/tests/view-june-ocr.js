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
  
  const pageLines = ocrData.pages[2].lines; // June is index 2
  pageLines.forEach((l, i) => {
    const text = clean(l.text || l);
    if (/2282|118|11,800|11800|282|2,282/i.test(text)) {
      console.log(`${i}: "${text}"`);
    }
  });
}

main().catch(console.error);
