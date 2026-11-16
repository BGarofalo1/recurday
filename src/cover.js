export const PHOTO_MAX = 2 * 1024 * 1024;
export const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function extForMime(mime) {
  const m = (mime || "").toLowerCase();
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  return "jpg";
}

export function hasCover(tradition) {
  return Boolean(tradition && (tradition.cover_r2_key || tradition.cover_media_id));
}

export function coverUrls(tradition, token = "") {
  if (!hasCover(tradition)) return { url: "", thumb: "", hasCover: false };
  const q = token ? `?t=${encodeURIComponent(token)}` : "";
  return {
    url: `/media/cover/${tradition.id}${q}`,
    thumb: `/media/cover/${tradition.id}/thumb${q}`,
    hasCover: true,
  };
}

export function isDedicatedCoverKey(key) {
  return typeof key === "string" && /\/cover\//.test(key);
}
