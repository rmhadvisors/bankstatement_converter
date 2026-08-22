import fs from "node:fs/promises";

async function main() {
  const cachePath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf.ocr.json";
  const ocrData = JSON.parse(await fs.readFile(cachePath, "utf8"));
  
  console.log("Line object structure:");
  console.log(JSON.stringify(ocrData.pages[0].lines.slice(67, 83), null, 2));
}

main().catch(console.error);
