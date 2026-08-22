import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

try {
  process.loadEnvFile();
} catch (e) {}

const OCR_ENDPOINT = "https://api.ocr.space/parse/image";

async function main() {
  const filePath = "C:/Users/HP/Downloads/BOI BANK.pdf";
  const ocrApiKey = process.env.OCR_SPACE_API_KEY;
  
  console.log("Reading file...");
  const fileBuffer = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  
  const form = new FormData();
  form.append("apikey", ocrApiKey);
  form.append("language", "eng");
  form.append("isTable", "true");
  form.append("OCREngine", "2");
  form.append("detectOrientation", "true");
  form.append("scale", "true");
  form.append("filetype", "PDF");
  form.append("file", new Blob([fileBuffer], { type: "application/pdf" }), fileName);

  console.log("Sending to OCR...");
  const response = await fetch(OCR_ENDPOINT, {
    method: "POST",
    body: form,
  });
  
  const payload = await response.json();
  const results = payload.ParsedResults || [];
  let out = "";
  for (let i = 0; i < results.length; i++) {
    out += `\n=== PAGE ${i + 1} ===\n`;
    const lines = (results[i].ParsedText || "").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      out += `Tokens: ${JSON.stringify(line.split("\t"))}\n`;
    }
  }
  await fs.writeFile("tests/boi_ocr_dump.txt", out);
  console.log("Dump written to tests/boi_ocr_dump.txt");
}

main().catch(console.error);
