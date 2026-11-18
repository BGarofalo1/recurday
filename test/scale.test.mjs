// Node-only checks for the "very busy" fallbacks and edge cache keys.
import worker from "../src/worker.js";
import { pageCacheKey } from "../src/edge.js";

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else { failed += 1; console.error(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
}

// A broken database (like a free-plan daily limit being hit) must not crash.
const brokenDb = { prepare() { throw new Error("D1_ERROR: Exceeded maximum daily rows read"); } };
const env = { DB: brokenDb, SESSION_SECRET: "x", MEDIA: {} };

const page = await worker.fetch(new Request("https://r.test/t/abcdefghijklmnopqrstuvwx", { headers: { accept: "text/html" } }), env);
const pageText = await page.text();
check("link page shows a calm busy page when the database is out", page.status === 503 && pageText.includes("Recurday is very busy right now.") && pageText.includes("Nothing was lost.") && page.headers.get("retry-after") === "60" && page.headers.get("cache-control") === "no-store");
check("busy page keeps security headers", page.headers.get("x-frame-options") === "DENY");

const api = await worker.fetch(new Request("https://r.test/api/tradition?t=abcdefghijklmnopqrstuvwx"), env);
const apiBody = await api.json();
check("API says busy, not a crash", api.status === 503 && /very busy/.test(apiBody.error));

// Edge cache keys: never contain the secret token; change on every edit, link, and year.
const base = { role: "household", token: "SECRET-token-value-123", tradition: { id: "t1", page_version: 3 }, share: null };
const url = new URL("https://r.test/t/SECRET-token-value-123");
const k1 = await pageCacheKey("https://r.test", base, url);
const k2 = await pageCacheKey("https://r.test", { ...base, tradition: { id: "t1", page_version: 4 } }, url);
const k3 = await pageCacheKey("https://r.test", { ...base, token: "another-token-value-456" }, url);
const k4 = await pageCacheKey("https://r.test", base, new URL("https://r.test/t/x?year=2024"));
check("cache key hides the link token", !k1.includes("SECRET"));
check("cache key changes after an edit", k1 !== k2);
check("cache key differs per link", k1 !== k3);
check("cache key differs per year view", k1 !== k4);

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("scale checks passed");
