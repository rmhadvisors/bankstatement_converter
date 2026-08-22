function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const text = clean(raw).replace(/[₹,|]/g, "").replace(/Cr|Dr/gi, "");
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return /Dr$/i.test(clean(raw)) || /^-/.test(text) ? -Math.abs(value) : value;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const monthNames = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function parseDate(raw) {
  const text = clean(raw).replace(/^'/, "");
  let match = text.match(/^(\d{2})[/.-](\d{2})[/.-](\d{2}|\d{4})$/);
  if (match) {
    const year = Number(match[3]) < 100 ? Number(match[3]) + 2000 : Number(match[3]);
    return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
  }

  match = text.match(/^(\d{2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if (match) {
    const month = monthNames[match[2].toLowerCase()];
    const year = Number(match[3]) < 100 ? Number(match[3]) + 2000 : Number(match[3]);
    return month ? new Date(Date.UTC(year, month - 1, Number(match[1]))) : null;
  }

  return null;
}

function amountItems(items = []) {
  return items
    .map((item) => ({ ...item, text: clean(item.text), value: parseAmount(item.text) }))
    .filter((item) => item.value !== null && /(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}/.test(item.text));
}

function isChronological(transactions) {
  const dated = transactions.filter((row) => row.date instanceof Date);
  if (dated.length < 2) return true;

  let forward = 0;
  let backward = 0;
  for (let index = 1; index < dated.length; index += 1) {
    const diff = dated[index].date.getTime() - dated[index - 1].date.getTime();
    if (diff > 0) forward += 1;
    if (diff < 0) backward += 1;
  }

  return forward >= backward;
}

function sortChronologically(transactions) {
  return [...transactions].sort((left, right) => {
    const dateDiff = (left.date?.getTime?.() || 0) - (right.date?.getTime?.() || 0);
    if (dateDiff !== 0) return dateDiff;
    return (left.sequence || 0) - (right.sequence || 0);
  });
}

export { amountItems, clean, isChronological, parseAmount, parseDate, roundMoney, sortChronologically };
