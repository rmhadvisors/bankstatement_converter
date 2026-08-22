import fs from "node:fs/promises";
import path from "node:path";
import { splitPdfPages } from "../src/parsers/ocrExtractor.js";
import canvasApi from "@napi-rs/canvas";
import Tesseract from "tesseract.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

globalThis.Path2D = canvasApi.Path2D;
globalThis.DOMMatrix = canvasApi.DOMMatrix;
globalThis.ImageData = canvasApi.ImageData;

async function runLocalPdfOcr(fileBuffer) {
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  }).promise;
  let text = "";

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = canvasApi.createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;
    const png = await canvas.encode("png");
    const result = await Tesseract.recognize(png, "eng");
    text += `${result.data.text || ""}\n`;
  }

  return text;
}

async function main() {
  const pdfPath = "tests/fixtures/BOB__2360__APRIL_TO_JUN.pdf";
  const fileBuffer = await fs.readFile(pdfPath);
  
  console.log("Splitting PDF...");
  const pages = await splitPdfPages(fileBuffer, "BOB__2360__APRIL_TO_JUN.pdf");
  console.log("Split into", pages.length, "pages.");
  
  console.log("Running local OCR on page 1...");
  const start = Date.now();
  const text = await runLocalPdfOcr(pages[0].fileBuffer);
  console.log(`OCR took ${((Date.now() - start) / 1000).toFixed(2)} seconds.`);
  console.log("\n--- EXTRACTED TEXT FROM PAGE 1 ---");
  console.log(text);
}

main().catch(console.error);
