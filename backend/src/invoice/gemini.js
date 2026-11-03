// Google Gemini (generateContent, REST, plain fetch) as an invoice reader. Same complete() shape as
// the Claude provider, so extract.js runs the same prompt, schema check + retry, rules and checks.
// Gemini's structured output (responseSchema) is generated from INVOICE_SCHEMA. Nothing here logs
// invoice contents. API: https://ai.google.dev/api/generate-content
import { INVOICE_SCHEMA } from "./schema.js";

const DEFAULT_MODEL = "gemini-3.8-flash";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = Number(process.env.INVOICE_LLM_TIMEOUT_MS) || 180_000;
const MAX_HTTP_RETRIES = 3;
// Gemini's 429 body says how long to wait ("retryDelay": "12s").
const retryDelayMs = (reply) => (parseFloat(reply?.error?.details?.find((d) => d.retryDelay)?.retryDelay) || 0) * 1000;

const geminiError = (code, message) => Object.assign(new Error(message), { code });

// ---- usage and cost ----
// Paid-tier USD per 1M tokens (input incl. images, output incl. thinking), ai.google.dev pricing page,
// 03/11/2026; 3.8 Flash and 3.6 Flash double on 01/01/2027. GEMINI_PRICE_INPUT_PER_M and
// GEMINI_PRICE_OUTPUT_PER_M (USD) override the table for every model; USD_INR converts (default 88).
const PRICES = {
  "gemini-2.5-flash-lite": [0.1, 0.4],
  "gemini-2.5-flash": [0.3, 2.5],
  "gemini-3.1-flash-lite": [0.25, 1.5],
  "gemini-3.5-flash-lite": [0.3, 2.5],
  "gemini-3.6-flash": [0.75, 3.75],
  "gemini-3.8-flash": [0.75, 3.75],
};
const DEFAULT_USD_INR = 88;

// usage: { model, requestedModel?, inputTokens, outputTokens } -> rupees, or null when the price is unknown.
// useEnv: false ignores the GEMINI_PRICE_* override (the benchmark compares several models).
function estimateCostInr(usage, { useEnv = true } = {}) {
  const [inEnv, outEnv] = [process.env.GEMINI_PRICE_INPUT_PER_M, process.env.GEMINI_PRICE_OUTPUT_PER_M].map(Number);
  const [inPrice, outPrice] = useEnv && inEnv >= 0 && outEnv >= 0 && process.env.GEMINI_PRICE_INPUT_PER_M && process.env.GEMINI_PRICE_OUTPUT_PER_M ? [inEnv, outEnv] : PRICES[usage.requestedModel ?? usage.model] ?? [];
  if (!(inPrice >= 0 && outPrice >= 0)) return null;
  return ((usage.inputTokens * inPrice + usage.outputTokens * outPrice) / 1e6) * (Number(process.env.USD_INR) || DEFAULT_USD_INR);
}

// One log line per call, and per run (a list of usages). Counts and money only, never contents.
const rupees = (n) => (n === null ? "price unknown" : `Rs ${n.toFixed(2)}`);
function usageLine(label, usages, options) {
  const costs = usages.map((u) => estimateCostInr(u, options));
  const total = costs.some((c) => c === null) ? null : costs.reduce((a, b) => a + b, 0);
  const tokens = usages.reduce((a, u) => [a[0] + u.inputTokens, a[1] + u.outputTokens], [0, 0]);
  return `${label}: ${[...new Set(usages.map((u) => u.requestedModel ?? u.model))].join(", ")}, ${usages.length} call(s), ${tokens[0]} in + ${tokens[1]} out tokens, ${rupees(total)}`;
}
const logUsage = (label, usages) => process.env.GEMINI_USAGE_LOG !== "off" && usages.length && console.log(usageLine(label, usages));

