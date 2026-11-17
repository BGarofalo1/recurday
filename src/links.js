import { seal, unseal, sha256hex, randomToken } from "./auth.js";

export async function saveHouseholdToken(env, traditionId, token) {
  if (!env.SESSION_SECRET || !token || !traditionId) return;
  const enc = await seal(env.SESSION_SECRET, token);
  await env.DB.prepare("UPDATE traditions SET household_token_enc = ? WHERE id = ?").bind(enc, traditionId).run();
}

export async function rotateHouseholdToken(env, traditionId) {
  const token = randomToken();
  const enc = env.SESSION_SECRET ? await seal(env.SESSION_SECRET, token) : null;
  await env.DB.prepare(
    "UPDATE traditions SET household_token_hash = ?, household_token_enc = ? WHERE id = ?"
  ).bind(await sha256hex(token), enc, traditionId).run();
  return token;
}

export async function familyLinkUrl(env, tradition, origin) {
  if (!tradition || !tradition.id) return "";
  if (tradition.household_token_enc && env.SESSION_SECRET) {
    const token = await unseal(env.SESSION_SECRET, tradition.household_token_enc);
    if (token) return `${origin}/t/${token}`;
  }
  const token = await rotateHouseholdToken(env, tradition.id);
  return `${origin}/t/${token}`;
}
