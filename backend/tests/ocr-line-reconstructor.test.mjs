import assert from "node:assert/strict";
import test from "node:test";

import { reconstructLinesFromWords } from "../src/parsers/ocrLineReconstructor.js";

test("reconstructs reading order from words given out of order (Y then X)", () => {
  // Two visual rows' words interleaved out of order, as OCR.space's column-major "isTable"
  // reflow can emit them -- the reconstructor must still recover top-to-bottom, left-to-right
  // reading order using each word's own position.
  const words = [
    { x: 400, y: 100, text: "Cr" }, // row 1, rightmost
    { x: 50, y: 200, text: "16-03-2026" }, // row 2, leftmost
    { x: 20, y: 100, text: "16-01-2026" }, // row 1, leftmost
    { x: 200, y: 200, text: "SHREEPATI" }, // row 2, middle
    { x: 200, y: 102, text: "BALAJI" }, // row 1, middle (tiny y jitter, same visual row)
  ];

  const lines = reconstructLinesFromWords(words);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "16-01-2026 BALAJI Cr");
  assert.equal(lines[1].text, "16-03-2026 SHREEPATI");
});

test("treats words more than the row band apart as separate lines", () => {
  const words = [
    { x: 10, y: 0, text: "A" },
    { x: 10, y: 50, text: "B" },
  ];
  const lines = reconstructLinesFromWords(words);
  assert.equal(lines.length, 2);
});

test("ignores words with missing or non-finite coordinates", () => {
  const words = [
    { x: 10, y: 0, text: "A" },
    { x: NaN, y: 0, text: "B" },
    { x: 10, text: "C" },
  ];
  const lines = reconstructLinesFromWords(words);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "A");
});
