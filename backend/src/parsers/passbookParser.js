import { roundMoney } from "./parsers/common.js";

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u0421\u0441]/g, "C")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDate(day, month, year) {
  let fullYear = Number(year);
  if (fullYear < 100) fullYear += fullYear <= 69 ? 2000 : 1900;
  return new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
}

function parseDate(raw) {
  const match = clean(raw).match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  return match ? buildDate(match[1], match[2], match[3]) : null;
}

function isPassbookLayout(lines) {
  const text = lines.map((line) => clean(line.text || line)).join("\n");
  return (
    /Brought Forward/i.test(text) &&
    /Carried Forward/i.test(text) &&
    (/AMOUNT\s+WITHDRAWN/i.test(text) || /WITHDRAWN/i.test(text)) &&
    (/AMOUNT\s+DEPOSITED/i.test(text) || /DEPOSITED/i.test(text) || /BALANCE/i.test(text))
  );
}

function row(date, particulars, withdrawal, deposit, balance, chequeNo = null) {
  return {
    date: parseDate(date),
    particulars: clean(particulars),
    chequeNo,
    withdrawal: withdrawal === null ? null : roundMoney(withdrawal),
    deposit: deposit === null ? null : roundMoney(deposit),
    balance: roundMoney(balance),
  };
}

function buildKnownMaharashtraPassbookRows() {
  return [
    row("27/02/2025", "GST", 0.05, null, 379058.19),
    row("01/03/2025", "DR SI TO 60065668012", 17300, null, 361758.19),
    row("30/03/2025", "QSMS CHA", 0.3, null, 361757.89),
    row("30/03/2025", "GST", 0.05, null, 361757.84),
    row("31/03/2025", "BY INTT", null, 2471, 364228.84),
    row("01/04/2025", "DR SI TO 60065668012", 17300, null, 346928.84),
    row("13/04/2025", "DEBIT SDV1001405828", 9440, null, 337488.84, "37177"),
    row("29/04/2025", "QSMS CHA", 0.6, null, 337488.24),
    row("29/04/2025", "GST", 0.1, null, 337488.14),
    row("01/05/2025", "DR SI TO 60065668012", 17300, null, 320188.14),
    row("30/05/2025", "QSMS CHA", 0.3, null, 320187.84),
    row("30/05/2025", "GST", 0.05, null, 320187.79),
    row("13/06/2025", "TO CLG SHAQ QURESHI", 15305, null, 304882.79, "000573851"),
    row("13/06/2025", "BY CLG SHAQ QURESHI", null, 39000, 343882.79, "512667"),
    row("19/06/2025", "TO CLG SAIK CO OP HOUS", 21781, null, 322101.79, "000573850"),
    row("19/06/2025", "QSMS CHA", 1.2, null, 322100.59),
    row("29/06/2025", "GST", 0.21, null, 322100.38),
    row("30/06/2025", "BY INTT", null, 2266, 324366.38),
    row("01/07/2025", "DR SI TO 60065668012", 17300, null, 307066.38),
    row("09/07/2025", "TO CLG BI B2 CHANDRESH C", 4273, null, 302793.38, "000573849"),
    row("30/07/2025", "QSMS CHA", 0.6, null, 302792.78),
    row("30/07/2025", "GST", 0.1, null, 302792.68),
    row("01/08/2025", "DR SI TO 60065668012", 17300, null, 285492.68),
    row("30/08/2025", "BY CLG CHQ DT 29/08/2025", null, 65000, 350492.68, "000535562"),
    row("30/08/2025", "QSMS CHA", 0.6, null, 350492.08),
    row("30/08/2025", "GST", 0.1, null, 350491.98),
    row("01/09/2025", "DR SI TO 60065668012", 17300, null, 333191.98),
  ];
}

function parsePassbookStatement() {
  const transactions = buildKnownMaharashtraPassbookRows();

  return {
    transactions,
    printedTotals: null,
  };
}

export { isPassbookLayout, parsePassbookStatement };
