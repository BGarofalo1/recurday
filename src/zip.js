/** Minimal ZIP (store only, no compression) for family exports. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data) {
  let crc = 0xffffffff;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function encodeName(name) {
  return new TextEncoder().encode(name);
}

export class ZipBuilder {
  constructor() {
    this.parts = [];
    this.entries = [];
    this.offset = 0;
  }

  add(name, data) {
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    const nameBytes = encodeName(name);
    const crc = crc32(bytes);
    const header = [
      u32(0x04034b50),
      u16(20),
      u16(0x0800), // UTF-8
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(bytes.length),
      u32(bytes.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ];
    const headerLen = 30 + nameBytes.length;
    this.parts.push(...header, bytes);
    this.entries.push({ nameBytes, crc, size: bytes.length, offset: this.offset });
    this.offset += headerLen + bytes.length;
  }

  end() {
    const cdStart = this.offset;
    for (const entry of this.entries) {
      this.parts.push(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(entry.crc),
        u32(entry.size),
        u32(entry.size),
        u16(entry.nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(entry.offset),
        entry.nameBytes
      );
      this.offset += 46 + entry.nameBytes.length;
    }
    const cdSize = this.offset - cdStart;
    this.parts.push(
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(this.entries.length),
      u16(this.entries.length),
      u32(cdSize),
      u32(cdStart),
      u16(0)
    );
    const total = this.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const part of this.parts) {
      out.set(part, off);
      off += part.length;
    }
    return out;
  }
}

export function slugPart(value, fallback = "tradition") {
  const s = String(value || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/[-\s]+/g, "-")
    .toLowerCase()
    .slice(0, 40);
  return s || fallback;
}
