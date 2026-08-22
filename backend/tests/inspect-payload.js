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

  console.log("Sending to OCR.space...");
  const response = await fetch(OCR_ENDPOINT, {
    method: "POST",
    body: form,
  });
  
  const payload = await response.json();
  console.log("Response keys:", Object.keys(payload));
  console.log("IsErroredOnProcessing:", payload.IsErroredOnProcessing);
  console.log("ErrorMessage:", payload.ErrorMessage);
  console.log("ErrorDetails:", payload.ErrorDetails);
  console.log("ParsedResults count:", payload.ParsedResults ? payload.ParsedResults.length : 0);
  if (payload.ParsedResults && payload.ParsedResults.length > 0) {
    console.log("First ParsedResult keys:", Object.keys(payload.ParsedResults[0]));
    console.log("First ParsedResult text snippet:", payload.ParsedResults[0].ParsedText?.slice(0, 200));
  }
}

main().catch(console.error);
