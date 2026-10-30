// Client's Tally workbook: GST Entries, TCS Entries, Import, Stock Items, Review, Party Settings.
// GST Entries rows are built per GST rate from the lines; other amounts are written values only.
import ExcelJS from "exceljs";
import { parseDmy } from "./validate.js";

const TEAL = "FF2F5F5F";
const YELLOW = "FFFFF2CC"; // light yellow, as in the client's sample workbook
const NOTE_GREY = "FF808080";
// Text about payment, for the Review sheet's payment note.
const PAYMENT_WORDS = /\b(?:recd|rcvd|received|recieved|paid|payment|pymt|cheque|chq|ch\.? no|neft|rtgs|imps|upi|utr|cash|advance|balance due)\b/i;
// The grey explanation lines written under a table.
const NOTE_ROW = /^(?:Yellow row|Used for TCS|Placeholder:)/;
const MONEY = "#,##0.00";
const DATE = "dd/mm/yyyy";

const has = (n) => typeof n === "number" && Number.isFinite(n);
const fmt = (n) => (has(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
const round2 = (n) => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
const lineValue = (line) => (has(line.taxableValue) ? line.taxableValue : has(line.amount) ? line.amount : null);

function addSheet(workbook, name, headers, widths) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  const header = sheet.addRow(headers);
  header.eachCell((cell) => {
    cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  widths.forEach((width, i) => (sheet.getColumn(i + 1).width = width));
  return sheet;
}

function finish(sheet, { moneyColumns = [], dateColumns = [], wrapColumns = [], percentColumns = [], highlight = new Set() } = {}) {
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { name: "Arial", size: 10, ...(cell.font?.bold ? { bold: true } : {}) };
      cell.alignment = { vertical: "top", wrapText: wrapColumns.includes(col) };
      if (percentColumns.includes(col)) cell.numFmt = "0%";
      if (moneyColumns.includes(col)) cell.numFmt = MONEY;
      if (dateColumns.includes(col)) cell.numFmt = DATE;
      if (highlight.has(n)) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
    });
  });
}

function totalRow(sheet, label, labelColumn, columns, firstRow) {
  const last = sheet.rowCount;
  const values = [];
  values[labelColumn] = label;
  const row = sheet.addRow(values);
  for (const col of columns) {
    const letter = sheet.getColumn(col).letter;
    let result = 0;
    for (let r = firstRow; r <= last; r++) result += Number(sheet.getCell(`${letter}${r}`).value) || 0;
    row.getCell(col).value = { formula: `SUM(${letter}${firstRow}:${letter}${last})`, result: round2(result) };
  }
  row.font = { name: "Arial", bold: true };
  return row;
}

// Grey explanatory line one row below a sheet's table.
function note(sheet, text) {
  sheet.addRow([]);
  sheet.addRow([text]).getCell(1).font = { name: "Arial", size: 10, color: { argb: NOTE_GREY } };
}

// "50,000 + 4,500 + 4,500 = 59,000" (+ round-off), for invoices whose amounts all check out.
function arithmeticSummary({ invoice, result }) {
  const t = invoice.totals ?? {};
  const n = (v) => v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(v) ? 0 : 2 });
  const parts = [result.computed.taxable, t.cgst, t.sgst, t.igst].filter((v) => has(v) && v !== 0);
  if (!parts.length || !has(t.grandTotal)) return "All amounts check.";
  const before = round2(parts.reduce((a, v) => a + v, 0));
  const roundOff = round2(t.grandTotal - before);
  return `All amounts check: ${parts.map(n).join(" + ")} = ${n(before)}${roundOff ? `, round-off ${roundOff > 0 ? "+" : ""}${n(roundOff)} = ${n(t.grandTotal)}` : ""}.`;
}

function stockText(lines) {
  return lines
    .map((line) =>
      [
        line.description ?? "",
        line.hsnSac ? `HSN ${line.hsnSac}` : "",
        [has(line.qty) ? line.qty : "", (line.unit ?? "").toUpperCase()].join(" ").trim(),
        fmt(line.rate),
        fmt(lineValue(line)),
        has(line.gstRate) ? `${line.gstRate}%` : "",
      ].join(" | "),
    )
    .join("\n");
}

