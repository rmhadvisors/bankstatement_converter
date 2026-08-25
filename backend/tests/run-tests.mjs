import process from "node:process";
try {
  process.loadEnvFile();
} catch (e) {
  // Ignored if loadEnvFile doesn't exist or .env is missing
}

await import("./bob-502.test.mjs");
await import("./bccb-june-26.test.mjs");
await import("./tjsb-011763.test.mjs");
await import("./kotak-5611535323.test.mjs");
await import("./provided-samples.test.mjs");
await import("./icici-9043-detailed.test.mjs");
await import("./idbi-rep31-ledger.test.mjs");
await import("./bccb-018110100001093.test.mjs");
await import("./pdf-preflight-empty-content.test.mjs");
await import("./ocr-corrections.test.mjs");
await import("./ocr-line-reconstructor.test.mjs");
await import("./federal-ocr-tolerant.test.mjs");
await import("./idbi-finacle-scanned-ocr.test.mjs");
await import("./apna-sahakari.test.mjs");

