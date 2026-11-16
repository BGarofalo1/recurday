import {
  PBKDF2_ITERS,
  SESSION_DAYS,
  FAIL_LIMIT,
  LOCK_MS,
  validFamilyName,
  validPasscode,
  nameKey,
  hashPasscode,
  timingSafeEqual,
  signSession,
  verifySession,
  parseCookie,
  sessionCookie,
  SESSION_COOKIE,
  seal,
  unseal,
  clientIp,
  sha256hex,
  randomToken,
  hexToBytes,
} from "./auth.js";
import {
  hueOf,
  ruleFromRow,
  ruleFromDate,
  parseTiming,
  occurDate,
  occurInMonth,
  upcomingFor,
  monthGrid,
  bindRule,
  describeRule,
  buildIcs,
} from "./calendar.js";
import { ZipBuilder, slugPart } from "./zip.js";
import { json, html, esc, pageShell, familyNav, nowIso, clip, originOf, isSecureRequest, SECURITY } from "./http.js";
import { mediaStore } from "./storage.js";

const EXPORT_MAX = 40 * 1024 * 1024;
const NAME_MAX = 80;
const TIMING_MAX = 200;
const NOTE_MAX = 2000;

export async function familyFromRequest(request, env) {
  const secret = env.SESSION_SECRET;
  if (!secret) return null;
  const raw = parseCookie(request.headers.get("cookie") || "", SESSION_COOKIE);
  const data = await verifySession(secret, raw);
  if (!data) return null;
  const fam = await env.DB.prepare("SELECT * FROM families WHERE id = ?").bind(data.fid).first();
  if (!fam || Number(fam.session_version) !== Number(data.v)) return null;
  return fam;
}

