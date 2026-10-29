import process from "node:process";
try {
  process.loadEnvFile();
} catch (e) {
  // Ignored if loadEnvFile doesn't exist or .env is missing
}

await import("./bob-502.test.mjs");
await import("./bccb-june-26.test.mjs");
await import("./bccb-passbook-photos.test.mjs");
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
await import("./icici-0836-scanned.test.mjs");
await import("./creditcard/ccCommon.test.mjs");
await import("./creditcard/ccValidation.test.mjs");
await import("./creditcard/ccDetector.test.mjs");
await import("./creditcard/ccConverter.test.mjs");
await import("./creditcard/hdfc45.test.mjs");
await import("./creditcard/idfc.test.mjs");
await import("./creditcard/axis.test.mjs");
await import("./creditcard/server.test.mjs");

await import("./hdfc-merged-apr25-mar26.test.mjs");
await import("./bank-client-statements.test.mjs");
await import("./bank-review-status.test.mjs");
