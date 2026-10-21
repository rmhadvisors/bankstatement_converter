import assert from "node:assert/strict";
import test from "node:test";

import {
  maskCard,
  maskCardNumbers,
  parseCcAmount,
  parseCcDate,
} from "../../src/creditcard/ccCommon.js";

const iso = (date) => date?.toISOString().slice(0, 10) ?? null;

test("ccCommon: parses every card statement date layout", () => {
  assert.equal(iso(parseCcDate("12/03/2024")), "2024-03-12");
  assert.equal(iso(parseCcDate("12-03-24")), "2024-03-12");
  assert.equal(iso(parseCcDate("12/03/2024 14:05:33")), "2024-03-12");
  assert.equal(iso(parseCcDate("12 Mar 24")), "2024-03-12");
  assert.equal(iso(parseCcDate("12-Mar-2024")), "2024-03-12");
  assert.equal(iso(parseCcDate("12 March, 2024")), "2024-03-12");
  assert.equal(iso(parseCcDate("March 12, 2024")), "2024-03-12");
  assert.equal(parseCcDate("31/02/2024"), null, "impossible dates are rejected, not rolled over");
  assert.equal(parseCcDate("12 Foo 2024"), null);
});

test("ccCommon: credit and debit markers", () => {
  const credit = (amount) => ({ amount, type: "credit" });
  const debit = (amount) => ({ amount, type: "debit" });

  assert.deepEqual(parseCcAmount("1,234.56 Cr"), credit(1234.56));
  assert.deepEqual(parseCcAmount("1,234.56 CR"), credit(1234.56));
  assert.deepEqual(parseCcAmount("1,234.56Cr"), credit(1234.56));
  assert.deepEqual(parseCcAmount("1,234.56 C"), credit(1234.56));
  assert.deepEqual(parseCcAmount("-1,234.56"), credit(1234.56));
  assert.deepEqual(parseCcAmount("1,234.56-"), credit(1234.56));
  assert.deepEqual(parseCcAmount("+ ₹ 1,234.56"), credit(1234.56));
  assert.deepEqual(parseCcAmount("1,234.56 +"), credit(1234.56));

  assert.deepEqual(parseCcAmount("1,234.56"), debit(1234.56));
  assert.deepEqual(parseCcAmount("1,234.56 Dr"), debit(1234.56));
  assert.deepEqual(parseCcAmount("1,234.56 D"), debit(1234.56));
  assert.deepEqual(parseCcAmount("₹ 1,00,000.00"), debit(100000));
  assert.deepEqual(parseCcAmount("Rs.450.00"), debit(450));

  assert.equal(parseCcAmount("1234"), null, "no paise -> not an amount");
  assert.equal(parseCcAmount("AMAZON 450.00"), null, "text left over -> not a bare amount");
});

test("ccCommon: card numbers are masked to the last 4 digits", () => {
  assert.equal(maskCard("4375 XXXX XXXX 1234"), "XXXX XXXX XXXX 1234");
  assert.equal(maskCard("1234"), "XXXX XXXX XXXX 1234");
  assert.equal(maskCard(""), "");

  // 4111 1111 1111 1111 passes Luhn; a 23-digit ARN and an 11-digit serial must survive.
  assert.equal(
    maskCardNumbers("PAYMENT FROM 4111 1111 1111 1111 THANKS"),
    "PAYMENT FROM XXXX XXXX XXXX 1111 THANKS",
  );
  assert.equal(maskCardNumbers("PAYMENT 4111111111111111"), "PAYMENT XXXX XXXX XXXX 1111");
  assert.equal(
    maskCardNumbers("CARD 4375XXXXXXXX1234 AUTOPAY"),
    "CARD XXXX XXXX XXXX 1234 AUTOPAY",
  );
  assert.equal(maskCardNumbers("ARN 74332744062400012345678"), "ARN 74332744062400012345678");
  assert.equal(maskCardNumbers("REF 10234567891"), "REF 10234567891");
});
