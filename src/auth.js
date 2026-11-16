/** Family login helpers: passcode hashing, signed cookies, name checks. */

export const PBKDF2_ITERS = 100000;
export const SESSION_COOKIE = "recurday_session";
export const SESSION_DAYS = 180;
export const FAIL_LIMIT = 5;
export const LOCK_MS = 15 * 60 * 1000;
export const NAME_MIN = 2;
export const NAME_MAX = 40;
export const PASSCODE_MIN = 8;
export const PASSCODE_MAX = 100;

export function nameKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function displayName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

export function validFamilyName(name) {
  const display = displayName(name);
  if (display.length < NAME_MIN || display.length > NAME_MAX) return null;
  if (!/^[\p{L}\p{N} .'-]+$/u.test(display)) return null;
  return display;
}

export function validPasscode(passcode) {
  const s = String(passcode ?? "");
  return s.length >= PASSCODE_MIN && s.length <= PASSCODE_MAX;
}

export function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex) {
  const clean = String(hex || "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function base64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64url(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hashPasscode(passcode, saltBytes, iters = PBKDF2_ITERS) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(passcode), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: iters },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

export function timingSafeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(secret, payload) {
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))));
  return `v1.${body}.${sig}`;
}

export async function verifySession(secret, token) {
  if (!secret || !token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [ , body, sig] = parts;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, fromBase64url(sig), new TextEncoder().encode(body));
  if (!ok) return null;
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
  } catch {
    return null;
  }
  if (!data?.fid || typeof data.v !== "number" || !data.exp) return null;
  if (Date.now() > Number(data.exp)) return null;
  return data;
}

export function parseCookie(header, name) {
  const parts = String(header || "").split(/;\s*/);
  const prefix = `${name}=`;
  for (const part of parts) {
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  }
  return "";
}

export function sessionCookie(value, { secure, maxAge = SESSION_DAYS * 24 * 60 * 60, clear = false } = {}) {
  const bits = [
    `${SESSION_COOKIE}=${clear ? "" : encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (clear) bits.push("Max-Age=0");
  else bits.push(`Max-Age=${maxAge}`);
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

async function aesKey(secret) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`recurday-seal:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(secret, plaintext) {
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
  return `${base64url(iv)}.${base64url(ct)}`;
}

export async function unseal(secret, packed) {
  if (!secret || !packed) return null;
  const [ivPart, ctPart] = String(packed).split(".");
  if (!ivPart || !ctPart) return null;
  try {
    const key = await aesKey(secret);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64url(ivPart) }, key, fromBase64url(ctPart));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

export function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "local"
  );
}

export async function sha256hex(value) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(buf));
}

export function randomToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(18)));
}
