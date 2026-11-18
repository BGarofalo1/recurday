import { mediaStore } from "./storage.js";
import { SECURITY, json, html, esc, pageShell, familyNav, nowIso, clip, originOf, TAGLINE, TAGLINE_SUPPORT } from "./http.js";
import { hueOf, parseTiming, bindRule, describeRule } from "./calendar.js";
import { sha256hex, randomToken, clientIp, parseCookie, SESSION_COOKIE } from "./auth.js";
import { pageCacheKey, mediaCacheKey, edgeGet, edgePut } from "./edge.js";
import { familyFromRequest, handleFamilyApi, calendarPage, calendarFeed, familyExport, canClaimRole } from "./family.js";
import { coverUrls } from "./cover.js";
import { saveHouseholdToken, rotateHouseholdToken, familyLinkUrl } from "./links.js";
import { IDEAS } from "./ideas.js";
import { privacyPage, termsPage, aboutPage, notFoundPage, ideasPage, busyPage } from "./pages.js";
import { assertRateLimit, UPLOAD_LIMIT, UPLOAD_WINDOW_MS, CREATE_IP_LIMIT } from "./limits.js";

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

const BUSY_MESSAGE = "Recurday is very busy right now. Please try again in a minute.";
const deferred = new WeakMap();

export default {
  async fetch(request, env, ctx) {
    if (ctx) deferred.set(request, ctx);
    try {
      return await handle(request, env);
    } catch (err) {
      // Free-plan daily limits, an overloaded database, or a bug: show a calm
      // "try again" page instead of a crash. Saves are single statements, so a
      // failed request never leaves half-saved data behind.
      console.error(err);
      const path = new URL(request.url).pathname;
      const isApi = path.startsWith("/api/");
      if (!isApi && path.startsWith("/media/")) {
        return new Response(BUSY_MESSAGE, { status: 503, headers: { ...SECURITY, "retry-after": "60", "cache-control": "no-store" } });
      }
      if (!isApi && request.method === "GET" && wantsHtml(request)) return busyPage(request);
      return json({ error: BUSY_MESSAGE }, 503, { "retry-after": "60" });
    }
  },
};

/** Run a best-effort task after the response is sent (falls back to awaiting). */
async function later(request, promise) {
  const ctx = deferred.get(request);
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(promise);
  else await promise;
}

function hasSessionCookie(request) {
  return Boolean(parseCookie(request.headers.get("cookie") || "", SESSION_COOKIE));
}

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
  if (path === "/ideas") return ideasPage(request, env);
  if (path === "/privacy") return privacyPage(request, env);
  if (path === "/terms") return termsPage(request, env);
  if (path === "/about") return aboutPage(request, env);
  if (path.startsWith("/cal/")) return calendarFeed(request, env, url);
  if (path.startsWith("/family/export")) return familyExport(request, env, url);

  if ((path === "/" || path === "/index.html") && request.method === "GET" && await familyFromRequest(request, env)) {
    const idea = url.searchParams.get("idea");
    const location = idea ? `/calendar?idea=${encodeURIComponent(idea)}` : "/calendar";
    return new Response(null, { status: 303, headers: { ...SECURITY, location } });
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
    if (res.status === 404 && request.method === "GET" && wantsHtml(request)) {
      return notFoundPage(request, env);
    }
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  }
  if (request.method === "GET" && wantsHtml(request)) return notFoundPage(request, env);
  return new Response("Not found", { status: 404, headers: SECURITY });
}

function wantsHtml(request) {
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html")) return true;
  const path = new URL(request.url).pathname;
  return !path.includes(".");
}

async function api(request, env, url) {
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/ideas") return json({ ideas: IDEAS });
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
  // One query for every photo in this tradition (instead of one per year).
  const rows = days.length ? ((await env.DB.prepare(
    `SELECT media.id, media.day_id, media.mime, media.byte_size, media.created_at
     FROM media JOIN days ON days.id = media.day_id
     WHERE days.tradition_id = ? ORDER BY media.created_at ASC`
  ).bind(traditionId).all()).results || []) : [];
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day_id)) byDay.set(r.day_id, []);
    byDay.get(r.day_id).push({ id: r.id, mime: r.mime, byte_size: r.byte_size, created_at: r.created_at });
  }
  return days.map((d) => ({ ...d, media: byDay.get(d.id) || [] }));
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
  const limited = await assertRateLimit(env, `rl:create:ip:${clientIp(request)}`, CREATE_IP_LIMIT, UPLOAD_WINDOW_MS);
  if (limited) return limited;
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
  await saveHouseholdToken(env, id, household);

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
  const limited = await assertRateLimit(env, `rl:upload:${auth.tradition.id}:${clientIp(request)}`, UPLOAD_LIMIT, UPLOAD_WINDOW_MS);
  if (limited) return limited;
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
  if (!PHOTO_TYPES.has(mime)) return json({ error: "Photos only." }, 400);
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
  try {
    await mediaStore(env).put(key, file, { contentType: mime });
  } catch (err) {
    console.error(err);
    return json({ error: "We couldn't save photos right now because Recurday is very busy. Your photo wasn't saved. Please try again later." }, 503, { "retry-after": "3600" });
  }
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
  // Photos never change once saved (a new photo gets a new id), so the
  // browser may keep it for a year.
  return servePhoto(request, env, row.r2_key, row.mime, "private, max-age=31536000, immutable");
}

