// Client's Tally workbook: GST Entries, TCS Entries, Import, Stock Items, Review, Party Settings.
// Written values only: an amount the invoice doesn't show is left blank, never computed in.
import ExcelJS from "exceljs";
import { parseDmy } from "./validate.js";

const TEAL = "FF2F5F5F";
const YELLOW = "FFFFF2CC"; // light yellow, as in the client's sample workbook
const NOTE_GREY = "FF808080";
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

// Rows for "GST Entries": one per GST rate. Single-rate invoice: the written totals. Multi-rate:
// written line values per rate, and taxes only where the lines themselves show them.
function gstRows(entry, gstLines) {
  const { invoice, result } = entry;
  const t = invoice.totals ?? {};
  const intra = result.computed.intraState;
  const rateOf = (line) => (has(line.gstRate) ? line.gstRate : has(t.igstRate) ? t.igstRate : has(t.cgstRate) ? t.cgstRate * 2 : null);
  const rates = [...new Set(gstLines.map(rateOf))];
  const notes = [];

  if (rates.length <= 1) {
    const taxable = result.computed.taxable;
    const known = taxable !== null;
    return {
      rows: [{
        rate: rates[0] ?? null,
        lines: gstLines,
        taxable,
        igst: !known ? null : intra === true ? 0 : has(t.igst) ? t.igst : null,
        cgst: !known ? null : intra === false ? 0 : has(t.cgst) ? t.cgst : null,
        sgst: !known ? null : intra === false ? 0 : has(t.sgst) ? t.sgst : null,
      }],
      notes,
    };
  }

  const rows = rates.map((rate) => {
    const lines = gstLines.filter((line) => rateOf(line) === rate);
    const sum = (key) => (lines.every((line) => has(line[key])) ? round2(lines.reduce((a, line) => a + line[key], 0)) : null);
    const values = lines.map(lineValue);
    return {
      rate,
      lines,
      taxable: values.every((v) => v !== null) ? round2(values.reduce((a, v) => a + v, 0)) : null,
      igst: intra === true ? 0 : sum("igst"),
      cgst: intra === false ? 0 : sum("cgst"),
      sgst: intra === false ? 0 : sum("sgst"),
    };
  });
  if (rows.some((row) => (intra === false ? row.igst : row.cgst) === null)) {
    notes.push("Several GST rates: the invoice shows tax only as a total, so the per-rate tax cells are blank. Enter them from the invoice.");
  }
  return { rows, notes };
}

// entries: [{ invoice, result, sourceFile, entryType, partyName }]; parties: [{ name, gstin, entryType }]
async function buildTallyWorkbookBuffer(entries, parties = []) {
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
      if (flagged(entry) || entryType === "TCS") gstYellow.add(added.number);
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
    // Payment note = what is written on the invoice; every check result goes to the review notes.
    const payment = entry.invoice.handwrittenNotes ?? [];
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

  const settings = addSheet(workbook, "Party Settings", ["SR.NO", "PARTY NAME", "ENTRY TYPE", "OUTPUT SHEET"], [7, 30, 12, 16]);
  const outputSheet = { STOCK: "GST Entries", NORMAL: "GST Entries", TCS: "TCS Entries", IMPORT: "Import file format (pending)" };
  parties.forEach((party, i) => settings.addRow([i + 1, party.name, party.entryType, outputSheet[party.entryType] ?? ""]));
  finish(settings);

  return workbook.xlsx.writeBuffer();
}

export { buildTallyWorkbookBuffer };
