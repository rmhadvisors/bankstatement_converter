// npm run test:full: the whole suite, but a missing client fixture or tool is a failure, not a skip.
// Run it before every merge (the client PDFs and expected-values JSON are git-ignored).
process.env.REQUIRE_FIXTURES = "1";
await import("./run-tests.mjs");
