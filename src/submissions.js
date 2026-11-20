import { json, html, pageShell, originOf, clip, nowIso } from "./http.js";
import { clientIp } from "./auth.js";
import { assertRateLimit } from "./limits.js";
import { SEASONS, AGES, TYPES, IDEA_NAME_MAX, IDEA_PRACTICE_MAX, IDEA_TIMING_MAX } from "./ideas.js";

/** Shared ideas per internet address per hour. Loose, since many phones share one address. */
export const IDEA_SHARE_IP_LIMIT = 10;
export const IDEA_SHARE_WINDOW_MS = 60 * 60 * 1000;
/** Keep the review queue from growing without bound on the free plan. */
export const IDEA_QUEUE_MAX = 2000;

const THANKS = "Thank you! We'll read it soon.";

function pick(value, options) {
  const v = String(value || "").trim().toLowerCase();
  return options.some(([key]) => key === v) ? v : "";
}

function oneLine(value, max) {
  return clip(String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " "), max);
}

function wantsJson(request) {
  return (request.headers.get("content-type") || "").includes("application/json") ||
    (request.headers.get("accept") || "").includes("application/json");
}

function reply(request, ok, message, status = 200) {
  if (wantsJson(request)) return json(ok ? { ok: true, message } : { error: message }, status);
  const body = `
    <article class="legal">
      <h1>${ok ? "Thank you!" : "We couldn't send that."}</h1>
      <p class="lead">${ok ? "We'll read your idea soon. It isn't shown to anyone until we do." : message}</p>
      <p><a class="btn" href="/ideas">Back to Ideas</a></p>
    </article>`;
  return html(pageShell({
    title: "Share an idea — Recurday",
    description: "Share a family tradition idea.",
    ogTitle: "Recurday",
    ogDescription: "Share a family tradition idea.",
    origin: originOf(request),
    body,
  }), status);
}

async function readForm(request) {
  const ctype = request.headers.get("content-type") || "";
  if (ctype.includes("application/json")) return request.json().catch(() => ({}));
  if (ctype.includes("form")) return Object.fromEntries((await request.formData()).entries());
  return {};
}

export async function shareIdea(request, env) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 4096) return reply(request, false, "That's a little long. Please keep it to one line.", 413);
  const limited = await assertRateLimit(env, `rl:idea:ip:${clientIp(request)}`, IDEA_SHARE_IP_LIMIT, IDEA_SHARE_WINDOW_MS);
  if (limited) return reply(request, false, "Please wait a few minutes and try again.", 429);
  const body = await readForm(request);
  // Honeypot: people never see this field. Bots that fill it get a polite
  // thank-you and nothing is saved.
  if (String(body.website || "").trim()) return reply(request, true, THANKS);
  const name = oneLine(body.name, IDEA_NAME_MAX);
  const practice = oneLine(body.practice, IDEA_PRACTICE_MAX);
  const timing = oneLine(body.timing, IDEA_TIMING_MAX);
  if (name.length < 2) return reply(request, false, "Please give your idea a name.", 400);
  if (practice.length < 5) return reply(request, false, "Please add one line on how you do it.", 400);
  if (/https?:\/\/|www\./i.test(`${name} ${practice} ${timing}`)) {
    return reply(request, false, "Please leave out links.", 400);
  }
  const queued = await env.DB.prepare("SELECT COUNT(*) AS n FROM idea_submissions WHERE status = 'pending'").first();
  if (Number(queued?.n || 0) >= IDEA_QUEUE_MAX) {
    return reply(request, false, "We have lots of ideas to read right now. Please try again another day.", 503);
  }
  await env.DB.prepare(
    `INSERT INTO idea_submissions (id, name, practice, timing, season, age, type, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(
    crypto.randomUUID(), name, practice, timing,
    pick(body.season, SEASONS), pick(body.age, AGES), pick(body.type, TYPES), nowIso()
  ).run();
  return reply(request, true, THANKS);
}
