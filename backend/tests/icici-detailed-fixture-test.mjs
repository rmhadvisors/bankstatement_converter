import assert from "node:assert/strict";
import { isIciciDetailedLayout, parseIciciDetailedTransactions } from "../src/parsers/parsers/iciciDetailedParser.js";

// These fixtures reproduce the visual line-wrap structure of the real ICICI
// "Detailed Statement" PDF, and every expected value below is copied verbatim
// from the real reference Excel for this statement
// (ICICI_OD_5385_01_04_2025_to_30_09_2025.xlsx) - not guessed.
//
// Column x-coordinates below are representative of the real table layout
// (narration column narrow and left of x=360; Withdrawal/Deposit/Balance
// columns fixed-width and right of it) - the parser identifies the amount
// columns by x-band, so getting the RELATIVE ordering of these columns right
// matters far more than matching the PDF's exact points.
const SL = 10;
const TRANID = 40;
const VALUEDATE = 90;
const TXNDATE = 140;
const POSTED = 190;
const TIME = 230;
const CHEQUE = 260;
const REMARKS = 290;
const WITHDRAWAL = 400;
const DEPOSIT = 460;
const BALANCE = 520;

function cell(x, text) {
  return { x, text };
}

function line(...cells) {
  return { text: cells.map((c) => c.text).join(" "), items: cells };
}

const header = [
  line(cell(SL, "ICICI"), cell(TRANID, "Bank")),
  line(cell(SL, "Detailed"), cell(TRANID, "Statement")),
  line(cell(SL, "IFSC"), cell(TRANID, "Code:"), cell(VALUEDATE, "ICIC0001394")),
  line(cell(SL, "Sl"), cell(TRANID, "Tran"), cell(VALUEDATE, "Value"), cell(TXNDATE, "Transaction"), cell(POSTED, "Transaction"), cell(CHEQUE, "Cheque no /"), cell(REMARKS, "Transaction"), cell(WITHDRAWAL, "Withdra"), cell(DEPOSIT, "Deposit"), cell(BALANCE, "Balance")),
  line(cell(SL, "No"), cell(TRANID, "Id"), cell(VALUEDATE, "Date"), cell(TXNDATE, "Date"), cell(POSTED, "Posted"), cell(CHEQUE, "Ref No"), cell(REMARKS, "Remarks"), cell(WITHDRAWAL, "wal (Dr)"), cell(DEPOSIT, "(Cr)")),
  line(cell(POSTED, "Date")),
];

// Row 1 (real Sl No 1): interest-collection debit, no Cheque/Ref No.
// Expected: "S69185699 139405005385:Int.C oll:03-03-2025 to 01-04-2025
// (02/04/2025 04:04:14 AM)", Debit 195332, Balance -25170940.43
const row1 = [
  line(cell(SL, "1"), cell(TRANID, "S6918")),
  line(cell(TRANID, "5699")),
  line(cell(VALUEDATE, "01/Apr/20")),
  line(cell(VALUEDATE, "25")),
  line(cell(TXNDATE, "02/Apr/2025"), cell(POSTED, "02/04/2025")),
  line(cell(TIME, "04:04:14"), cell(TIME, "AM")),
  line(cell(WITHDRAWAL, "1,95,332.")),
  line(cell(REMARKS, "139405005385:Int.C")),
  line(cell(WITHDRAWAL, "00")),
  line(cell(REMARKS, "oll:03-03-2025"), cell(REMARKS, "to")),
  line(cell(DEPOSIT, "-")),
  line(cell(REMARKS, "01-04-2025")),
  line(cell(BALANCE, "2,51,70,9")),
  line(cell(BALANCE, "40.43")),
];

// Row 2 (real Sl No 2): debit WITH a Cheque/Ref No (1096).
// Expected: "M339692 [Ref/Chq: 1096] CLG/ELEGANCE UNIFORMS/HDF
// (02/04/2025 05:34:28 AM)", Debit 14280, Balance -25185220.43
const row2 = [
  line(cell(SL, "2"), cell(TRANID, "M3396")),
  line(cell(TRANID, "92")),
  line(cell(VALUEDATE, "02/Apr/20")),
  line(cell(VALUEDATE, "25")),
  line(cell(TXNDATE, "02/Apr/2025"), cell(POSTED, "02/04/2025")),
  line(cell(TIME, "05:34:28"), cell(TIME, "AM"), cell(CHEQUE, "1096"), cell(REMARKS, "CLG/ELEGANCE")),
  line(cell(WITHDRAWAL, "14,280.00")),
  line(cell(REMARKS, "UNIFORMS/HDF")),
  line(cell(DEPOSIT, "-")),
  line(cell(BALANCE, "2,51,85,2")),
  line(cell(BALANCE, "20.43")),
];

