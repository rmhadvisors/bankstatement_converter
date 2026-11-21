// npm run check-samples: converts each sample statement and prints PASS/FAIL per file against tests/samples/expected.json.
// Uses whatever reader is configured in .env (so with BANK_AI_FALLBACK=true this also exercises the AI path and spends credit).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { convertPdfToStatement } from "../src/parsers/converter.js";

try { process.loadEnvFile(); } catch {}
const sum = (rows, key) => Math.round(rows.reduce((n, r) => n + (r[key] || 0), 0) * 100) / 100;
let failed = 0;

for (const sample of JSON.parse(readFileSync("tests/samples/expected.json", "utf8")).samples) {
  const path = resolve(sample.file);
  if (!existsSync(path)) { console.log(`SKIP  ${sample.name}  (missing ${sample.file})`); continue; }
  const problems = [];
  try {
    const s = await convertPdfToStatement(path);
    const rows = s.transactions.filter((r) => r.particulars !== "B/F");
    const check = (what, got, want) => want !== undefined && JSON.stringify(got) !== JSON.stringify(want) && problems.push(`${what}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    check("status", s.review?.status, sample.status);
    check("rows", rows.length, sample.rows);
    check("opening", s.reconciliation?.openingBalance, sample.opening);
    check("withdrawal", sum(rows, "withdrawal"), sample.withdrawal);
    check("deposit", sum(rows, "deposit"), sample.deposit);
    check("closing", rows.at(-1)?.balance, sample.closing);
    if (sample.firstBalances) check("first balances", rows.slice(0, sample.firstBalances.length).map((r) => r.balance), sample.firstBalances);
    console.log(`  ${rows.length} rows, ${s.detectedFormat}, ${s.review?.status}${s.aiAssisted ? `, AI ${s.aiAssisted.model}` : ""}`);
  } catch (error) {
    problems.push(`error: ${error.code || error.message}`);
  }
  if (problems.length) failed++;
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${sample.name}${problems.map((p) => `\n        ${p}`).join("")}`);
}
process.exit(failed ? 1 : 0);
