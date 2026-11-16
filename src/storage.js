/**
 * Media store adapter.
 *
 * Recurday currently stores photos in Workers KV (free, no payment method).
 * The Worker never lists keys and only serves an object after the caller
 * presents a valid household, keeper, or accepted-invite token.
 *
 * To switch back to a private R2 bucket later (after R2 is enabled on the
 * account, with no public access):
 *   1. wrangler r2 bucket create recurday-media
 *   2. In wrangler.toml, replace the kv_namespaces MEDIA binding with:
 *        [[r2_buckets]]
 *        binding = "MEDIA"
 *        bucket_name = "recurday-media"
 *      and set MEDIA_BACKEND = "r2" under [vars].
 *   3. Copy existing KV objects into R2 (keys are already
 *      {traditionId}/{dayId}/{mediaId}.{ext}). Then redeploy.
 * This module auto-detects R2 vs KV if MEDIA_BACKEND is unset.
 */

function isR2(binding) {
  return Boolean(binding) && typeof binding.createMultipartUpload === "function";
}

async function asBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  if (typeof data?.arrayBuffer === "function") return data.arrayBuffer();
  if (typeof data?.getReader === "function" || typeof ReadableStream !== "undefined" && data instanceof ReadableStream) {
    const res = new Response(data);
    return res.arrayBuffer();
  }
  return data;
}

function kvStore(ns) {
  return {
    kind: "kv",
    async put(key, data, { contentType } = {}) {
      const value = await asBuffer(data);
      await ns.put(key, value, {
        metadata: { contentType: contentType || "application/octet-stream" },
      });
    },
    async get(key) {
      const res = await ns.getWithMetadata(key, { type: "arrayBuffer" });
      if (!res || res.value == null) return null;
      return {
        body: res.value,
        contentType: res.metadata?.contentType || "application/octet-stream",
      };
    },
    async remove(key) {
      await ns.delete(key);
    },
  };
}

function r2Store(bucket) {
  return {
    kind: "r2",
    async put(key, data, { contentType } = {}) {
      await bucket.put(key, data, {
        httpMetadata: { contentType: contentType || "application/octet-stream" },
      });
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      return {
        body: obj.body,
        contentType: obj.httpMetadata?.contentType || "application/octet-stream",
      };
    },
    async remove(key) {
      await bucket.delete(key);
    },
  };
}

export function mediaStore(env) {
  const binding = env.MEDIA;
  if (!binding) {
    throw new Error("MEDIA binding is missing.");
  }
  const forced = String(env.MEDIA_BACKEND || "").toLowerCase();
  if (forced === "r2" || (forced !== "kv" && isR2(binding))) {
    return r2Store(binding);
  }
  return kvStore(binding);
}