// Row 3 (real Sl No 3): debit, narration wraps across several lines.
// Expected balance -25472595.43
const row3 = [
  line(cell(SL, "3"), cell(TRANID, "S7524")),
  line(cell(TRANID, "4716")),
  line(cell(VALUEDATE, "02/Apr/20")),
  line(cell(VALUEDATE, "25")),
  line(cell(TXNDATE, "02/Apr/2025"), cell(POSTED, "02/04/2025")),
  line(cell(TIME, "01:55:23"), cell(TIME, "PM"), cell(CHEQUE, "1120"), cell(REMARKS, "RTGS:ICICR5202504")),
  line(cell(WITHDRAWAL, "2,87,375.")),
  line(cell(REMARKS, "0200474594/IDBI")),
  line(cell(WITHDRAWAL, "00")),
  line(cell(REMARKS, "BANK/SHAKTI")),
  line(cell(DEPOSIT, "-")),
  line(cell(REMARKS, "ENTERPRISE")),
  line(cell(BALANCE, "2,54,72,5")),
  line(cell(BALANCE, "95.43")),
];

// Row 5 (real Sl No 5): pure CREDIT, no Cheque/Ref No, narration wraps
// heavily and itself contains hyphens/digits right up against the wrap
// boundary. Expected Credit 2650000, Balance -23020835.43
const row5 = [
  line(cell(SL, "5"), cell(TRANID, "S7673")),
  line(cell(TRANID, "1326")),
  line(cell(VALUEDATE, "02/Apr/20")),
  line(cell(VALUEDATE, "25")),
  line(cell(TXNDATE, "02/Apr/2025"), cell(POSTED, "02/04/2025")),
  line(cell(TIME, "03:56:22"), cell(TIME, "PM"), cell(REMARKS, "RTGS-")),
  line(cell(REMARKS, "HDFCR5202504025")),
  line(cell(REMARKS, "7053792-RAJESH")),
  line(cell(DEPOSIT, "26,50,000")),
  line(cell(REMARKS, "INDIA")),
  line(cell(DEPOSIT, ".00")),
  line(cell(REMARKS, "MANUFACTURING")),
  line(cell(WITHDRAWAL, "-")),
  line(cell(REMARKS, "PVT"), cell(REMARKS, "LTD-")),
  line(cell(REMARKS, "99990206198714-")),
  line(cell(REMARKS, "HDFC0000038")),
  line(cell(BALANCE, "2,30,20,8")),
  line(cell(BALANCE, "35.43")),
];

// Row 7 is deliberately given a made-up Sl No jump straight to 7 (row 6 is
// skipped, simulating a row the extractor failed to isolate) - the parser
// must self-heal instead of collapsing the remainder of the statement into
// one row. Not a real statement row; values are internally consistent only.
const row7 = [
  line(
    cell(SL, "7"),
    cell(TRANID, "M3600"),
    cell(TRANID, "786"),
    cell(TXNDATE, "02/Apr/2025"),
    cell(POSTED, "02/04/2025"),
    cell(TIME, "05:05:55"),
    cell(TIME, "PM"),
    cell(CHEQUE, "1119"),
    cell(REMARKS, "TRF/RAJESH"),
  ),
  line(cell(REMARKS, "ENTERPRISES"), cell(REMARKS, "/ICI")),
  line(cell(WITHDRAWAL, "5,34,600.00")),
  line(cell(DEPOSIT, "-")),
  line(cell(BALANCE, "2,35,86,7")),
  line(cell(BALANCE, "24.43")),
];

// A minimal filler transaction (Sl No 1) that establishes a known prior
// balance so the fixture document is internally consistent; withdrawal/
// deposit are now read directly from their x-band, so this no longer
// affects debit/credit resolution the way it used to - it just keeps each
// isolated regression document well-formed.
function fillerEstablishing(previousMagnitude) {
  return [
    line(cell(SL, "1"), cell(TRANID, "F0000001")),
    line(cell(TXNDATE, "01/Jan/2025"), cell(POSTED, "01/01/2025"), cell(TIME, "00:00:01"), cell(TIME, "AM")),
    line(cell(WITHDRAWAL, "1.00")),
    line(cell(DEPOSIT, "-")),
    line(cell(BALANCE, previousMagnitude)),
  ];
}

