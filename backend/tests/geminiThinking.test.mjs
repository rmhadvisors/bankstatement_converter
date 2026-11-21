import assert from "node:assert/strict";
import { test } from "node:test";
import { geminiProvider } from "../src/invoice/gemini.js";

const ok = { candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }], usageMetadata: {} };
const reply = (body, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body });

test("thinking level is sent; a model that rejects it gets the same call without it", async () => {
  const bodies = [];
  const fetchImpl = async (_, init) => {
    bodies.push(JSON.parse(init.body).generationConfig);
    return bodies.length === 1 ? reply({ error: { message: "Unknown field thinkingLevel" } }, 400) : reply(ok);
  };
  const provider = geminiProvider({ apiKey: "k", model: "m", fetchImpl });
  await provider.complete({ system: "s", messages: [{ role: "user", content: "x" }], thinking: "low" });
  assert.equal(bodies[0].thinkingConfig.thinkingLevel, "low");
  assert.equal(bodies[1].thinkingConfig, undefined);
  assert.equal(bodies.length, 2);
});