// InvoiceJSON schema -> Gemini responseSchema (OpenAPI subset). The free-form confidence map can't be
// expressed there, so Gemini returns it as a list of { field, level }, turned back into the map below.
function toGeminiSchema(schema) {
  if (typeof schema === "string") return { type: schema.split("|").includes("string") ? "string" : schema.split("|")[0], nullable: true };
  if (schema.oneOf) return { type: "string", enum: schema.oneOf, nullable: true };
  if (Array.isArray(schema)) return { type: "array", items: toGeminiSchema(schema[0]) };
  if (schema["*"]) return { type: "array", items: { type: "object", properties: { field: { type: "string" }, level: { type: "string", enum: ["medium", "low"] } }, required: ["field", "level"] } };
  const entries = Object.entries(schema).filter(([key]) => !["derived", "useComputedTotals", "crossCheck"].includes(key));
  return { type: "object", properties: Object.fromEntries(entries.map(([key, value]) => [key, toGeminiSchema(value)])), propertyOrdering: entries.map(([key]) => key) };
}
const GEMINI_SCHEMA = toGeminiSchema(INVOICE_SCHEMA);
const CONFIDENCE_NOTE = '\n\nIn this API, "confidence" is a list: [{"field": "<field path>", "level": "medium" | "low"}].';

// Gemini's reply -> the InvoiceJSON text the shared checks expect (confidence list -> map).
function toInvoiceText(text) {
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value?.confidence)) value.confidence = Object.fromEntries(value.confidence.filter((c) => c?.field).map((c) => [c.field, c.level]));
    return JSON.stringify(value);
  } catch {
    return text; // left for the shared JSON check (and its one retry)
  }
}

// Claude-style message blocks -> Gemini parts.
const toParts = (content) =>
  (typeof content === "string" ? [{ type: "text", text: content }] : content).map((block) =>
    block.type === "image" ? { inlineData: { mimeType: block.source.media_type, data: block.source.data } } : { text: block.text },
  );

function geminiProvider({ apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || DEFAULT_MODEL, fetchImpl = fetch } = {}) {
  return {
    name: `gemini:${model}`,
    // signal: the per-file deadline from extract.js (covers retries); else one call's timeout.
    // responseSchema: another document type's Gemini schema (fuelRegister.js); default is the invoice one.
    async complete({ system, messages, signal = AbortSignal.timeout(TIMEOUT_MS), responseSchema = GEMINI_SCHEMA }) {
      const timedOut = () => geminiError("INVOICE_LLM_TIMEOUT", `Gemini did not finish within ${Math.round(TIMEOUT_MS / 1000)} s.`);
      if (!apiKey) throw geminiError("GEMINI_KEY_MISSING", "Gemini is not configured (GEMINI_API_KEY is not set).");
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: responseSchema === GEMINI_SCHEMA ? system + CONFIDENCE_NOTE : system }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: toParts(m.content) })),
        generationConfig: { responseMimeType: "application/json", responseSchema, maxOutputTokens: 32_768 },
      });
      for (let attempt = 0; ; attempt++) {
        let response;
        try {
          response = await fetchImpl(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
            body,
            signal,
          });
        } catch (error) {
          if (signal.aborted) throw timedOut();
          if (attempt < MAX_HTTP_RETRIES) continue;
          throw geminiError("INVOICE_LLM_UNREACHABLE", "Could not reach Gemini.");
        }
        const reply = await response.json().catch(() => null);
        // Rate limit / overload: wait as told (or back off) and retry, within the file's deadline.
        if ((response.status === 429 || response.status >= 500) && attempt < MAX_HTTP_RETRIES) {
          const wait = Math.min(retryDelayMs(reply) || Number(response.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt, 60_000);
          await new Promise((resolve) => setTimeout(resolve, wait));
          if (signal.aborted) throw timedOut();
          continue;
        }
        // status: lets callers tell a rate limit or spending cap (429) from other failures.
        if (!response.ok) throw Object.assign(geminiError("INVOICE_LLM_FAILED", `Gemini error ${response.status}: ${reply?.error?.message ?? response.statusText}`), { status: response.status });
        const candidate = reply?.candidates?.[0];
        if (!candidate || reply.promptFeedback?.blockReason || ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(candidate.finishReason)) {
          throw geminiError("INVOICE_LLM_REFUSED", "Gemini declined to read this file.");
        }
        if (candidate.finishReason === "MAX_TOKENS") throw geminiError("INVOICE_LLM_TRUNCATED", "Gemini's answer was cut off (invoice too long).");
        const usage = reply.usageMetadata ?? {};
        // Thinking tokens are billed as output.
        const used = { model: reply.modelVersion ?? model, requestedModel: model, inputTokens: usage.promptTokenCount ?? 0, outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) };
        logUsage("Gemini call", [used]);
        return { text: toInvoiceText((candidate.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("")), usage: used };
      }
    },
  };
}

export { GEMINI_SCHEMA, PRICES, estimateCostInr, geminiProvider, logUsage, toGeminiSchema, usageLine };
