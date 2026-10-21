import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyStatement,
  detectIssuer,
  isCreditCardStatement,
} from "../../src/creditcard/ccDetector.js";
import * as cards from "../fixtures/creditcard/synthetic-statements.mjs";
import { federal019068Lines } from "../fixtures/federal-019068-lines.mjs";
import { hdfc3241OcrLines } from "../fixtures/hdfc-3241-ocr-lines.mjs";
import { idbiFinacleLines } from "../fixtures/idbi-finacle-lines.mjs";
import { pnbOcrLines } from "../fixtures/pnb-ocr-lines.mjs";
import { unionBank571301010050303Lines } from "../fixtures/union-bank-571301010050303-lines.mjs";
import { page1Lines as greaterBombayLines } from "../fixtures/greater-bombay-lines.mjs";

const bankStatements = {
  federal: federal019068Lines,
  hdfcBank: hdfc3241OcrLines,
  idbi: idbiFinacleLines,
  pnb: pnbOcrLines,
  unionBank: unionBank571301010050303Lines,
  greaterBombay: greaterBombayLines,
};

test("ccDetector: synthetic card statements are credit card statements of the right issuer", () => {
  for (const [name, statement] of Object.entries(cards).filter(([, value]) => value.lines)) {
    assert.equal(classifyStatement(statement.lines), "credit_card", name);
    assert.equal(detectIssuer(statement.lines)?.key, statement.expected.issuer, name);
  }
});

test("ccDetector: real bank statement fixtures are never classified as card statements", () => {
  for (const [name, lines] of Object.entries(bankStatements)) {
    assert.equal(isCreditCardStatement(lines), false, name);
    assert.notEqual(classifyStatement(lines), "credit_card", name);
  }
  assert.equal(classifyStatement(pnbOcrLines), "bank");
});

test("ccDetector: issuer is the one named most, not one mentioned in a narration", () => {
  const text = "ICICI Bank Credit Card\nPAYMENT RECEIVED HDFC BANK NEFT\nICICI Bank customer care";
  assert.equal(detectIssuer(text).key, "icici");
  assert.equal(detectIssuer("Statement of something"), null);
});

test("ccDetector: a bank narration mentioning a card bill is still a bank statement", () => {
  const text =
    "STATEMENT OF ACCOUNT IFSC SBIN0001 Opening Balance\nCREDIT CARD PAYMENT HDFC due date 12/03 Withdrawals Deposits";
  assert.equal(classifyStatement(text), "bank");
});
