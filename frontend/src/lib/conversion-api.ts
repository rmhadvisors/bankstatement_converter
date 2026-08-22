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

export async function convertPdfViaApi(
  file: File,
  password = "",
  scanned = false,
): Promise<ApiConvertResult> {
  const form = new FormData();
  form.append("statement", file, file.name);
  form.append("scanned", String(scanned));
  form.append("password", password);

  const response = await fetch("/api/convert", {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
      error?: string;
      code?: string;
      pagesScanned?: number;
      totalPages?: number;
      emptyPages?: number;
    } | null;
    const code = payload?.code || payload?.error;
    const message = payload?.message || payload?.error || "Conversion failed";

    if (code && VALIDATION_ERROR_CODES.has(code)) {
      throw new ConversionValidationError(code, message, {
        pagesScanned: payload?.pagesScanned,
        totalPages: payload?.totalPages,
        emptyPages: payload?.emptyPages,
      });
    }

    throw new Error(message);
  }

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
  };
}
