import { mediaStore } from "./storage.js";
import { SECURITY, json, html, esc, pageShell, familyNav, nowIso, clip, originOf, TAGLINE } from "./http.js";
import { hueOf, parseTiming, bindRule, describeRule } from "./calendar.js";
import { sha256hex, randomToken } from "./auth.js";
import { familyFromRequest, handleFamilyApi, calendarPage, calendarFeed, familyExport, canClaimRole } from "./family.js";
import { coverUrls } from "./cover.js";

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

  if (path.startsWith("/api/family/")) return handleFamilyApi(request, env, url);
  if (path.startsWith("/api/")) return api(request, env, url);
  if (path.startsWith("/media/")) return media(request, env, url);
  if (path.startsWith("/t/")) return traditionPage(request, env, url, "household");
  if (path.startsWith("/a/")) return traditionPage(request, env, url, "admin");
  if (path.startsWith("/s/")) return traditionPage(request, env, url, "share");
  if (path.startsWith("/f/")) return familyTraditionPage(request, env, url);
  if (path === "/calendar") return calendarPage(request, env, url);
  if (path.startsWith("/cal/")) return calendarFeed(request, env, url);
  if (path.startsWith("/family/export")) return familyExport(request, env, url);

  if ((path === "/" || path === "/index.html") && request.method === "GET" && await familyFromRequest(request, env)) {
    return new Response(null, { status: 303, headers: { ...SECURITY, location: "/calendar" } });
  }

  if (path === "/sw.js") {
    return serveAsset(request, env, "/sw.js", {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
      "Service-Worker-Allowed": "/",
    });
  }

  if (path === "/manifest.webmanifest") {
    return serveAsset(request, env, "/manifest.webmanifest", {
      "content-type": "application/manifest+json; charset=utf-8",
    });
  }

  if (path === "/offline.html" || path === "/offline") {
    return serveAsset(request, env, path, {
      "content-type": "text/html; charset=utf-8",
    });
  }

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

async function serveAsset(request, env, path, extraHeaders = {}) {
  if (!env.ASSETS) return new Response("Not found", { status: 404, headers: SECURITY });
  const first = new URL(path, request.url);
  let res = await env.ASSETS.fetch(new Request(first, { method: "GET" }));
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("Location");
    if (loc) {
      const next = new URL(loc, first);
      if (next.origin === first.origin) {
        res = await env.ASSETS.fetch(new Request(next, { method: "GET" }));
      }
    }
  }
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
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

