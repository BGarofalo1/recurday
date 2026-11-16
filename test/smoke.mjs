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
    check("household page has send-to-family", familyHtml.includes("Send to our family"));
    check("household page has no like/count chrome", !familyHtml.includes("leaderboard") && !familyHtml.includes('id="like"') && !familyHtml.includes("Like this"));
    check("household link preview uses generic image", familyHtml.includes('property="og:image"') && familyHtml.includes("/og.png") && !/property="og:image" content="[^"]*\/media\//.test(familyHtml));
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
    check("keeper page can still rewatch", keeper.ok && keeperHtml.includes("Pancake Saturday") && keeperHtml.includes("Invite another family"));
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