async function sessionResponse(request, env, family, body, status = 200) {
  if (!env.SESSION_SECRET) return json({ error: "This app isn't fully configured yet." }, 500);
  const token = await signSession(env.SESSION_SECRET, {
    fid: family.id,
    v: Number(family.session_version),
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
  return json(body, status, { "set-cookie": sessionCookie(token, { secure: isSecureRequest(request) }) });
}

function clearSession(request, body = { ok: true }, status = 200) {
  return json(body, status, { "set-cookie": sessionCookie("", { secure: isSecureRequest(request), clear: true }) });
}

async function readLock(env, key) {
  return env.DB.prepare("SELECT * FROM login_attempts WHERE key = ?").bind(key).first();
}

function locked(row) {
  return Boolean(row?.locked_until && row.locked_until > nowIso());
}

async function assertNotLocked(env, ip, key) {
  const ipRow = await readLock(env, `ip:${ip}`);
  const nameRow = key ? await readLock(env, `name:${key}`) : null;
  if (locked(ipRow) || locked(nameRow)) {
    return json({ error: "Please wait a few minutes and try again." }, 429);
  }
  return null;
}

async function recordFailure(env, ip, key) {
  const now = nowIso();
  for (const lockKey of [`ip:${ip}`, key ? `name:${key}` : null].filter(Boolean)) {
    const row = await readLock(env, lockKey);
    const fail = Number(row?.fail_count || 0) + 1;
    const until = fail >= FAIL_LIMIT ? new Date(Date.now() + LOCK_MS).toISOString() : null;
    if (row) {
      await env.DB.prepare(
        "UPDATE login_attempts SET fail_count = ?, locked_until = ?, updated_at = ? WHERE key = ?"
      ).bind(fail, until, now, lockKey).run();
    } else {
      await env.DB.prepare(
        "INSERT INTO login_attempts (key, fail_count, locked_until, updated_at) VALUES (?, ?, ?, ?)"
      ).bind(lockKey, fail, until, now).run();
    }
  }
}

async function clearFailures(env, ip, key) {
  await env.DB.prepare("DELETE FROM login_attempts WHERE key = ?").bind(`ip:${ip}`).run();
  if (key) await env.DB.prepare("DELETE FROM login_attempts WHERE key = ?").bind(`name:${key}`).run();
}

async function findFamilyByName(env, name) {
  const key = nameKey(name);
  if (!key) return null;
  return env.DB.prepare("SELECT * FROM families WHERE name_key = ?").bind(key).first();
}

async function verifyPasscode(family, passcode) {
  const salt = hexToBytes(family.passcode_salt);
  const hash = await hashPasscode(passcode, salt, Number(family.passcode_iters) || PBKDF2_ITERS);
  return timingSafeEqual(hash, family.passcode_hash);
}

async function mintCalendarToken(env, secret) {
  const token = randomToken();
  const enc = await seal(secret, token);
  const hash = await sha256hex(token);
  return { token, enc, hash };
}

async function createFamilyRecord(env, display, passcode) {
  const secret = env.SESSION_SECRET;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPasscode(passcode, salt, PBKDF2_ITERS);
  const cal = await mintCalendarToken(env, secret);
  const family = {
    id: crypto.randomUUID(),
    name: display,
    name_key: nameKey(display),
    passcode_salt: [...salt].map((b) => b.toString(16).padStart(2, "0")).join(""),
    passcode_hash: hash,
    passcode_iters: PBKDF2_ITERS,
    session_version: 1,
    calendar_token_hash: cal.hash,
    calendar_token_enc: cal.enc,
    created_at: nowIso(),
  };
  await env.DB.prepare(
    `INSERT INTO families
      (id, name, name_key, passcode_salt, passcode_hash, passcode_iters, session_version, calendar_token_hash, calendar_token_enc, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    family.id, family.name, family.name_key, family.passcode_salt, family.passcode_hash,
    family.passcode_iters, family.session_version, family.calendar_token_hash, family.calendar_token_enc, family.created_at
  ).run();
  return { family, calendarToken: cal.token };
}

export async function handleFamilyApi(request, env, url) {
  const path = url.pathname;
  if (!env.SESSION_SECRET) return json({ error: "This app isn't fully configured yet." }, 500);
  if (request.method === "POST" && path === "/api/family/create") return createFamily(request, env);
  if (request.method === "POST" && path === "/api/family/login") return loginFamily(request, env);
  if (request.method === "POST" && path === "/api/family/logout") return logoutFamily(request, env);
  if (request.method === "POST" && path === "/api/family/passcode") return changePasscode(request, env);
  if (request.method === "POST" && path === "/api/family/claim") return claimTradition(request, env);
  if (request.method === "POST" && path === "/api/family/traditions") return createFamilyTradition(request, env);
  if (request.method === "POST" && path === "/api/family/calendar-link") return rotateCalendarLink(request, env);
  return json({ error: "Not found." }, 404);
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

async function createFamily(request, env) {
  const body = await readBody(request);
  const display = validFamilyName(body.name || body.family_name);
  if (!display) return json({ error: "Please choose a family name of 2 to 40 letters." }, 400);
  if (!validPasscode(body.passcode)) return json({ error: "Please choose a passcode of at least 8 characters." }, 400);
  const ip = clientIp(request);
  const key = nameKey(display);
  const lockedRes = await assertNotLocked(env, ip, key);
  if (lockedRes) return lockedRes;
  const existing = await findFamilyByName(env, display);
  if (existing) return json({ error: "That family name is already in use. If this is your family, log in." }, 409);
  const { family, calendarToken } = await createFamilyRecord(env, display, body.passcode);
  await clearFailures(env, ip, key);
  const origin = originOf(request);
  return sessionResponse(request, env, family, {
    ok: true,
    name: family.name,
    calendar_path: "/calendar",
    calendar_url: `${origin}/calendar`,
    ics_path: `/cal/${calendarToken}.ics`,
    ics_url: `${origin}/cal/${calendarToken}.ics`,
  }, 201);
}

async function loginFamily(request, env) {
  const body = await readBody(request);
  const display = validFamilyName(body.name || body.family_name);
  const ip = clientIp(request);
  const key = display ? nameKey(display) : nameKey(body.name || body.family_name);
  const lockedRes = await assertNotLocked(env, ip, key);
  if (lockedRes) return lockedRes;
  if (!display || !validPasscode(body.passcode)) {
    await recordFailure(env, ip, key);
    return json({ error: "That family name or passcode didn't work." }, 401);
  }
  const family = await findFamilyByName(env, display);
  if (!family || !(await verifyPasscode(family, body.passcode))) {
    await recordFailure(env, ip, key);
    return json({ error: "That family name or passcode didn't work." }, 401);
  }
  await clearFailures(env, ip, key);
  return sessionResponse(request, env, family, { ok: true, name: family.name, calendar_path: "/calendar" });
}

async function logoutFamily(request, env) {
  const ctype = request.headers.get("content-type") || "";
  if (!ctype.includes("application/json")) {
    const res = new Response(null, {
      status: 303,
      headers: {
        ...SECURITY,
        location: "/",
        "set-cookie": sessionCookie("", { secure: isSecureRequest(request), clear: true }),
      },
    });
    return res;
  }
  return clearSession(request);
}

async function changePasscode(request, env) {
  const family = await familyFromRequest(request, env);
  if (!family) return json({ error: "Please log in with your family name and passcode." }, 401);
  const body = await readBody(request);
  if (!validPasscode(body.current_passcode) || !(await verifyPasscode(family, body.current_passcode))) {
    return json({ error: "That current passcode didn't work." }, 401);
  }
  if (!validPasscode(body.new_passcode)) return json({ error: "Please choose a new passcode of at least 8 characters." }, 400);
  if (body.new_passcode === body.current_passcode) return json({ error: "Please choose a different new passcode." }, 400);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPasscode(body.new_passcode, salt, PBKDF2_ITERS);
  const version = Number(family.session_version) + 1;
  await env.DB.prepare(
    `UPDATE families
     SET passcode_salt = ?, passcode_hash = ?, passcode_iters = ?, session_version = ?
     WHERE id = ?`
  ).bind(
    [...salt].map((b) => b.toString(16).padStart(2, "0")).join(""),
    hash,
    PBKDF2_ITERS,
    version,
    family.id
  ).run();
  const updated = { ...family, session_version: version };
  return sessionResponse(request, env, updated, { ok: true });
}

async function attachTradition(env, familyId, traditionId) {
  await env.DB.prepare("UPDATE traditions SET family_id = ? WHERE id = ? AND family_id IS NULL")
    .bind(familyId, traditionId).run();
}

export async function traditionByToken(env, resolveFn, token) {
  return resolveFn(env, token);
}

async function claimTradition(request, env) {
  const body = await readBody(request);
  const token = String(body.t || body.token || "").trim();
  if (!token) return json({ error: "We couldn't find that link." }, 404);
  const hash = await sha256hex(token);
  const tradition = await env.DB.prepare(
    "SELECT * FROM traditions WHERE household_token_hash = ? OR admin_token_hash = ?"
  ).bind(hash, hash).first();
  if (!tradition) return json({ error: "We couldn't find that link." }, 404);
  const share = await env.DB.prepare("SELECT id FROM shares WHERE token_hash = ?").bind(hash).first();
  if (share) return json({ error: "Invite links can't set up a family login." }, 403);

  const sessionFamily = await familyFromRequest(request, env);
  if (sessionFamily) {
    if (tradition.family_id && tradition.family_id !== sessionFamily.id) {
      return json({ error: "This tradition already belongs to a family." }, 409);
    }
    if (!tradition.family_id) await attachTradition(env, sessionFamily.id, tradition.id);
    return json({ ok: true, calendar_path: "/calendar", tradition_path: `/f/${tradition.id}` });
  }

  const display = validFamilyName(body.name || body.family_name);
  const ip = clientIp(request);
  const key = display ? nameKey(display) : nameKey(body.name || body.family_name);
  const lockedRes = await assertNotLocked(env, ip, key);
  if (lockedRes) return lockedRes;
  if (!display || !validPasscode(body.passcode)) {
    await recordFailure(env, ip, key);
    return json({ error: "Please enter a family name and a passcode of at least 8 characters." }, 400);
  }

  if (tradition.family_id) {
    const owner = await env.DB.prepare("SELECT id, name_key FROM families WHERE id = ?").bind(tradition.family_id).first();
    if (owner && owner.name_key === nameKey(display)) {
      const fam = await findFamilyByName(env, display);
      if (fam && await verifyPasscode(fam, body.passcode)) {
        await clearFailures(env, ip, key);
        return sessionResponse(request, env, fam, { ok: true, calendar_path: "/calendar", tradition_path: `/f/${tradition.id}` });
      }
    }
    await recordFailure(env, ip, key);
    return json({ error: "This tradition already belongs to a family. Log in as that family to see it." }, 409);
  }

  const existing = await findFamilyByName(env, display);
  if (existing) {
    if (!(await verifyPasscode(existing, body.passcode))) {
      await recordFailure(env, ip, key);
      return json({ error: "That family name or passcode didn't work." }, 401);
    }
    await attachTradition(env, existing.id, tradition.id);
    await persistRule(env, tradition);
    await clearFailures(env, ip, key);
    return sessionResponse(request, env, existing, { ok: true, calendar_path: "/calendar", tradition_path: `/f/${tradition.id}` });
  }

  const { family } = await createFamilyRecord(env, display, body.passcode);
  await attachTradition(env, family.id, tradition.id);
  await persistRule(env, tradition);
  await clearFailures(env, ip, key);
  return sessionResponse(request, env, family, { ok: true, calendar_path: "/calendar", tradition_path: `/f/${tradition.id}` }, 201);
}

async function persistRule(env, tradition) {
  if (tradition.recur_type) return;
  const rule = parseTiming(tradition.timing_note);
  if (!rule) return;
  const bound = bindRule(rule);
  await env.DB.prepare(
    `UPDATE traditions SET recur_type = ?, recur_month = ?, recur_day = ?, recur_nth = ?, recur_weekday = ? WHERE id = ?`
  ).bind(bound.recur_type, bound.recur_month, bound.recur_day, bound.recur_nth, bound.recur_weekday, tradition.id).run();
}

function ruleFromBody(body) {
  if (body.recur_type === "nth_weekday" && body.date) return ruleFromDate(body.date, "nth_weekday");
  if (body.date) return ruleFromDate(body.date, "fixed");
  if (body.timing_note) return parseTiming(body.timing_note);
  return null;
}

async function createFamilyTradition(request, env) {
  const family = await familyFromRequest(request, env);
  if (!family) return json({ error: "Please log in with your family name and passcode." }, 401);
  const body = await readBody(request);
  const name = clip(body.name, NAME_MAX);
  const practice_note = clip(body.practice_note, NOTE_MAX);
  if (!name) return json({ error: "Please give this tradition a name." }, 400);
  const rule = ruleFromBody(body);
  const timing_note = clip(body.timing_note || (rule ? describeRule(rule) : ""), TIMING_MAX);
  const bound = bindRule(rule);
  const id = crypto.randomUUID();
  const household = randomToken();
  const admin = randomToken();
  await env.DB.prepare(
    `INSERT INTO traditions
      (id, name, timing_note, practice_note, created_at, household_token_hash, admin_token_hash,
       family_id, recur_type, recur_month, recur_day, recur_nth, recur_weekday)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, name, timing_note, practice_note, nowIso(),
    await sha256hex(household), await sha256hex(admin),
    family.id, bound.recur_type, bound.recur_month, bound.recur_day, bound.recur_nth, bound.recur_weekday
  ).run();
  const origin = originOf(request);
  return json({
    id,
    name,
    timing_note,
    household_path: `/t/${household}`,
    admin_path: `/a/${admin}`,
    household_url: `${origin}/t/${household}`,
    admin_url: `${origin}/a/${admin}`,
    tradition_path: `/f/${id}`,
    calendar_path: "/calendar",
  }, 201);
}

async function rotateCalendarLink(request, env) {
  const family = await familyFromRequest(request, env);
  if (!family) return json({ error: "Please log in with your family name and passcode." }, 401);
  const cal = await mintCalendarToken(env, env.SESSION_SECRET);
  await env.DB.prepare("UPDATE families SET calendar_token_hash = ?, calendar_token_enc = ? WHERE id = ?")
    .bind(cal.hash, cal.enc, family.id).run();
  const origin = originOf(request);
  return json({ ok: true, ics_path: `/cal/${cal.token}.ics`, ics_url: `${origin}/cal/${cal.token}.ics` });
}

async function loadFamilyTraditions(env, familyId) {
  return (await env.DB.prepare(
    "SELECT * FROM traditions WHERE family_id = ? ORDER BY name COLLATE NOCASE ASC"
  ).bind(familyId).all()).results || [];
}

export async function calendarPage(request, env, url) {
  const family = await familyFromRequest(request, env);
  if (!family) {
    return new Response(null, { status: 303, headers: { ...SECURITY, location: "/" } });
  }
  const now = new Date();
  const year = Number(url.searchParams.get("year")) || now.getFullYear();
  const month = Number(url.searchParams.get("month")) || now.getMonth() + 1;
  const safeYear = year >= 1900 && year <= 2100 ? year : now.getFullYear();
  const safeMonth = month >= 1 && month <= 12 ? month : now.getMonth() + 1;
  const today = url.searchParams.get("on") || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const add = url.searchParams.get("add") || "";
  const traditions = await loadFamilyTraditions(env, family.id);
  const origin = originOf(request);
  const cells = monthGrid(safeYear, safeMonth).map((cell) => {
    if (!cell.day) return { ...cell, items: [] };
    const items = traditions
      .map((t) => {
        const rule = ruleFromRow(t);
        const day = occurInMonth(rule, safeYear, safeMonth);
        if (day !== cell.day) return null;
        return { id: t.id, name: t.name, hue: hueOf(t.name) };
      })
      .filter(Boolean);
    return { ...cell, items };
  });
  const upcoming = upcomingFor(traditions, today, 8).map((item) => ({
    id: item.tradition.id,
    name: item.tradition.name,
    date: item.date,
    hue: hueOf(item.tradition.name),
    when: item.tradition.timing_note || describeRule(ruleFromRow(item.tradition)),
  }));
  const icsToken = await unseal(env.SESSION_SECRET, family.calendar_token_enc);
  const icsUrl = icsToken ? `${origin}/cal/${icsToken}.ics` : "";
  const monthName = new Date(Date.UTC(safeYear, safeMonth - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const prev = safeMonth === 1 ? { year: safeYear - 1, month: 12 } : { year: safeYear, month: safeMonth - 1 };
  const next = safeMonth === 12 ? { year: safeYear + 1, month: 1 } : { year: safeYear, month: safeMonth + 1 };
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
  const grid = cells.map((cell) => {
    if (!cell.day) return `<div class="cal-day outside" aria-hidden="true"></div>`;
    const isToday = cell.iso === today ? " today" : "";
    const pills = cell.items.map((item) =>
      `<a class="cal-pill hue-${esc(item.hue)}" href="/f/${esc(item.id)}">${esc(item.name)}</a>`
    ).join("");
    return `<div class="cal-day${isToday}">
      <a class="cal-num" href="/calendar?year=${safeYear}&month=${safeMonth}&add=${cell.iso}" aria-label="Add a tradition on ${esc(cell.iso)}">${cell.day}</a>${pills}</div>`;
  }).join("");

  const unscheduled = traditions.filter((t) => !ruleFromRow(t));
  const unscheduledHtml = unscheduled.length
    ? `<div class="card"><h2>Needs a date</h2><ul class="upcoming">${unscheduled.map((t) =>
      `<li><a href="/f/${esc(t.id)}">${esc(t.name)}</a>${t.timing_note ? ` — ${esc(t.timing_note)}` : ""}</li>`
    ).join("")}</ul><p class="hint">These traditions don't have a date we can place on the calendar yet. Open one and edit when it happens, or add a new one by tapping a day.</p></div>`
    : "";

  const upcomingHtml = upcoming.length
    ? `<ul class="upcoming">${upcoming.map((item) =>
      `<li><a class="cal-pill hue-${esc(item.hue)}" href="/f/${esc(item.id)}">${esc(item.name)}</a> <span class="muted">${esc(item.date)}${item.when ? ` · ${esc(item.when)}` : ""}</span></li>`
    ).join("")}</ul>`
    : `<p class="empty">Nothing upcoming with a date yet. Tap a day to add a tradition.</p>`;

  const addCard = add ? renderAddCard(add) : "";

  const body = `
    <p class="eyebrow">${esc(family.name)}</p>
    <h1>Our traditions</h1>
    <p class="lead">A month at a time, given back to each other year after year.</p>
    ${addCard}
    <div class="card cal-card">
      <div class="cal-nav">
        <a class="btn secondary cal-nav-btn" href="/calendar?year=${prev.year}&month=${prev.month}">Previous</a>
        <h2 class="cal-title">${esc(monthName)} ${safeYear}</h2>
        <a class="btn secondary cal-nav-btn" href="/calendar?year=${next.year}&month=${next.month}">Next</a>
      </div>
      <div class="cal-grid" aria-label="${esc(monthName)} ${safeYear}">
        ${dow}
        ${grid}
      </div>
    </div>
    <div class="card">
      <h2>Upcoming</h2>
      ${upcomingHtml}
    </div>
    ${unscheduledHtml}
    <div class="card">
      <h2>Your family login</h2>
      <p>Everyone at home uses the name <strong>${esc(family.name)}</strong> and the same passcode. One login, so the family can keep this calendar together.</p>
      <form id="passcode-form">
        <label for="current_passcode">Current passcode</label>
        <input id="current_passcode" name="current_passcode" type="password" required minlength="8" autocomplete="current-password">
        <label for="new_passcode">New passcode</label>
        <input id="new_passcode" name="new_passcode" type="password" required minlength="8" autocomplete="new-password">
        <p class="hint">Changing the passcode signs out other devices.</p>
        <button class="btn secondary" type="submit">Change passcode</button>
        <p class="error hidden" id="passcode-error"></p>
        <p class="ok hidden" id="passcode-ok">Passcode updated.</p>
      </form>
    </div>
    <div class="card">
      <h2>Phone calendar</h2>
      <p>Add these days to the family's phone calendar with this private link. Anyone who has it can see tradition names and dates, not your photos.</p>
      ${icsUrl ? `<div class="links"><p><a href="${esc(icsUrl)}">${esc(icsUrl)}</a></p></div>
        <button class="btn" type="button" id="copy-ics" data-url="${esc(icsUrl)}">Copy subscribe link</button>` : `<p class="hint">Make a subscribe link to add these days to the family's phone calendar.</p>`}
      <button class="btn secondary" type="button" id="rotate-ics">${icsUrl ? "Make a fresh subscribe link" : "Make a subscribe link"}</button>
      <div id="ics-result"></div>
    </div>
    <div class="card">
      <h2>A copy to keep</h2>
      <p>Download a zip of your traditions, photos, and a simple index — a record to keep and pass down.</p>
      <a class="btn" href="/family/export">Download a copy</a>
      <p class="hint">If the whole family album is too large, we'll offer a download for each tradition instead.</p>
    </div>
    <p class="foot">Private by default. No likes, no rankings, no public list of traditions.</p>`;

  return html(pageShell({
    title: `${family.name} — Recurday`,
    description: "Your family's traditions, month by month.",
    ogTitle: "Recurday",
    ogDescription: "A private family calendar of traditions.",
    origin,
    nav: familyNav(family),
    body,
  }));
}

function renderAddCard(iso) {
  const label = iso;
  return `
    <div class="card" id="add-tradition">
      <h2>Add a tradition on ${esc(label)}</h2>
      <form id="calendar-create-form">
        <input type="hidden" name="date" value="${esc(iso)}">
        <label for="cal-name">What do you call it?</label>
        <input id="cal-name" name="name" type="text" required maxlength="80" placeholder="Pancake Saturday">
        <label for="cal-practice">How do you do it?</label>
        <textarea id="cal-practice" name="practice_note" maxlength="2000" placeholder="We make pancakes, go to the creek, and eat outside."></textarea>
        <label for="cal-repeat">Repeat each year</label>
        <select id="cal-repeat" name="recur_type">
          <option value="fixed" selected>On this date every year</option>
          <option value="nth_weekday">On this weekday every year (for example, the first Saturday)</option>
        </select>
        <button class="btn" type="submit">Create this tradition</button>
        <p class="error hidden" id="calendar-create-error"></p>
      </form>
    </div>`;
}

export async function calendarFeed(request, env, url) {
  const raw = decodeURIComponent((url.pathname.split("/")[2] || "").replace(/\.ics$/i, ""));
  if (!raw || raw.length < 16) return new Response("Not found", { status: 404, headers: SECURITY });
  const hash = await sha256hex(raw);
  const family = await env.DB.prepare("SELECT * FROM families WHERE calendar_token_hash = ?").bind(hash).first();
  if (!family) return new Response("Not found", { status: 404, headers: SECURITY });
  const traditions = await loadFamilyTraditions(env, family.id);
  const year = new Date().getUTCFullYear();
  const events = traditions.map((t) => {
    const rule = ruleFromRow(t);
    if (!rule) return null;
    const dtstart = occurDate(rule, year) || occurDate(rule, year + 1);
    if (!dtstart) return null;
    return { id: t.id, name: t.name, rule, dtstart, timing: t.timing_note, practice: t.practice_note };
  }).filter(Boolean);
  const body = buildIcs({ familyName: family.name, events, origin: originOf(request) });
  return new Response(body, {
    status: 200,
    headers: {
      ...SECURITY,
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="recurday.ics"`,
      "cache-control": "private, no-store",
    },
  });
}

export async function familyExport(request, env, url) {
  const family = await familyFromRequest(request, env);
  if (!family) return json({ error: "Please log in with your family name and passcode." }, 401);
  const traditionId = url.pathname.startsWith("/family/export/") ? url.pathname.slice("/family/export/".length).split("/")[0] : "";
  const traditions = traditionId
    ? (await env.DB.prepare("SELECT * FROM traditions WHERE id = ? AND family_id = ?").bind(traditionId, family.id).all()).results || []
    : await loadFamilyTraditions(env, family.id);
  if (traditionId && !traditions.length) return json({ error: "We couldn't find that tradition." }, 404);

  const sized = [];
  let total = 0;
  for (const t of traditions) {
    const days = (await env.DB.prepare(
      "SELECT * FROM days WHERE tradition_id = ? ORDER BY year ASC"
    ).bind(t.id).all()).results || [];
    const daysOut = [];
    for (const day of days) {
      const media = (await env.DB.prepare(
        "SELECT id, r2_key, mime, byte_size, created_at FROM media WHERE day_id = ? ORDER BY created_at ASC"
      ).bind(day.id).all()).results || [];
      total += media.reduce((n, m) => n + Number(m.byte_size || 0), 0);
      daysOut.push({ ...day, media });
    }
    sized.push({ tradition: t, days: daysOut });
  }

  if (!traditionId && total > EXPORT_MAX) {
    const list = sized.map(({ tradition, days }) => {
      const bytes = days.reduce((n, d) => n + d.media.reduce((m, x) => m + Number(x.byte_size || 0), 0), 0);
      return { id: tradition.id, name: tradition.name, bytes, path: `/family/export/${tradition.id}` };
    });
    const body = `
      <h1>This copy is too large for one file</h1>
      <p class="lead">Please download one tradition at a time. The family album is about ${Math.ceil(total / (1024 * 1024))} MB.</p>
      <div class="card">
        <ul class="upcoming">${list.map((t) =>
          `<li><a href="${esc(t.path)}">${esc(t.name)}</a> <span class="muted">(${Math.max(1, Math.round(t.bytes / 1024))} KB)</span></li>`
        ).join("")}</ul>
      </div>
      <p><a class="btn secondary" href="/calendar">Back to our calendar</a></p>`;
    return html(pageShell({
      title: "Download a copy — Recurday",
      description: "Export one tradition at a time.",
      ogTitle: "Recurday",
      ogDescription: "A private family export.",
      origin: originOf(request),
      nav: familyNav(family),
      body,
    }), 413);
  }

  const zip = new ZipBuilder();
  const used = new Set();
  const indexTraditions = [];
  for (const { tradition, days } of sized) {
    let folder = slugPart(tradition.name);
    let n = 2;
    while (used.has(folder)) folder = `${slugPart(tradition.name)}-${n++}`;
    used.add(folder);
    const photos = [];
    for (const day of days) {
      let i = 1;
      for (const m of day.media) {
        const ext = (m.mime || "").includes("png") ? "png" : (m.mime || "").includes("webp") ? "webp" : (m.mime || "").includes("gif") ? "gif" : "jpg";
        const filename = `${String(i).padStart(2, "0")}.${ext}`;
        const path = `traditions/${folder}/${day.year}/${filename}`;
        const obj = await mediaStore(env).get(m.r2_key);
        if (obj) {
          const buf = new Uint8Array(await obj.arrayBuffer());
          zip.add(path, buf);
          photos.push({ year: day.year, path, note: day.note, observed_on: day.observed_on });
          i += 1;
        }
      }
    }
    const meta = {
      name: tradition.name,
      timing: tradition.timing_note,
      practice: tradition.practice_note,
      days: days.map((d) => ({
        year: d.year,
        observed_on: d.observed_on,
        note: d.note,
        photos: photos.filter((p) => p.year === d.year).map((p) => p.path),
      })),
    };
    zip.add(`traditions/${folder}/tradition.json`, JSON.stringify(meta, null, 2));
    indexTraditions.push({ folder, ...meta });
  }

  const exportedAt = nowIso();
  const familyJson = { family: family.name, exported_at: exportedAt, traditions: indexTraditions };
  zip.add("family.json", JSON.stringify(familyJson, null, 2));
  zip.add("index.html", exportIndexHtml(family.name, exportedAt, indexTraditions));
  const bytes = zip.end();
  const filename = traditionId
    ? `recurday-${slugPart(traditions[0].name)}.zip`
    : `recurday-${slugPart(family.name, "family")}.zip`;
  return new Response(bytes, {
    status: 200,
    headers: {
      ...SECURITY,
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}

function exportIndexHtml(familyName, exportedAt, traditions) {
  const sections = traditions.map((t) => {
    const years = (t.days || []).map((d) => {
      const imgs = (d.photos || []).map((p) => `<p><img src="${esc(p)}" alt=""></p>`).join("");
      return `<h3>${d.year}</h3>${d.observed_on ? `<p>${esc(d.observed_on)}</p>` : ""}${d.note ? `<p>${esc(d.note)}</p>` : ""}${imgs || "<p>No photos this year.</p>"}`;
    }).join("");
    return `<section>
      <h2>${esc(t.name)}</h2>
      <p>${esc(t.timing || "")}</p>
      <p>${esc(t.practice || "")}</p>
      ${years}
    </section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(familyName)} — Recurday export</title>
  <style>
    body { margin: 0; font-family: Georgia, "Iowan Old Style", serif; background: #f6efe4; color: #2a2318; }
    .bar { height: 4px; background: linear-gradient(90deg, #e4452e, #f07812, #efc100, #2fa24c, #2b7de1, #4b3cb8, #8d2db5); }
    main { max-width: 40rem; margin: 0 auto; padding: 1.5rem 1.1rem 3rem; }
    h1, h2, h3 { font-weight: 600; }
    img { max-width: 100%; height: auto; border-radius: 0.6rem; background: #efe4d4; }
    p { line-height: 1.45; }
    section { margin: 2rem 0; padding-top: 1rem; border-top: 1px solid #e4d5c1; }
  </style>
</head>
<body>
  <div class="bar"></div>
  <main>
    <p>A Recurday copy</p>
    <h1>${esc(familyName)}</h1>
    <p>Exported ${esc(exportedAt.slice(0, 10))}. This file is yours to keep.</p>
    ${sections || "<p>No traditions yet.</p>"}
  </main>
</body>
</html>
`;
}

export function canClaimRole(role) {
  return role === "household" || role === "admin";
}