// Row 109 - a real regression case: narration ends in a bare digit reference
// code ("...SR269007047") immediately followed by the amount with NO
// dash/separator between them. Expected: "S67676402 Penal_Chrg_PDD_O
// BC_Mar25SR269007 047 (23/04/2025 05:13:13 PM)", Debit 21890.69,
// Balance -24288247.12
// (Given a fresh Sl No sequence of its own - each of the "row NNN" fixtures
// below is parsed in ITS OWN isolated document, since the real Sl Nos
// sampled from across the 1280-row statement aren't consecutive, and
// self-healing is intentionally bounded to a small jump window.)
const row109 = [
  ...fillerEstablishing("2,42,66,356.43"),
  line(cell(SL, "2"), cell(TRANID, "S6767")),
  line(cell(TRANID, "6402")),
  line(cell(VALUEDATE, "23/Apr/20")),
  line(cell(VALUEDATE, "25")),
  line(cell(TXNDATE, "23/Apr/2025"), cell(POSTED, "23/04/2025")),
  line(cell(TIME, "05:13:13"), cell(TIME, "PM"), cell(REMARKS, "Penal_Chrg_PDD_O")),
  line(cell(REMARKS, "BC_Mar25SR269007")),
  line(cell(REMARKS, "047")),
  line(cell(WITHDRAWAL, "21,890.69")),
  line(cell(DEPOSIT, "-")),
  line(cell(BALANCE, "2,42,88,2")),
  line(cell(BALANCE, "47.12")),
];

// Row 209 - another real regression case: a lone stray digit ("5", the tail
// of a UPI reference code) sits immediately before a small amount in the
// narration column - it must never be confused with the amount columns since
// those are now identified purely by x-band. Expected: "S93352981
// EZY/UPICCMDR_~24 7475097932~17052 5 (17/05/2025 01:50:41 PM)", Debit 1121
// (NOT credit), Balance -26258727.12
const row209 = [
  ...fillerEstablishing("2,62,57,606.12"),
  line(cell(SL, "2"), cell(TRANID, "S9335")),
  line(cell(TRANID, "2981")),
  line(cell(VALUEDATE, "17/May/20")),
  line(cell(VALUEDATE, "25")),
  line(cell(TXNDATE, "17/May/2025"), cell(POSTED, "17/05/2025")),
  line(cell(TIME, "01:50:41"), cell(TIME, "PM"), cell(REMARKS, "EZY/UPICCMDR_~24")),
  line(cell(REMARKS, "7475097932~17052")),
  line(cell(REMARKS, "5")),
  line(cell(WITHDRAWAL, "1,121.00")),
  line(cell(DEPOSIT, "-")),
  line(cell(BALANCE, "2,62,58,7")),
  line(cell(BALANCE, "27.12")),
];

// Row 906 - GRS/tax row with a two-decimal (non-".00") credit amount and
// narration containing long runs of bare digits right next to the amount.
// Expected Credit 201138.14, Balance -12644072.84
const row906 = [
  ...fillerEstablishing("1,28,45,210.98"),
  line(cell(SL, "2"), cell(TRANID, "S3505")),
  line(cell(TRANID, "0845")),
  line(cell(VALUEDATE, "14/Aug/20")),
  line(cell(VALUEDATE, "25")),
  line(cell(TXNDATE, "14/Aug/2025"), cell(POSTED, "14/08/2025")),
  line(cell(TIME, "02:36:35"), cell(TIME, "PM"), cell(REMARKS, "GRS/0022GRSH250")),
  line(cell(REMARKS, "21358")),
  line(cell(REMARKS, "2025080500560732")),
  line(cell(REMARKS, "NEW"), cell(REMARKS, "FASHION")),
  line(cell(DEPOSIT, "2,01,138.")),
  line(cell(REMARKS, "PERU"), cell(REMARKS, "S"), cell(REMARKS, "A"), cell(REMARKS, "ID")),
  line(cell(REMARKS, "2025~0022GRSH25")),
  line(cell(DEPOSIT, "14")),
  line(cell(REMARKS, "021358")),
  line(cell(REMARKS, "2025080500560")),
  line(cell(WITHDRAWAL, "-")),
  line(cell(BALANCE, "1,26,44,0")),
  line(cell(BALANCE, "72.84")),
];

