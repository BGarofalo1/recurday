// Prebuild the public pages (Ideas, About, Privacy, Terms) into public/ so
// Cloudflare serves them as static assets: free, unlimited, and still up even
// if the Worker's free daily request limit runs out.
// https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
//
//   node scripts/build-static.mjs          write the files
//   node scripts/build-static.mjs --check  fail if they are out of date
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ideasPage, aboutPage, privacyPage, termsPage } from "../src/pages.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = process.env.RECURDAY_ORIGIN || "https://recurday.bgarofalo1.workers.dev";
const PAGES = [
  ["ideas.html", ideasPage, "/ideas"],
  ["about.html", aboutPage, "/about"],
  ["privacy.html", privacyPage, "/privacy"],
  ["terms.html", termsPage, "/terms"],
];
const check = process.argv.includes("--check");
let stale = 0;
for (const [file, render, route] of PAGES) {
  const res = await render(new Request(ORIGIN + route), {});
  const htmlText = (await res.text()).replace("<!doctype html>", "<!doctype html>\n<!-- Built by scripts/build-static.mjs from src/pages.js. Do not edit by hand. -->");
  const out = path.join(root, "public", file);
  if (check) {
    const current = await readFile(out, "utf8").catch(() => "");
    if (current !== htmlText) {
      stale += 1;
      console.error(`  FAIL public/${file} is out of date. Run: npm run build`);
    } else {
      console.log(`  ok  public/${file} matches src`);
    }
  } else {
    await writeFile(out, htmlText);
    console.log(`wrote public/${file}`);
  }
}
if (stale) process.exit(1);
