import { clean, parseAmount, parseDate, roundMoney } from "./common.js";
import { correctDebitCreditByBalance } from "../validation.js";

function isJanaLayout(lines) {
  const text = lines
    .slice(0, 120)
    .map((line) => clean(line.text || line))
    .join("\n");

  return (
    /Jana Small Finance Bank Ltd\./i.test(text) &&
    /Txn Date/i.test(text) &&
    /Narration/i.test(text) &&
    /Reference/i.test(text) &&
    /Deposits/i.test(text) &&
    /Withdrawal/i.test(text) &&
    /Balance/i.test(text)
  );
}

function isDateText(value) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(clean(value));
}

function isMoneyText(value) {
  return /^(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}$/.test(clean(value));
}

function clusterPageRows(page) {
  const cells = [];

  for (const line of page.lines || []) {
    for (const item of line.items || []) {
      const text = clean(item.text);
      if (!text) continue;

      cells.push({
        row: item.x,
        column: line.y,
        text,
      });
    }
  }

  const rows = [];
  for (const cell of cells) {
    let row = rows.find((candidate) => Math.abs(candidate.row - cell.row) <= 4);

    if (!row) {
      row = { row: cell.row, cells: [] };
      rows.push(row);
    }

    row.cells.push(cell);
    row.row = (row.row * (row.cells.length - 1) + cell.row) / row.cells.length;
  }

  return rows.sort((left, right) => left.row - right.row);
}

function nearestAmount(cells, minColumn, maxColumn, targetColumn) {
  const item = cells
    .filter((cell) => cell.column >= minColumn && cell.column < maxColumn && isMoneyText(cell.text))
    .sort(
      (left, right) =>
        Math.abs(left.column - targetColumn) - Math.abs(right.column - targetColumn),
    )[0];

  const value = parseAmount(item?.text);
  return value === null ? null : Math.abs(value);
}

function parseDateRow(dateRow, rows) {
  const rowIndex = rows.indexOf(dateRow);
  const dateCell = dateRow.cells.find((cell) => cell.column < 90 && isDateText(cell.text));
  const date = parseDate(dateCell?.text);
  if (!date) return null;

  const nearbyRows = rows.filter(
    (row, index) => index === rowIndex || Math.abs(row.row - dateRow.row) <= 13,
  );
  const cells = nearbyRows
    .flatMap((row) => row.cells)
    .sort((left, right) => left.row - right.row || left.column - right.column);

  const particulars = clean(
    cells
      .filter((cell) => cell.column >= 105 && cell.column < 316 && !isDateText(cell.text))
      .map((cell) => cell.text)
      .join(" "),
  );
  const chequeNo = clean(
    cells
      .filter((cell) => cell.column >= 316 && cell.column < 410)
      .sort((left, right) => left.column - right.column)
      .map((cell) => cell.text)
      .join(" "),
  );
  const deposit = nearestAmount(cells, 430, 520, 465);
  const withdrawal = nearestAmount(cells, 530, 620, 565);
  const balance = nearestAmount(cells, 640, 740, 675);

  if (balance === null) return null;

  return {
    date,
    particulars: particulars || "TRANSACTION",
    chequeNo: chequeNo || null,
    withdrawal: withdrawal && withdrawal !== 0 ? roundMoney(withdrawal) : null,
    deposit: deposit && deposit !== 0 ? roundMoney(deposit) : null,
    balance: roundMoney(balance),
  };
}

function parseJanaTransactions(lines) {
  const pages = new Map();

  for (const line of lines) {
    const pageNumber = line.pageNumber || 1;
    if (!pages.has(pageNumber)) pages.set(pageNumber, { pageNumber, lines: [] });
    pages.get(pageNumber).lines.push(line);
  }

  const transactions = [];

  for (const page of pages.values()) {
    const rows = clusterPageRows(page);
    const dateRows = rows.filter((row) =>
      row.cells.some((cell) => cell.column < 90 && isDateText(cell.text)),
    );

    for (const row of dateRows) {
      const transaction = parseDateRow(row, rows);
      if (transaction) transactions.push(transaction);
    }
  }

  return correctDebitCreditByBalance(transactions);
}

export { isJanaLayout, parseJanaTransactions };
