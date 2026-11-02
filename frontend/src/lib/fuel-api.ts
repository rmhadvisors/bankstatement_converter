// Fuel sales register API (backend/src/invoice/fuelService.js) and the per-user item/ledger mapping.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export type Col = "salesByMeter" | "pumpTest" | "netSales" | "cumulative";
export const COLS: { key: Col; label: string }[] = [
  { key: "salesByMeter", label: "Meter sales" },
  { key: "pumpTest", label: "Pump test" },
  { key: "netSales", label: "Net sales" },
  { key: "cumulative", label: "Cumulative" },
];

// One register row as the review screen holds it: the first reading's values, `alt` = what the second
// reading says where it differs, `edited` = cells the reviewer typed over.
export type ReadRow = Record<Col, number | null> & {
  day: number;
  unreadable?: Col[];
  alt?: Partial<Record<Col, number | null>>;
  edited?: Col[];
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReadPage = Record<string, any> & {
  page: number;
  kind: "register" | "rates" | "other";
  rows?: ReadRow[];
};
export type Reading = { pages: ReadPage[] };

export type Flag = {
  id: string;
  kind: string;
  product: string | null;
  day: number | null;
  col: Col | null;
  rateKey: string | null;
  reason: string;
  values: { first: number | null; second: number | null } | null;
  suggestion: { col: Col; day: number; value: number; reason: string } | null;
  registerError: boolean;
  accepted: string | null;
};
export type TableRow = Record<Col, number | null> & {
  day: number;
  rate: number | null;
  amount: number | null;
  alt?: Partial<Record<Col, number | null>>;
  cells: Partial<Record<Col, string[]>>;
};
export type Built = {
  period: {
    month: number;
    year: number;
    label: string;
    sheetName: string;
    financialYear: string | null;
  };
  rows: { date: string; item: string; qty: number; rate: number | null; amt: number | null }[];
  tables: { item: string; register: string; page: number; rateKey: string; rows: TableRow[] }[];
  rates: Record<string, { read?: number; alt?: number | null; value: number; edited?: boolean }>;
  flags: Flag[];
  ignoredPages: { page: number; description: string }[];
  unresolved: number;
  status: "OK" | "NEEDS REVIEW";
  entryType: string;
  mapping: MappingRow[];
};
export type MappingRow = { register: string; nth: number; item: string; ledger: string };
export type BuildParams = {
  reading: Reading;
  financialYear: string;
  narrationDate: string;
  month?: number;
  ratesOverride: Record<string, number>;
  mapping: MappingRow[];
  accepted: { id: string; note: string }[];
};

async function jsonOrThrow<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok && response.status !== 202)
    throw new Error(body?.message || `Request failed (${response.status})`);
  return body as T;
}

const post = (path: string, body: unknown) =>
  fetch(`${API_BASE_URL}/api/fuel-register/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export async function getFuelConfig(): Promise<{
  party: string;
  entryType: string;
  mapping: MappingRow[];
  configured: boolean;
}> {
  return jsonOrThrow(await fetch(`${API_BASE_URL}/api/fuel-register/config`));
}

export const pageImageUrl = (jobId: string, page: number) =>
  `${API_BASE_URL}/api/fuel-register/convert/${jobId}/page/${page}`;

// Uploads the PDF, then polls until both readings of every page are done.
export async function convertFuelRegister(file: File): Promise<{
  jobId: string;
  reading: Reading;
  pageCount: number;
  calls: { first: number; second: number; total: number };
}> {
  const form = new FormData();
  form.append("file", file, file.name);
  const { jobId } = await jsonOrThrow<{ jobId: string }>(
    await fetch(`${API_BASE_URL}/api/fuel-register/convert`, { method: "POST", body: form }),
  );
  for (;;) {
    const body = await jsonOrThrow<{
      status: string;
      error?: { message: string };
      reading?: Reading;
      pageCount?: number;
      calls?: { first: number; second: number; total: number };
    }>(await fetch(`${API_BASE_URL}/api/fuel-register/convert/${jobId}`));
    if (body.status === "error")
      throw new Error(body.error?.message ?? "Could not read the register.");
    if (body.status === "done")
      return { jobId, reading: body.reading!, pageCount: body.pageCount!, calls: body.calls! };
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

export async function buildFuelRegister(params: BuildParams): Promise<Built> {
  return jsonOrThrow(await post("build", params));
}

export async function exportFuelRegister(
  params: BuildParams,
  exportAnyway: boolean,
): Promise<void> {
  const response = await post("export", { ...params, exportAnyway });
  if (!response.ok) await jsonOrThrow(response);
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download:
      /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ??
      "Fuel_Register.xlsx",
  });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Item/ledger names per user, kept in this browser (the party settings table has no column for them).
const mappingKey = (userId: string) => `fuel-register:mapping:${userId}`;
export function readMapping(userId: string, defaults: MappingRow[]): MappingRow[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(mappingKey(userId)) ?? "null") as
      | MappingRow[]
      | null;
    return defaults.map(
      (row) => saved?.find((s) => s.register === row.register && s.nth === row.nth) ?? row,
    );
  } catch {
    return defaults;
  }
}
export function writeMapping(userId: string, mapping: MappingRow[]) {
  try {
    window.localStorage.setItem(mappingKey(userId), JSON.stringify(mapping));
  } catch {
    // Storage blocked: the names last for this page view only.
  }
}
