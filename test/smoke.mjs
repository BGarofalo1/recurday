import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

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
    check("home is noindex", (home.headers.get("x-robots-tag") || "").includes("noindex") && homeHtml.includes("noindex"));
    check("home has no likes or rankings", !/leaderboard|like button|popularity/i.test(homeHtml) && !homeHtml.includes("id=\"like\""));

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
        manifest.theme_color === "#f6efe4" &&
        manifest.background_color === "#f6efe4",
      JSON.stringify(manifest)
    );
    const purposes = (manifest.icons || []).flatMap((icon) => String(icon.purpose || "any").split(/\s+/));
    const sizes = new Set((manifest.icons || []).map((icon) => icon.sizes));
    check("manifest has 192, 512, and maskable icons", sizes.has("192x192") && sizes.has("512x512") && purposes.includes("any") && purposes.includes("maskable"));

    const iconChecks = [
      ["/icons/icon-192.png", 192],
      ["/icons/icon-512.png", 512],
      ["/icons/icon-192-maskable.png", 192],
      ["/icons/icon-512-maskable.png", 512],
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
    check("service worker caches the app shell", /recurday-shell/.test(swText) && shellList.includes("/offline.html") && shellList.includes("/styles.css") && shellList.includes("/app.js"));
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
    check("offline fallback page loads", offline.status === 200 && (offline.headers.get("content-type") || "").includes("text/html") && offlineHtml.includes("You're offline"));

    check(
      "home is installable on iOS and Android",
      homeHtml.includes('rel="manifest"') &&
        homeHtml.includes("/manifest.webmanifest") &&
        homeHtml.includes('rel="apple-touch-icon"') &&
        homeHtml.includes('name="theme-color" content="#f6efe4"') &&
        homeHtml.includes('name="apple-mobile-web-app-capable" content="yes"') &&
        homeHtml.includes('name="apple-mobile-web-app-title" content="Recurday"') &&
        homeHtml.includes("/app.js")
    );
    check("home still uses the generic share image", homeHtml.includes('property="og:image" content="/og.png"'));


    const robots = await fetch(`${base}/robots.txt`);
    const robotsTxt = await robots.text();
    check("robots.txt disallows all", robots.ok && /Disallow:\s*\//.test(robotsTxt));

    const missing = await fetch(`${base}/api/traditions`);
    check("no public tradition index", missing.status === 404);

    const created = await fetch(`${base}/api/traditions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Pancake Saturday",
        timing_note: "First Saturday in June",
        practice_note: "Pancakes, then the creek.",
      }),
    });
    const trad = await created.json();
    check("create tradition", created.status === 201 && trad.household_url && trad.admin_url, JSON.stringify(trad));
    const householdToken = trad.household_path.split("/t/")[1];
    const adminToken = trad.admin_path.split("/a/")[1];

    const familyPage = await fetch(`${base}${trad.household_path}`);
    const familyHtml = await familyPage.text();
    check("household page title and og", familyPage.ok && familyHtml.includes("<title>Pancake Saturday — Recurday</title>") && familyHtml.includes('property="og:title" content="Pancake Saturday"'));
    check("household page noindex", (familyPage.headers.get("x-robots-tag") || "").includes("noindex"));
    check("household page has text-to-family", familyHtml.includes("Text this to family"));
    check("household page has no like/count chrome", !familyHtml.includes("leaderboard") && !familyHtml.includes('id="like"') && !familyHtml.includes("Like this"));
    check("household link preview uses generic image", familyHtml.includes('property="og:image"') && familyHtml.includes("/og.png") && !/property="og:image" content="[^"]*\/media\//.test(familyHtml));
    check(
      "household page keeps install tags and a rainbow hue",
      familyHtml.includes('rel="manifest" href="/manifest.webmanifest"') &&
        familyHtml.includes('rel="apple-touch-icon"') &&
        familyHtml.includes('name="theme-color" content="#f6efe4"') &&
        familyHtml.includes("/icons/mark.svg") &&
        /class="wrap hue-(red|orange|yellow|green|blue|indigo|violet)"/.test(familyHtml)
    );
    check("video upload is hidden with coming-soon note", familyHtml.includes("Video coming soon") && familyHtml.includes('accept="image/jpeg,image/png,image/webp,image/gif"') && !familyHtml.includes("video/mp4"));

    const form = new FormData();
    form.set("t", householdToken);
    form.set("year", "2024");
    form.set("note", "The first year.");
    form.set("file", new Blob([JPG], { type: "image/jpeg" }), "creek.jpg");
    const uploaded = await fetch(`${base}/api/upload`, { method: "POST", body: form });
    const up = await uploaded.json();
    check("upload photo for 2024", uploaded.status === 201 && up.media_id, JSON.stringify(up));

    const videoForm = new FormData();
    videoForm.set("t", householdToken);
    videoForm.set("year", "2024");
    videoForm.set("file", new Blob([new Uint8Array([0, 0, 0, 0])], { type: "video/mp4" }), "clip.mp4");
    const videoUp = await fetch(`${base}/api/upload`, { method: "POST", body: videoForm });
    const videoBody = await videoUp.json();
    check("video upload is rejected", videoUp.status === 400 && /coming soon/i.test(videoBody.error || ""), JSON.stringify(videoBody));

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
    check("invite is gated until accept", pending.ok && pendingHtml.includes("Accept and view") && !pendingHtml.includes(`/media/${up.media_id}`));
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
    check("copied practice has the same name and notes", copyPage.ok && copyHtml.includes("Pancake Saturday") && copyHtml.includes("Pancakes, then the creek.") && copyHtml.includes("First Saturday in June"));
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
    check("their own started tradition still works after revoke", copyStill.ok && (await copyStill.text()).includes("Pancake Saturday"));

    const keeper = await fetch(`${base}${trad.admin_path}`);
    const keeperHtml = await keeper.text();
    check("keeper page can still rewatch", keeper.ok && keeperHtml.includes("Pancake Saturday") && keeperHtml.includes("Pass it on"));

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
        passHtml.includes("Start your own family's traditions") &&
        passHtml.includes('property="og:image"') &&
        passHtml.includes("/og.png") &&
        (passPage.headers.get("x-robots-tag") || "").includes("noindex")
    );

    const yearHtml2 = await (await fetch(`${base}${trad.household_path}?year=2024`)).text();
    check("through the years is offered when a year has photos", yearHtml2.includes("Through the years") && yearHtml2.includes("id=\"years-data\""));

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
      body: JSON.stringify({ name: "Pancake Saturday", practice_note: "Pancakes together.", date: "2026-06-06", recur_type: "nth_weekday" }),
    });
    const made = await madeOnCal.json();
    check("logged-in family can add a tradition from a date", madeOnCal.status === 201 && made.tradition_path, JSON.stringify(made));
    const calJune = await fetch(`${base}/calendar?year=2026&month=6`, { headers: { cookie: loginCookie } });
    const juneHtml = await calJune.text();
    check("calendar shows the tradition on its date", calJune.ok && juneHtml.includes("Pancake Saturday") && juneHtml.includes("/f/") && juneHtml.includes("hue-"));

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
        zipText.includes("Pancake Saturday")
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
