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
  if (results.length > 1) {
    const page2Text = results[1].ParsedText || "";
    const lines = page2Text.split(/\r?\n/).filter(Boolean);
    console.log("Page 2 lines split by tabs:");
    for (const line of lines) {
      console.log("Line:", JSON.stringify(line));
      console.log("Tabs:", JSON.stringify(line.split("\t")));
    }
  }
}

main().catch(console.error);
