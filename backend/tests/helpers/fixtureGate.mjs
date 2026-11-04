import assert from "node:assert/strict";
import { existsSync } from "node:fs";

// Client fixtures (statement PDFs and their expected-values JSON) are git-ignored, so a clone without them
// skips those tests. That must never be quiet: every skipped fixture is listed in one loud line at the end of
// the run, and REQUIRE_FIXTURES=1 (npm run test:full) turns a missing fixture or tool into a failure.
const REQUIRED = process.env.REQUIRE_FIXTURES === "1";
const skipped = [];

// tool: ["tesseract", true|false] -- a binary the test needs besides the file.
function fixtureGate(name, path, { tool = null } = {}) {
  const missing = !existsSync(path) ? `needs fixtures/${name}` : tool && !tool[1] ? `needs the ${tool[0]} binary` : null;
  if (missing && !REQUIRED) skipped.push(name);
  return {
    skip: missing && !REQUIRED ? missing : false,
    // Call first thing in the test body: under REQUIRE_FIXTURES a missing fixture is a failure, not a skip.
    assertPresent() {
      if (missing) assert.fail(`REQUIRE_FIXTURES=1 but ${missing} (${path})`);
    },
  };
}

process.on("exit", () => {
  if (skipped.length) console.log(`\nSKIPPED ${skipped.length} client fixtures: ${[...new Set(skipped)].join(", ")}  (npm run test:full fails on these)`);
});

export { fixtureGate };
