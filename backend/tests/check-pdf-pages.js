import fs from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

async function main() {
  const pdfPath = "C:/Users/HP/.gemini/antigravity-ide/brain/00b8ef4e-5d26-43bb-90e0-1b7264b9a828/media__1782811280625.pdf";
  const fileBuffer = await fs.readFile(pdfPath);
  const pdf = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
  console.log("PDF Page Count:", pdf.getPageCount());
}

main().catch(console.error);
