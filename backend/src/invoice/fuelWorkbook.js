// Fuel sales register -> the client's Tally import sheet, in the format of the reference workbook
// (sheet "JULY 26": DATE SR PARTY ITEM QTY RATE AMT VCH LEDGER NARRATION; no Error column). When
// flags are still unresolved, the caller adds a last "Review" sheet; the main sheet never changes.
import ExcelJS from "exceljs";

const ACCOUNTING = '_ * #,##0.00_ ;_ * -#,##0.00_ ;_ * "-"??_ ;_ @_ ';
const HEADERS = ["DATE", "SR", "PARTY", "ITEM", "QTY", "RATE", "AMT", "VCH", "LEDGER", "NARRATION"];
const WIDTHS = [14.86, 8.71, 10.43, 29.14, 13.14, 12.86, 18.86, 8.71, 26, 42];
const BORDER = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
const FONT = { name: "Calibri", size: 13 };

// Plain-sentence reason, the two reads and the suggestion for the Review sheet.
const reviewLines = (flags) =>
  flags.map((f) => [
    f.product ?? "",
    f.day ?? "",
    f.reason,
    f.values ? (f.values.first ?? "blank") : "",
    f.values ? (f.values.second ?? "blank") : "",
    f.suggestion ? f.suggestion.value : "",
    f.accepted === null ? "Not resolved" : `Accepted as read${f.accepted ? `: ${f.accepted}` : ""}`,
  ]);

// rows: buildFuelRegister().rows; review: null (no Review sheet) or the flags to list.
async function buildFuelWorkbookBuffer({ sheetName, rows, review = null }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName, { properties: { tabColor: { argb: "FF7030A0" }, defaultRowHeight: 15 } });
  sheet.addRow(HEADERS);
  sheet.getRow(1).height = 15.75;
  sheet.getRow(1).eachCell((c, col) => {
    c.font = { ...FONT, bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2F3" }, bgColor: { argb: "FFD9E2F3" } };
    c.alignment = { horizontal: "center" };
    c.border = BORDER;
    if (col >= 5 && col <= 7) c.numFmt = ACCOUNTING;
  });
  rows.forEach((r, i) => {
    const n = i + 2;
    const row = sheet.addRow([
      new Date(`${r.date}T00:00:00.000Z`),
      r.sr,
      r.party,
      r.item,
      r.qty,
      r.rate,
      r.amt === null ? null : { formula: `ROUND(E${n}*F${n},2)`, result: r.amt },
      r.vch,
      r.ledger,
      r.narration,
    ]);
    row.height = 14.25;
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = FONT;
      c.border = BORDER;
      if (col === 1) c.numFmt = "mm-dd-yy";
      if (col >= 5 && col <= 7) c.numFmt = ACCOUNTING;
    });
  });
  WIDTHS.forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  sheet.autoFilter = `A1:J${rows.length + 1}`;

  if (review?.length) {
    const sheet2 = workbook.addWorksheet("Review");
    sheet2.addRow(["PRODUCT", "DAY", "PROBLEM", "FIRST READING", "SECOND READING", "SUGGESTED", "STATUS"]);
    for (const line of reviewLines(review)) sheet2.addRow(line);
    sheet2.getRow(1).font = { bold: true };
    [18, 6, 90, 15, 15, 12, 40].forEach((w, i) => (sheet2.getColumn(i + 1).width = w));
    sheet2.eachRow((row, n) => {
      if (n > 1) row.getCell(3).alignment = { wrapText: true, vertical: "top" };
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export { buildFuelWorkbookBuffer };