// Rows for "GST Entries": one per line GST rate, built from the lines (tax = taxable x rate, never
// copied from elsewhere). Lines without a rate get their own row with the tax cells blank.
// A single-rate invoice with printed totals keeps the printed figures. yellow: row needs a look.
function gstRows(entry, gstLines) {
  const { invoice, result } = entry;
  const t = invoice.totals ?? {};
  const intra = result.computed.intraState;
  const totalsBlank = result.computed.taxable === null && !has(t.grandTotal);
  const notes = [];
  const sno = (line) => line.sno ?? gstLines.indexOf(line) + 1;

  // "Use computed totals": unrated lines take the rate of the others, only if the rated lines all agree.
  const ratedRates = [...new Set(gstLines.map((line) => line.gstRate).filter(has))];
  const assumed = invoice.useComputedTotals === true && ratedRates.length === 1 ? ratedRates[0] : null;
  const rateOf = (line) => (has(line.gstRate) ? line.gstRate : assumed);
  for (const line of gstLines) {
    if (!has(line.gstRate) && assumed !== null) notes.push(`Line ${sno(line)}: no GST rate written; ${assumed}% (the rate of the other lines) used because "Use computed totals" was chosen.`);
  }

  const groups = new Map(); // rate (null = none written) -> lines, in order of first appearance, unrated last
  for (const line of gstLines.filter((l) => rateOf(l) !== null)) groups.set(rateOf(line), [...(groups.get(rateOf(line)) ?? []), line]);
  const unrated = gstLines.filter((l) => rateOf(l) === null);
  if (unrated.length) groups.set(null, unrated);

  // One rate, printed totals: the invoice's own figures (an all-unrated invoice with printed totals too).
  if (!totalsBlank && groups.size <= 1) {
    const rate = [...groups.keys()][0] ?? null;
    return {
      rows: [{
        rate,
        lines: gstLines,
        taxable: result.computed.taxable,
        igst: intra === true ? 0 : has(t.igst) ? t.igst : null,
        cgst: intra === false ? 0 : has(t.cgst) ? t.cgst : null,
        sgst: intra === false ? 0 : has(t.sgst) ? t.sgst : null,
        yellow: gstLines.some((line) => !has(line.gstRate)),
      }],
      notes,
    };
  }

  const rows = [...groups].map(([rate, lines]) => {
    const values = lines.map(lineValue);
    const taxable = values.every((v) => v !== null) ? round2(values.reduce((a, v) => a + v, 0)) : null;
    const tax = rate === null || taxable === null ? null : round2((taxable * rate) / (intra === false ? 100 : 200));
    const split = (interstate) => (tax === null ? null : interstate === (intra === false) ? tax : 0);
    return { rate, lines, taxable, igst: split(true), cgst: split(false), sgst: split(false), yellow: rate === null || lines.some((l) => !has(l.gstRate)) };
  });
  if (!gstLines.some((line) => has(line.gstRate))) {
    for (const line of gstLines) notes.push(`Line ${sno(line)}: no GST rate written.`);
  }

  if (totalsBlank) {
    if (rows.some((row) => row.rate !== null)) notes.push("Tax computed from lines, not printed on the invoice.");
    for (const row of rows) row.yellow = true;
  } else {
    // Printed totals: the rate-wise split must add up to them (round-off tolerance 1.00).
    const added = (key) => round2(rows.reduce((a, row) => a + (row[key] ?? 0), 0));
    const off = [["taxable", "taxable amount", result.computed.taxable], ["cgst", "CGST", t.cgst], ["sgst", "SGST", t.sgst], ["igst", "IGST", t.igst]]
      .filter(([key, , printed]) => has(printed) && Math.abs(added(key) - printed) > 1)
      .map(([key, name, printed]) => `${name} ${fmt(added(key))} vs printed ${fmt(printed)}`);
    if (off.length) {
      notes.push(`The rate-wise split does not match the printed totals: ${off.join("; ")}.`);
      for (const row of rows) row.yellow = true;
    }
  }
  return { rows, notes };
}

