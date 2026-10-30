// Google Gemini (generateContent, REST, plain fetch) as an invoice reader. Same complete() shape as
// the Claude provider, so extract.js runs the same prompt, schema check + retry, rules and checks.
// Gemini's structured output (responseSchema) is generated from INVOICE_SCHEMA. Nothing here logs
// invoice contents. API: https://ai.google.dev/api/generate-content
import { INVOICE_SCHEMA } from "./schema.js";

const DEFAULT_MODEL = "gemini-3.8-flash";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = Number(process.env.INVOICE_LLM_TIMEOUT_MS) || 180_000;
const MAX_HTTP_RETRIES = 2;

const geminiError = (code, message) => Object.assign(new Error(message), { code });

// InvoiceJSON schema -> Gemini responseSchema (OpenAPI subset). The free-form confidence map can't be
// expressed there, so Gemini returns it as a list of { field, level }, turned back into the map below.
function toGeminiSchema(schema) {
  if (typeof schema === "string") return { type: schema.split("|").includes("string") ? "string" : schema.split("|")[0], nullable: true };
  if (schema.oneOf) return { type: "string", enum: schema.oneOf, nullable: true };
  if (Array.isArray(schema)) return { type: "array", items: toGeminiSchema(schema[0]) };
  if (schema["*"]) return { type: "array", items: { type: "object", properties: { field: { type: "string" }, level: { type: "string", enum: ["medium", "low"] } }, required: ["field", "level"] } };
  const entries = Object.entries(schema).filter(([key]) => !["derived", "useComputedTotals"].includes(key));
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
    async complete({ system, messages }) {
      if (!apiKey) throw geminiError("GEMINI_KEY_MISSING", "Gemini is not configured (GEMINI_API_KEY is not set).");
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system + CONFIDENCE_NOTE }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: toParts(m.content) })),
        generationConfig: { responseMimeType: "application/json", responseSchema: GEMINI_SCHEMA, maxOutputTokens: 32_768 },
      });
      for (let attempt = 0; ; attempt++) {
        let response;
        try {
          response = await fetchImpl(`${BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch (error) {
          if (error?.name === "TimeoutError") throw geminiError("INVOICE_LLM_TIMEOUT", `Gemini did not answer within ${Math.round(TIMEOUT_MS / 1000)} s.`);
          if (attempt < MAX_HTTP_RETRIES) continue;
          throw geminiError("INVOICE_LLM_UNREACHABLE", "Could not reach Gemini.");
        }
        if ((response.status === 429 || response.status >= 500) && attempt < MAX_HTTP_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
          continue;
        }
        const reply = await response.json().catch(() => null);
        if (!response.ok) throw geminiError("INVOICE_LLM_FAILED", `Gemini error ${response.status}: ${reply?.error?.message ?? response.statusText}`);
        const candidate = reply?.candidates?.[0];
        if (!candidate || reply.promptFeedback?.blockReason || ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(candidate.finishReason)) {
          throw geminiError("INVOICE_LLM_REFUSED", "Gemini declined to read this file.");
        }
        if (candidate.finishReason === "MAX_TOKENS") throw geminiError("INVOICE_LLM_TRUNCATED", "Gemini's answer was cut off (invoice too long).");
        const usage = reply.usageMetadata ?? {};
        return {
          text: toInvoiceText((candidate.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("")),
          // Thinking tokens are billed as output.
          usage: { model: reply.modelVersion ?? model, inputTokens: usage.promptTokenCount ?? 0, outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) },
        };
      }
    },
  };
}

export { GEMINI_SCHEMA, geminiProvider, toGeminiSchema };
