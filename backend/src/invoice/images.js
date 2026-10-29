// Turns uploaded invoice files into what the model reads: a text layer (digital PDF) or JPEG page
// images (photos, HEIC, scanned PDFs). Photos get EXIF rotation + downscaling only -- no
// binarization, which destroys handwriting, and no page cropping (the model ignores background).
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extractPdf } from "../parsers/pdfExtractor.js";

const require = createRequire(import.meta.url);

const MAX_LONG_SIDE = 2000;
const JPEG_QUALITY = 85;
const MAX_PDF_PAGES = 10;
// A digital PDF's text layer has at least this many non-space characters; scans have ~none.
const MIN_TEXT_CHARS = 200;

function invoiceError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Magic bytes, not the file name: the name is user input.
function sniffType(buffer) {
  const ascii = (start, end) => buffer.subarray(start, end).toString("latin1");
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(0, 5) === "%PDF-") return "pdf";
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(ascii(8, 12))) return "heic";
  return null;
}

// EXIF Orientation tag (0x0112) from a JPEG's APP1 segment; 1 (upright) when absent.
function exifOrientation(buffer) {
  let offset = 2;
  while (offset + 4 <= buffer.length && buffer[offset] === 0xff) {
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker === 0xe1 && buffer.subarray(offset + 4, offset + 10).toString("latin1") === "Exif\0\0") {
      const tiff = offset + 10;
      const little = buffer.subarray(tiff, tiff + 2).toString("latin1") === "II";
      const u16 = (at) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
      const u32 = (at) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
      const ifd = tiff + u32(tiff + 4);
      for (let i = 0, count = u16(ifd); i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x0112) return u16(entry + 8);
      }
      return 1;
    }
    if (marker === 0xda) break; // start of scan: no more metadata
    offset += 2 + length;
  }
  return 1;
}

// EXIF orientation -> [clockwise degrees, mirrored] (mirror is applied before rotating).
const ORIENTATION = { 1: [0, false], 2: [0, true], 3: [180, false], 4: [180, true], 5: [270, true], 6: [90, false], 7: [90, true], 8: [270, false] };

async function loadCanvas() {
  const canvasApi = await import("@napi-rs/canvas");
  // pdf.js rendering under Node expects these browser globals (same setup as ocrExtractor).
  globalThis.Path2D ??= canvasApi.Path2D;
  globalThis.DOMMatrix ??= canvasApi.DOMMatrix;
  globalThis.ImageData ??= canvasApi.ImageData;
  return canvasApi;
}

// Draw `source` (anything drawImage accepts) upright, rotated by `degrees`, long side <= MAX_LONG_SIDE.
async function toJpeg(canvasApi, source, width, height, degrees = 0, mirrored = false) {
  const scale = Math.min(1, MAX_LONG_SIDE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const quarter = degrees % 180 !== 0;
  const canvas = canvasApi.createCanvas(quarter ? h : w, quarter ? w : h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  if (mirrored) ctx.scale(-1, 1);
  ctx.drawImage(source, -w / 2, -h / 2, w, h);
  return { mediaType: "image/jpeg", data: await canvas.encode("jpeg", JPEG_QUALITY), width: canvas.width, height: canvas.height };
}

async function imageFileToJpeg(buffer, type, rotate) {
  const canvasApi = await loadCanvas();
  if (type === "heic") {
    // libheif applies the HEIF rotation itself, so only the user's rotation is added.
    const decode = require("heic-decode");
    const { width, height, data } = await decode({ buffer });
    const raw = canvasApi.createCanvas(width, height);
    raw.getContext("2d").putImageData(new canvasApi.ImageData(data, width, height), 0, 0);
    return toJpeg(canvasApi, raw, width, height, rotate);
  }
  const image = await canvasApi.loadImage(buffer);
  const [degrees, mirrored] = type === "jpeg" ? ORIENTATION[exifOrientation(buffer)] ?? ORIENTATION[1] : ORIENTATION[1];
  return toJpeg(canvasApi, image, image.width, image.height, (degrees + rotate) % 360, mirrored);
}

async function renderPdfPages(buffer, rotate) {
  const canvasApi = await loadCanvas();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: pdfjs.VerbosityLevel.ERRORS }).promise;
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw invoiceError("INVOICE_TOO_MANY_PAGES", `This PDF has ${pdf.numPages} pages; an invoice upload can have at most ${MAX_PDF_PAGES}.`);
  }
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: MAX_LONG_SIDE / Math.max(base.width, base.height) });
    const canvas = canvasApi.createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    pages.push(await toJpeg(canvasApi, canvas, canvas.width, canvas.height, rotate));
  }
  return pages;
}

// -> { kind: "text", text, pageCount } | { kind: "images", images: [{ mediaType, data, width, height }] }
// `rotate` (0/90/180/270, clockwise) comes from the review screen's rotate button.
async function prepareInvoiceFile(filePath, { rotate = 0 } = {}) {
  const buffer = await readFile(filePath);
  const type = sniffType(buffer);
  if (!type) throw invoiceError("INVOICE_UNSUPPORTED_FILE", "Only JPG, PNG, WEBP, HEIC photos and PDF files are supported.");
  if (type !== "pdf") return { kind: "images", images: [await imageFileToJpeg(buffer, type, rotate)] };

  const { text, pageCount } = await extractPdf(filePath);
  if (rotate === 0 && text.replace(/\s+/g, "").length >= MIN_TEXT_CHARS) return { kind: "text", text, pageCount };
  return { kind: "images", images: await renderPdfPages(buffer, rotate) };
}

export { exifOrientation, invoiceError, prepareInvoiceFile, sniffType, MAX_LONG_SIDE };
