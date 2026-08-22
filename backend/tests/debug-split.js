import fs from "node:fs/promises";

async function main() {
  const cachePath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf.ocr.json";
  const ocrData = JSON.parse(await fs.readFile(cachePath, "utf8"));
  
  const clean = (str) => {
    if (!str) return "";
    return str
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };
  
  // Let's debug Page 2 (index 1)
  const pageLines = ocrData.pages[1].lines;
  
  const startIndex = pageLines.findIndex(l => 
    /(Detailed Statement for|Account Statement|Txn Date|Date\s*Transaction)/i.test(clean(l.text || l))
  );
  console.log("Start Index for Page 2:", startIndex);
  
  const statementLines = pageLines.slice(startIndex);
  
  const blocks = [];
  let current = [];
  let seenBalances = false;

  for (const line of statementLines) {
    const text = clean(line.text || line);
    
    const isDate = /^\s*\d{2}[./-]\d{2}[./-]\d{2,4}\b/.test(text);
    const isBalanceKeyword = /^\s*(Balance|Closing Balance)\s*$/i.test(text);

    if (isBalanceKeyword) {
      console.log(`Matched Balance Keyword at line: "${text}"`);
      seenBalances = true;
    }

    if (seenBalances && isDate) {
      console.log(`Triggering split at date line: "${text}"`);
      blocks.push(current);
      current = [];
      seenBalances = false;
    }

    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current);
  }
  
  console.log(`Total blocks split for Page 2: ${blocks.length}`);
  blocks.forEach((block, idx) => {
    console.log(`Block ${idx + 1} has ${block.length} lines.`);
  });
}

main().catch(console.error);
