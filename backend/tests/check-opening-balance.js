import fs from "node:fs/promises";

async function main() {
  const fileContent = await fs.readFile("tests/fixtures/bob_ocr_text.txt", "utf8");
  const lines = fileContent.split("\n");
  
  console.log("Searching for keywords...");
  lines.forEach((line, idx) => {
    if (/opening|b\/f|brought|forward|closing/i.test(line)) {
      console.log(`Line ${idx + 1}: ${line}`);
    }
  });
}

main().catch(console.error);