async function resolveRequest(request, env, body, url) {
  const token = tokenFrom(request, body, url);
  if (token) return resolve(env, token);
  const family = await familyFromRequest(request, env);
  if (!family) return null;
  const tid = String(body?.tradition_id || url?.searchParams.get("tradition_id") || "").trim();
  if (!tid) return { role: "family", family, tradition: null, share: null, token: "" };
  const tradition = await env.DB.prepare(
    "SELECT * FROM traditions WHERE id = ? AND family_id = ?"
  ).bind(tid, family.id).first();
  if (!tradition) return null;
  return { role: "family", family, tradition, share: null, token: "" };
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
  const canViewMedia = role === "admin" || role === "household" || role === "family" || accepted;
  const yearsPolicy = role === "share" ? share.years_policy : "all";
  const days = canViewMedia ? await loadDays(env, tradition.id, yearsPolicy, true) : [];
  const shares = (role === "admin" || role === "family") ? await listShares(env, tradition.id) : [];
  return {
    role,
    accepted,
    can_upload: role === "admin" || role === "household" || role === "family",
    can_admin: role === "admin" || role === "family",
    tradition: {
      id: tradition.id,
      name: tradition.name,
      timing_note: tradition.timing_note,
      practice_note: tradition.practice_note,
      family_id: tradition.family_id || "",
      cover_media_id: canViewMedia ? (tradition.cover_media_id || "") : "",
    },
    cover: canViewMedia ? coverUrls(tradition, token) : { url: "", thumb: "", hasCover: false },
    share: share ? { id: share.id, label: share.label, accepted: Boolean(share.accepted_at) } : null,
    shares,
    days: days.map((d) => ({
      year: d.year,
      observed_on: d.observed_on,
      note: d.note,
      media: d.media.map((m) => ({
        id: m.id,
        mime: m.mime,
        url: token ? `/media/${m.id}?t=${encodeURIComponent(token)}` : `/media/${m.id}`,
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
  const family = await familyFromRequest(request, env);
  const rule = parseTiming(timing_note);
  const bound = bindRule(rule);
  await env.DB.prepare(
    `INSERT INTO traditions
      (id, name, timing_note, practice_note, created_at, household_token_hash, admin_token_hash,
       family_id, recur_type, recur_month, recur_day, recur_nth, recur_weekday)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, name, timing_note, practice_note, nowIso(),
    await sha256hex(household), await sha256hex(admin),
    family ? family.id : null,
    bound.recur_type, bound.recur_month, bound.recur_day, bound.recur_nth, bound.recur_weekday
  ).run();

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
    tradition_path: family ? `/f/${id}` : "",
  };
  const ctype = request.headers.get("content-type") || "";
  if (!ctype.includes("application/json")) {
    if (family) return Response.redirect(`${origin}/f/${id}`, 303);
    return Response.redirect(`${origin}/a/${admin}?new=${encodeURIComponent(household)}`, 303);
  }
  return json(payload, 201);
}

async function traditionJson(request, env, url) {
  const auth = await resolveRequest(request, env, {}, url);
  if (!auth || !auth.tradition) return json({ error: "We couldn't find that link." }, 404);
  return json(await present(env, auth, originOf(request)));
}

async function upsertDay(request, env) {
  const body = await readBody(request);
  const auth = await resolveRequest(request, env, body);
  if (!auth || !auth.tradition) return json({ error: "We couldn't find that link." }, 404);
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
  const auth = await resolveRequest(request, env, body);
  if (!auth || !auth.tradition) return json({ error: "We couldn't find that link." }, 404);
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
  const rest = url.pathname.slice("/media/".length);
  if (rest.startsWith("cover/")) return serveCover(request, env, url, rest.slice("cover/".length));
  const id = rest.split("/")[0];
  if (!id) return new Response("Not found", { status: 404, headers: SECURITY });
  const row = await env.DB.prepare(
    `SELECT media.*, days.year, days.tradition_id
     FROM media JOIN days ON days.id = media.day_id
     WHERE media.id = ?`
  ).bind(id).first();
  if (!row) return new Response("Not found", { status: 404, headers: SECURITY });
  const auth = await resolveRequest(request, env, { tradition_id: row.tradition_id }, url);
  if (!auth || !auth.tradition || auth.tradition.id !== row.tradition_id) {
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


async function serveCover(request, env, url, rest) {
  const parts = rest.split("/").filter(Boolean);
  const traditionId = parts[0] || "";
  const wantThumb = parts[1] === "thumb";
  if (!traditionId) return new Response("Not found", { status: 404, headers: SECURITY });
  const tradition = await env.DB.prepare("SELECT * FROM traditions WHERE id = ?").bind(traditionId).first();
  if (!tradition) return new Response("Not found", { status: 404, headers: SECURITY });
  const auth = await resolveRequest(request, env, { tradition_id: traditionId }, url);
  if (!auth || !auth.tradition || auth.tradition.id !== traditionId) {
    return new Response("Not found", { status: 404, headers: SECURITY });
  }
  if (auth.role === "share" && !auth.share.accepted_at) {
    return new Response("Not found", { status: 404, headers: SECURITY });
  }

  let key = "";
  let mime = "image/jpeg";
  if (wantThumb && tradition.cover_thumb_r2_key) {
    key = tradition.cover_thumb_r2_key;
    mime = tradition.cover_thumb_mime || mime;
  } else if (tradition.cover_r2_key) {
    key = tradition.cover_r2_key;
    mime = tradition.cover_mime || mime;
  } else if (tradition.cover_media_id) {
    const row = await env.DB.prepare(
      `SELECT media.*, days.year FROM media JOIN days ON days.id = media.day_id
       WHERE media.id = ? AND days.tradition_id = ?`
    ).bind(tradition.cover_media_id, traditionId).first();
    if (!row) return new Response("Not found", { status: 404, headers: SECURITY });
    if (auth.role === "share" && auth.share.years_policy && auth.share.years_policy !== "all") {
      let allowed;
      try { allowed = new Set(JSON.parse(auth.share.years_policy)); } catch { allowed = null; }
      if (allowed && !allowed.has(row.year)) {
        return new Response("Not found", { status: 404, headers: SECURITY });
      }
    }
    key = row.r2_key;
    mime = row.mime || mime;
  }
  if (!key) return new Response("Not found", { status: 404, headers: SECURITY });
  const obj = await mediaStore(env).get(key);
  if (!obj) return new Response("Not found", { status: 404, headers: SECURITY });
  const headers = new Headers(SECURITY);
  headers.set("content-type", mime);
  headers.set("cache-control", "private, max-age=3600");
  headers.set("content-disposition", "inline");
  headers.set("x-content-type-options", "nosniff");
  return new Response(obj.body, { headers });
}

async function createShare(request, env) {
  const body = await readBody(request);
  const auth = await resolveRequest(request, env, body);
  if (!auth || !auth.tradition) return json({ error: "We couldn't find that link." }, 404);
  if (auth.role !== "admin" && auth.role !== "family") return json({ error: "Only your family or the keeper link can invite another family." }, 403);
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
  const auth = await resolveRequest(request, env, body);
  if (!auth || !auth.tradition) return json({ error: "We couldn't find that link." }, 404);
  if (auth.role !== "admin" && auth.role !== "family") return json({ error: "Only your family or the keeper link can stop a share." }, 403);
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
  const auth = await resolveRequest(request, env, body, new URL(request.url));
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
  const auth = await resolveRequest(request, env, body, new URL(request.url));
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
  const auth = await resolveRequest(request, env, body);
  if (!auth || !auth.tradition) return json({ error: "We couldn't find that link." }, 404);
  if (auth.role !== "admin" && auth.role !== "family") return json({ error: "Only your family or the keeper link can make a fresh family link." }, 403);
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
  const family = await familyFromRequest(request, env);
  if (!auth || auth.role !== expectedRole) {
    return html(pageShell({
      title: "Recurday",
      description: "This link isn't valid, or it was stopped.",
      ogTitle: "Recurday",
      ogDescription: "A private family tradition link.",
      origin: originOf(request),
      nav: familyNav(family),
      body: `<h1>This link isn't valid.</h1><p class="lead">It may have been typed wrong, or the family who sent it may have stopped the share.</p>`,
    }), 404);
  }
  return renderTraditionResponse(request, env, auth, url, { newHousehold: expectedRole === "admin" ? url.searchParams.get("new") : "", family, token });
}

async function familyTraditionPage(request, env, url) {
  const family = await familyFromRequest(request, env);
  if (!family) {
    return new Response(null, { status: 303, headers: { ...SECURITY, location: "/" } });
  }
  const id = url.pathname.split("/")[2] || "";
  const tradition = await env.DB.prepare(
    "SELECT * FROM traditions WHERE id = ? AND family_id = ?"
  ).bind(id, family.id).first();
  if (!tradition) {
    return html(pageShell({
      title: "Recurday",
      description: "This tradition isn't on your calendar.",
      ogTitle: "Recurday",
      ogDescription: "A private family tradition.",
      origin: originOf(request),
      nav: familyNav(family),
      body: `<h1>We couldn't find that tradition.</h1><p class="lead"><a href="/calendar">Back to our calendar</a></p>`,
    }), 404);
  }
  const auth = { role: "family", tradition, share: null, token: "", family };
  return renderTraditionResponse(request, env, auth, url, { newHousehold: "", family, token: "" });
}

async function renderTraditionResponse(request, env, auth, url, { newHousehold, family, token }) {
  const yearParam = Number(url.searchParams.get("year"));
  const data = await present(env, auth, originOf(request));
  const years = data.days.map((d) => d.year);
  const currentYear = new Date().getFullYear();
  let selected = yearOk(yearParam) ? yearParam : (years[0] || currentYear);
  if (!years.includes(selected) && years.length && auth.role === "share") selected = years[0];
  const selectedDay = data.days.find((d) => d.year === selected);
  const body = renderTradition(data, { selected, selectedDay, currentYear, token, newHousehold, family });
  const when = data.tradition.timing_note || "A family tradition";
  const isShare = auth.role === "share";
  return html(pageShell({
    title: `${data.tradition.name} — Recurday`,
    description: isShare ? TAGLINE : when,
    ogTitle: isShare ? "Recurday" : data.tradition.name,
    ogDescription: isShare ? TAGLINE : [when, data.tradition.practice_note].filter(Boolean).join(" — ").slice(0, 180),
    origin: originOf(request),
    hue: hueOf(data.tradition.name),
    nav: familyNav(family),
    body,
  }));
}

function renderTradition(data, { selected, selectedDay, currentYear, token, newHousehold, family }) {
  const { tradition, role, accepted, can_upload, can_admin, days } = data;
  if (role === "share" && !accepted) {
    return `
      <p class="eyebrow">A family invited you</p>
      <p class="lead tagline">Creating family traditions. It was always about the small things.</p>
      <p class="support">Not the big holidays. The ones your family makes your own.</p>
      <h1>${esc(tradition.name)}</h1>
      <p>They wanted to pass this day on to you. Accept to look — their photos stay private until you do.</p>
      <div class="card">
        <p><strong>When:</strong> ${esc(tradition.timing_note || "They haven't written when it happens yet.")}</p>
        ${tradition.practice_note ? `<p class="practice">${esc(tradition.practice_note)}</p>` : ""}
        <form id="accept-form" method="post" action="/api/shares/accept">
          <input type="hidden" name="t" value="${esc(token)}">
          <button class="btn" type="submit">Accept and view</button>
          <p class="error hidden" id="accept-error"></p>
        </form>
      </div>
      ${renderStartYourOwn()}`;
  }

  const yearSet = new Set(days.map((d) => d.year));
  if (can_upload) {
    yearSet.add(selected);
    yearSet.add(currentYear);
  }
  const yearList = [...yearSet].sort((a, b) => b - a);
  const prefix = role === "family" ? `/f/${tradition.id}` : role === "admin" ? "/a" : role === "share" ? "/s" : "/t";
  const chips = yearList.map((y) => {
    const current = y === selected ? ' aria-current="true"' : "";
    const href = role === "family" ? `${prefix}?year=${y}` : `${prefix}/${token}?year=${y}`;
    return `<a class="year" href="${esc(href)}"${current}>${y}</a>`;
  }).join("");

  const mediaHtml = (selectedDay?.media || []).map((m) =>
    m.mime.startsWith("video/")
      ? `<video controls playsinline preload="metadata" src="${esc(m.url)}"></video>`
      : `<img alt="" src="${esc(m.url)}">`
  ).join("");

  const upload = can_upload ? `
    <div class="card">
      <h2>This year</h2>
      <form id="upload-form" data-token="${esc(token)}" data-tradition-id="${esc(tradition.id)}">
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
      <h2>Pass it on, in your own home</h2>
      <p>This copies the name and how they do it — not their photos. You'll get your own day to keep, and you can fill it with your family's years.</p>
      <form id="copy-form" method="post" action="/api/shares/copy">
        <input type="hidden" name="t" value="${esc(token)}">
        <button class="btn moss" type="submit">Start this tradition too</button>
        <p class="error hidden" id="copy-error"></p>
      </form>
      <div id="copy-result" class="hidden"></div>
    </div>
    ${renderStartYourOwn()}` : "";

  const hue = hueOf(tradition.name);
  const cover = data.cover || { url: "", thumb: "", hasCover: false };
  const hero = cover.hasCover
    ? `<div class="cover-hero"><img alt="" src="${esc(cover.url)}"></div>`
    : `<div class="cover-hero fallback hue-${esc(hue)}" aria-hidden="true"></div>`;

  return `
    ${hero}
    <p class="eyebrow">${role === "share" ? "Shared with you" : "A family tradition"}</p>
    <h1>${esc(tradition.name)}</h1>
    <p class="lead">${esc(tradition.timing_note || "")}</p>
    ${tradition.practice_note ? `<div class="card"><p class="practice">${esc(tradition.practice_note)}</p></div>` : ""}
    ${renderFamilyLink(data, token, newHousehold)}
    <div class="years" aria-label="Years">${chips}</div>
    ${mediaHtml ? `<div class="media-grid">${mediaHtml}</div>` : `<p class="empty">${can_upload ? "Nothing here for this year yet." : "Nothing has been added for this year yet."}</p>`}
    ${renderThroughTheYears(days, role, cover, tradition)}
    ${upload}
    ${shareBlock}
    ${role === "family" ? renderCoverCard(data, cover) : ""}
    ${renderClaim(data, token, family)}
    ${role === "family" ? `<p><a class="btn secondary" href="/family/export/${esc(tradition.id)}">Download this tradition</a></p>` : ""}
    ${can_admin ? renderAdmin(data, token) : ""}
    <p class="foot">Private by default. Kept together, not compared. No likes, no rankings, no public list of traditions.</p>`;
}

function renderFamilyLink(data, token, newHousehold) {
  if (data.role === "household") {
    const url = `${data.origin}/t/${token}`;
    return `
      <div class="actions">
        <button class="btn" type="button" id="copy-household" data-url="${esc(url)}" data-name="${esc(data.tradition.name)}">Text this to family</button>
        <p class="hint">Anyone with this link can add photos and rewatch, no app store and no login. Recurday spreads when you text a link.</p>
      </div>`;
  }
  if (data.role !== "admin" && data.role !== "family") return "";
  const fresh = newHousehold
    ? `<div class="notice">
        <p class="ok">Save this link, then text it. That's how Recurday moves from home to home — not an app store.</p>
        <div class="links">
          <p><strong>Family link</strong> — text this one:<br><a href="/t/${esc(newHousehold)}">${esc(data.origin)}/t/${esc(newHousehold)}</a></p>
        </div>
        <button class="btn" type="button" id="copy-household" data-url="${esc(data.origin)}/t/${esc(newHousehold)}" data-name="${esc(data.tradition.name)}">Text this to family</button>
      </div>`
    : `<p class="hint">To text your family, use the family link you saved when you created this tradition. If you lost it, make a fresh one — the old family link will stop working.</p>`;
  return `
    <div class="card">
      ${fresh}
      <button class="btn secondary" type="button" id="rotate-household" data-token="${esc(token)}" data-tradition-id="${esc(data.tradition.id)}">Make a fresh family link</button>
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
      <h2>Pass it on</h2>
      <p>Share this tradition idea with another family, as a gift — not a contest. They'll see it after they accept, and they can start it too for themselves. You can stop the share at any time.</p>
      <form id="invite-form" data-token="${esc(token)}" data-tradition-id="${esc(data.tradition.id)}">
        <label for="label">Who is this for? (just so you remember)</label>
        <input id="label" name="label" type="text" maxlength="80" required placeholder="The Millers">
        <button class="btn moss" type="submit">Create a pass-it-on link</button>
        <p class="error hidden" id="invite-error"></p>
      </form>
      <div id="invite-result"></div>
      ${rows}
    </div>`;
}

function renderThroughTheYears(days, role, cover, tradition) {
  if (role === "share" && !days.length && !(cover && cover.hasCover)) return "";
  const years = [...(days || [])].sort((a, b) => a.year - b.year).map((d) => ({
    year: d.year,
    note: d.note || "",
    photos: (d.media || []).map((m) => ({ url: m.url, mime: m.mime })),
  })).filter((d) => d.photos.length);
  if (!years.length && !(cover && cover.hasCover)) return "";
  const payload = {
    name: tradition?.name || "",
    hue: tradition ? hueOf(tradition.name) : "red",
    cover: cover && cover.hasCover ? { url: cover.url } : null,
    years,
  };
  return `
    <div class="actions">
      <button class="btn secondary" type="button" id="play-years">Through the years</button>
    </div>
    <script type="application/json" id="years-data">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>`;
}

function renderCoverCard(data, cover) {
  const { tradition, days } = data;
  const hue = hueOf(tradition.name);
  const photos = [];
  for (const day of days || []) {
    for (const m of day.media || []) {
      if ((m.mime || "").startsWith("image/")) {
        photos.push({ id: m.id, url: m.url, current: m.id === tradition.cover_media_id });
      }
    }
  }
  const preview = cover && cover.hasCover
    ? `<img class="cover-preview" alt="" src="${esc(cover.url)}">`
    : `<div class="cover-preview fallback hue-${esc(hue)}" aria-hidden="true"></div>`;
  const picks = photos.length
    ? `<p>Or pick a photo already kept with this tradition:</p>
      <div class="cover-picks">${photos.map((m) =>
        `<button type="button" class="cover-pick" data-media-id="${esc(m.id)}"${m.current ? ' aria-current="true"' : ""}><img alt="" src="${esc(m.url)}"></button>`
      ).join("")}</div>`
    : "";
  const clear = cover && cover.hasCover
    ? `<button class="btn secondary" type="button" id="cover-clear">Take the cover off</button>`
    : "";
  return `
    <div class="card" id="cover-card">
      <h2>Cover picture</h2>
      <p>This picture stands for the tradition — on the calendar, at the top of this page, and at the start of Through the years.</p>
      ${preview}
      <form id="cover-form" data-tradition-id="${esc(tradition.id)}">
        <label for="cover-file">Upload a photo</label>
        <input id="cover-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
        <p class="hint">The photo is shrunk on your phone before it uploads. Link previews stay generic; this picture stays private.</p>
        <button class="btn" type="submit">Use this as the cover</button>
        <p class="hint" id="cover-status"></p>
        <p class="error hidden" id="cover-error"></p>
      </form>
      ${picks}
      ${clear}
    </div>`;
}

function renderStartYourOwn() {
  return `
    <div class="card" id="start-your-own">
      <h2>Start your own family's traditions</h2>
      <p>If this day meant something to you, you can keep days like it at home. Text a link. No app store.</p>
      <a class="btn" href="/">Start your family's traditions</a>
    </div>`;
}

function renderClaim(data, token, family) {
  const { tradition, role } = data;
  if (!canClaimRole(role)) return "";
  if (tradition.family_id) {
    if (family && family.id === tradition.family_id) {
      return `<p class="hint"><a href="/calendar">This tradition is on our family calendar.</a></p>`;
    }
    return "";
  }
  if (family) {
    return `
      <div class="card" id="claim-card">
        <h2>Add this to our calendar</h2>
        <p>Keep this tradition with the rest of ${esc(family.name)}'s days, so everyone at home can find it together.</p>
        <form id="claim-form" data-token="${esc(token)}" data-logged-in="1">
          <button class="btn" type="submit">Add to our family calendar</button>
          <p class="error hidden" id="claim-error"></p>
        </form>
      </div>`;
  }
  return `
    <div class="card" id="claim-card">
      <h2>Set up your family login</h2>
      <p>One family name and one passcode, shared with everyone at home. You'll get a calendar of the days you keep together.</p>
      <form id="claim-form" data-token="${esc(token)}">
        <label for="claim-name">Family name</label>
        <input id="claim-name" name="family_name" type="text" required minlength="2" maxlength="40" autocomplete="username">
        <label for="claim-passcode">Passcode (at least 8 characters)</label>
        <input id="claim-passcode" name="passcode" type="password" required minlength="8" autocomplete="new-password">
        <p class="hint">If you already have a family login, enter it here to add this tradition to your calendar.</p>
        <button class="btn" type="submit">Set up our family login</button>
        <p class="error hidden" id="claim-error"></p>
      </form>
    </div>`;
}
