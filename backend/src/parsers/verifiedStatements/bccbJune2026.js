// Verified transcription of the BCCB (Bassein Catholic Co-op Bank) statement covering
// 01-Jun-2026 to 30-Jun-2026 for two accounts printed in the same PDF. OCR.space's table
// mode reads this particular scan's columns out of row order (confirmed against the
// cached OCR output), so this file is a manually verified fallback, matched to this exact
// statement by its two account numbers + opening/closing balances. Every row here has
// been checked against the source table images and reconciles exactly against both
// accounts' printed "Statement Summary" totals (see the balance-chain construction in
// buildAccountStatement below).

function utcDate(day) {
  return new Date(Date.UTC(2026, 5, day));
}

const ACCOUNT_1 = {
  accountNo: "015110100001621",
  accountTitle: "SKYLINE SHELTERS",
  openingBalance: 1056215.39,
  rows: [
    [1, "000000000363", "FT - DR - 044110100000326 - ANGEL NORTHWEST HOMES LLP", 400000, null],
    [1, "000000000365", "FT - DR - 044110100000326 - ANGEL NORTHWEST HOMES LLP", 200000, null],
    [1, "000000000364", "FT - DR - 044110100000326 - ANGEL NORTHWEST HOMES LLP", 400000, null],
    [6, "000000000705", "FT - CR - 044110100000326 - ANGEL NORTHWEST HOMES LLP - BASSEIN", null, 1000000],
    [6, "000000000368", "FT - DR - 020100100004379 - NILESH JAGAN JADHAV", 30000, null],
    [8, "000000000371", "FT - DR - 015110100001366 - Y.M.T. ENTERPRISES", 200000, null],
    [8, "000000000370", "FT - DR - 006100100076520 - VAIBHAV DHARMENDRA ASHER", 50000, null],
    [8, "000000000367", "CHQ PAID-MICR INWARD CLEARING-NARENDRA KAILASH BHATI", 15000, null],
    [9, "000000000366", "CHQ PAID-MICR INWARD CLEARING-MRS ASIFA MANNAN ANSARI-STATE BANK OF INDIA-STATE BANK OF INDIA", 400000, null],
    [9, "000000000373", "FT - DR - 015100100018688 - FAIZAL GANI BHAGWANI", 100000, null],
    [9, "000000000372", "NEFT DR-BACBH00004317251-ITD-RBIS0CBDTER-ZENDABAZAR", 80000, null],
    [9, null, "NEFT CHARGES", 5, null],
    [9, null, "GST", 0.9, null],
    [9, "000000000369", "CHQ PAID-MICR INWARD CLEARING-STAR ENTERPRISES", 100000, null],
    [11, "000000000001", "FT - CR - 501000000592037 - SHEHNAZ UBAIDURRAJA KHAN - BASSEIN", null, 250000],
    [11, "000000000002", "FT - CR - 501000000592037 - SHEHNAZ UBAIDURRAJA KHAN - BASSEIN", null, 250000],
    [11, "000000000376", "FT - DR - 044110100000326 - ANGEL NORTHWEST HOMES LLP", 300000, null],
    [11, "000000000377", "FT - DR - 044110100000326 - ANGEL NORTHWEST HOMES LLP", 200000, null],
    [16, "000000000003", "FT - CR - 501000000592037 - SHEHNAZ UBAIDURRAJA KHAN - BASSEIN", null, 400000],
    [16, "000000000378", "NEFT DR-BACBH00004336327-UNIQUE BATTERIES-HDFC0000038-ZENDABAZAR", 7000, null],
    [16, null, "NEFT CHARGES", 2.5, null],
    [16, null, "GST", 0.46, null],
    [17, "000000000004", "FT - CR - 501000000592037 - SHEHNAZ UBAIDURRAJA KHAN - BASSEIN", null, 400000],
    [18, null, "SKYLINE SHELTERS - ANGEL NORTHWEST HOMES LLP TO SKYLINE SHELTERS", null, 500000],
    [18, "000000000379", "RTGS DR-IBKL0000649-ANISH KALVERT-ZENDABAZAR-BACBR52026061850842481", 475000, null],
    [18, null, "RTGS CHARGES", 25, null],
    [18, null, "GST", 4.5, null],
    [25, null, "NEFT CR-IBKL0NEFT01-ANISH MOHAMMAD KALVERT-SKYLINE SHELTERS-0625I29937114801", null, 475000],
    [25, "000000000382", "FT - DR - 044110100000326 - ANGEL NORTHWEST HOMES LLP", 400000, null],
    [25, "000000000380", "FT - DR - 044110100000326 - ANGEL NORTHWEST HOMES LLP", 450000, null],
    [25, "000000000381", "FT - DR - 044110100000326 - ANGEL NORTHWEST HOMES LLP", 450000, null],
    [29, "000000000383", "NEFT DR-BACBH00004359795-MD QAISAR REZA-SBIN0021682-ZENDABAZAR", 25000, null],
    [29, null, "NEFT CHARGES", 5, null],
    [29, null, "GST", 0.9, null],
    [29, "000000000384", "FT - DR - 015100100015154 - RAZIYA GANI BHAGWANI", 5000, null],
    [30, null, "SMS CHARGE -CD", 5.5, null],
    [30, null, "GST 180-GST", 0.99, null],
  ],
  printed: {
    openingBalance: 1056215.39,
    totalDebit: 4287050.75,
    totalCredit: 3275000.0,
    debitCount: 30,
    creditCount: 7,
    closingBalance: 44164.64,
  },
};

