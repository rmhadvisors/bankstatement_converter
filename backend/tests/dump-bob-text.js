import fs from "node:fs/promises";

async function main() {
  const ocrData = JSON.parse(await fs.readFile("tests/fixtures/BOB__2360__APRIL_TO_JUN.pdf.ocr.json", "utf8"));
  let output = "";
  for (const line of ocrData.lines) {
    output += `Page ${line.pageNumber} (top=${line.top}, left=${line.left}): "${line.text}"\n`;
  }
  await fs.writeFile("tests/fixtures/bob_ocr_text.txt", output, "utf8");
  console.log("Dumped all lines to tests/fixtures/bob_ocr_text.txt");
}

main().catch(console.error);
