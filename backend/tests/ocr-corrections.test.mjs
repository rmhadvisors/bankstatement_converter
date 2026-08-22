import assert from "node:assert/strict";
import test from "node:test";

import { correctOcrToken } from "../src/parsers/ocrCorrections.js";

test("fixes O/0 confusion inside a date token", () => {
  assert.equal(correctOcrToken("01/O7/2026"), "01/07/2026");
});

test("fixes O/0 confusion inside an amount token", () => {
  assert.equal(correctOcrToken("1,2O0.OO"), "1,200.00");
});

test("leaves narration-shaped text untouched", () => {
  assert.equal(correctOcrToken("SHREEPATI REALTY"), "SHREEPATI REALTY");
});

test("leaves already-correct tokens untouched", () => {
  assert.equal(correctOcrToken("16-03-2026"), "16-03-2026");
  assert.equal(correctOcrToken("25,00,000.00"), "25,00,000.00");
});