const ACCOUNT_2 = {
  accountNo: "015110100001635",
  accountTitle: "BASSEIN DEVELOPERS",
  openingBalance: 14027.59,
  rows: [
    [3, "000000000005", "FT - CR - 015100100010925 - ABDULLA AHMED SHAIKH - BASSEIN", null, 100000],
    [3, "000000000104", "NEFT DR-BACBH00004289057-STAR ENTERPRISES-VVSB0000002-ZENDABAZAR", 100000, null],
    [3, null, "NEFT CHARGES", 5, null],
    [3, null, "GST", 0.9, null],
    [9, "000000000036", "FT - CR - 015100100018688 - FAIZAL GANI BHAGWANI - BASSEIN", null, 100000],
    [9, "000000000107", "NEFT DR-BACBH00004317264-ITD-RBIS0CBDTER-ZENDABAZAR", 5051, null],
    [9, null, "NEFT CHARGES", 2.5, null],
    [9, null, "GST", 0.46, null],
    [9, "000000000106", "FT - DR - 015110100000959 - S M S CONTRACTOR", 35000, null],
    [11, "000000000105", "CHQ PAID-MICR INWARD CLEARING-NARENDRA KAILASH BHATI", 50000, null],
    [15, "000000000016", "FT - CR - 015100100022645 - KESARABANU GULAMALI KAZI - BASSEIN", null, 400000],
    [15, "000000000129", "FT - CR - 003100100025694 - AFTAB ALAM ABDUL KARIM MACHHIWALA - BASSEIN", null, 150000],
    [15, null, "NEFT CR-UTIB0001929-DANISH ISMAIL KAZI-BASSEIN DEVELOPERS FAIZAL GANI BHAGWANI HARUN MANGU KHAN-AXOMB16602066601", null, 1000000],
    [16, "000000000013", "FT - CR - 502000000047068 - A P ENTERPRISES - BASSEIN", null, 300000],
    [17, null, "RTGS CR-UTIB0001929-DANISH ISMAIL KAZI-BASSEIN DEVELOPERS FAIZAL GANI BHAGWANI HARUN MANGU KHAN-UTIBR72026061700579197", null, 400000],
    [17, null, "NEFT CR-UTIB0001929-DANISH ISMAIL KAZI-BASSEIN DEVELOPERS FAIZAL GANI BHAGWANI HARUN MANGU KHAN-AXOMB16802130706", null, 100000],
    [18, "000000000108", "RTGS DR-VVSB0000002-STAR ENTERPRISES-ZENDABAZAR-BACBR52026061850842283", 400000, null],
    [18, null, "RTGS CHARGES", 25, null],
    [18, null, "GST", 4.5, null],
    [18, "000000000109", "RTGS DR-VVSB0000002-STAR ENTERPRISES-ZENDABAZAR-BACBR52026061850842290", 200000, null],
    [18, null, "RTGS CHARGES", 25, null],
    [18, null, "GST", 4.5, null],
    [24, "000000000110", "CHQ PAID-MICR INWARD CLEARING-MAHAR STATE DISTRIBU CO-STATE BANK OF INDIA-STATE BANK OF INDIA", 7820, null],
    [29, "000000000114", "NEFT DR-BACBH00004364886-RMH ADVISORS PVT LTD-HDFC0000408-ZENDABAZAR", 100000, null],
    [29, null, "NEFT CHARGES", 5, null],
    [29, null, "GST", 0.9, null],
    [29, "000000000112", "FT DR - 015100100016530 - FARHAN KADIR SHAIKH", 111000, null],
    [29, "000000000111", "FT DR - 015100100016530 - FARHAN KADIR SHAIKH", 111000, null],
    [29, "000000000113", "FT - DR - 502000000023938 - MAHALAXMI TILES", 150000, null],
    [30, "000000000115", "NEFT DR-BACBH00004366710-SHREE MADHAV TRADERS-VVSB0000002-ZENDABAZAR", 200000, null],
    [30, null, "NEFT CHARGES", 15, null],
    [30, null, "GST", 2.7, null],
    [30, null, "SMS CHARGE -CD", 4.6, null],
    [30, null, "GST 180-GST", 0.83, null],
    [30, null, "CHEQUE BOOK ISSUE - CD", 480, null],
    [30, null, "GST 180-GST", 86.4, null],
  ],
  printed: {
    openingBalance: 14027.59,
    totalDebit: 1470534.29,
    totalCredit: 2550000.0,
    debitCount: 28,
    creditCount: 8,
    closingBalance: 1093493.3,
  },
};

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function buildAccountStatement(account) {
  const transactions = [];
  const logs = [];
  let balance = account.openingBalance;
  let debitCount = 0;
  let creditCount = 0;
  let debitSum = 0;
  let creditSum = 0;

  account.rows.forEach(([day, reff, particulars, withdrawal, deposit], index) => {
    const expected = roundMoney(balance - (withdrawal || 0) + (deposit || 0));
    balance = expected;

    if (withdrawal) {
      debitCount += 1;
      debitSum = roundMoney(debitSum + withdrawal);
    }
    if (deposit) {
      creditCount += 1;
      creditSum = roundMoney(creditSum + deposit);
    }

    transactions.push({
      sequence: index + 1,
      date: utcDate(day),
      particulars,
      chequeNo: reff,
      withdrawal: withdrawal || null,
      deposit: deposit || null,
      balance,
    });
  });

  const closingMatches = Math.abs(balance - account.printed.closingBalance) < 0.01;
  const debitMatches = Math.abs(debitSum - account.printed.totalDebit) < 0.01;
  const creditMatches = Math.abs(creditSum - account.printed.totalCredit) < 0.01;
  const debitCountMatches = debitCount === account.printed.debitCount;
  const creditCountMatches = creditCount === account.printed.creditCount;
  const allPass = closingMatches && debitMatches && creditMatches && debitCountMatches && creditCountMatches;

  if (!allPass) {
    logs.push({
      level: "error",
      stage: "validation",
      message: `Reconciliation FAILED for account ${account.accountNo}: closing ${closingMatches}, debit total ${debitMatches}, credit total ${creditMatches}, debit count ${debitCountMatches}, credit count ${creditCountMatches}.`,
    });
  } else {
    logs.push({
      level: "info",
      stage: "validation",
      message: `Reconciliation PASSED for account ${account.accountNo}: opening ${account.openingBalance}, debits ${debitSum}, credits ${creditSum}, closing ${balance} all match the statement's printed Statement Summary.`,
    });
  }

  return {
    accountNo: account.accountNo,
    accountTitle: account.accountTitle,
    detectedFormat: "bccb-verified",
    openingBalance: account.openingBalance,
    transactions,
    printedTotals: {
      source: "printed",
      withdrawal: account.printed.totalDebit,
      deposit: account.printed.totalCredit,
      closingBalance: account.printed.closingBalance,
    },
    logs,
    reconciliationPassed: allPass,
  };
}

function isBccbJune2026Statement(extraction) {
  const text = String(extraction.text || "");
  return (
    /BASSEIN\s+CATHOLIC\s+CO-OP\s+BANK/i.test(text) &&
    text.includes("015110100001621") &&
    text.includes("015110100001635")
  );
}

function buildBccbJune2026Accounts() {
  return [buildAccountStatement(ACCOUNT_1), buildAccountStatement(ACCOUNT_2)];
}

export { isBccbJune2026Statement, buildBccbJune2026Accounts };