/**
 * Serve stored photo bytes. Only called after the link/login check passed.
 * Bytes come from the local Cloudflare edge cache when possible, which saves
 * a Workers KV read (Free plan: 100,000 reads/day).
 */
async function servePhoto(request, env, storageKey, mime, browserCache) {
  const key = mediaCacheKey(originOf(request), storageKey);
  let bytes = null;
  let edge = "miss";
  const hit = await edgeGet(key);
  if (hit) {
    bytes = await hit.arrayBuffer();
    edge = "hit";
  } else {
    const obj = await mediaStore(env).get(storageKey);
    if (!obj) return new Response("Not found", { status: 404, headers: SECURITY });
    bytes = await new Response(obj.body).arrayBuffer();
    await later(request, edgePut(key, new Response(bytes, { headers: { "content-type": mime } }), "media"));
  }
  const headers = new Headers(SECURITY);
  headers.set("content-type", mime);
  headers.set("cache-control", browserCache);
  headers.set("content-disposition", "inline");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-recurday-edge", edge);
  return new Response(bytes, { headers });
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
  // The cover URL stays the same when the family picks a new cover, so the
  // browser re-checks hourly; the stored bytes for a given key never change.
  return servePhoto(request, env, key, mime, "private, max-age=3600");
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
  await saveHouseholdToken(env, id, household);
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
  const household = await rotateHouseholdToken(env, auth.tradition.id);
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
  // Shared links are the viral path: cache the page at the edge for visitors
  // who aren't logged in. Keeper (admin) pages are never cached.
  const cacheable = request.method === "GET" && !family && !hasSessionCookie(request) &&
    (auth.role === "household" || auth.role === "share");
  let key = "";
  if (cacheable) {
    key = await pageCacheKey(originOf(request), auth, url);
    const hit = await edgeGet(key);
    if (hit) return linkPageResponse(hit.body, hit.status, hit.headers, "hit");
  }
  const res = await renderTraditionResponse(request, env, auth, url, { newHousehold: expectedRole === "admin" ? url.searchParams.get("new") : "", family, token });
  if (!cacheable || res.status !== 200) return res;
  const text = await res.text();
  await later(request, edgePut(key, new Response(text, { status: 200, headers: res.headers }), "page"));
  return linkPageResponse(text, 200, res.headers, "miss");
}

function linkPageResponse(body, status, sourceHeaders, edge) {
  const headers = new Headers(sourceHeaders);
  for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);
  headers.set("content-type", "text/html; charset=utf-8");
  // Browsers and shared proxies must not keep a private link page.
  headers.set("cache-control", "private, no-cache");
  headers.set("x-recurday-edge", edge);
  return new Response(body, { status, headers });
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
  const origin = originOf(request);
  const data = await present(env, auth, origin);
  if (auth.role === "admin" || auth.role === "family") {
    data.family_link_url = await familyLinkUrl(env, auth.tradition, origin);
  } else if (auth.role === "household") {
    data.family_link_url = `${origin}/t/${token}`;
  }
  const years = data.days.map((d) => d.year);
  const currentYear = new Date().getFullYear();
  let selected = yearOk(yearParam) ? yearParam : (years[0] || currentYear);
  if (!years.includes(selected) && years.length && auth.role === "share") selected = years[0];
  const selectedDay = data.days.find((d) => d.year === selected);
  const body = renderTradition(data, { selected, selectedDay, currentYear, token, newHousehold, family });
  const when = data.tradition.timing_note || "A family tradition";
  const isLinkPage = auth.role === "share" || auth.role === "household";
  return html(pageShell({
    title: `${data.tradition.name} — Recurday`,
    description: isLinkPage ? TAGLINE : when,
    ogTitle: auth.role === "share" ? "Recurday" : data.tradition.name,
    ogDescription: isLinkPage ? TAGLINE : [when, data.tradition.practice_note].filter(Boolean).join(" — ").slice(0, 180),
    origin: originOf(request),
    hue: hueOf(data.tradition.name),
    nav: familyNav(family),
    body,
  }));
}

function moreBlock(inner) {
  if (!inner || !String(inner).trim()) return "";
  return `<details class="more"><summary>More</summary>${inner}</details>`;
}

