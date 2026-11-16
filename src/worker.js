import { mediaStore } from "./storage.js";

const NAME_MAX = 80;
const TIMING_MAX = 200;
const NOTE_MAX = 2000;
const LABEL_MAX = 80;
const PHOTO_MAX = 2 * 1024 * 1024;
const TRADITION_MAX_BYTES = 100 * PHOTO_MAX;
const TRADITION_MAX_ITEMS = 100;
const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

const SECURITY = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'",
};

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error(err);
      return json({ error: "Something went wrong." }, 500);
    }
  },
};

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: SECURITY });
  }

  if (path.startsWith("/api/")) return api(request, env, url);
  if (path.startsWith("/media/")) return media(request, env, url);
  if (path.startsWith("/t/")) return traditionPage(request, env, url, "household");
  if (path.startsWith("/a/")) return traditionPage(request, env, url, "admin");
  if (path.startsWith("/s/")) return traditionPage(request, env, url, "share");

  if (env.ASSETS) {
    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  }
  return new Response("Not found", { status: 404, headers: SECURITY });
}

async function api(request, env, url) {
  const path = url.pathname;
  if (request.method === "POST" && path === "/api/traditions") return createTradition(request, env);
  if (request.method === "GET" && path === "/api/tradition") return traditionJson(request, env, url);
  if (request.method === "POST" && path === "/api/days") return upsertDay(request, env);
  if (request.method === "POST" && path === "/api/upload") return upload(request, env);
  if (request.method === "POST" && path === "/api/shares") return createShare(request, env);
  if (request.method === "POST" && path === "/api/shares/revoke") return revokeShare(request, env);
  if (request.method === "POST" && path === "/api/shares/accept") return acceptShare(request, env);
  if (request.method === "POST" && path === "/api/shares/copy") return copyTradition(request, env);
  if (request.method === "POST" && path === "/api/household/rotate") return rotateHousehold(request, env);
  return json({ error: "Not found." }, 404);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...SECURITY },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...SECURITY },
  });
}

function originOf(request) {
  return new URL(request.url).origin;
}

async function sha256hex(value) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(18)));
}

function base64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function nowIso() {
  return new Date().toISOString();
}

