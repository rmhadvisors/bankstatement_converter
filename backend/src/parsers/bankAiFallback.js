// Last-resort bank statement reader: Gemini reads the page images when the normal parsers fail, find no
// rows, or leave the result at needs_review. Off unless BANK_AI_FALLBACK=true and GEMINI_BILLING_CONFIRMED=true.
// The AI result goes through the same checks as a parsed one (balance chain, page totals, opening + credits -
// debits = closing, printed totals). Only pages that fail are re-read, once; a result that still does not
// reconcile stays needs_review. No number is ever changed to make a check pass.
import { readFile } from "node:fs/promises";
import { estimateCostInr, geminiProvider, usageLine } from "../invoice/gemini.js";
import { renderPdfPages } from "../invoice/images.js";
import { roundMoney } from "./parsers/common.js";
import { buildValidationReport, reviewStatus } from "./validation.js";

const PAGES_PER_CALL = 4;
const PAGE_LONG_SIDE = 3000;
const TOLERANCE = 0.05;

const aiFallbackEnabled = (env = process.env) =>
  env.BANK_AI_FALLBACK === "true" && env.GEMINI_BILLING_CONFIRMED === "true" && Boolean(env.GEMINI_API_KEY);
const aiMaxPages = (env = process.env) => Number(env.BANK_AI_MAX_PAGES) || 60;

const num = { type: "number", nullable: true };
const str = { type: "string", nullable: true };
const READ_SCHEMA = {
  type: "object",
  properties: {
    bank: str, accountName: str, accountNumber: str, ifsc: str, period: str,
    openingBalance: num,
    printed: { type: "object", nullable: true, properties: { openingBalance: num, closingBalance: num, withdrawal: num, deposit: num } },
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "integer" },
          pageTotals: { type: "object", nullable: true, properties: { withdrawal: num, deposit: num } },
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: { date: { type: "string" }, description: { type: "string" }, chequeNo: str, withdrawal: num, deposit: num, balance: num },
              required: ["date", "description"],
            },
          },
        },
        required: ["page", "rows"],
      },
    },
  },
  required: ["pages"],
};

const SYSTEM = `You transcribe bank statement page images into JSON. Copy every number exactly as printed; never calculate, round, infer or correct a number. Use null for anything not printed.
- One entry per page, with that page's transaction rows in printed order. Skip headers, footers, page notes and legends; skip the opening-balance line (B/F, brought forward) but report it as openingBalance (on the first page only). Skip every "Brought Forward", "Carried Forward", "Carried Over" and "Balance C/F" line on later pages: they repeat the running balance and are not transactions.
- Photos of passbooks may be tilted, rotated, shadowed or show two half-pages: read the rows in printed order, one entry per printed page, and ignore anything outside the table.
- date: YYYY-MM-DD. description: the full narration, including wrapped lines. chequeNo: the cheque/reference number column if there is one.
- withdrawal and deposit: decide by the column the amount is printed in (or the Dr/Cr marker), never by how the balance moved. Plain positive numbers.
- balance: the running balance after the row. A balance printed Dr (overdrawn) is negative; Cr or unmarked is positive.
- pageTotals: the totals printed at the end of a page ("Page Total"), else null. printed: the statement's own opening balance, closing balance and grand total of withdrawals and deposits, only where printed, else null.
- Report every row on every page; never merge or skip rows.`;

function aiError(code, message) {
  return Object.assign(new Error(message), { code });
}

// One Gemini call over a few page images. `pageNumbers` are the real page numbers of `images`.
async function readPages(provider, images, pageNumbers, usages) {
  const content = [{ type: "text", text: `Transcribe these statement pages (page numbers: ${pageNumbers.join(", ")}).` }];
  images.forEach((image, index) => {
    content.push({ type: "text", text: `Page ${pageNumbers[index]}:` });
    content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: Buffer.from(image.data).toString("base64") } });
  });
  const { text, usage } = await provider.complete({ system: SYSTEM, messages: [{ role: "user", content }], responseSchema: READ_SCHEMA });
  usages.push(usage);
  let reply;
  try {
    reply = JSON.parse(text);
  } catch {
    throw aiError("BANK_AI_BAD_JSON", "The AI reader returned an unreadable answer.");
  }
  // Trust the page number only when it is one we sent; otherwise take the model's pages in order.
  const pages = (reply.pages || []).map((page, index) => ({ ...page, page: pageNumbers.includes(page.page) ? page.page : pageNumbers[index] }));
  return { reply, pages };
}

