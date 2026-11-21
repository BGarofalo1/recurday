/**
 * Edge cache helpers (Cloudflare Cache API, free on every plan).
 * https://developers.cloudflare.com/workers/runtime-apis/cache/
 *
 * What is cached, and why it is safe:
 * - Shared-link pages (/t/, /s/) for visitors who are NOT logged in. The key
 *   includes a hash of the link's secret token, so only people holding the
 *   same link can ever get the cached copy, and the tradition's page_version
 *   (bumped by database triggers on every edit), so an edit is seen everywhere
 *   at once without a purge. Logged-in family pages are never cached.
 * - Photo bytes, only AFTER the normal link/login check passes on every
 *   request. Photos never change once saved, so they can be kept long.
 *
 * Every cache call is best-effort: if the cache is unavailable, the app
 * just reads from the database and storage like before.
 */
import { sha256hex } from "./auth.js";

const PAGE_TTL = 24 * 60 * 60;          // seconds; key also changes daily (UTC)
const MEDIA_TTL = 30 * 24 * 60 * 60;    // seconds; photos are immutable

function cacheStore() {
  try {
    return typeof caches !== "undefined" && caches.default ? caches.default : null;
  } catch {
    return null;
  }
}

export async function pageCacheKey(origin, auth, url, localDay = "") {
  const t = auth.tradition;
  const share = auth.share;
  // The visitor's local date (their time zone), so "this year" turns over at
  // their midnight, not London's.
  const day = localDay || new Date().toISOString().slice(0, 10);
  const shareBits = share ? `${share.id}.${share.accepted_at ? 1 : 0}.${share.years_policy || "all"}` : "-";
  const tokenHash = await sha256hex(`page:${auth.token}`);
  const q = new URLSearchParams();
  const year = url.searchParams.get("year");
  if (year) q.set("year", year);
  return `${origin}/__edge/page/${auth.role}/${tokenHash}/${t.id}/v${Number(t.page_version || 0)}/${encodeURIComponent(shareBits)}/${day}?${q}`;
}

export function mediaCacheKey(origin, storageKey) {
  return `${origin}/__edge/media/${encodeURIComponent(storageKey)}`;
}

export async function edgeGet(key) {
  const cache = cacheStore();
  if (!cache) return null;
  try {
    return (await cache.match(key)) || null;
  } catch {
    return null;
  }
}

/** Store a copy in the edge cache. Returns nothing; never throws. */
export async function edgePut(key, response, kind) {
  const cache = cacheStore();
  if (!cache || !response || response.status !== 200) return;
  try {
    const headers = new Headers(response.headers);
    headers.delete("set-cookie");
    headers.set("cache-control", `public, max-age=${kind === "media" ? MEDIA_TTL : PAGE_TTL}`);
    await cache.put(key, new Response(response.body, { status: 200, headers }));
  } catch {
    // Best-effort only.
  }
}