// entries: [{ invoice, result, sourceFile, entryType, partyName }]; parties: [{ name, gstin, entryType }]
// options.includePartySettings: add the Party Settings sheet (off by default).
async function buildTallyWorkbookBuffer(entries, parties = [], { includePartySettings = false } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bank Statement Convertor";
  const sorted = [...entries].sort((a, b) => (parseDmy(a.invoice.invoiceDate)?.getTime() ?? 0) - (parseDmy(b.invoice.invoiceDate)?.getTime() ?? 0));
  const extraNotes = new Map(entries.map((entry) => [entry, []]));
  const flagged = (entry) => entry.result.status !== "OK";

  // GST Entries (STOCK and NORMAL parties, plus the GST part of a TCS bill)
  const gst = addSheet(workbook, "GST Entries", ["DATE", "PARTY NAME", "GSTIN", "INVOICE NO", "TAXABLE AMOUNT", "IGST", "CGST", "SGST", "STOCK (IF APPLICABLE)"], [12, 28, 19, 15, 16, 11, 12, 12, 58]);
  const gstYellow = new Set();
  for (const entry of sorted) {
    const { invoice, entryType } = entry;
    if (!["STOCK", "NORMAL", "TCS"].includes(entryType)) continue;
    const lines = invoice.lineItems ?? [];
    const gstLines = entryType === "TCS" ? lines.filter((line) => has(line.gstRate) && line.gstRate > 0) : lines;
    if (entryType === "TCS" && !gstLines.length) continue;
    if (entryType === "TCS") extraNotes.get(entry).push("Bar bill also has GST items: entered on GST Entries as well as TCS Entries. Please check both.");
    const { rows, notes } = gstRows(entry, gstLines);
    extraNotes.get(entry).push(...notes);
    for (const row of rows) {
      const added = gst.addRow([
        parseDmy(invoice.invoiceDate),
        entry.partyName,
        invoice.supplier?.gstin ?? "",
        invoice.invoiceNo ?? "",
        row.taxable,
        row.igst,
        row.cgst,
        row.sgst,
        entryType === "STOCK" ? stockText(row.lines) : "Not applicable (normal entry)",
      ]);
      if (flagged(entry) || entryType === "TCS" || row.yellow) gstYellow.add(added.number);
    }
  }
  if (gst.rowCount > 1) totalRow(gst, "TOTAL", 4, [5, 6, 7, 8], 2);
  finish(gst, { moneyColumns: [5, 6, 7, 8], dateColumns: [1], wrapColumns: [9], highlight: gstYellow });
  note(gst, "Yellow row = needs review (see Review sheet). Stock column: Item | HSN | Qty | Rate | Amount | GST%.");

  // TCS Entries: liquor is outside GST (lines without a GST rate).
  const tcs = addSheet(workbook, "TCS Entries", ["DATE", "PARTY NAME", "INVOICE NO", "NON GST LIQUOR (TAXABLE)", "TCS"], [12, 28, 15, 22, 12]);
  const tcsYellow = new Set();
  for (const entry of sorted.filter((e) => e.entryType === "TCS")) {
    const liquor = (entry.invoice.lineItems ?? []).filter((line) => !has(line.gstRate) || line.gstRate === 0).map(lineValue);
    const added = tcs.addRow([
      parseDmy(entry.invoice.invoiceDate),
      entry.partyName,
      entry.invoice.invoiceNo ?? "",
      liquor.length && liquor.every((v) => v !== null) ? round2(liquor.reduce((a, v) => a + v, 0)) : null,
      has(entry.invoice.totals?.tcs) ? entry.invoice.totals.tcs : null,
    ]);
    if (flagged(entry)) tcsYellow.add(added.number);
  }
  const hasTcs = tcs.rowCount > 1;
  if (hasTcs) totalRow(tcs, "TOTAL", 3, [4, 5], 2);
  finish(tcs, { moneyColumns: [4, 5], dateColumns: [1], highlight: tcsYellow });
  if (!hasTcs) note(tcs, "Used for TCS-wise parties (liquor bills). No TCS invoice in this export.");

  // Import: placeholder until the client's Tally import file defines the columns.
  const imports = sorted.filter((e) => e.entryType === "IMPORT");
  if (imports.length) {
    const imp = addSheet(workbook, "Import", ["DATE", "PARTY NAME", "INVOICE NO", "GRAND TOTAL", "SOURCE FILE"], [12, 30, 16, 16, 40]);
    for (const entry of imports) {
      imp.addRow([parseDmy(entry.invoice.invoiceDate), entry.partyName, entry.invoice.invoiceNo ?? "", entry.invoice.totals?.grandTotal ?? null, entry.sourceFile ?? ""]);
    }
    imp.addRow([]);
    imp.addRow(["Placeholder: the Tally import columns for IMPORT parties will be generated once the import file is provided."]).font = { name: "Arial", italic: true };
    finish(imp, { moneyColumns: [4], dateColumns: [1] });
  }

  // Stock Items: one row per item of a STOCK party, with a live qty x rate check.
  const stock = addSheet(workbook, "Stock Items", ["INVOICE NO", "PARTY NAME", "ITEM", "HSN/SAC", "QTY", "UNIT", "RATE", "AMOUNT", "GST %", "CHECK"], [15, 24, 24, 11, 8, 8, 11, 13, 7, 26]);
  const stockYellowCells = [];
  for (const entry of sorted.filter((e) => e.entryType === "STOCK")) {
    for (const [i, line] of (entry.invoice.lineItems ?? []).entries()) {
      const row = stock.addRow([entry.invoice.invoiceNo ?? "", entry.partyName, line.description ?? "", line.hsnSac ?? null, line.qty, line.unit ? line.unit.toUpperCase() : null, line.rate, lineValue(line), has(line.gstRate) ? line.gstRate / 100 : null]);
      const r = row.number;
      // A low-confidence reading of this cell is highlighted, like in the client's sample.
      for (const [col, key] of [[3, "description"], [4, "hsnSac"], [5, "qty"], [7, "rate"], [8, "amount"]]) {
        if (entry.invoice.confidence?.[`lineItems[${i}].${key}`] === "low") stockYellowCells.push([r, col]);
      }
      const computed = has(line.qty) && has(line.rate) ? round2(line.qty * line.rate) : null;
      const ok = computed === null || lineValue(line) === null ? true : Math.abs(computed - lineValue(line)) <= 1;
      row.getCell(10).value = {
        formula: `IF(OR(E${r}="",G${r}=""),"OK",IF(ABS(E${r}*G${r}-H${r})<=1,"OK","Qty x Rate = "&TEXT(E${r}*G${r},"#,##0.00")))`,
        result: ok ? "OK" : `Qty x Rate = ${fmt(computed)}`,
      };
    }
  }
  finish(stock, { moneyColumns: [7, 8], percentColumns: [9] });
  for (const [r, col] of stockYellowCells) stock.getRow(r).getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };

  // Review: every validation message lives here, keeping the client's sheets clean.
  const review = addSheet(workbook, "Review", ["INVOICE NO", "PARTY NAME", "ENTRY TYPE", "STATUS", "GRAND TOTAL", "PAYMENT NOTE", "REVIEW NOTES", "SOURCE"], [15, 24, 12, 13, 13, 34, 60, 26]);
  const reviewYellow = new Set();
  for (const entry of sorted) {
    const reasons = entry.result.reasons;
    // Payment note = what is written about payment outside the item table; check results go to the review notes.
    const payment = (entry.invoice.handwrittenNotes ?? []).filter((note) => PAYMENT_WORDS.test(note));
    const notes = [...reasons.map((r) => r.message), ...extraNotes.get(entry)];
    if (entry.result.status === "OK") notes.unshift(arithmeticSummary(entry));
    const added = review.addRow([
      entry.invoice.invoiceNo ?? "",
      entry.partyName,
      entry.entryType,
      entry.result.status,
      entry.invoice.totals?.grandTotal ?? null,
      payment.join("\n"),
      notes.join("\n"),
      entry.sourceFile ?? "",
    ]);
    if (flagged(entry)) reviewYellow.add(added.number);
  }
  finish(review, { moneyColumns: [5], wrapColumns: [6, 7], highlight: reviewYellow });

  if (includePartySettings) {
    const settings = addSheet(workbook, "Party Settings", ["SR.NO", "PARTY NAME", "ENTRY TYPE", "OUTPUT SHEET"], [7, 30, 12, 16]);
    const outputSheet = { STOCK: "GST Entries", NORMAL: "GST Entries", TCS: "TCS Entries", IMPORT: "Import file format (pending)" };
    parties.forEach((party, i) => settings.addRow([i + 1, party.name, party.entryType, outputSheet[party.entryType] ?? ""]));
    finish(settings);
  }

  // Sheets with no rows are left out (the Review sheet always stays).
  for (const sheet of [...workbook.worksheets]) {
    let rows = 0;
    sheet.eachRow((row, n) => n > 1 && row.getCell(1).value !== null && !NOTE_ROW.test(String(row.getCell(1).value)) && rows++);
    if (sheet.name !== "Review" && rows === 0) workbook.removeWorksheet(sheet.id);
  }

  return workbook.xlsx.writeBuffer();
}

export { buildTallyWorkbookBuffer };