// End-of-statement footer/legends block: must not create a phantom
// transaction, and must not be silently absorbed into the last row's
// narration.
const footer = [
  line(cell(SL, "Page Total")),
  line(cell(SL, "Opening Bal:"), cell(TRANID, "-2,49,75,608.43")),
  line(cell(SL, "Withdrawls:"), cell(TRANID, "16,49,67,512.83")),
  line(cell(SL, "Deposits:"), cell(TRANID, "16,89,50,488.14")),
  line(cell(SL, "Closing Bal:"), cell(TRANID, "-2,09,92,633.12")),
  line(cell(SL, "Legends Used in Account Statement")),
  line(cell(SL, "1. BBPS - Bharat Bill Payment Service")),
  line(cell(SL, "----------End Of Statement----------")),
];

const mainLines = [...header, ...row1, ...row2, ...row3, ...row5, ...row7, ...footer];

assert.equal(isIciciDetailedLayout(mainLines), true, "layout should be detected");

const { transactions } = parseIciciDetailedTransactions(mainLines);
console.log(JSON.stringify(transactions, null, 2));

assert.equal(transactions.length, 5, `expected 5 transactions, got ${transactions.length}`);
const [t1, t2, t3, t5, t7] = transactions;

const [, t109] = parseIciciDetailedTransactions([...header, ...row109, ...footer]).transactions;
const [, t209] = parseIciciDetailedTransactions([...header, ...row209, ...footer]).transactions;
const [, t906] = parseIciciDetailedTransactions([...header, ...row906, ...footer]).transactions;

assert.equal(t1.particulars, "S69185699 139405005385:Int.C oll:03-03-2025 to 01-04-2025 (02/04/2025 04:04:14 AM)");
assert.equal(t1.withdrawal, 195332);
assert.equal(t1.deposit, null);
assert.equal(t1.balance, -25170940.43);

assert.equal(t2.particulars, "M339692 [Ref/Chq: 1096] CLG/ELEGANCE UNIFORMS/HDF (02/04/2025 05:34:28 AM)");
assert.equal(t2.withdrawal, 14280);
assert.equal(t2.balance, -25185220.43);

assert.equal(t3.withdrawal, 287375);
assert.equal(t3.balance, -25472595.43);
assert.equal(t3.particulars, "S75244716 [Ref/Chq: 1120] RTGS:ICICR5202504 0200474594/IDBI BANK/SHAKTI ENTERPRISE (02/04/2025 01:55:23 PM)");

assert.equal(t5.deposit, 2650000);
assert.equal(t5.withdrawal, null);
assert.equal(t5.balance, -23020835.43);
assert.equal(
  t5.particulars,
  "S76731326 RTGS- HDFCR5202504025 7053792-RAJESH INDIA MANUFACTURING PVT LTD- 99990206198714- HDFC0000038 (02/04/2025 03:56:22 PM)",
);

// The critical self-heal check: row 6 was skipped entirely, yet row 7 is
// still isolated correctly instead of merging into a runaway blob.
assert.equal(t7.withdrawal, 534600);

// Regression: trailing bare digit code "047" must stay in the narration,
// not get merged into the debit amount - matches the real Sl No 109 row.
assert.equal(t109.particulars, "S67676402 Penal_Chrg_PDD_O BC_Mar25SR269007 047 (23/04/2025 05:13:13 PM)");
assert.equal(t109.withdrawal, 21890.69);
assert.equal(t109.deposit, null);
assert.equal(t109.balance, -24288247.12);

// Regression: a lone stray digit that would *coincidentally* still look like
// a valid amount once merged must stay in the narration; the real amount is
// 1,121.00 (a DEBIT here), not 51,121.00.
assert.equal(t209.particulars, "S93352981 EZY/UPICCMDR_~24 7475097932~17052 5 (17/05/2025 01:50:41 PM)");
assert.equal(t209.withdrawal, 1121);
assert.equal(t209.deposit, null);
assert.equal(t209.balance, -26258727.12);

// Regression: two-decimal (non-".00") amount reconstruction, matching the
// real Sl No 906 GRS/tax row exactly.
assert.equal(t906.deposit, 201138.14);
assert.equal(t906.withdrawal, null);
assert.equal(t906.balance, -12644072.84);

console.log("ALL ICICI DETAILED PARSER FIXTURE ASSERTIONS PASSED (verified against real reference Excel values)");
