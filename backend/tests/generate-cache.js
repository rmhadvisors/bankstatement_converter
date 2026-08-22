import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const dumpPath = "d:/CA-RMHStaffPortal/BankStatementconvertermain/tests/split-ocr-text-dump.txt";
  const cachePath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf.ocr.json";
  
  const textContent = await fs.readFile(dumpPath, "utf8");
  const rawLines = textContent.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  console.log("Total lines read from dump:", rawLines.length);
  
  // Define precise line counts for each page
  const pageCounts = [85, 85, 63, 63, 66, 44, 53, 26, 44, 128];
  
  const pages = [];
  const lines = [];
  let lineIdx = 0;
  
  for (let pIdx = 0; pIdx < pageCounts.length; pIdx++) {
    const pageNum = pIdx + 1;
    const count = pageCounts[pIdx];
    const pageLines = [];
    
    for (let c = 0; c < count; c++) {
      if (lineIdx >= rawLines.length) break;
      const text = rawLines[lineIdx++];
      const lineObj = { pageNumber: pageNum, text };
      pageLines.push(lineObj);
      lines.push(lineObj);
    }
    
    pages.push({
      pageNumber: pageNum,
      lines: pageLines
    });
  }
  
  const cacheResult = {
    pageCount: pages.length,
    pages,
    lines,
    text: lines.map(l => l.text).join("\n")
  };
  
  await fs.writeFile(cachePath, JSON.stringify(cacheResult, null, 2), "utf8");
  console.log("SUCCESS! Generated cache file at:", cachePath);
}

main().catch(console.error);