const money = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : roundMoney(Number(value)));

function toRow(row, page) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(row.date || "") ? new Date(`${row.date}T00:00:00.000Z`) : null;
  return {
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    particulars: String(row.description || "").replace(/\s+/g, " ").trim() || "TRANSACTION",
    chequeNo: row.chequeNo || null,
    withdrawal: money(row.withdrawal),
    deposit: money(row.deposit),
    balance: money(row.balance),
    aiPage: page,
  };
}

// Pages that fail their own check: a printed page total that the page's rows do not add up to, or a row whose
// balance does not follow from the previous row's (the previous row's page too when the break is at a page start).
function failingPages(rows, pageTotals) {
  const failed = new Set();
  const sums = new Map();
  for (const row of rows) {
    const sum = sums.get(row.aiPage) || { withdrawal: 0, deposit: 0 };
    sum.withdrawal += row.withdrawal || 0;
    sum.deposit += row.deposit || 0;
    sums.set(row.aiPage, sum);
  }
  for (const [page, totals] of pageTotals) {
    const sum = sums.get(page) || { withdrawal: 0, deposit: 0 };
    for (const key of ["withdrawal", "deposit"]) {
      if (totals[key] !== null && Math.abs(roundMoney(sum[key]) - totals[key]) > TOLERANCE) failed.add(page);
    }
  }
  const dated = rows.filter((row) => row.date);
  const newestFirst = dated.length > 1 && dated[0].date > dated.at(-1).date;
  rows.forEach((row, index) => {
    const older = rows[newestFirst ? index + 1 : index - 1];
    if (!older || older.balance === null || row.balance === null) return;
    const expected = roundMoney(older.balance - (row.withdrawal || 0) + (row.deposit || 0));
    if (Math.abs(expected - row.balance) > TOLERANCE) {
      failed.add(row.aiPage);
      if (older.aiPage !== row.aiPage) failed.add(older.aiPage);
    }
  });
  return failed;
}

function buildStatement(pageResults, meta, usages, model) {
  const ordered = [...pageResults.keys()].sort((a, b) => a - b);
  const transactions = ordered.flatMap((page) => pageResults.get(page).rows.map((row) => toRow(row, page)));
  const pageTotals = new Map(
    ordered.filter((page) => pageResults.get(page).pageTotals).map((page) => [page, { withdrawal: money(pageResults.get(page).pageTotals.withdrawal), deposit: money(pageResults.get(page).pageTotals.deposit) }]),
  );
  const failed = failingPages(transactions, pageTotals);
  for (const page of ordered) if (pageResults.get(page).missing) failed.add(page);
  const printed = meta.printed || {};
  const printedTotals = {
    source: "printed",
    withdrawal: money(printed.withdrawal),
    deposit: money(printed.deposit),
    closingBalance: money(printed.closingBalance),
    openingBalance: money(printed.openingBalance ?? meta.openingBalance),
  };
  const accountInfo = [["Bank", meta.bank], ["Account Name", meta.accountName], ["Account Number", meta.accountNumber], ["IFSC Code", meta.ifsc], ["Statement Period", meta.period]]
    .filter(([, value]) => value)
    .map(([label, value]) => ({ label, value }));
  const statement = {
    accountInfo,
    transactions,
    printedTotals,
    totals: {
      source: "calculated",
      withdrawal: roundMoney(transactions.reduce((sum, row) => sum + (row.withdrawal || 0), 0)),
      deposit: roundMoney(transactions.reduce((sum, row) => sum + (row.deposit || 0), 0)),
      closingBalance: transactions.findLast((row) => row.balance !== null)?.balance ?? null,
    },
    pageCount: ordered.length,
    detectedFormat: "ai-gemini",
    ocrSourced: false,
    parsingErrors: [],
    reviewRows: [],
    logs: [],
    aiAssisted: { model, pages: ordered.length, calls: usages.length, costInr: usages.some((u) => estimateCostInr(u) === null) ? null : roundMoney(usages.reduce((sum, u) => sum + estimateCostInr(u), 0)) },
  };
  statement.reconciliation = buildValidationReport(statement, []);
  statement.review = reviewStatus(statement);

  // Checks the shared validation does not make, so an AI read can never reach "ok" without one real check.
  const reasons = statement.review.reasons;
  const chainRows = transactions.filter((row) => row.balance !== null).length;
  if (statement.reconciliation.closingDifference === null && chainRows < 2) reasons.push("Nothing in the statement could verify the AI-read rows (no balances or printed totals).");
  if (failed.size) reasons.push(`Page total or running balance does not match on page(s) ${[...failed].sort((a, b) => a - b).join(", ")}.`);
  const undated = transactions.filter((row) => !row.date).length;
  if (undated) reasons.push(`${undated} row(s) have no readable date.`);
  statement.review.status = reasons.length ? "needs_review" : "ok";
  statement.review.aiAssisted = true;
  return { statement, failed };
}

