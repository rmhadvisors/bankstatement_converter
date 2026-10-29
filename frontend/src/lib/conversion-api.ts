// Empty by default: same-origin "/api/convert" works for local dev (via the Vite proxy) and any
// combined single-origin deploy. Set VITE_API_BASE_URL when the frontend and backend are deployed
// separately (e.g. Vercel + Hostinger) so requests reach the backend's own domain.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export type ApiConvertResult = {
  rowsCount: number;
  fileName: string;
  blob: Blob;
};

// Codes the /api/convert route returns for a pre-flight validation rejection (see
// pdfPreflight.js / server.ts) -- the file was inspected and found to have nothing convertible,
// which is an expected outcome to show cleanly in the UI, not a crash to log to the console.
const VALIDATION_ERROR_CODES = new Set(["PDF_NO_READABLE_CONTENT", "PDF_PREFLIGHT_OPEN_TOO_SLOW"]);

export class ConversionValidationError extends Error {
  code: string;
  pagesScanned?: number;
  totalPages?: number;
  emptyPages?: number;

  constructor(
    code: string,
    message: string,
    details?: { pagesScanned?: number; totalPages?: number; emptyPages?: number },
  ) {
    super(message);
    this.name = "ConversionValidationError";
    this.code = code;
    this.pagesScanned = details?.pagesScanned;
    this.totalPages = details?.totalPages;
    this.emptyPages = details?.emptyPages;
  }
}

function getDownloadFileName(response: Response, originalName: string) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const quoted = disposition.match(/filename="([^"]+)"/i);
  const bare = disposition.match(/filename=([^;]+)/i);
  const fromHeader = quoted?.[1] || bare?.[1]?.trim();

  if (fromHeader) return fromHeader;
  return `${originalName.replace(/\.[^.]+$/, "") || "statement"}.xlsx`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function throwConversionError(response: Response): Promise<never> {
  const payload = (await response.json().catch(() => null)) as {
    message?: string;
    error?: string;
    code?: string;
    pagesScanned?: number;
    totalPages?: number;
    emptyPages?: number;
  } | null;
  const code = payload?.code || payload?.error;
  // No JSON body means the backend never answered (crashed, restarted, or a proxy/CORS error
  // page) -- say so with the status instead of a bare "Conversion failed".
  const message =
    payload?.message ||
    payload?.error ||
    `Conversion failed (HTTP ${response.status}${response.status >= 500 ? ": the server stopped responding or crashed, please retry" : ""})`;

  if (code && VALIDATION_ERROR_CODES.has(code)) {
    throw new ConversionValidationError(code, message, {
      pagesScanned: payload?.pagesScanned,
      totalPages: payload?.totalPages,
      emptyPages: payload?.emptyPages,
    });
  }

  // code lets callers react to specific failures (e.g. PASSWORD_REQUIRED) without parsing text.
  throw Object.assign(new Error(message), { code });
}

const POLL_INTERVAL_MS = 3000;
// A long OCR job is polled for as long as it runs; only this many consecutive failed polls
// (network blip, backend restart) give up.
const MAX_POLL_FAILURES = 10;

export type ConversionProgress = { status: string; page?: number; totalPages?: number };

// Conversion (OCR especially, on a large scanned PDF) can take minutes -- far longer than any
// reverse proxy will hold a single request open. The backend runs it as a background job: this
// submits the file, then polls for the result instead of waiting on one long request (which was
// coming back as a bare 502 once the proxy gave up).
async function submitAndPoll(
  route: string,
  form: FormData,
  onProgress?: (progress: ConversionProgress) => void,
): Promise<Response> {
  const submitResponse = await fetch(`${API_BASE_URL}${route}`, {
    method: "POST",
    body: form,
  });

  if (!submitResponse.ok) {
    await throwConversionError(submitResponse);
  }

  const { jobId } = (await submitResponse.json()) as { jobId: string };

  let response: Response;
  let failures = 0;
  for (;;) {
    try {
      response = await fetch(`${API_BASE_URL}${route}/${jobId}`);
      failures = 0;
    } catch (error) {
      if ((failures += 1) >= MAX_POLL_FAILURES) throw error;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }
    if (response.status !== 202) break;
    const progress = (await response.json().catch(() => null)) as ConversionProgress | null;
    if (progress) onProgress?.(progress);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  if (!response.ok) {
    await throwConversionError(response);
  }
  return response;
}

export async function convertPdfViaApi(
  file: File,
  password = "",
  scanned = false,
  onProgress?: (progress: ConversionProgress) => void,
): Promise<BankConvertResult> {
  const form = new FormData();
  form.append("statement", file, file.name);
  form.append("scanned", String(scanned));
  form.append("password", password);

  const response = await submitAndPoll("/api/convert", form, onProgress);
  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error("Conversion returned an empty Excel file");
  }

  const fileName = getDownloadFileName(response, file.name);
  downloadBlob(blob, fileName);

  return {
    rowsCount: Number(response.headers.get("x-transaction-count") || 0),
    fileName,
    blob,
    ...readReviewHeaders(response),
  };
}

// "needs_review": the file converted but doesn't reconcile (balance chain or printed totals).
export type BankConvertResult = ApiConvertResult & {
  reviewStatus: "ok" | "needs_review";
  reviewReasons: string[];
};

function readReviewHeaders(response: Response): Pick<BankConvertResult, "reviewStatus" | "reviewReasons"> {
  let reviewReasons: string[] = [];
  try {
    reviewReasons = JSON.parse(decodeURIComponent(response.headers.get("x-review-reasons") || "%5B%5D"));
  } catch {
    reviewReasons = [];
  }
  const reviewStatus = response.headers.get("x-conversion-status") === "needs_review" ? "needs_review" : "ok";
  return { reviewStatus, reviewReasons };
}

export type ReconciliationStatus = "OK" | "MISMATCH" | "UNVERIFIED";

export type CreditCardConvertResult = ApiConvertResult & {
  reconciliationStatus: ReconciliationStatus;
  reconciliationWarning: string;
};

// Errors carry the backend's code (PASSWORD_REQUIRED, WRONG_PASSWORD, NOT_A_CREDIT_CARD_STATEMENT, ...)
// on error.code and its message on error.message.
export async function convertCreditCardViaApi(
  file: File,
  password = "",
): Promise<CreditCardConvertResult> {
  const form = new FormData();
  form.append("statement", file, file.name);
  form.append("password", password);

  const response = await submitAndPoll("/api/credit-card/convert", form);
  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error("Conversion returned an empty Excel file");
  }

  const fileName = getDownloadFileName(response, file.name);
  downloadBlob(blob, fileName);

  return {
    rowsCount: Number(response.headers.get("x-transaction-count") || 0),
    fileName,
    blob,
    reconciliationStatus: (response.headers.get("x-reconciliation-status") || "UNVERIFIED") as ReconciliationStatus,
    reconciliationWarning: decodeURIComponent(response.headers.get("x-reconciliation-warning") || ""),
  };
}