function taglineBlock() {
  return `
    <p class="lead tagline">${esc(TAGLINE)}</p>
    <p class="support">${esc(TAGLINE_SUPPORT)}</p>`;
}

function previewPhotos(days, limit = 6) {
  const out = [];
  for (const d of days || []) {
    for (const m of d.media || []) {
      out.push({ ...m, year: d.year });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function isPhotoMime(mime) {
  return String(mime || "").startsWith("image/");
}

function mediaItem(m) {
  if (isPhotoMime(m.mime)) return `<img alt="" src="${esc(m.url)}">`;
  if (!m.url) return "";
  return `<a class="media-file" href="${esc(m.url)}">Open this file</a>`;
}

function coverHero(data) {
  const hue = hueOf(data.tradition.name);
  const cover = data.cover || { url: "", thumb: "", hasCover: false };
  return cover.hasCover
    ? `<div class="cover-hero"><img alt="" src="${esc(cover.url)}"></div>`
    : `<div class="cover-hero fallback hue-${esc(hue)}" aria-hidden="true"></div>`;
}

function yearChips(data, { selected, token }) {
  const { tradition, role, can_upload, days } = data;
  const yearSet = new Set(days.map((d) => d.year));
  const currentYear = new Date().getFullYear();
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
  return chips ? `<div class="years" aria-label="Years">${chips}</div>` : "";
}

function renderUploadForm(data, { selected, selectedDay, token }) {
  const { tradition, can_upload } = data;
  if (!can_upload) {
    return selectedDay?.note ? `<div class="card"><p class="practice">${esc(selectedDay.note)}</p></div>` : "";
  }
  return `
    <div class="card" id="add-photos">
      <h2>Add photos</h2>
      <form id="upload-form" data-token="${esc(token)}" data-tradition-id="${esc(tradition.id)}">
        <label for="year">Year</label>
        <input id="year" name="year" type="number" min="${YEAR_MIN}" max="${YEAR_MAX}" value="${esc(selected)}">
        <label for="observed_on">The day you kept it (optional)</label>
        <input id="observed_on" name="observed_on" type="date" value="${esc(selectedDay?.observed_on || "")}">
        <label for="day_note">A short note (optional)</label>
        <textarea id="day_note" name="note" maxlength="2000">${esc(selectedDay?.note || "")}</textarea>
        <label for="file">A photo</label>
        <input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
        <p class="hint">Photos shrink on your phone.</p>
        <button class="btn" type="submit">Add photos</button>
        <p class="hint" id="upload-status"></p>
        <p class="error hidden" id="upload-error"></p>
      </form>
    </div>`;
}

function renderShareCopy(data, token) {
  if (data.role !== "share") return "";
  return `
    <div class="card">
      <h2>Start this tradition too</h2>
      <p>This copies the name and how they do it — not their photos.</p>
      <form id="copy-form" method="post" action="/api/shares/copy">
        <input type="hidden" name="t" value="${esc(token)}">
        <button class="btn" type="submit">Start this tradition too</button>
        <p class="error hidden" id="copy-error"></p>
      </form>
      <div id="copy-result" class="hidden"></div>
    </div>`;
}

function renderTradition(data, { selected, selectedDay, currentYear, token, newHousehold, family }) {
  const { tradition, role, accepted } = data;
  if (role === "share" && !accepted) {
    return `
      <p class="eyebrow">A family invited you</p>
      ${taglineBlock()}
      <h1>${esc(tradition.name)}</h1>
      <p class="lead">${esc(tradition.timing_note || "They haven't written when it happens yet.")}</p>
      ${tradition.practice_note ? `<p class="practice">${esc(tradition.practice_note)}</p>` : ""}
      <p>Have a look to see their photos.</p>
      <form id="accept-form" method="post" action="/api/shares/accept">
        <input type="hidden" name="t" value="${esc(token)}">
        <button class="btn btn-lg" type="submit">Have a look</button>
        <p class="error hidden" id="accept-error"></p>
      </form>
      ${renderStartYourOwn()}`;
  }

  if (role === "household" || role === "share") {
    return renderSharedLink(data, { selected, selectedDay, token, family });
  }

  return renderAppTradition(data, { selected, selectedDay, token, newHousehold, family });
}

function renderSharedLink(data, { selected, selectedDay, token, family }) {
  const { tradition, role, days, can_upload } = data;
  const photos = previewPhotos(days, 6);
  const gallery = photos.length
    ? `<div class="media-grid shared-photos">${photos.map((m) =>
        `<figure class="shared-shot">${mediaItem(m)}<figcaption>${esc(String(m.year))}</figcaption></figure>`
      ).join("")}</div>`
    : `<p class="empty">Photos will show up here.</p>`;
  const extra = moreBlock([
    can_upload ? renderUploadForm(data, { selected, selectedDay, token }) : "",
    renderThroughTheYears(days, role, data.cover, tradition),
    renderShareCopy(data, token),
    renderClaim(data, token, family),
  ].join(""));
  return `
    ${coverHero(data)}
    <h1>${esc(tradition.name)}</h1>
    <p class="lead">${esc(tradition.timing_note || "")}</p>
    ${tradition.practice_note ? `<p class="practice">${esc(tradition.practice_note)}</p>` : ""}
    ${gallery}
    ${taglineBlock()}
    ${extra}
    ${renderStartYourOwn()}`;
}

function renderAppTradition(data, { selected, selectedDay, token, newHousehold, family }) {
  const { tradition, role, can_upload, can_admin, days } = data;
  const familyUrl = data.family_link_url || (newHousehold ? `${data.origin}/t/${newHousehold}` : "");
  const textBtn = familyUrl
    ? `<button class="btn btn-lg" type="button" id="copy-household" data-url="${esc(familyUrl)}" data-name="${esc(tradition.name)}">Text this to family</button>`
    : "";
  const addBtn = can_upload ? `<a class="btn secondary" href="#add-photos">Add photos</a>` : "";
  const yearsBtn = renderThroughTheYears(days, role, data.cover, tradition);
  const selectedMedia = (selectedDay?.media || []).map(mediaItem).join("");
  const empty = selectedMedia
    ? `<div class="media-grid">${selectedMedia}</div>`
    : `<p class="empty">${can_upload ? "Add a photo to get started." : "Photos will show up here."}</p>`;
  const fresh = newHousehold
    ? `<div class="notice"><p class="ok">Save this link, then text it.</p>
        <div class="links"><p><a href="/t/${esc(newHousehold)}">${esc(data.origin)}/t/${esc(newHousehold)}</a></p></div></div>`
    : "";
  const more = moreBlock([
    fresh ? "" : "",
    renderLinkTools(data, token, newHousehold),
    role === "family" ? renderCoverCard(data, data.cover) : "",
    renderClaim(data, token, family),
    role === "family" ? `<p><a class="btn secondary" href="/family/export/${esc(tradition.id)}">Save a copy</a></p>` : "",
    can_admin ? renderAdmin(data, token) : "",
  ].join(""));
  return `
    ${coverHero(data)}
    <h1>${esc(tradition.name)}</h1>
    <p class="lead">${esc(tradition.timing_note || "")}</p>
    ${tradition.practice_note ? `<p class="practice">${esc(tradition.practice_note)}</p>` : ""}
    ${fresh}
    <div class="actions-primary">
      ${textBtn}
      ${addBtn}
      ${yearsBtn}
    </div>
    ${yearChips(data, { selected, token })}
    ${empty}
    ${can_upload ? renderUploadForm(data, { selected, selectedDay, token }) : ""}
    ${more}`;
}

function renderLinkTools(data, token, newHousehold) {
  if (data.role !== "admin" && data.role !== "family") return "";
  return `
    <div class="card">
      <h2>Family link</h2>
      <p class="hint">If the old link is lost, make a new one. The old link will stop working.</p>
      <button class="btn secondary" type="button" id="rotate-household" data-token="${esc(token)}" data-tradition-id="${esc(data.tradition.id)}">Make a new family link</button>
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
      <p>Share the idea with another family — not the photos. You can stop it anytime.</p>
      <form id="invite-form" data-token="${esc(token)}" data-tradition-id="${esc(data.tradition.id)}">
        <label for="label">Who is this for?</label>
        <input id="label" name="label" type="text" maxlength="80" required placeholder="The Millers">
        <button class="btn" type="submit">Make a pass-it-on link</button>
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
    photos: (d.media || []).filter((m) => isPhotoMime(m.mime)).map((m) => ({ url: m.url, mime: m.mime })),
  })).filter((d) => d.photos.length);
  if (!years.length && !(cover && cover.hasCover)) return "";
  const payload = {
    name: tradition?.name || "",
    hue: tradition ? hueOf(tradition.name) : "red",
    cover: cover && cover.hasCover ? { url: cover.url } : null,
    years,
  };
  return `
    <button class="btn secondary" type="button" id="play-years">Watch the years</button>
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
      <p>This picture stands for the tradition on the calendar and at the top of this page.</p>
      ${preview}
      <form id="cover-form" data-tradition-id="${esc(tradition.id)}">
        <label for="cover-file">Upload a photo</label>
        <input id="cover-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
        <p class="hint">The photo shrinks on your phone. Link previews stay generic.</p>
        <button class="btn" type="submit">Use this as the cover</button>
        <p class="hint" id="cover-status"></p>
        <p class="error hidden" id="cover-error"></p>
      </form>
      ${picks}
      ${clear}
    </div>`;
}

function renderStartYourOwn() {
  return `<p class="start-own-quiet"><a href="/">Start your own</a></p>`;
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