function chunk(list, size) {
  const out = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

// -> an Excel-ready statement ({ ..., aiAssisted, review }) or null when the AI read nothing usable.
// provider / render are injectable so tests run on saved answers with no network.
async function readStatementWithAi(filePath, { provider = geminiProvider(), render = renderPdfPages, maxPages = aiMaxPages(), logs = [] } = {}) {
  const images = await render(await readFile(filePath), 0, PAGE_LONG_SIDE, maxPages);
  const usages = [];
  const pageResults = new Map();
  const meta = {};

  const read = async (pageNumbers) => {
    for (const group of chunk(pageNumbers, PAGES_PER_CALL)) {
      const { reply, pages } = await readPages(provider, group.map((page) => images[page - 1]), group, usages);
      for (const key of ["bank", "accountName", "accountNumber", "ifsc", "period", "openingBalance"]) if (meta[key] == null && reply[key] != null) meta[key] = reply[key];
      meta.printed = { ...meta.printed, ...Object.fromEntries(Object.entries(reply.printed || {}).filter(([, value]) => value !== null && value !== undefined)) };
      for (const page of pages) pageResults.set(page.page, { rows: page.rows || [], pageTotals: page.pageTotals || null });
      // A page the model skipped is a failing page (re-read once), never silently dropped.
      for (const page of group) if (!pages.some((p) => p.page === page)) pageResults.set(page, { rows: [], pageTotals: null, missing: true });
    }
  };

  let outcome;
  try {
    await read(images.map((_, index) => index + 1));
    outcome = buildStatement(pageResults, meta, usages, provider.name);
    if (outcome.failed.size) {
      // One re-read of just the failing pages; kept only if it leaves no more failing pages than before.
      // Rows are replaced wholesale, never edited.
      const before = new Map(pageResults);
      const failedBefore = outcome.failed.size;
      await read([...outcome.failed]);
      outcome = buildStatement(pageResults, meta, usages, provider.name);
      if (outcome.failed.size > failedBefore) {
        pageResults.clear();
        for (const [page, value] of before) pageResults.set(page, value);
        outcome = buildStatement(pageResults, meta, usages, provider.name);
      }
    }
  } finally {
    // Counts and money only, never statement contents.
    if (usages.length) {
      const line = usageLine(`AI-assisted bank statement read (${images.length} page(s))`, usages);
      console.log(`[bank-ai-fallback] ${line}`);
      logs.push({ level: "info", stage: "ai", message: line });
    }
  }

  const { statement } = outcome;
  if (statement.transactions.length === 0) return null;
  statement.logs.push({ level: "info", stage: "ai", message: `AI-assisted: ${statement.aiAssisted.pages} page(s), ${statement.aiAssisted.calls} call(s).` });
  return statement;
}

export { aiFallbackEnabled, aiMaxPages, readStatementWithAi };
