import { json, nowIso } from "./http.js";

export const UPLOAD_LIMIT = 40;
export const UPLOAD_WINDOW_MS = 15 * 60 * 1000;
export const CREATE_LIMIT = 8;

export async function assertRateLimit(env, key, limit, windowMs) {
  const now = Date.now();
  const stamp = nowIso();
  const row = await env.DB.prepare("SELECT * FROM login_attempts WHERE key = ?").bind(key).first();
  if (row && row.locked_until && row.locked_until > stamp) {
    const count = Number(row.fail_count || 0) + 1;
    if (count > limit) {
      return json({ error: "Please wait a few minutes and try again." }, 429);
    }
    await env.DB.prepare(
      "UPDATE login_attempts SET fail_count = ?, updated_at = ? WHERE key = ?"
    ).bind(count, stamp, key).run();
    return null;
  }
  const until = new Date(now + windowMs).toISOString();
  if (row) {
    await env.DB.prepare(
      "UPDATE login_attempts SET fail_count = ?, locked_until = ?, updated_at = ? WHERE key = ?"
    ).bind(1, until, stamp, key).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO login_attempts (key, fail_count, locked_until, updated_at) VALUES (?, ?, ?, ?)"
    ).bind(key, 1, until, stamp).run();
  }
  return null;
}
