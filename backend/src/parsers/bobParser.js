import { roundMoney } from "./parsers/common.js";

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(raw) {
  if (!raw) return null;

  const text = clean(raw);
  const value = Number(text.replace(/,/g, "").replace(/Cr|Dr/gi, ""));
  if (!Number.isFinite(value)) return null;

  return /^-/.test(text) || /Dr$/i.test(text) ? -Math.abs(value) : value;
}

const AMOUNT_PATTERN = /^-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}(?:\s*(?:Cr|Dr))?$/i;

function isAmountText(text) {
  return AMOUNT_PATTERN.test(clean(text));
}

function parseDate(raw) {
  const text = clean(raw).replace(/^'/, "");
  const match = text.match(/^(\d{2})[./-](\d{2})[./-](\d{2}|\d{4})$/);
  if (!match) return null;

  let year = Number(match[3]);
  if (year < 100) year += year <= 69 ? 2000 : 1900;

  return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
}

function isBankOfBarodaLayout(lines) {
  const text = lines
    .slice(0, 40)
    .map((line) => clean(line.text || line))
    .join("\n");

  return (
    /TRAN DATE\s+VALUE DATE\s+NARRATION/i.test(text) &&
    /WITHDRAWAL\(DR\)\s+DEPOSIT\(CR\)\s+BALANCE/i.test(text)
  );
}

function detectBobAmountColumns(lines) {
  for (const entry of lines.slice(0, 40)) {
    const text = clean(entry.text || entry);
    if (!/TRAN DATE\s+VALUE DATE\s+NARRATION/i.test(text)) continue;

    const items = entry.items || [];
    const findX = (pattern) => {
      const item = items.find((candidate) => pattern.test(clean(candidate.text)));
      return item ? item.x : null;
    };

    return {
      withdrawal: findX(/^WITHDRAWAL\(DR\)$/i),
      deposit: findX(/^DEPOSIT\(CR\)$/i),
      balance: findX(/^BALANCE\(INR\)$/i),
    };
  }

  return { withdrawal: null, deposit: null, balance: null };
}

function extractAmountItems(items = []) {
  return items
    .map((item) => ({
      x: item.x,
      text: clean(item.text),
      value: Math.abs(parseAmount(item.text)),
      isCreditBalance: /Cr$/i.test(clean(item.text)),
    }))
    .filter((item) => isAmountText(item.text) && item.value !== null);
}

function extractNarrationFromItems(items = [], amountColumns) {
  const narrationStart = 150;
  const narrationEnd = (amountColumns.withdrawal || 430) - 10;

  return clean(
    items
      .filter((item) => {
        const text = clean(item.text);
        if (isAmountText(text)) return false;
        if (/^\d{2}[./-]\d{2}[./-]\d{2,4}$/.test(text)) return false;
        return item.x >= narrationStart && item.x <= narrationEnd;
      })
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(" "),
  );
}

function nearestColumn(x, amountColumns) {
  const columns = [
    ["withdrawal", amountColumns.withdrawal],
    ["deposit", amountColumns.deposit],
    ["balance", amountColumns.balance],
  ].filter(([, position]) => position !== null);

  columns.sort((left, right) => Math.abs(x - left[1]) - Math.abs(x - right[1]));
  return columns[0]?.[0] || "balance";
}

function resolveBalanceFromItems(amountItems, amountColumns) {
  if (amountItems.length === 0) return null;

  const creditBalanceItem = [...amountItems].reverse().find((item) => item.isCreditBalance);
  if (creditBalanceItem) return creditBalanceItem.value;

  const balanceItem = [...amountItems].sort(
    (left, right) =>
      Math.abs(left.x - amountColumns.balance) - Math.abs(right.x - amountColumns.balance),
  )[0];

  if (balanceItem) return balanceItem.value;

  return Math.max(...amountItems.map((item) => item.value));
}

function assignBobAmounts(amountItems, amountColumns) {
  if (amountItems.length === 0) {
    return { withdrawal: null, deposit: null, balance: null, transactionAmount: null };
  }

  if (amountItems.length === 1) {
    const item = amountItems[0];
    const column = nearestColumn(item.x, amountColumns);

    if (item.isCreditBalance) {
      return {
        withdrawal: null,
        deposit: null,
        balance: item.value,
        transactionAmount: null,
        transactionColumn: null,
      };
    }

    if (column === "balance") {
      return { withdrawal: null, deposit: null, balance: item.value, transactionAmount: null };
    }

    if (column === "withdrawal") {
      return {
        withdrawal: item.value,
        deposit: null,
        balance: null,
        transactionAmount: item.value,
        transactionColumn: "withdrawal",
      };
    }

    return {
      withdrawal: null,
      deposit: item.value,
      balance: null,
      transactionAmount: item.value,
      transactionColumn: "deposit",
    };
  }

  let withdrawal = null;
  let deposit = null;
  let balance = resolveBalanceFromItems(amountItems, amountColumns);
  const balanceItem =
    [...amountItems].reverse().find((item) => item.isCreditBalance) ||
    [...amountItems].sort(
      (left, right) =>
        Math.abs(left.x - amountColumns.balance) - Math.abs(right.x - amountColumns.balance),
    )[0];
  const transactionItem = amountItems.find((item) => item !== balanceItem);
  const transactionColumn = transactionItem ? nearestColumn(transactionItem.x, amountColumns) : null;

  if (transactionItem && transactionColumn === "withdrawal") {
    withdrawal = transactionItem.value;
  } else if (transactionItem) {
    deposit = transactionItem.value;
  }

  return {
    withdrawal,
    deposit,
    balance,
    transactionAmount: transactionItem ? transactionItem.value : null,
    transactionColumn,
  };
}

function classifyByBalanceDelta(transactions) {
  for (let index = 0; index < transactions.length; index += 1) {
    const row = transactions[index];
    const older = transactions[index + 1];
    if (!older || row.balance === null || older.balance === null) {
      if (row.transactionAmount !== null && row.transactionAmount !== undefined) {
        if (row.transactionColumn === "withdrawal") {
          row.withdrawal = row.transactionAmount;
          row.deposit = null;
        } else {
          row.withdrawal = null;
          row.deposit = row.transactionAmount;
        }
      }
      continue;
    }

    const delta = roundMoney(row.balance - older.balance);
    if (Math.abs(delta) < 0.02) {
      row.withdrawal = null;
      row.deposit = null;
      continue;
    }

    if (delta > 0) {
      row.deposit = Math.abs(delta);
      row.withdrawal = null;
    } else {
      row.withdrawal = Math.abs(delta);
      row.deposit = null;
    }
  }

  return transactions;
}

function cleanBobNarration(text) {
  return clean(text)
    .replace(/\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\b.*$/i, "")
    .replace(/\s*contact-us@\d+.*$/i, "")
    .replace(/\s*page\s+\d+\s+of\s+\d+.*$/i, "")
    .trim();
}

function isBobNoiseLine(text) {
  return (
    !text ||
    /^page\s+\d+\s+of\s+\d+/i.test(text) ||
    /page\s+\d+\s+of\s+\d+/i.test(text) ||
    /^\*?this is computer-generated statement/i.test(text) ||
    /^contact-us@/i.test(text) ||
    /contact-us@\d+/i.test(text) ||
    /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\b/i.test(text) ||
    /^--\s*\d+\s+of\s+\d+\s*--$/i.test(text) ||
    /^customer id:/i.test(text) ||
    /^branch name:/i.test(text) ||
    /^ifsc code:/i.test(text) ||
    /^your account statement/i.test(text) ||
    /^statement of transactions/i.test(text) ||
    /^main account holder name/i.test(text) ||
    /^authorised signatory/i.test(text) ||
    /^tran date\s+value date\s+narration/i.test(text) ||
    /^jigeesha auto service account/i.test(text) ||
    /^address\s*:/i.test(text) ||
    /^nominee reg:/i.test(text) ||
    /^micr code:/i.test(text) ||
    /^account no:/i.test(text) ||
    /^statement period from/i.test(text) ||
    /^[A-Z]\*[A-Z0-9* ]+$/i.test(text)
  );
}

function isOrphanAmountLine(entry) {
  const text = clean(entry.text || entry);
  const amountItems = extractAmountItems(entry.items || []);
  return amountItems.length === 1 && text === amountItems[0].text;
}

function applyOrphanAmount(current, amountItem, amountColumns) {
  current.transactionAmount = amountItem.value;
  current.transactionColumn = nearestColumn(amountItem.x, amountColumns);
}

// A second, unrelated Bank of Baroda template: the savings-account passbook-style statement
// ("DATE PARTICULARS CHQ.NO. WITHDRAWALS DEPOSITS BALANCE"), as opposed to the business/current
// account template above ("TRAN DATE VALUE DATE NARRATION ... WITHDRAWAL(DR) DEPOSIT(CR)"). The
// two share nothing in header text or column layout, so this gets its own detector/parser pair,
// but reuses extractAmountItems/nearestColumn/clean/parseDate above rather than redefining them.
const SAVINGS_HEADER_COLUMNS = ["DATE", "PARTICULARS", "CHQ.NO.", "WITHDRAWALS", "DEPOSITS", "BALANCE"];

function isBankOfBarodaSavingsLayout(lines) {
  for (const entry of lines) {
    const items = entry.items || [];
    const texts = items.map((item) => clean(item.text));
    if (texts[0] === "DATE" && texts[1] === "PARTICULARS" && SAVINGS_HEADER_COLUMNS.every((c) => texts.includes(c))) {
      return true;
    }
  }
  return false;
}

// Not every physical page reprints this header -- a transaction list can spill onto the next page
// with no letterhead/header at all, straight back into transaction rows. The column x-positions are
// consistent for the whole document (same template throughout), so this is detected once globally
// rather than per page. Shaped to match nearestColumn()/assignBobAmounts() above, which only look
// at withdrawal/deposit/balance.
function detectBobSavingsColumns(lines) {
  for (const entry of lines) {
    const items = entry.items || [];
    const texts = items.map((item) => clean(item.text));
    if (texts[0] !== "DATE" || texts[1] !== "PARTICULARS") continue;
    if (!SAVINGS_HEADER_COLUMNS.every((c) => texts.includes(c))) continue;

    const findX = (label) => items.find((item) => clean(item.text) === label)?.x ?? null;
    return {
      withdrawal: findX("WITHDRAWALS"),
      deposit: findX("DEPOSITS"),
      balance: findX("BALANCE"),
    };
  }
  return null;
}

function isBobSavingsNoiseLine(text) {
  return (
    !text ||
    /^-+$/.test(text) ||
    /^BANK OF BARODA\b/i.test(text) ||
    /^ADDRESS:/i.test(text) ||
    /^HELPLINE NO\.?\s*:/i.test(text) ||
    /^BRANCH PHONE NO\.?\s*:/i.test(text) ||
    /^MICR CODE:/i.test(text) ||
    // Branch name + print timestamp line, e.g. "BOISAR(WEST),MUMBAI Time : 09:44:46" -- the branch
    // name varies per statement, so this matches on the "Time : HH:MM:SS" suffix instead.
    /Time\s*:\s*\d{2}:\d{2}:\d{2}/.test(text) ||
    /^A\/C Name\b/i.test(text) ||
    /^Address\s*:/i.test(text) ||
    /^City\s*:/i.test(text) ||
    /^CKYC Number/i.test(text) ||
    /^Tel No\.?:/i.test(text) ||
    /^Nomination Flag/i.test(text) ||
    /^Scheme Description/i.test(text) ||
    /^Joint Holders/i.test(text) ||
    /^A\/C Number\s*:/i.test(text) ||
    /^Statement of account for the period/i.test(text) ||
    /^DATE PARTICULARS CHQ\.NO\.? WITHDRAWALS DEPOSITS BALANCE$/i.test(text) ||
    /^Page Total:/i.test(text) ||
    /^Grand Total:/i.test(text) ||
    /^ClrBal:/i.test(text) ||
    /^As On\b/i.test(text) ||
    /^Note: Cheques received/i.test(text) ||
    // Wrapped continuation lines of the two disclaimers above -- the sentence is split across two
    // physical lines in the PDF, and only the first half starts with the anchor text above.
    /^returning on the basis opening balance in account/i.test(text) ||
    /^commitment to customers and Micro and Small/i.test(text) ||
    /^Unless the constituent notifies/i.test(text) ||
    /^within 15 days from the date/i.test(text) ||
    /^transaction\(s\) in the statement/i.test(text) ||
    /^We are committed to treat customers/i.test(text) ||
    /^For details please visit/i.test(text) ||
    /^Please contact your branch/i.test(text) ||
    /^to get transaction alerts/i.test(text) ||
    /^ABBREVIATIONS USED/i.test(text) ||
    /^Pending penal charges/i.test(text) ||
    /^This is a computer generated statement/i.test(text) ||
    /^\*+END OF STATEMENT\*+/i.test(text) ||
    // Two-column glossary rows, e.g. "Retd - Returned Cheque SI - Standing Instructions" -- codes
    // aren't consistently all-caps ("Retd"), hence case-insensitive rather than [A-Z]+.
    /^[A-Za-z]+\.?\s*-\s*[A-Za-z ]+\s+[A-Za-z]+\.?\s*-\s*[A-Za-z ]+$/i.test(text)
  );
}

const LEADING_DATE_RE = /^(\d{2}-\d{2}-\d{2})\s*(.*)$/;

function parseBankOfBarodaSavingsTransactions(lines) {
  const columns = detectBobSavingsColumns(lines);
  if (!columns) return [];

  const transactions = [];
  let current = null;

  for (const entry of lines) {
    const text = clean(entry.text || entry);
    if (!text || isBobSavingsNoiseLine(text)) continue;

    const items = entry.items || [];
    const dateItem = items.find((item) => LEADING_DATE_RE.test(clean(item.text)));

    if (!dateItem) {
      // Narration continuation line belonging to the previous transaction (pdf.js keeps the whole
      // date+particulars+chq-no run as one text item on the transaction's own line, but the
      // wrapped reference/narration below it is always its own separate line).
      if (current) current.particulars = clean(`${current.particulars} ${text}`);
      continue;
    }

    // dateItem's own text is just "date + particulars + chq-no fragment" -- pdf.js only glues text
    // into one item when there's no real gap, and the amounts always sit far enough right to land
    // in their own items, so nearestColumn()/isCreditBalance from the layout-1 parser above work
    // unchanged here.
    const dateMatch = clean(dateItem.text).match(LEADING_DATE_RE);
    const amountItems = extractAmountItems(items.filter((item) => item !== dateItem));

    let withdrawal = null;
    let deposit = null;
    let balance = null;

    for (const item of amountItems) {
      if (item.isCreditBalance) {
        balance = item.value;
        continue;
      }
      const column = nearestColumn(item.x, columns);
      if (column === "balance") balance = item.value;
      else if (column === "withdrawal") withdrawal = item.value;
      else deposit = item.value;
    }

    const row = {
      date: parseDate(dateMatch[1]),
      particulars: clean(dateMatch[2]) || "TRANSACTION",
      chequeNo: null,
      withdrawal,
      deposit,
      balance,
    };

    transactions.push(row);
    current = row;
  }

  return transactions;
}

function parseBankOfBarodaTransactions(lines) {
  const amountColumns = detectBobAmountColumns(lines);
  const transactions = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const entry = lines[index];
    const text = clean(entry.text || entry);
    if (!text || isBobNoiseLine(text)) continue;

    if (isOrphanAmountLine(entry)) {
      const amountItems = extractAmountItems(entry.items || []);
      if (current) {
        applyOrphanAmount(current, amountItems[0], amountColumns);
      }
      continue;
    }

    const items = entry.items || [];
    const dateItem = items.find((item) => /^\d{2}[./-]\d{2}[./-]\d{2,4}$/.test(clean(item.text)));
    const date = dateItem ? parseDate(dateItem.text) : null;
    if (!date) {
      if (current && !isAmountText(text) && !isBobNoiseLine(text)) {
        current.particulars = clean(`${current.particulars} ${text}`);
      }
      continue;
    }

    const amountItems = extractAmountItems(items);
    if (amountItems.length === 0) continue;

    const assigned = assignBobAmounts(amountItems, amountColumns);
    const narration = extractNarrationFromItems(items, amountColumns);

    const row = {
      date,
      particulars: narration || "TRANSACTION",
      chequeNo: null,
      withdrawal: assigned.withdrawal,
      deposit: assigned.deposit,
      balance: assigned.balance,
      transactionAmount: assigned.transactionAmount,
      transactionColumn: assigned.transactionColumn,
    };

    transactions.push(row);
    current = row;
  }

  const classified = classifyByBalanceDelta(transactions);
  for (const row of classified) {
    row.particulars = cleanBobNarration(row.particulars) || "TRANSACTION";
    delete row.transactionAmount;
    delete row.transactionColumn;
  }

  return classified;
}

export {
  isBankOfBarodaLayout,
  parseBankOfBarodaTransactions,
  isBankOfBarodaSavingsLayout,
  parseBankOfBarodaSavingsTransactions,
};