function clip(s, max) {
  return String(s ?? "").trim().slice(0, max);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function yearOk(year) {
  const n = Number(year);
  return Number.isInteger(n) && n >= YEAR_MIN && n <= YEAR_MAX;
}

async function readBody(request) {
  const ctype = request.headers.get("content-type") || "";
  if (ctype.includes("application/json")) return request.json();
  if (ctype.includes("form")) {
    const fd = await request.formData();
    return Object.fromEntries(fd.entries());
  }
  return {};
}

function tokenFrom(request, body, url) {
  return (
    request.headers.get("x-recurday-token") ||
    body?.t ||
    body?.token ||
    url?.searchParams.get("t") ||
    ""
  ).trim();
}

async function resolve(env, token) {
  if (!token || token.length < 16) return null;
  const hash = await sha256hex(token);
  const byHousehold = await env.DB.prepare(
    "SELECT * FROM traditions WHERE household_token_hash = ?"
  ).bind(hash).first();
  if (byHousehold) return { role: "household", tradition: byHousehold, share: null, token };
  const byAdmin = await env.DB.prepare(
    "SELECT * FROM traditions WHERE admin_token_hash = ?"
  ).bind(hash).first();
  if (byAdmin) return { role: "admin", tradition: byAdmin, share: null, token };
  const share = await env.DB.prepare(
    "SELECT * FROM shares WHERE token_hash = ?"
  ).bind(hash).first();
  if (!share || share.revoked_at) return null;
  const tradition = await env.DB.prepare(
    "SELECT * FROM traditions WHERE id = ?"
  ).bind(share.tradition_id).first();
  if (!tradition) return null;
  return { role: "share", tradition, share, token };
}

async function loadDays(env, traditionId, yearsPolicy, includeMedia) {
  let days = (await env.DB.prepare(
    "SELECT * FROM days WHERE tradition_id = ? ORDER BY year DESC"
  ).bind(traditionId).all()).results || [];
  if (yearsPolicy && yearsPolicy !== "all") {
    let allowed;
    try { allowed = new Set(JSON.parse(yearsPolicy)); } catch { allowed = null; }
    if (allowed) days = days.filter((d) => allowed.has(d.year));
  }
  if (!includeMedia) return days.map((d) => ({ ...d, media: [] }));
  const out = [];
  for (const day of days) {
    const media = (await env.DB.prepare(
      "SELECT id, mime, byte_size, created_at FROM media WHERE day_id = ? ORDER BY created_at ASC"
    ).bind(day.id).all()).results || [];
    out.push({ ...day, media });
  }
  return out;
}

async function traditionUsage(env, traditionId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS items, COALESCE(SUM(byte_size), 0) AS bytes
     FROM media JOIN days ON days.id = media.day_id
     WHERE days.tradition_id = ?`
  ).bind(traditionId).first();
  return { items: Number(row?.items || 0), bytes: Number(row?.bytes || 0) };
}

async function listShares(env, traditionId) {
  return (await env.DB.prepare(
    `SELECT id, label, accepted_at, revoked_at, created_at
     FROM shares WHERE tradition_id = ? ORDER BY created_at DESC`
  ).bind(traditionId).all()).results || [];
}

async function present(env, auth, origin) {
  const { role, tradition, share, token } = auth;
  const accepted = role !== "share" || Boolean(share.accepted_at);
  const canViewMedia = role === "admin" || role === "household" || accepted;
  const yearsPolicy = role === "share" ? share.years_policy : "all";
  const days = canViewMedia ? await loadDays(env, tradition.id, yearsPolicy, true) : [];
  const shares = role === "admin" ? await listShares(env, tradition.id) : [];
  return {
    role,
    accepted,
    can_upload: role === "admin" || role === "household",
    can_admin: role === "admin",
    tradition: {
      id: tradition.id,
      name: tradition.name,
      timing_note: tradition.timing_note,
      practice_note: tradition.practice_note,
    },
    share: share ? { id: share.id, label: share.label, accepted: Boolean(share.accepted_at) } : null,
    shares,
    days: days.map((d) => ({
      year: d.year,
      observed_on: d.observed_on,
      note: d.note,
      media: d.media.map((m) => ({
        id: m.id,
        mime: m.mime,
        url: `/media/${m.id}?t=${encodeURIComponent(token)}`,
      })),
    })),
    origin,
  };
}

async function createTradition(request, env) {
  const body = await readBody(request);
  const name = clip(body.name, NAME_MAX);
  const timing_note = clip(body.timing_note, TIMING_MAX);
  const practice_note = clip(body.practice_note, NOTE_MAX);
  if (!name) return json({ error: "Please give this tradition a name." }, 400);

  const id = crypto.randomUUID();
  const household = randomToken();
  const admin = randomToken();
  await env.DB.prepare(
    `INSERT INTO traditions
      (id, name, timing_note, practice_note, created_at, household_token_hash, admin_token_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, name, timing_note, practice_note, nowIso(), await sha256hex(household), await sha256hex(admin)).run();

  const origin = originOf(request);
  const payload = {
    id,
    name,
    timing_note,
    practice_note,
    household_path: `/t/${household}`,
    admin_path: `/a/${admin}`,
    household_url: `${origin}/t/${household}`,
    admin_url: `${origin}/a/${admin}`,
  };
  const ctype = request.headers.get("content-type") || "";
  if (!ctype.includes("application/json")) {
    return Response.redirect(`${origin}/a/${admin}?new=${encodeURIComponent(household)}`, 303);
  }
  return json(payload, 201);
}

async function traditionJson(request, env, url) {
  const auth = await resolve(env, tokenFrom(request, {}, url));
  if (!auth) return json({ error: "We couldn't find that link." }, 404);
  return json(await present(env, auth, originOf(request)));
}

async function upsertDay(request, env) {
  const body = await readBody(request);
  const auth = await resolve(env, tokenFrom(request, body));
  if (!auth) return json({ error: "We couldn't find that link." }, 404);
  if (auth.role === "share") return json({ error: "This invite is only for looking, not adding." }, 403);
  const year = Number(body.year);
  if (!yearOk(year)) return json({ error: "Please choose a valid year." }, 400);
  const day = await ensureDay(env, auth.tradition.id, year, body);
  return json({ ok: true, day_id: day.id, year: day.year });
}

async function ensureDay(env, traditionId, year, fields = {}) {
  const existing = await env.DB.prepare(
    "SELECT * FROM days WHERE tradition_id = ? AND year = ?"
  ).bind(traditionId, year).first();
  const observed = fields.observed_on ? clip(fields.observed_on, 20) : existing?.observed_on || null;
  const note = fields.note !== undefined ? clip(fields.note, NOTE_MAX) : existing?.note || "";
  if (existing) {
    if (fields.note !== undefined || fields.observed_on !== undefined) {
      await env.DB.prepare("UPDATE days SET observed_on = ?, note = ? WHERE id = ?")
        .bind(observed, note, existing.id).run();
    }
    return { ...existing, observed_on: observed, note };
  }
  const id = crypto.randomUUID();
  const created_at = nowIso();
  await env.DB.prepare(
    `INSERT INTO days (id, tradition_id, year, observed_on, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, traditionId, year, observed, note, created_at).run();
  return { id, tradition_id: traditionId, year, observed_on: observed, note, created_at };
}

async function upload(request, env) {
  const ctype = request.headers.get("content-type") || "";
  if (!ctype.includes("multipart/form-data")) {
    return json({ error: "Please send the file as a form upload." }, 400);
  }
  const fd = await request.formData();
  const body = Object.fromEntries([...fd.entries()].filter(([k]) => k !== "file"));
  const auth = await resolve(env, tokenFrom(request, body));
  if (!auth) return json({ error: "We couldn't find that link." }, 404);
  if (auth.role === "share") return json({ error: "This invite is only for looking, not adding." }, 403);
  const year = Number(body.year);
  if (!yearOk(year)) return json({ error: "Please choose a valid year." }, 400);
  const file = fd.get("file");
  if (!file || typeof file === "string" || !file.size) {
    return json({ error: "Choose a photo first." }, 400);
  }
  const mime = (file.type || "application/octet-stream").toLowerCase();
  if (VIDEO_TYPES.has(mime) || mime.startsWith("video/")) {
    return json({ error: "Video coming soon." }, 400);
  }
  if (!PHOTO_TYPES.has(mime)) return json({ error: "Please choose a photo." }, 400);
  if (file.size > PHOTO_MAX) return json({ error: "That photo is too large. Please keep it to about 2 MB." }, 400);
  const usage = await traditionUsage(env, auth.tradition.id);
  if (usage.items >= TRADITION_MAX_ITEMS) {
    return json({ error: "This tradition has reached its Day-1 item limit." }, 400);
  }
  if (usage.bytes + file.size > TRADITION_MAX_BYTES) {
    return json({ error: "This tradition has reached its Day-1 storage limit." }, 400);
  }
  const day = await ensureDay(env, auth.tradition.id, year, body);
  const id = crypto.randomUUID();
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg";
  const key = `${auth.tradition.id}/${day.id}/${id}.${ext}`;
  await mediaStore(env).put(key, file, { contentType: mime });
  await env.DB.prepare(
    `INSERT INTO media (id, day_id, r2_key, mime, byte_size, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, day.id, key, mime, file.size, nowIso()).run();
  return json({ ok: true, media_id: id, year, day_id: day.id }, 201);
}

async function media(request, env, url) {
  const id = url.pathname.slice("/media/".length).split("/")[0];
  const auth = await resolve(env, tokenFrom(request, {}, url));
  if (!auth || !id) return new Response("Not found", { status: 404, headers: SECURITY });
  const row = await env.DB.prepare(
    `SELECT media.*, days.year, days.tradition_id
     FROM media JOIN days ON days.id = media.day_id
     WHERE media.id = ?`
  ).bind(id).first();
  if (!row || row.tradition_id !== auth.tradition.id) {
    return new Response("Not found", { status: 404, headers: SECURITY });
  }
  if (auth.role === "share") {
    if (!auth.share.accepted_at) return new Response("Not found", { status: 404, headers: SECURITY });
    if (auth.share.years_policy && auth.share.years_policy !== "all") {
      let allowed;
      try { allowed = new Set(JSON.parse(auth.share.years_policy)); } catch { allowed = null; }
      if (allowed && !allowed.has(row.year)) {
        return new Response("Not found", { status: 404, headers: SECURITY });
      }
    }
  }
  const obj = await mediaStore(env).get(row.r2_key);
  if (!obj) return new Response("Not found", { status: 404, headers: SECURITY });
  const headers = new Headers(SECURITY);
  headers.set("content-type", row.mime);
  headers.set("cache-control", "private, max-age=3600");
  headers.set("content-disposition", "inline");
  headers.set("x-content-type-options", "nosniff");
  return new Response(obj.body, { headers });
}

async function createShare(request, env) {
  const body = await readBody(request);
  const auth = await resolve(env, tokenFrom(request, body));
  if (!auth) return json({ error: "We couldn't find that link." }, 404);
  if (auth.role !== "admin") return json({ error: "Only the keeper link can invite another family." }, 403);
  const label = clip(body.label, LABEL_MAX);
  if (!label) return json({ error: "Please name the family you're inviting." }, 400);
  const token = randomToken();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO shares (id, tradition_id, label, token_hash, years_policy, created_at)
     VALUES (?, ?, ?, ?, 'all', ?)`
  ).bind(id, auth.tradition.id, label, await sha256hex(token), nowIso()).run();
  const origin = originOf(request);
  return json({
    share_id: id,
    label,
    invite_path: `/s/${token}`,
    invite_url: `${origin}/s/${token}`,
    admin_path: `/a/${auth.token}`,
  }, 201);
}

async function revokeShare(request, env) {
  const body = await readBody(request);
  const auth = await resolve(env, tokenFrom(request, body));
  if (!auth) return json({ error: "We couldn't find that link." }, 404);
  if (auth.role !== "admin") return json({ error: "Only the keeper link can stop a share." }, 403);
  const share = await env.DB.prepare(
    "SELECT * FROM shares WHERE id = ? AND tradition_id = ?"
  ).bind(body.share_id, auth.tradition.id).first();
  if (!share) return json({ error: "We couldn't find that invite." }, 404);
  await env.DB.prepare(
    "UPDATE shares SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL"
  ).bind(nowIso(), share.id).run();
  return json({ ok: true });
}

async function acceptShare(request, env) {
  const body = await readBody(request);
  const auth = await resolve(env, tokenFrom(request, body, new URL(request.url)));
  if (!auth || auth.role !== "share") return json({ error: "We couldn't find that invite." }, 404);
  if (!auth.share.accepted_at) {
    await env.DB.prepare(
      "UPDATE shares SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL"
    ).bind(nowIso(), auth.share.id).run();
  }
  const ctype = request.headers.get("content-type") || "";
  if (!ctype.includes("application/json")) {
    return Response.redirect(`${originOf(request)}/s/${auth.token}`, 303);
  }
  return json({ ok: true });
}

async function copyTradition(request, env) {
  const body = await readBody(request);
  const auth = await resolve(env, tokenFrom(request, body, new URL(request.url)));
  if (!auth || auth.role !== "share") return json({ error: "We couldn't find that invite." }, 404);
  if (!auth.share.accepted_at) return json({ error: "Please accept the invite first." }, 403);
  const id = crypto.randomUUID();
  const household = randomToken();
  const admin = randomToken();
  const created_at = nowIso();
  await env.DB.prepare(
    `INSERT INTO traditions
      (id, name, timing_note, practice_note, created_at, household_token_hash, admin_token_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    auth.tradition.name,
    auth.tradition.timing_note,
    auth.tradition.practice_note,
    created_at,
    await sha256hex(household),
    await sha256hex(admin)
  ).run();
  await env.DB.prepare(
    "INSERT INTO copies (new_tradition_id, source_tradition_id, created_at) VALUES (?, ?, ?)"
  ).bind(id, auth.tradition.id, created_at).run();
  const origin = originOf(request);
  return json({
    id,
    name: auth.tradition.name,
    household_path: `/t/${household}`,
    admin_path: `/a/${admin}`,
    household_url: `${origin}/t/${household}`,
    admin_url: `${origin}/a/${admin}`,
  }, 201);
}

async function rotateHousehold(request, env) {
  const body = await readBody(request);
  const auth = await resolve(env, tokenFrom(request, body));
  if (!auth) return json({ error: "We couldn't find that link." }, 404);
  if (auth.role !== "admin") return json({ error: "Only the keeper link can make a fresh family link." }, 403);
  const household = randomToken();
  await env.DB.prepare(
    "UPDATE traditions SET household_token_hash = ? WHERE id = ?"
  ).bind(await sha256hex(household), auth.tradition.id).run();
  const origin = originOf(request);
  return json({
    household_path: `/t/${household}`,
    household_url: `${origin}/t/${household}`,
  });
}

async function traditionPage(request, env, url, expectedRole) {
  const token = decodeURIComponent(url.pathname.split("/")[2] || "");
  const auth = await resolve(env, token);
  if (!auth || auth.role !== expectedRole) {
    return html(pageShell({
      title: "Recurday",
      description: "This link isn't valid, or it was stopped.",
      ogTitle: "Recurday",
      ogDescription: "A private family tradition link.",
      origin: originOf(request),
      body: `<h1>This link isn't valid.</h1><p class="lead">It may have been typed wrong, or the family who sent it may have stopped the share.</p>`,
    }), 404);
  }
  const yearParam = Number(url.searchParams.get("year"));
  const data = await present(env, auth, originOf(request));
  const years = data.days.map((d) => d.year);
  const currentYear = new Date().getFullYear();
  let selected = yearOk(yearParam) ? yearParam : (years[0] || currentYear);
  if (!years.includes(selected) && years.length && auth.role === "share") selected = years[0];
  const selectedDay = data.days.find((d) => d.year === selected);
  const newHousehold = expectedRole === "admin" ? url.searchParams.get("new") : "";
  const body = renderTradition(data, { selected, selectedDay, currentYear, token, newHousehold });
  const when = data.tradition.timing_note || "A family tradition";
  return html(pageShell({
    title: `${data.tradition.name} — Recurday`,
    description: when,
    ogTitle: data.tradition.name,
    ogDescription: [when, data.tradition.practice_note].filter(Boolean).join(" — ").slice(0, 180),
    origin: originOf(request),
    body,
  }));
}

function pageShell({ title, description, ogTitle, ogDescription, origin, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <meta name="referrer" content="no-referrer">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta property="og:title" content="${esc(ogTitle)}">
  <meta property="og:description" content="${esc(ogDescription)}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${esc(origin)}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.png" type="image/png">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="wrap">
    <header class="top">
      <a class="brand" href="/">Recurday</a>
    </header>
    ${body}
  </div>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

function renderTradition(data, { selected, selectedDay, currentYear, token, newHousehold }) {
  const { tradition, role, accepted, can_upload, can_admin, days } = data;
  if (role === "share" && !accepted) {
    return `
      <p class="eyebrow">A family invited you</p>
      <h1>${esc(tradition.name)}</h1>
      <p class="lead">They wanted to show you a tradition they keep. Accept to look — their photos stay private until you do.</p>
      <div class="card">
        <p><strong>When:</strong> ${esc(tradition.timing_note || "They haven't written when it happens yet.")}</p>
        ${tradition.practice_note ? `<p class="practice">${esc(tradition.practice_note)}</p>` : ""}
        <form id="accept-form" method="post" action="/api/shares/accept">
          <input type="hidden" name="t" value="${esc(token)}">
          <button class="btn" type="submit">Accept and view</button>
          <p class="error hidden" id="accept-error"></p>
        </form>
      </div>`;
  }

  const yearSet = new Set(days.map((d) => d.year));
  if (can_upload) {
    yearSet.add(selected);
    yearSet.add(currentYear);
  }
  const yearList = [...yearSet].sort((a, b) => b - a);
  const prefix = role === "admin" ? "/a" : role === "share" ? "/s" : "/t";
  const chips = yearList.map((y) => {
    const current = y === selected ? ' aria-current="true"' : "";
    return `<a class="year" href="${esc(`${prefix}/${token}?year=${y}`)}"${current}>${y}</a>`;
  }).join("");

  const mediaHtml = (selectedDay?.media || []).map((m) =>
    m.mime.startsWith("video/")
      ? `<video controls playsinline preload="metadata" src="${esc(m.url)}"></video>`
      : `<img alt="" src="${esc(m.url)}">`
  ).join("");

  const upload = can_upload ? `
    <div class="card">
      <h2>This year</h2>
      <form id="upload-form" data-token="${esc(token)}">
        <label for="year">Year</label>
        <input id="year" name="year" type="number" min="${YEAR_MIN}" max="${YEAR_MAX}" value="${esc(selected)}">
        <label for="observed_on">The date you kept it (optional)</label>
        <input id="observed_on" name="observed_on" type="date" value="${esc(selectedDay?.observed_on || "")}">
        <label for="day_note">A short note (optional)</label>
        <textarea id="day_note" name="note" maxlength="2000">${esc(selectedDay?.note || "")}</textarea>
        <label for="file">A photo</label>
        <input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
        <p class="hint">Photos are shrunk on your phone before they upload. Video coming soon.</p>
        <button class="btn" type="submit">Add to this year</button>
        <p class="hint" id="upload-status"></p>
        <p class="error hidden" id="upload-error"></p>
      </form>
    </div>` : (selectedDay?.note ? `<div class="card"><p class="practice">${esc(selectedDay.note)}</p></div>` : "");

  const shareBlock = role === "share" ? `
    <div class="card">
      <h2>Start this tradition too</h2>
      <p>This copies the name and how they do it — not their photos. You'll get your own links to fill with your family's days.</p>
      <form id="copy-form" method="post" action="/api/shares/copy">
        <input type="hidden" name="t" value="${esc(token)}">
        <button class="btn moss" type="submit">Start this tradition too</button>
        <p class="error hidden" id="copy-error"></p>
      </form>
      <div id="copy-result" class="hidden"></div>
    </div>` : "";

  return `
    <p class="eyebrow">${role === "share" ? "Shared with you" : "A family tradition"}</p>
    <h1>${esc(tradition.name)}</h1>
    <p class="lead">${esc(tradition.timing_note || "")}</p>
    ${tradition.practice_note ? `<div class="card"><p class="practice">${esc(tradition.practice_note)}</p></div>` : ""}
    ${renderFamilyLink(data, token, newHousehold)}
    <div class="years" aria-label="Years">${chips}</div>
    ${mediaHtml ? `<div class="media-grid">${mediaHtml}</div>` : `<p class="empty">${can_upload ? "Nothing here for this year yet." : "Nothing has been added for this year."}</p>`}
    ${upload}
    ${shareBlock}
    ${can_admin ? renderAdmin(data, token) : ""}
    <p class="foot">Private by default. No likes, no rankings, no public list of traditions.</p>`;
}

function renderFamilyLink(data, token, newHousehold) {
  if (data.role === "household") {
    const url = `${data.origin}/t/${token}`;
    return `
      <div class="actions">
        <button class="btn" type="button" id="copy-household" data-url="${esc(url)}" data-name="${esc(data.tradition.name)}">Send to our family</button>
        <p class="hint">Anyone with this link can add photos and rewatch. There is no app to install.</p>
      </div>`;
  }
  if (data.role !== "admin") return "";
  const fresh = newHousehold
    ? `<div class="notice">
        <p class="ok">Save these links. We can't email them to you.</p>
        <div class="links">
          <p><strong>Family link</strong> — text this one:<br><a href="/t/${esc(newHousehold)}">${esc(data.origin)}/t/${esc(newHousehold)}</a></p>
        </div>
        <button class="btn" type="button" id="copy-household" data-url="${esc(data.origin)}/t/${esc(newHousehold)}" data-name="${esc(data.tradition.name)}">Send to our family</button>
      </div>`
    : `<p class="hint">This is the keeper page. To text your family, use the family link you saved when you created this tradition. If you lost it, make a fresh one — the old family link will stop working.</p>`;
  return `
    <div class="card">
      ${fresh}
      <button class="btn secondary" type="button" id="rotate-household" data-token="${esc(token)}">Make a fresh family link</button>
      <div id="rotate-result"></div>
    </div>`;
}

function renderAdmin(data, token) {
  const rows = (data.shares || []).map((s) => {
    const state = s.revoked_at ? "Stopped" : s.accepted_at ? "Accepted" : "Waiting for them to accept";
    const stop = s.revoked_at ? "" : `<button class="btn secondary" type="button" data-revoke="${esc(s.id)}">Stop this share</button>`;
    return `<div class="notice"><p><strong>${esc(s.label)}</strong> — ${esc(state)}</p>${stop}</div>`;
  }).join("");
  return `
    <div class="card" id="keeper">
      <h2>Invite another family</h2>
      <p>They'll see this tradition after they accept. They can start it too for themselves. You can stop the share at any time. Their invite is separate from your family's link.</p>
      <form id="invite-form" data-token="${esc(token)}">
        <label for="label">Who is this for? (just so you remember)</label>
        <input id="label" name="label" type="text" maxlength="80" required placeholder="The Millers">
        <button class="btn moss" type="submit">Create an invite link</button>
        <p class="error hidden" id="invite-error"></p>
      </form>
      <div id="invite-result"></div>
      ${rows}
    </div>`;
}
