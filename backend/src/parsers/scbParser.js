import { clean, roundMoney } from "./parsers/common.js";

function parseAmount(raw) {
  if (!raw) return null;
  const value = Number(clean(raw).replace(/[₹,]/g, "").replace(/Cr|Dr/gi, ""));
  if (!Number.isFinite(value)) return null;
  return /Dr$/i.test(clean(raw)) ? -Math.abs(value) : value;
}

const monthNames = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function isStandardCharteredLayout(lines) {
  const text = lines
    .slice(0, 80)
    .map((line) => clean(line.text || line))
    .join("\n");

  return (
    /ACCOUNT STATEMENT/i.test(text) &&
    /SCBL\d+/i.test(text) &&
    /Date\s+Value\s+Description\s+Cheque\s+Deposit\s+Withdrawal\s+Balance/i.test(text)
  );
}

function parsePeriod(lines) {
  const text = lines
    .slice(0, 100)
    .map((line) => clean(line.text || line))
    .join("\n");
  const match = text.match(/STATEMENT DATE\s*:\s*(\d{2})\s+([A-Za-z]{3})\s+(\d{4})\s+To\s+\d{2}\s+([A-Za-z]{3})\s+(\d{4})/i);

  if (!match) {
    return { startMonth: 3, startYear: 2025, endYear: 2026 };
  }

  return {
    startMonth: monthNames[match[2].toLowerCase()],
    startYear: Number(match[3]),
    endYear: Number(match[5]),
  };
}

function parseScbDate(raw, period) {
  const match = clean(raw).match(/^([A-Za-z]{3})\s+(\d{2})$/);
  if (!match) return null;

  const month = monthNames[match[1].toLowerCase()];
  if (month === undefined) return null;

  const year = month >= period.startMonth ? period.startYear : period.endYear;
  return new Date(Date.UTC(year, month, Number(match[2])));
}

function amountItems(items = []) {
  return items
    .map((item) => ({ x: item.x, text: clean(item.text), value: parseAmount(item.text) }))
    .filter((item) => item.value !== null && /^-?\d{1,3}(?:,\d{2,3})*\.\d{2}$/.test(item.text));
}

function detectColumns(lines) {
  for (const entry of lines.slice(0, 100)) {
    const text = clean(entry.text || entry);
    if (!/Date\s+Value\s+Description\s+Cheque\s+Deposit\s+Withdrawal\s+Balance/i.test(text)) {
      continue;
    }

    const findX = (pattern) => {
      const item = (entry.items || []).find((candidate) => pattern.test(clean(candidate.text)));
      return item ? item.x : null;
    };

    return {
      deposit: findX(/^Deposit$/i) || 395,
      withdrawal: findX(/^Withdrawal$/i) || 460,
      balance: findX(/^Balance$/i) || 525,
    };
  }

  return { deposit: 395, withdrawal: 460, balance: 525 };
}

function parseOpeningBalance(lines) {
  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!/^Balance Brought Forward\b/i.test(text)) continue;
    const amounts = amountItems(entry.items || []);
    if (amounts.length > 0) return amounts[amounts.length - 1].value;
    const match = text.match(/(\d{1,3}(?:,\d{2,3})*\.\d{2})$/);
    if (match) return parseAmount(match[1]);
  }

  return null;
}

function findDateItems(items) {
  return items.filter((item) => /^[A-Za-z]{3}\s+\d{2}$/.test(clean(item.text)) && item.x < 110);
}

function isRowStart(entry) {
  return findDateItems(entry.items || []).length > 0 && amountItems(entry.items || []).length >= 2;
}

function nearestTransactionColumn(x, columns) {
  const midpoint = (columns.deposit + columns.withdrawal) / 2;
  return x <= midpoint ? "deposit" : "withdrawal";
}

function parseRow(entry, period, columns, previousBalance) {
  const items = entry.items || [];
  const dates = findDateItems(items).sort((a, b) => a.x - b.x);
  const transactionDate = dates[0] || dates[dates.length - 1];
  const date = transactionDate ? parseScbDate(transactionDate.text, period) : null;
  if (!date) return null;

  const amounts = amountItems(items).sort((a, b) => a.x - b.x);
  const balanceItem = [...amounts].sort(
    (left, right) => Math.abs(left.x - columns.balance) - Math.abs(right.x - columns.balance),
  )[0];
  const transactionItem = amounts.find((item) => item !== balanceItem);
  if (!balanceItem || !transactionItem) return null;

  const narrationStart = Math.max(...dates.map((item) => item.x)) + 20;
  const narrationEnd = transactionItem.x - 8;
  const particulars = clean(
    items
      .filter((item) => {
        const text = clean(item.text);
        if (/^[A-Za-z]{3}\s+\d{2}$/.test(text)) return false;
        if (/^-?\d{1,3}(?:,\d{2,3})*\.\d{2}$/.test(text)) return false;
        return item.x >= narrationStart && item.x <= narrationEnd;
      })
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(" "),
  );

  const balance = roundMoney(balanceItem.value);
  const amount = Math.abs(transactionItem.value);
  const delta = previousBalance === null ? null : roundMoney(balance - previousBalance);
  let withdrawal = null;
  let deposit = null;

  if (delta !== null && Math.abs(Math.abs(delta) - amount) <= 0.05) {
    if (delta > 0) deposit = amount;
    if (delta < 0) withdrawal = amount;
  } else if (nearestTransactionColumn(transactionItem.x, columns) === "deposit") {
    deposit = amount;
  } else {
    withdrawal = amount;
  }

  return {
    date,
    particulars: particulars || "TRANSACTION",
    chequeNo: null,
    withdrawal,
    deposit,
    balance,
  };
}

function isNoiseLine(text) {
  return (
    !text ||
    /^ACCOUNT STATEMENT$/i.test(text) ||
    /^Date\s+Value\s+Description/i.test(text) ||
    /^Date$/i.test(text) ||
    /^Balance Brought Forward/i.test(text) ||
    /^Page\s+\d+\s+of\s+\d+/i.test(text) ||
    /^Date\s*:/i.test(text) ||
    /^Total\b/i.test(text) ||
    /^(Bank deposits|Please register|Report irregularities)/i.test(text) ||
    /^(MRS|BRANCH|STATEMENT DATE|CURRENCY|ACCOUNT TYPE|ACCOUNT NO|NOMINEE|BRANCH ADDRESS|IFSC|Phone No\.)/i.test(
      text,
    )
  );
}

function parseStandardCharteredTransactions(lines) {
  const period = parsePeriod(lines);
  const columns = detectColumns(lines);
  const transactions = [];
  let previousBalance = parseOpeningBalance(lines);
  let current = null;

  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!text) continue;

    if (/^Balance Brought Forward\b/i.test(text)) {
      const broughtForward = amountItems(entry.items || []).at(-1)?.value;
      if (transactions.length === 0 && broughtForward !== undefined) {
        previousBalance = broughtForward;
      }
      continue;
    }

    if (isRowStart(entry)) {
      const row = parseRow(entry, period, columns, previousBalance);
      if (!row) continue;
      transactions.push(row);
      previousBalance = row.balance;
      current = row;
      continue;
    }

    if (!current || isNoiseLine(text)) continue;
    current.particulars = clean(`${current.particulars} ${text}`);
  }

  return transactions;
}

export { isStandardCharteredLayout, parseStandardCharteredTransactions };
