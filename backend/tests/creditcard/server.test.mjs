import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";

import * as cards from "../fixtures/creditcard/synthetic-statements.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendDir = join(__dirname, "..", "..");
const bankPdf = join(backendDir, "tests", "fixtures", "bob-502.pdf");
const uploadDir = join(tmpdir(), "statement-savior-conversions");
const stalePath = join(uploadDir, `stale-${randomUUID()}.pdf`);
const freshPath = join(uploadDir, `fresh-${randomUUID()}.pdf`);
const cardPdfPath = join(tmpdir(), `cc-server-test-${randomUUID()}.pdf`);
// The synthetic HDFC statement, RC4-encrypted with a made-up password (no customer data).
const lockedSyntheticPdf = join(
  backendDir,
  "tests",
  "fixtures",
  "creditcard",
  "synthetic-hdfc-locked.pdf",
);
const lockedIdfcPdf = join(backendDir, "tmp", "IDFC PSW-0201.pdf");
const lockedAxisPdf = join(backendDir, "tmp", "Axis - Credit Card PSW-DEVE4297.pdf");

let server;
let baseUrl;
let preexisting;

describe("credit card + bank HTTP routes", () => {
  before(async () => {
    await mkdir(uploadDir, { recursive: true });
    await writeFile(stalePath, "old");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(stalePath, twoHoursAgo, twoHoursAgo);
    await writeFile(freshPath, "new");
    await cards.writeStatementPdf(cards.hdfc.lines, cardPdfPath);

    server = spawn(process.execPath, ["src/server.js"], {
      cwd: backendDir,
      env: { ...process.env, PORT: "0" },
    });
    baseUrl = await new Promise((resolve, reject) => {
      server.stdout.on("data", (chunk) => {
        const match = String(chunk).match(/listening on http:\/\/0\.0\.0\.0:(\d+)/);
        if (match) resolve(`http://127.0.0.1:${match[1]}`);
      });
      server.once("exit", (code) => reject(new Error(`server exited early (${code})`)));
    });
    // Never the dev server's port: a test server there answers (and then drops) real browser jobs.
    assert.doesNotMatch(baseUrl, /:8080$/);
    preexisting = new Set(await readdir(uploadDir));
  });

  after(async () => {
    server?.kill();
    await Promise.all([freshPath, stalePath, cardPdfPath].map((path) => rm(path, { force: true })));
  });

  async function upload(route, filePath, fileName, password) {
    const form = new FormData();
    if (password !== undefined) form.append("password", password);
    form.append(
      "statement",
      new Blob([await readFile(filePath)], { type: "application/pdf" }),
      fileName,
    );
    return fetch(`${baseUrl}${route}`, { method: "POST", body: form });
  }

  async function waitForJob(route, jobId) {
    for (;;) {
      const response = await fetch(`${baseUrl}${route}/${jobId}`);
      if (response.status !== 202) return response;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  test("server: stale uploads (>1h) are swept at startup, fresh ones are kept", async () => {
    const names = await readdir(uploadDir);
    assert.ok(!names.includes(stalePath.split(/[\\/]/).pop()), "stale upload removed");
    assert.ok(names.includes(freshPath.split(/[\\/]/).pop()), "fresh upload kept");
  });

  test("server: bank /api/convert still converts end to end, and its job is not visible to the card route", async () => {
    const submit = await upload("/api/convert", bankPdf, "bob-502.pdf");
    assert.equal(submit.status, 202);
    const { jobId } = await submit.json();

    assert.equal((await fetch(`${baseUrl}/api/credit-card/convert/${jobId}`)).status, 404);

    const response = await waitForJob("/api/convert", jobId);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-transaction-count"), "415");
    assert.match(response.headers.get("content-type"), /spreadsheetml/);
    assert.ok((await response.arrayBuffer()).byteLength > 0);

    // Unlike card jobs, bank jobs stay downloadable until their TTL (unchanged behaviour).
    assert.equal((await fetch(`${baseUrl}/api/convert/${jobId}`)).status, 200);
  });

  test("server: card job downloads once, reports reconciliation, then is gone", async () => {
    const submit = await upload("/api/credit-card/convert", cardPdfPath, "hdfc-card.pdf");
    assert.equal(submit.status, 202);
    const { jobId } = await submit.json();

    assert.equal(
      (await fetch(`${baseUrl}/api/convert/${jobId}`)).status,
      404,
      "card job is not on the bank route",
    );

    const response = await waitForJob("/api/credit-card/convert", jobId);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-transaction-count"), String(cards.hdfc.expected.count));
    assert.equal(response.headers.get("x-reconciliation-status"), "OK");
    assert.match(response.headers.get("content-disposition"), /hdfc-card\.xlsx/);
    await response.arrayBuffer();

    const again = await fetch(`${baseUrl}/api/credit-card/convert/${jobId}`);
    assert.equal(again.status, 404);
    assert.equal((await again.json()).code, "JOB_NOT_FOUND");
  });

  test("server: card endpoint errors are { error, code } JSON", async () => {
    const submit = await upload("/api/credit-card/convert", bankPdf, "bank.pdf");
    const { jobId } = await submit.json();
    const response = await waitForJob("/api/credit-card/convert", jobId);
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.code, "NOT_A_CREDIT_CARD_STATEMENT");
    assert.match(body.error, /bank account statement/);

    const empty = await fetch(`${baseUrl}/api/credit-card/convert`, {
      method: "POST",
      body: new FormData(),
    });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).code, "FILE_REQUIRED");
  });

  // Correct password -> workbook; wrong -> WRONG_PASSWORD; none -> PASSWORD_REQUIRED (never a 500).
  async function assertPasswordFlow(filePath, password, expectedCount) {
    const run = async (attempt) => {
      const submit = await upload("/api/credit-card/convert", filePath, "locked.pdf", attempt);
      return waitForJob("/api/credit-card/convert", (await submit.json()).jobId);
    };

    const ok = await run(password);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("x-transaction-count"), String(expectedCount));
    assert.equal(ok.headers.get("x-reconciliation-status"), "OK");
    await ok.arrayBuffer();

    for (const [attempt, code] of [
      ["not-the-password", "WRONG_PASSWORD"],
      ["", "PASSWORD_REQUIRED"],
    ]) {
      const response = await run(attempt);
      assert.equal(response.status, 400, code);
      assert.equal((await response.json()).code, code);
    }
  }

  test("server: password-protected card statement (synthetic fixture)", () =>
    assertPasswordFlow(lockedSyntheticPdf, "AKAS1203", cards.hdfc.expected.count));

  // The real IDFC statement is customer data, so it lives only in the gitignored backend/tmp/ and
  // its password comes from the environment (e.g. backend/.env, also gitignored).
  test(
    "server: original password-protected IDFC FIRST statement",
    {
      skip:
        !(existsSync(lockedIdfcPdf) && process.env.IDFC_TEST_PDF_PASSWORD) &&
        "needs backend/tmp/IDFC PSW-0201.pdf and IDFC_TEST_PDF_PASSWORD",
    },
    () => assertPasswordFlow(lockedIdfcPdf, process.env.IDFC_TEST_PDF_PASSWORD, 7),
  );

  test(
    "server: original password-protected Axis SELECT statement",
    {
      skip:
        !(existsSync(lockedAxisPdf) && process.env.AXIS_TEST_PDF_PASSWORD) &&
        "needs backend/tmp/Axis - Credit Card PSW-DEVE4297.pdf and AXIS_TEST_PDF_PASSWORD",
    },
    () => assertPasswordFlow(lockedAxisPdf, process.env.AXIS_TEST_PDF_PASSWORD, 34),
  );

  test("server: finished jobs leave no upload or OCR cache behind", async () => {
    // Only files written during this run count: a dev server killed mid-job elsewhere can leave
    // its own (< 1h old, so not yet swept) uploads in the shared temp dir.
    const leftovers = (await readdir(uploadDir)).filter((name) => !preexisting.has(name));
    assert.deepEqual(leftovers, []);
  });
});
