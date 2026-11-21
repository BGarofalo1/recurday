import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { localDate } from "../src/calendar.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
const JPG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wAAAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQACEQADAPwAH/9k=",
  "base64"
);

let failed = 0;
let passed = 0;

function pngSize(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}


function sessionCookieFrom(res) {
  const list = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  const line = list.find((c) => c && c.startsWith("recurday_session="));
  return line ? line.split(";")[0] : "";
}

function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

function openPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: opts.stdio ?? "pipe" });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => { out += d; });
    child.stderr?.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${err || out}`));
    });
  });
}

async function waitFor(url, timeoutMs = 30000) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status > 0) return;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not start at ${url}: ${last}`);
}

async function main() {
  if (process.argv.includes("--remote")) {
    throw new Error("This smoke test must never use --remote.");
  }
  const persist = await mkdtemp(path.join(tmpdir(), "recurday-smoke-"));
  const port = await openPort();
  const base = `http://127.0.0.1:${port}`;
  let child;
  try {
    console.log("Applying local D1 migrations…");
    await run(wrangler, [
      "d1", "migrations", "apply", "recurday",
      "--local",
      "--persist-to", persist,
    ], { cwd: root, env: { ...process.env, CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "" } });

    console.log(`Starting wrangler dev on ${base} (local only)…`);
    child = spawn(wrangler, [
      "dev",
      "--ip", "127.0.0.1",
      "--port", String(port),
      "--persist-to", persist,
      "--var", "SESSION_SECRET:test-session-secret-not-for-production",
    ], {
      cwd: root,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const logs = [];
    child.stdout.on("data", (d) => logs.push(d.toString()));
    child.stderr.on("data", (d) => logs.push(d.toString()));
    child.on("exit", (code) => {
      if (code && code !== 0 && failed === 0 && passed === 0) {
        console.error(logs.join(""));
      }
    });
    await waitFor(`${base}/`);

    console.log("Running checks…");

    const home = await fetch(`${base}/`);
    const homeHtml = await home.text();
    check("home page loads", home.ok && homeHtml.includes("Start a tradition"));
    check("home quietly links to ideas", homeHtml.includes('href="/ideas"') && homeHtml.includes("Ideas"));
    check(
      "home footer quietly links to about, ideas, privacy, and terms",
      homeHtml.includes('class="site-foot"') &&
        homeHtml.includes('href="/about"') &&
        homeHtml.includes('href="/privacy"') &&
        homeHtml.includes('href="/terms"') &&
        homeHtml.includes("Skip to content")
    );
    check("home is noindex", (home.headers.get("x-robots-tag") || "").includes("noindex") && homeHtml.includes("noindex"));
    check("home has no likes or rankings", !/leaderboard|like button|popularity/i.test(homeHtml) && !homeHtml.includes("id=\"like\""));
    check(
      "home hero uses the new tagline",
      homeHtml.includes("Creating family traditions.") &&
        homeHtml.includes("It was always about the small things.") &&
        homeHtml.includes("Not the big holidays. The ones your family makes your own.") &&
        !homeHtml.includes("Your family's own special days.")
    );
    check(
      "home meta and og description use the tagline",
      homeHtml.includes('name="description" content="Creating family traditions. It was always about the small things."') &&
        homeHtml.includes('property="og:description" content="Creating family traditions. It was always about the small things."') &&
        homeHtml.includes('property="og:image" content="https://recurday.bgarofalo1.workers.dev/og.png"')
    );


    const ideasPage = await fetch(`${base}/ideas`);
    const ideasHtml = await ideasPage.text();
    check("ideas page loads", ideasPage.ok && ideasHtml.includes("<h1>Ideas</h1>") && ideasHtml.includes("Make it ours") && ideasHtml.includes("Grinch Movie Night") && ideasHtml.includes("Everyone brings something green. No green, no screen.") && ideasHtml.includes("Second Saturday in December"));
    check("ideas page is noindex and has no ranks or names of people", (ideasPage.headers.get("x-robots-tag") || "").includes("noindex") && !/leaderboard|like button|popularity/i.test(ideasHtml) && !ideasHtml.includes('id="like"') && !ideasHtml.includes("Girard"));
    check("ideas page has a few more traditions to borrow", ideasHtml.includes("First-snow pancakes") && ideasHtml.includes("Backwards dinner") && ideasHtml.includes("Leaf-pile day") && ideasHtml.includes("/calendar?idea=grinch-movie-night"));
    check("ideas page is a static file with the same security headers", (ideasPage.headers.get("content-security-policy") || "").includes("frame-ancestors 'none'") && ideasPage.headers.get("x-frame-options") === "DENY" && (ideasPage.headers.get("strict-transport-security") || "").includes("max-age="));
    const ideasApi = await fetch(`${base}/api/ideas`);
    const ideasBody = await ideasApi.json();
    check("ideas api is a static list", ideasApi.ok && Array.isArray(ideasBody.ideas) && ideasBody.ideas.length >= 9 && ideasBody.ideas.every((idea) => idea.slug && idea.name && idea.practice && idea.timing));
    check("ideas page has filter chips, tags, and a share form", ideasHtml.includes('id="idea-filters" hidden') && ideasHtml.includes('data-filter="season"') && ideasHtml.includes('data-filter="place"') && /data-type="[^"]*spooky"/.test(ideasHtml) && ideasHtml.includes('action="/api/ideas/share"'));
    check("ideas has 100+ ideas", ideasBody.ideas.length >= 100 && ideasBody.ideas.every((idea) => idea.seasons && idea.ages && idea.types && idea.places));
    const ideaShareRes = await fetch(`${base}/api/ideas/share`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ name: "Smoke-test pancakes", practice: "Everyone flips one pancake.", timing: "First Saturday in March", type: "breakfast" }),
    });
    const ideaShareBody = await ideaShareRes.json();
    check("sharing an idea thanks you", ideaShareRes.ok && ideaShareBody.ok === true && /Thank you/.test(ideaShareBody.message));
    const honeyRes = await fetch(`${base}/api/ideas/share`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: "Smoke-test honeypot", practice: "This should not be saved.", website: "bot" }).toString(),
    });
    check("honeypot share gets a thank-you page", honeyRes.ok && (await honeyRes.text()).includes("Thank you!"));
    const badShare = await fetch(`${base}/api/ideas/share`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x", practice: "" }) });
    check("empty shared idea is refused", badShare.status === 400);
    const queue = await run(wrangler, ["d1", "execute", "recurday", "--local", "--persist-to", persist, "--json", "--command", "SELECT name, status FROM idea_submissions"], { cwd: root, env: { ...process.env, CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "" } });
    const queueRows = JSON.parse(queue.out)[0]?.results || [];
    check("shared idea waits in the review queue, honeypot saved nothing", queueRows.length === 1 && queueRows[0].name === "Smoke-test pancakes" && queueRows[0].status === "pending");
    const ideasAgain = await (await fetch(`${base}/ideas`)).text();
    check("shared idea is not shown publicly", !ideasAgain.includes("Smoke-test pancakes") && !JSON.stringify(await (await fetch(`${base}/api/ideas`)).json()).includes("Smoke-test"));
    const ogHome = homeHtml;
    check("home share card tags use an absolute image", ogHome.includes('property="og:image" content="https://') && ogHome.includes('name="twitter:image" content="https://') && ogHome.includes('property="og:image:width" content="1200"'));
    check("ideas share card tags use an absolute image", /property="og:image" content="https?:\/\/[^"]+\/og\.png"/.test(ideasHtml) && ideasHtml.includes('name="twitter:card" content="summary_large_image"'));
    check("buttons are not solid red", !(await (await fetch(`${base}/styles.css`)).text()).includes("linear-gradient(var(--clay), var(--clay))"));

    const privacy = await fetch(`${base}/privacy`);
    const privacyHtml = await privacy.text();
    check(
      "privacy page loads in plain words",
      privacy.ok &&
        privacyHtml.includes("<h1>Privacy</h1>") &&
        privacyHtml.includes("No ads, no selling, no tracking") &&
        privacyHtml.includes("How to delete everything") &&
        privacyHtml.includes("Delete our family") &&
        privacyHtml.includes("does not use analytics") &&
        privacyHtml.includes("private to your family") &&
        !privacyHtml.includes("Girard")
    );
    check("privacy page is noindex", (privacy.headers.get("x-robots-tag") || "").includes("noindex") && privacyHtml.includes("noindex"));

    const terms = await fetch(`${base}/terms`);
    const termsHtml = await terms.text();
    check(
      "terms page loads in plain words",
      terms.ok &&
        termsHtml.includes("<h1>Terms</h1>") &&
        termsHtml.includes("free app") &&
        termsHtml.includes("photos only") &&
        termsHtml.includes("as-is") &&
        termsHtml.includes("/privacy") &&
        (terms.headers.get("x-robots-tag") || "").includes("noindex")
    );

    const about = await fetch(`${base}/about`);
    const aboutHtml = await about.text();
    check(
      "about page loads with the tagline and open source link",
      about.ok &&
        aboutHtml.includes("<h1>About</h1>") &&
        aboutHtml.includes("Creating family traditions.") &&
        aboutHtml.includes("It was always about the small things.") &&
        aboutHtml.includes("https://github.com/BGarofalo1/recurday") &&
        aboutHtml.includes("Photos only") &&
        !aboutHtml.includes("Girard") &&
        !/leaderboard|like button|popularity/i.test(aboutHtml) &&
        (about.headers.get("x-robots-tag") || "").includes("noindex")
    );

    const missingPage = await fetch(`${base}/this-page-is-not-here`);
    const missingHtml = await missingPage.text();
    check(
      "missing pages show a plain 404",
      missingPage.status === 404 &&
        missingHtml.includes("We couldn't find that page.") &&
        missingHtml.includes("Back to Recurday") &&
        (missingPage.headers.get("x-robots-tag") || "").includes("noindex")
    );
    const missingAsset = await fetch(`${base}/no-such-file.js`);
    const missingAssetHtml = await missingAsset.text();
    check(
      "missing script files stay a plain 404, not the HTML page",
      missingAsset.status === 404 && !missingAssetHtml.includes("We couldn't find that page.")
    );

    check(
      "pages send security headers",
      (home.headers.get("content-security-policy") || "").includes("default-src 'self'") &&
        home.headers.get("x-frame-options") === "DENY" &&
        home.headers.get("cross-origin-opener-policy") === "same-origin" &&
        home.headers.get("cross-origin-resource-policy") === "same-origin" &&
        (home.headers.get("permissions-policy") || "").includes("camera=()") &&
        (home.headers.get("strict-transport-security") || "").includes("max-age=15552000") &&
        home.headers.get("x-content-type-options") === "nosniff" &&
        home.headers.get("referrer-policy") === "no-referrer"
    );
    const ideasAnonCal = await fetch(`${base}/calendar?idea=grinch-movie-night`, { redirect: "manual" });
    const ideasAnonLoc = ideasAnonCal.headers.get("location") || "";
    check("logged-out make-it-ours goes to get started", (ideasAnonCal.status === 303 || ideasAnonCal.status === 302) && ideasAnonLoc.includes("idea=grinch-movie-night"));

    const manifestRes = await fetch(`${base}/manifest.webmanifest`);
    const manifestType = manifestRes.headers.get("content-type") || "";
    const manifest = await manifestRes.json();
    check("manifest is served", manifestRes.ok && manifestType.includes("manifest") && manifestType.includes("json"));
    check(
      "manifest names Recurday as a standalone app",
      manifest.name === "Recurday" &&
        manifest.short_name === "Recurday" &&
        manifest.display === "standalone" &&
        (manifest.start_url === "/" || manifest.start_url === "./") &&
        manifest.theme_color === "#ffffff" &&
        manifest.background_color === "#ffffff" &&
        manifest.description === "Creating family traditions. It was always about the small things.",
      JSON.stringify(manifest)
    );
    const purposes = (manifest.icons || []).flatMap((icon) => String(icon.purpose || "any").split(/\s+/));
    const sizes = new Set((manifest.icons || []).map((icon) => icon.sizes));
    check("manifest has 192, 512, and maskable icons", sizes.has("192x192") && sizes.has("512x512") && purposes.includes("any") && purposes.includes("maskable"));
    check("manifest also lists 48, 96, and 144 icons", sizes.has("48x48") && sizes.has("96x96") && sizes.has("144x144"));

    const iconChecks = [
      ["/icons/icon-192.png", 192],
      ["/icons/icon-512.png", 512],
      ["/icons/icon-192-maskable.png", 192],
      ["/icons/icon-512-maskable.png", 512],
      ["/icons/icon-16.png", 16],
      ["/icons/icon-32.png", 32],
      ["/icons/icon-48.png", 48],
      ["/icons/icon-96.png", 96],
      ["/icons/icon-144.png", 144],
      ["/apple-touch-icon.png", 180],
      ["/favicon.png", 64],
    ];
    for (const [path, edge] of iconChecks) {
      const res = await fetch(`${base}${path}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const dim = pngSize(buf);
      check(
        `${path} is a ${edge}px PNG`,
        res.ok && (res.headers.get("content-type") || "").includes("image/png") && dim && dim.w === edge && dim.h === edge,
        `status=${res.status} type=${res.headers.get("content-type")} dim=${JSON.stringify(dim)}`
      );
    }

    const sw = await fetch(`${base}/sw.js`);
    const swText = await sw.text();
    const swType = sw.headers.get("content-type") || "";
    const shellMatch = swText.match(/const SHELL\s*=\s*\[([\s\S]*?)\];/);
    const shellList = shellMatch ? shellMatch[1] : "";
    check("service worker is javascript", sw.ok && /javascript/.test(swType));
    check("service worker is scoped to the whole app", (sw.headers.get("service-worker-allowed") || "") === "/");
    const ico = await fetch(`${base}/favicon.ico`);
    const icoBuf = new Uint8Array(await ico.arrayBuffer());
    check(
      "favicon.ico has 16, 32, and 48 px sizes",
      ico.ok && icoBuf.length > 100 && icoBuf[0] === 0 && icoBuf[1] === 0 && icoBuf[2] === 1 && icoBuf[3] === 0 && icoBuf[4] === 3 && icoBuf[5] === 0,
      `status=${ico.status} bytes=${icoBuf.length}`
    );

    check("service worker caches the app shell", /recurday-shell/.test(swText) && shellList.includes("/offline") && !shellList.includes("/offline.html") && shellList.includes("/styles.css") && shellList.includes("/app.js"));
    check(
      "service worker never caches private family data",
      /const PRIVATE\s*=/.test(swText) &&
        /\(media\|api\|t\|a\|s\|f\|cal\|calendar\|family\)/.test(swText) &&
        !shellList.includes("/media") &&
        !shellList.includes("/api/") &&
        !shellList.includes("/t/") &&
        !shellList.includes("/a/") &&
        !shellList.includes("/s/") &&
        !shellList.includes("/f/") &&
        !shellList.includes("/cal") &&
        !shellList.includes("/calendar") &&
        !shellList.includes("/family")
    );

    const offline = await fetch(`${base}/offline.html`, { redirect: "manual" });
    const offlineHtml = offline.status === 200 ? await offline.text() : "";
    check(
      "offline fallback page loads in plain words and has a footer",
      offline.status === 200 &&
        (offline.headers.get("content-type") || "").includes("text/html") &&
        offlineHtml.includes("You're offline.") &&
        offlineHtml.includes("Try Recurday again") &&
        offlineHtml.includes('href="/privacy"') &&
        offlineHtml.includes('class="site-foot"')
    );

    check(
      "home is installable on iOS and Android",
      homeHtml.includes('rel="manifest"') &&
        homeHtml.includes("/manifest.webmanifest") &&
        homeHtml.includes('rel="apple-touch-icon"') &&
        homeHtml.includes('name="theme-color" content="#ffffff"') &&
        homeHtml.includes('name="apple-mobile-web-app-capable" content="yes"') &&
        homeHtml.includes('name="apple-mobile-web-app-title" content="Recurday"') &&
        homeHtml.includes("/app.js")
    );
    check("home still uses the generic share image", homeHtml.includes('property="og:image" content="https://recurday.bgarofalo1.workers.dev/og.png"'));


    const robots = await fetch(`${base}/robots.txt`);
    const robotsTxt = await robots.text();
    check("robots.txt disallows all", robots.ok && /Disallow:\s*\//.test(robotsTxt) && /User-agent: \*\nDisallow: \/\s*$/.test(robotsTxt));
    check("robots.txt lets link previews see only public pages and the share card", robotsTxt.includes("Allow: /og.png") && !/Allow: \/(t|a|s|f|media|cal|calendar|family|api)(\/|\s)/.test(robotsTxt));

    const missing = await fetch(`${base}/api/traditions`);
    check("no public tradition index", missing.status === 404);

    const created = await fetch(`${base}/api/traditions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Grinch Movie Night",
        timing_note: "Second Saturday in December",
        practice_note: "Everyone brings something green. No green, no screen.",
      }),
    });
    const trad = await created.json();
    check("create tradition", created.status === 201 && trad.household_url && trad.admin_url, JSON.stringify(trad));
    const householdToken = trad.household_path.split("/t/")[1];
    const adminToken = trad.admin_path.split("/a/")[1];

    const familyPage = await fetch(`${base}${trad.household_path}`);
    const familyHtml = await familyPage.text();
    check("household page title and og", familyPage.ok && familyHtml.includes("<title>Grinch Movie Night — Recurday</title>") && familyHtml.includes('property="og:title" content="Grinch Movie Night"'));
    check("household page noindex", (familyPage.headers.get("x-robots-tag") || "").includes("noindex"));
    const keeperPage = await fetch(`${base}${trad.admin_path}`);
    const keeperHomeHtml = await keeperPage.text();
    check("keeper page has text-to-family", keeperPage.ok && keeperHomeHtml.includes("Text this to family"));
    check("household page is the shared-link view", familyHtml.includes("Creating family traditions.") && familyHtml.includes("It was always about the small things.") && familyHtml.includes("Start your own") && familyHtml.includes("Everyone brings something green. No green, no screen."));
    check("household page has no like/count chrome", !familyHtml.includes("leaderboard") && !familyHtml.includes('id="like"') && !familyHtml.includes("Like this"));
    check("household link preview uses generic image", familyHtml.includes('property="og:image"') && familyHtml.includes("/og.png") && !/property="og:image" content="[^"]*\/media\//.test(familyHtml));
    check(
      "household page keeps install tags and a rainbow hue",
      familyHtml.includes('rel="manifest" href="/manifest.webmanifest"') &&
        familyHtml.includes('rel="apple-touch-icon"') &&
        familyHtml.includes('name="theme-color" content="#ffffff"') &&
        familyHtml.includes("/icons/mark.svg") &&
        /class="wrap hue-(red|orange|yellow|green|blue|indigo|violet)"/.test(familyHtml)
    );
    check("upload form is photos only", familyHtml.includes("Photos shrink on your phone.") && familyHtml.includes('accept="image/jpeg,image/png,image/webp,image/gif"') && !familyHtml.includes("video/mp4") && !/video coming soon/i.test(familyHtml));

    const form = new FormData();
    form.set("t", householdToken);
    form.set("year", "2024");
    form.set("note", "The first year.");
    form.set("file", new Blob([JPG], { type: "image/jpeg" }), "creek.jpg");
    const uploaded = await fetch(`${base}/api/upload`, { method: "POST", body: form });
    const up = await uploaded.json();
    check("upload photo for 2024", uploaded.status === 201 && up.media_id, JSON.stringify(up));

    const nonPhotoForm = new FormData();
    nonPhotoForm.set("t", householdToken);
    nonPhotoForm.set("year", "2024");
    nonPhotoForm.set("file", new Blob([new Uint8Array([0, 0, 0, 0])], { type: "video/mp4" }), "clip.mp4");
    const nonPhotoUp = await fetch(`${base}/api/upload`, { method: "POST", body: nonPhotoForm });
    const nonPhotoBody = await nonPhotoUp.json();
    check("non-photo upload is rejected", nonPhotoUp.status === 400 && nonPhotoBody.error === "Photos only.", JSON.stringify(nonPhotoBody));

    const mediaUrl = `${base}/media/${up.media_id}?t=${encodeURIComponent(householdToken)}`;
    const mediaOk = await fetch(mediaUrl);
    check("media with household token", mediaOk.ok && (mediaOk.headers.get("content-type") || "").includes("image/jpeg"));
    const mediaBare = await fetch(`${base}/media/${up.media_id}`);
    check("media without token is hidden", mediaBare.status === 404);
    const mediaBad = await fetch(`${base}/media/${up.media_id}?t=totally-not-a-real-token-value`);
    check("media with bad token is hidden", mediaBad.status === 404);

    const yearPage = await fetch(`${base}${trad.household_path}?year=2024`);
    const yearHtml = await yearPage.text();
    check("rewatch page shows 2024 and the photo", yearPage.ok && yearHtml.includes(">2024<") && yearHtml.includes(`/media/${up.media_id}`));

    // Scale: shared-link pages and photos come from the edge cache, and edits show up at once.
    check("photo may be kept by the browser (immutable, private)", /private/.test(mediaOk.headers.get("cache-control") || "") && /immutable/.test(mediaOk.headers.get("cache-control") || ""));
    const mediaAgain = await fetch(mediaUrl);
    check("second photo view is served from the edge cache", mediaAgain.ok && mediaAgain.headers.get("x-recurday-edge") === "hit" && (await mediaAgain.arrayBuffer()).byteLength === JPG.length, mediaAgain.headers.get("x-recurday-edge"));
    check("edge-cached photo still needs the link", (await fetch(`${base}/media/${up.media_id}`)).status === 404);
    const linkA = await fetch(`${base}${trad.household_path}`);
    const linkAHtml = await linkA.text();
    const linkB = await fetch(`${base}${trad.household_path}`);
    const linkBHtml = await linkB.text();
    check("shared link page is cached at the edge for visitors", linkB.ok && linkB.headers.get("x-recurday-edge") === "hit" && linkBHtml === linkAHtml, `${linkA.headers.get("x-recurday-edge")} ${linkB.headers.get("x-recurday-edge")}`);
    check("cached shared link page is not kept by browsers", /private/.test(linkB.headers.get("cache-control") || "") && /no-cache/.test(linkB.headers.get("cache-control") || "") && (linkB.headers.get("x-frame-options") || "") === "DENY");
    const noteForm = new FormData();
    noteForm.set("t", householdToken);
    noteForm.set("year", "2024");
    noteForm.set("note", "Edited note shows up right away.");
    const noteRes = await fetch(`${base}/api/days`, { method: "POST", body: noteForm });
    const linkAfterEdit = await fetch(`${base}${trad.household_path}?year=2024`);
    const linkAfterEditHtml = await linkAfterEdit.text();
    check("an edit shows on the shared link at once (no stale cache)", noteRes.ok && linkAfterEdit.headers.get("x-recurday-edge") === "miss" && linkAfterEditHtml.includes("Edited note shows up right away."));
    const keeperAgain = await fetch(`${base}${trad.admin_path}`);
    check("keeper page is never edge-cached", keeperAgain.ok && !keeperAgain.headers.get("x-recurday-edge"));

    const shareRes = await fetch(`${base}/api/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: adminToken, label: "The Millers" }),
    });
    const share = await shareRes.json();
    check("admin can mint an invite", shareRes.status === 201 && share.invite_path, JSON.stringify(share));
    const shareToken = share.invite_path.split("/s/")[1];

    const pending = await fetch(`${base}${share.invite_path}`);
    const pendingHtml = await pending.text();
    check("invite is gated until accept", pending.ok && pendingHtml.includes("Have a look") && !pendingHtml.includes(`/media/${up.media_id}`));
    const mediaPending = await fetch(`${base}/media/${up.media_id}?t=${encodeURIComponent(shareToken)}`);
    check("media hidden before accept", mediaPending.status === 404);

    const sneakCopy = await fetch(`${base}/api/shares/copy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: shareToken }),
    });
    check("copy blocked before accept", sneakCopy.status === 403);

    const accepted = await fetch(`${base}/api/shares/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: shareToken }),
    });
    check("invite can be accepted", accepted.ok);

    const sharedPage = await fetch(`${base}${share.invite_path}`);
    const sharedHtml = await sharedPage.text();
    check(
      "accepted invite can rewatch and start-too, but not upload",
      sharedPage.ok &&
        sharedHtml.includes(`/media/${up.media_id}`) &&
        sharedHtml.includes("Start this tradition too") &&
        !sharedHtml.includes("id=\"upload-form\"")
    );
    const mediaShared = await fetch(`${base}/media/${up.media_id}?t=${encodeURIComponent(shareToken)}`);
    check("media visible after accept", mediaShared.ok);

    const sneakUpload = new FormData();
    sneakUpload.set("t", shareToken);
    sneakUpload.set("year", "2024");
    sneakUpload.set("file", new Blob([JPG], { type: "image/jpeg" }), "nope.jpg");
    const sneakUp = await fetch(`${base}/api/upload`, { method: "POST", body: sneakUpload });
    check("invite cannot upload into the source", sneakUp.status === 403);

    const copied = await fetch(`${base}/api/shares/copy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: shareToken }),
    });
    const copy = await copied.json();
    check("start this tradition too", copied.status === 201 && copy.household_path, JSON.stringify(copy));

    const copyPage = await fetch(`${base}${copy.household_path}`);
    const copyHtml = await copyPage.text();
    check("copied practice has the same name and notes", copyPage.ok && copyHtml.includes("Grinch Movie Night") && copyHtml.includes("Everyone brings something green. No green, no screen.") && copyHtml.includes("Second Saturday in December"));
    check("copied tradition does not include their media", !copyHtml.includes(`/media/${up.media_id}`));
    const copyJson = await (await fetch(`${base}/api/tradition?t=${encodeURIComponent(copy.household_path.split("/t/")[1])}`)).json();
    const copyMediaCount = (copyJson.days || []).reduce((n, d) => n + (d.media?.length || 0), 0);
    check("copied tradition has zero media rows", copyMediaCount === 0, JSON.stringify(copyJson.days));

    const revoked = await fetch(`${base}/api/shares/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: adminToken, share_id: share.share_id }),
    });
    check("admin can revoke the invite", revoked.ok);
    const afterRevoke = await fetch(`${base}${share.invite_path}`);
    const afterHtml = await afterRevoke.text();
    check("revoked invite no longer opens", afterRevoke.status === 404 && afterHtml.includes("isn't valid"));
    const mediaRevoked = await fetch(`${base}/media/${up.media_id}?t=${encodeURIComponent(shareToken)}`);
    check("revoked invite cannot see media", mediaRevoked.status === 404);
    const copyStill = await fetch(`${base}${copy.household_path}`);
    check("their own started tradition still works after revoke", copyStill.ok && (await copyStill.text()).includes("Grinch Movie Night"));

    const keeper = await fetch(`${base}${trad.admin_path}`);
    const keeperHtml = await keeper.text();
    check("keeper page can still rewatch", keeper.ok && keeperHtml.includes("Grinch Movie Night") && keeperHtml.includes("Pass it on"));

    const passOn = await fetch(`${base}/api/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: adminToken, label: "The Carters" }),
    });
    const passBody = await passOn.json();
    check("pass-it-on invite can be minted", passOn.status === 201 && passBody.invite_path, JSON.stringify(passBody));
    const passPage = await fetch(`${base}${passBody.invite_path}`);
    const passHtml = await passPage.text();
    check(
      "shared link offers start-your-own and generic preview",
      passPage.ok &&
        passHtml.includes("Start your own") &&
        passHtml.includes("Creating family traditions.") &&
        passHtml.includes("It was always about the small things.") &&
        passHtml.includes("Not the big holidays. The ones your family makes your own.") &&
        passHtml.includes('property="og:image"') &&
        passHtml.includes("/og.png") &&
        passHtml.includes('property="og:description" content="Creating family traditions. It was always about the small things."') &&
        (passPage.headers.get("x-robots-tag") || "").includes("noindex")
    );

    const yearHtml2 = await (await fetch(`${base}${trad.household_path}?year=2024`)).text();
    check("through the years is offered when a year has photos", yearHtml2.includes("Watch the years") && yearHtml2.includes("id=\"years-data\""));

    const createdFamily = await fetch(`${base}/api/family/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "The Testers", passcode: "together-please" }),
    });
    const fam = await createdFamily.json();
    const famCookie = sessionCookieFrom(createdFamily);
    check("create family login", createdFamily.status === 201 && famCookie && fam.calendar_path === "/calendar", JSON.stringify(fam));

    const taken = await fetch(`${base}/api/family/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "the testers", passcode: "another-passcode" }),
    });
    check("family name is unique, case-insensitive", taken.status === 409);

    const badLogin = await fetch(`${base}/api/family/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "The Testers", passcode: "wrong-passcode" }),
    });
    check("wrong passcode is rejected", badLogin.status === 401);

    const goodLogin = await fetch(`${base}/api/family/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "The Testers", passcode: "together-please" }),
    });
    const loginCookie = sessionCookieFrom(goodLogin);
    check("family can log in", goodLogin.ok && loginCookie);

    const calendar = await fetch(`${base}/calendar`, { headers: { cookie: loginCookie } });
    const calHtml = await calendar.text();
    check("calendar is the family home", calendar.ok && calHtml.includes("Our traditions") && calHtml.includes("Upcoming") && (calendar.headers.get("x-robots-tag") || "").includes("noindex"));
    check(
      "calendar more links to ideas, about, privacy, and delete",
      calHtml.includes('href="/ideas"') &&
        calHtml.includes('href="/about"') &&
        calHtml.includes('href="/privacy"') &&
        calHtml.includes("Delete our family") &&
        calHtml.includes('id="delete-family-form"')
    );
    const ideaCal = await fetch(`${base}/calendar?idea=grinch-movie-night`, { headers: { cookie: loginCookie } });
    const ideaCalHtml = await ideaCal.text();
    check(
      "logged-in make-it-ours prefills a new tradition",
      ideaCal.ok &&
        ideaCalHtml.includes('id="add-tradition"') &&
        ideaCalHtml.includes('value="Grinch Movie Night"') &&
        ideaCalHtml.includes("Everyone brings something green. No green, no screen.") &&
        ideaCalHtml.includes("2026-12-12") &&
        ideaCalHtml.includes('value="nth_weekday" selected')
    );
    check("calendar is not a public listing", !/leaderboard|most popular|referral/i.test(calHtml));

    const calAnon = await fetch(`${base}/calendar`, { redirect: "manual" });
    check("calendar requires login", calAnon.status === 303 || calAnon.status === 401 || calAnon.status === 302);

    const ics = await fetch(`${base}${fam.ics_path}`);
    const icsText = await ics.text();
    const icsType = ics.headers.get("content-type") || "";
    check("private calendar feed is an ics", ics.ok && icsType.includes("text/calendar") && icsText.includes("BEGIN:VCALENDAR") && (ics.headers.get("x-robots-tag") || "").includes("noindex"));
    const icsBad = await fetch(`${base}/cal/not-a-real-calendar-token-value.ics`);
    check("ics with a bad token is hidden", icsBad.status === 404);

    const madeOnCal = await fetch(`${base}/api/family/traditions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: loginCookie },
      body: JSON.stringify({ name: "Grinch Movie Night", practice_note: "Everyone brings something green. No green, no screen.", date: "2026-12-12", recur_type: "nth_weekday" }),
    });
    const made = await madeOnCal.json();
    check("logged-in family can add a tradition from a date", madeOnCal.status === 201 && made.tradition_path, JSON.stringify(made));
    const calJune = await fetch(`${base}/calendar?year=2026&month=12`, { headers: { cookie: loginCookie } });
    const juneHtml = await calJune.text();
    check("calendar shows the tradition on its date", calJune.ok && juneHtml.includes("Grinch Movie Night") && juneHtml.includes("/f/") && juneHtml.includes("hue-"));
    check("calendar uses a hue fallback when a tradition has no cover", juneHtml.includes("cal-thumb fallback") && !juneHtml.includes("/media/cover/"));

    const tradPageBefore = await fetch(`${base}${made.tradition_path}`, { headers: { cookie: loginCookie } });
    const tradBeforeHtml = await tradPageBefore.text();
    check(
      "tradition page without a cover uses the hue and a generic preview",
      tradPageBefore.ok &&
        tradBeforeHtml.includes("cover-hero fallback") &&
        tradBeforeHtml.includes('property="og:image"') &&
        tradBeforeHtml.includes("/og.png") &&
        !tradBeforeHtml.includes("/media/cover/") &&
        tradBeforeHtml.includes("Cover picture")
    );

    const coverAnon = await fetch(`${base}/api/family/cover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tradition_id: made.id }),
    });
    check("setting a cover requires login", coverAnon.status === 401);

    const coverFd = new FormData();
    coverFd.set("tradition_id", made.id);
    coverFd.set("file", new Blob([JPG], { type: "image/jpeg" }), "cover.jpg");
    coverFd.set("thumb", new Blob([JPG], { type: "image/jpeg" }), "cover.thumb.jpg");
    const coverUp = await fetch(`${base}/api/family/cover`, { method: "POST", headers: { cookie: loginCookie }, body: coverFd });
    const coverBody = await coverUp.json();
    check("family can upload a cover picture", coverUp.status === 201 && coverBody.url && coverBody.thumb, JSON.stringify(coverBody));

    const tradPage = await fetch(`${base}${made.tradition_path}`, { headers: { cookie: loginCookie } });
    const tradHtml = await tradPage.text();
    check(
      "tradition page shows the cover as a hero and keeps a generic preview",
      tradPage.ok &&
        tradHtml.includes("cover-hero") &&
        tradHtml.includes(coverBody.url) &&
        !tradHtml.includes("cover-hero fallback") &&
        tradHtml.includes('property="og:image"') &&
        tradHtml.includes("/og.png") &&
        !/og:image[^>]+\/media\/cover/i.test(tradHtml) &&
        tradHtml.includes("years-data") &&
        tradHtml.includes(coverBody.url)
    );

    const coverGet = await fetch(`${base}${coverBody.url}`, { headers: { cookie: loginCookie } });
    const coverBytes = new Uint8Array(await coverGet.arrayBuffer());
    check("cover is served to the logged-in family", coverGet.ok && (coverGet.headers.get("content-type") || "").includes("image/jpeg") && coverBytes[0] === 0xff && coverBytes[1] === 0xd8);
    const coverHidden = await fetch(`${base}${coverBody.url}`);
    check("cover without a login or link is hidden", coverHidden.status === 404);
    const coverThumb = await fetch(`${base}${coverBody.thumb}`, { headers: { cookie: loginCookie } });
    check("cover thumbnail is served", coverThumb.ok);

    const calCovered = await fetch(`${base}/calendar?year=2026&month=12`, { headers: { cookie: loginCookie } });
    const calCoveredHtml = await calCovered.text();
    check(
      "calendar shows a round cover thumbnail",
      calCovered.ok && calCoveredHtml.includes("cal-thumb") && calCoveredHtml.includes(coverBody.thumb)
    );

    const yearPhoto = new FormData();
    yearPhoto.set("tradition_id", made.id);
    yearPhoto.set("year", "2024");
    yearPhoto.set("file", new Blob([JPG], { type: "image/jpeg" }), "year.jpg");
    const yearUp = await fetch(`${base}/api/upload`, { method: "POST", headers: { cookie: loginCookie }, body: yearPhoto });
    const yearBody = await yearUp.json();
    check("family can add a year photo to pick as a cover", yearUp.status === 201 && yearBody.media_id, JSON.stringify(yearBody));
    const picked = await fetch(`${base}/api/family/cover`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: loginCookie },
      body: JSON.stringify({ tradition_id: made.id, media_id: yearBody.media_id }),
    });
    const pickedBody = await picked.json();
    check("family can pick an existing photo as the cover", picked.ok && pickedBody.url, JSON.stringify(pickedBody));
    const afterPick = await fetch(`${base}${made.tradition_path}`, { headers: { cookie: loginCookie } });
    const afterPickHtml = await afterPick.text();
    check("picked cover is marked in the cover picker", afterPick.ok && afterPickHtml.includes(`data-media-id="${yearBody.media_id}"`) && afterPickHtml.includes("aria-current"));

    const passOnCover = await fetch(`${base}/api/shares`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: loginCookie },
      body: JSON.stringify({ tradition_id: made.id, label: "The Neighbors" }),
    });
    const passOnCoverBody = await passOnCover.json();
    check("pass-it-on link can be minted for a covered tradition", passOnCover.status === 201 && passOnCoverBody.invite_path, JSON.stringify(passOnCoverBody));
    const pendingCover = await fetch(`${base}${passOnCoverBody.invite_path}`);
    const pendingCoverHtml = await pendingCover.text();
    check("unaccepted share does not reveal the cover", pendingCover.ok && !pendingCoverHtml.includes("/media/cover/") && pendingCoverHtml.includes("/og.png"));
    await fetch(`${base}/api/shares/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: passOnCoverBody.invite_path.split("/s/")[1] }),
    });
    const acceptedCover = await fetch(`${base}${passOnCoverBody.invite_path}`);
    const acceptedCoverHtml = await acceptedCover.text();
    check("accepted share can see the cover and still uses a generic preview", acceptedCover.ok && acceptedCoverHtml.includes("/media/cover/") && acceptedCoverHtml.includes("/og.png"));
    const copiedCover = await fetch(`${base}/api/shares/copy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: passOnCoverBody.invite_path.split("/s/")[1] }),
    });
    const copiedCoverBody = await copiedCover.json();
    const copiedPage = copiedCoverBody.household_path ? await fetch(`${base}${copiedCoverBody.household_path}`) : { ok: false, text: async () => "" };
    const copiedPageHtml = await copiedPage.text();
    check("passing it on copies the practice, not the cover", copiedCover.status === 201 && copiedPage.ok && copiedPageHtml.includes("cover-hero fallback") && !copiedPageHtml.includes("/media/cover/"), JSON.stringify(copiedCoverBody));

    const exportAnon = await fetch(`${base}/family/export`, { redirect: "manual" });
    check("export requires login", exportAnon.status === 401 || exportAnon.status === 303 || exportAnon.status === 302);
    const exported = await fetch(`${base}/family/export`, { headers: { cookie: loginCookie } });
    const zipBuf = new Uint8Array(await exported.arrayBuffer());
    const zipText = new TextDecoder("latin1").decode(zipBuf);
    check(
      "family export is a private zip with an index",
      exported.ok &&
        (exported.headers.get("content-type") || "").includes("zip") &&
        zipBuf[0] === 0x50 && zipBuf[1] === 0x4b &&
        zipText.includes("family.json") &&
        zipText.includes("index.html") &&
        zipText.includes("Grinch Movie Night") &&
        (zipText.includes("cover.jpg") || zipText.includes("cover.jpeg")),
      `status=${exported.status} type=${exported.headers.get("content-type")} cover=${zipText.includes("cover.jpg")} len=${zipBuf.length}`
    );

    const claimable = await fetch(`${base}/api/traditions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Lantern Night", timing_note: "December 21", practice_note: "We light a lantern." }),
    });
    const claimedTrad = await claimable.json();
    const claimToken = claimedTrad.household_path.split("/t/")[1];
    const claimPage = await fetch(`${base}${claimedTrad.household_path}`);
    const claimHtml = await claimPage.text();
    check("existing tradition link offers family login setup", claimPage.ok && claimHtml.includes("Set up your family login"));
    const claimed = await fetch(`${base}/api/family/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: claimToken, name: "The Testers", passcode: "together-please" }),
    });
    const claimedBody = await claimed.json();
    check("existing tradition can be claimed by the family", claimed.ok && claimedBody.calendar_path === "/calendar", JSON.stringify(claimedBody));
    const afterClaim = await fetch(`${base}/calendar?year=2026&month=12`, { headers: { cookie: loginCookie } });
    check("claimed tradition appears on the calendar", afterClaim.ok && (await afterClaim.text()).includes("Lantern Night"));

    const shareStill = await fetch(`${base}${passBody.invite_path}`);
    check("pass-it-on link still works without login", shareStill.ok);

    const changed = await fetch(`${base}/api/family/passcode`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: loginCookie },
      body: JSON.stringify({ current_passcode: "together-please", new_passcode: "new-together-ok" }),
    });
    const newCookie = sessionCookieFrom(changed);
    check("family can change the passcode", changed.ok && newCookie);
    const oldSession = await fetch(`${base}/calendar`, { headers: { cookie: loginCookie }, redirect: "manual" });
    check("changing the passcode signs out other devices", oldSession.status === 303 || oldSession.status === 401 || oldSession.status === 302);
    const newSession = await fetch(`${base}/calendar`, { headers: { cookie: newCookie } });
    check("new passcode session still opens the calendar", newSession.ok);

    const logout = await fetch(`${base}/api/family/logout`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: newCookie },
    });
    const loggedOutCookie = sessionCookieFrom(logout);
    check("family can log out", logout.ok);

    const goneName = "The Deleters";
    const gonePass = "delete-please";
    const madeGoneFam = await fetch(`${base}/api/family/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: goneName, passcode: gonePass }),
    });
    const goneCookie = sessionCookieFrom(madeGoneFam);
    check("a second family can be created to test delete", madeGoneFam.status === 201 && goneCookie, `status=${madeGoneFam.status}`);

    const madeGoneTrad = await fetch(`${base}/api/family/traditions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: goneCookie },
      body: JSON.stringify({ name: "Flashlight walk", practice_note: "Then cocoa.", date: "2026-02-06", recur_type: "nth_weekday" }),
    });
    const goneTrad = await madeGoneTrad.json();
    check("delete-test family can add a tradition", madeGoneTrad.status === 201 && goneTrad.household_path && goneTrad.tradition_path, JSON.stringify(goneTrad));

    const gonePhoto = new FormData();
    gonePhoto.set("tradition_id", goneTrad.id);
    gonePhoto.set("year", "2024");
    gonePhoto.set("file", new Blob([JPG], { type: "image/jpeg" }), "year.jpg");
    const goneUp = await fetch(`${base}/api/upload`, { method: "POST", headers: { cookie: goneCookie }, body: gonePhoto });
    const goneMedia = await goneUp.json();
    check("delete-test family can add a photo", goneUp.status === 201 && goneMedia.media_id, JSON.stringify(goneMedia));

    const goneLinkBefore = await fetch(`${base}${goneTrad.household_path}`);
    const goneLinkHtml = await goneLinkBefore.text();
    check("family link works before delete", goneLinkBefore.ok && goneLinkHtml.includes("Flashlight walk"));

    const deleteAnon = await fetch(`${base}/api/family/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: gonePass, confirm: "1" }),
    });
    check("delete requires a login", deleteAnon.status === 401);

    const noConfirm = await fetch(`${base}/api/family/delete`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: goneCookie },
      body: JSON.stringify({ passcode: gonePass }),
    });
    check("delete requires confirmation", noConfirm.status === 400);

    const stillThere = await fetch(`${base}${goneTrad.household_path}`);
    check("family data remains if delete is not confirmed", stillThere.ok);

    const badPass = await fetch(`${base}/api/family/delete`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: goneCookie },
      body: JSON.stringify({ passcode: "wrong-passcode", confirm: "1" }),
    });
    check("delete rejects the wrong passcode", badPass.status === 401);

    const stillThere2 = await fetch(`${base}${goneTrad.household_path}`);
    check("family data remains after a wrong passcode", stillThere2.ok);

    const deleted = await fetch(`${base}/api/family/delete`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: goneCookie },
      body: JSON.stringify({ passcode: gonePass, confirm: "1" }),
    });
    const deletedBody = await deleted.json();
    check("family can delete everything", deleted.ok && deletedBody.deleted === true, JSON.stringify(deletedBody));

    const afterSession = await fetch(`${base}/calendar`, { headers: { cookie: goneCookie }, redirect: "manual" });
    check("deleted family session no longer opens the calendar", afterSession.status === 303 || afterSession.status === 401 || afterSession.status === 302);

    const afterLink = await fetch(`${base}${goneTrad.household_path}`);
    const afterLinkHtml = await afterLink.text();
    check("deleted family link no longer opens", afterLink.status === 404 && /isn't valid|couldn't find/i.test(afterLinkHtml), `status=${afterLink.status}`);

    const afterFamPage = await fetch(`${base}${goneTrad.tradition_path}`, { headers: { cookie: goneCookie }, redirect: "manual" });
    check("deleted tradition page is gone", afterFamPage.status === 404 || afterFamPage.status === 401 || afterFamPage.status === 303 || afterFamPage.status === 302, `status=${afterFamPage.status}`);

    const afterMedia = await fetch(`${base}/media/${goneMedia.media_id}?t=${encodeURIComponent(goneTrad.household_path.split("/t/")[1])}`);
    check("deleted family photo is gone", afterMedia.status === 404);

    const reuseName = await fetch(`${base}/api/family/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: goneName, passcode: gonePass }),
    });
    check("deleted family name can be used again", reuseName.status === 201, `status=${reuseName.status}`);

    // Backup code, forgot passcode, Coming up, Add to calendar, and /sample.
    const post = (url, body, cookie = "") => fetch(`${base}${url}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    const recName = "Recovery Family";
    const recMade = await post("/api/family/create", { name: recName, passcode: "first-passcode" });
    const recBody = await recMade.json();
    const recCookie = sessionCookieFrom(recMade);
    check("new family gets a one-time backup code", recMade.status === 201 && /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/.test(recBody.backup_code || ""), JSON.stringify(recBody));
    const recCal = await (await fetch(`${base}/calendar`, { headers: { cookie: recCookie } })).text();
    check("calendar never shows the backup code again", !recCal.includes(recBody.backup_code) && recCal.includes("Make a new backup code") && !recCal.includes("Make our backup code"));
    const recWrong = await post("/api/family/recover", { name: recName, backup_code: "AAAA-BBBB-CCCC-DDDD", new_passcode: "second-passcode" });
    check("a wrong backup code is refused", recWrong.status === 401);
    const recNoName = await post("/api/family/recover", { name: "Nobody Here", backup_code: recBody.backup_code, new_passcode: "second-passcode" });
    check("a backup code only works with its own family", recNoName.status === 401);
    const sloppy = recBody.backup_code.toLowerCase().replace(/-/g, " ");
    const recOk = await post("/api/family/recover", { name: recName.toLowerCase(), backup_code: sloppy, new_passcode: "second-passcode" });
    const recOkBody = await recOk.json();
    const recOkCookie = sessionCookieFrom(recOk);
    check("backup code sets a new passcode (case and dashes don't matter)", recOk.ok && recOkCookie && recOkBody.calendar_path === "/calendar", JSON.stringify(recOkBody));
    check("a fresh backup code is issued after recovery", /^[0-9A-Z]{4}-/.test(recOkBody.backup_code || "") && recOkBody.backup_code !== recBody.backup_code);
    const recOldPass = await post("/api/family/login", { name: recName, passcode: "first-passcode" });
    check("old passcode stops working after recovery", recOldPass.status === 401);
    const recNewPass = await post("/api/family/login", { name: recName, passcode: "second-passcode" });
    check("new passcode works after recovery", recNewPass.ok);
    const recOldSession = await fetch(`${base}/calendar`, { headers: { cookie: recCookie }, redirect: "manual" });
    check("recovery signs out other devices", recOldSession.status === 303);
    const recReuse = await post("/api/family/recover", { name: recName, backup_code: recBody.backup_code, new_passcode: "third-passcode" });
    check("a used backup code can't be used again", recReuse.status === 401);
    const regenBad = await post("/api/family/backup-code", { passcode: "first-passcode" }, recOkCookie);
    check("making a new backup code needs the passcode", regenBad.status === 401);
    const regen = await post("/api/family/backup-code", { passcode: "second-passcode" }, recOkCookie);
    const regenBody = await regen.json();
    check("family can make a new backup code", regen.ok && regenBody.backup_code && regenBody.backup_code !== recOkBody.backup_code);
    const regenOld = await post("/api/family/recover", { name: recName, backup_code: recOkBody.backup_code, new_passcode: "third-passcode" });
    check("making a new backup code retires the old one", regenOld.status === 401);
    const recLogin = sessionCookieFrom(recNewPass);

    const nyToday = localDate("America/New_York");
    const soonDate = new Date(Date.parse(`${nyToday}T12:00:00Z`) + 5 * 86400000).toISOString().slice(0, 10);
    const soonMade = await post("/api/family/traditions", { name: "Soon Pancake Day", date: soonDate, recur_type: "fixed" }, recLogin);
    const soonBody = await soonMade.json();
    const soonCal = await (await fetch(`${base}/calendar`, { headers: { cookie: recLogin } })).text();
    check("calendar shows a Coming up strip for the next 30 days", soonMade.status === 201 && soonCal.includes("Coming up") && soonCal.includes("Soon Pancake Day") && soonCal.includes("In 5 days"), `ny=${nyToday}`);
    const calIn = async (tz) => (await fetch(`${base}/calendar`, { headers: { cookie: `${recLogin}; recurday_tz=${encodeURIComponent(tz)}` } })).text();
    const kiri = await calIn("Pacific/Kiritimati");
    const pago = await calIn("Pacific/Pago_Pago");
    const todayAttr = (h) => (h.match(/<body[^>]*data-today="([^"]+)"/) || [])[1];
    const highlighted = (h) => (h.match(/class="cal-day today">\s*<a class="cal-num"[^>]*add=(\d{4}-\d{2}-\d{2})/) || [])[1];
    check("calendar's today follows the phone's time zone (UTC+14)", todayAttr(kiri) === localDate("Pacific/Kiritimati") && highlighted(kiri) === localDate("Pacific/Kiritimati"), `${todayAttr(kiri)} ${highlighted(kiri)}`);
    check("calendar's today follows the phone's time zone (UTC-11)", todayAttr(pago) === localDate("Pacific/Pago_Pago") && highlighted(pago) === localDate("Pacific/Pago_Pago") && todayAttr(kiri) !== todayAttr(pago), `${todayAttr(pago)} ${highlighted(pago)}`);
    const nyCal = await (await fetch(`${base}/calendar`, { headers: { cookie: recLogin } })).text();
    check("with no time zone cookie, today is New York's date", todayAttr(nyCal) === nyToday && /data-tz="America\/New_York"/.test(nyCal));
    const badTz = await calIn("Nowhere/Fake");
    check("a bad time zone cookie falls back to New York", todayAttr(badTz) === nyToday);
    check("Coming up offers Add to calendar", soonCal.includes(`/family/ics/${soonBody.id}.ics`));
    const one = await fetch(`${base}/family/ics/${soonBody.id}.ics`, { headers: { cookie: recLogin } });
    const oneText = await one.text();
    const [, mm, dd] = soonDate.split("-").map(Number);
    check(
      "Add to calendar is a yearly .ics with week-before and day-before reminders",
      one.ok && (one.headers.get("content-type") || "").includes("text/calendar") &&
        oneText.startsWith("BEGIN:VCALENDAR\r\n") && oneText.includes(`RRULE:FREQ=YEARLY;BYMONTH=${mm};BYMONTHDAY=${dd}`) &&
        (oneText.match(/BEGIN:VALARM/g) || []).length === 2 && oneText.includes("TRIGGER:-P6DT15H") && oneText.includes("TRIGGER:-PT15H") &&
        oneText.split("\r\n").every((l) => Buffer.byteLength(l) <= 75),
      oneText
    );
    const oneAnon = await fetch(`${base}/family/ics/${soonBody.id}.ics`);
    check("Add to calendar file needs the family login", oneAnon.status === 401);
    const otherFam = await fetch(`${base}/family/ics/${soonBody.id}.ics`, { headers: { cookie: newCookie } });
    check("another family can't download it", otherFam.status === 401 || otherFam.status === 404);
    const soonTradPage = await (await fetch(`${base}${soonBody.tradition_path}`, { headers: { cookie: recLogin } })).text();
    check("tradition page has Add to calendar", soonTradPage.includes(`/family/ics/${soonBody.id}.ics`));

    const homeAgain = await (await fetch(`${base}/`)).text();
    check("home links to the example and to Forgot passcode", homeAgain.includes('href="/sample"') && homeAgain.includes("Forgot passcode?") && homeAgain.includes('id="family-recover-form"'));
    const sample = await fetch(`${base}/sample`);
    const sampleHtml = await sample.text();
    check(
      "sample calendar opens with no login, clearly labeled as an example",
      sample.ok && sampleHtml.includes("The Example Family") && sampleHtml.includes("made-up family") &&
        sampleHtml.includes('href="/#start"') && sampleHtml.includes("Start your own") && !sampleHtml.includes("/media/")
    );
    const sampleIcsRes = await fetch(`${base}/sample/kite-day.ics`);
    const sampleIcsText = await sampleIcsRes.text();
    check("sample Add to calendar file is a calendar", sampleIcsRes.ok && sampleIcsText.includes("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU") && sampleIcsText.includes("BEGIN:VALARM"), sampleIcsRes.headers.get("content-type"));
    const art = await fetch(`${base}/sample/art/kite-day.svg`);
    const artText = await art.text();
    check("sample pictures are tiny bundled drawings", art.ok && artText.startsWith("<svg") && artText.length < 2000);

    const lockerName = "Lockout Family";
    let lastLock;
    for (let i = 0; i < 5; i++) {
      lastLock = await fetch(`${base}/api/family/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: lockerName, passcode: "definitely-wrong" }),
      });
    }
    const locked = await fetch(`${base}/api/family/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: lockerName, passcode: "definitely-wrong" }),
    });
    check("login is locked after repeated failures", locked.status === 429, `status=${locked.status} prior=${lastLock.status}`);
    const neighbor = await fetch(`${base}/api/family/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: goneName, passcode: gonePass }),
    });
    check("one family's wrong guesses don't lock out others on the same Wi-Fi", neighbor.status === 200, `status=${neighbor.status}`);

  } finally {
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      if (!child.killed) child.kill("SIGKILL");
    }
    await rm(persist, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
