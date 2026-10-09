// Generates simple PNG app icons (NHS blue with a white 2x2 "hub" tile motif). No dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size, maskable) {
  const blue = [0x00, 0x5e, 0xb8], white = [255, 255, 255];
  const pad = Math.round(size * (maskable ? 0.26 : 0.18)), gap = Math.round(size * 0.06);
  const tile = Math.floor((size - 2 * pad - gap) / 2), r = Math.round(tile * 0.18);
  const inTile = (x, y) => {
    for (const ox of [pad, pad + tile + gap]) for (const oy of [pad, pad + tile + gap]) {
      const dx = x - ox, dy = y - oy;
      if (dx < 0 || dy < 0 || dx >= tile || dy >= tile) continue;
      const cx = Math.min(dx, tile - 1 - dx), cy = Math.min(dy, tile - 1 - dy);
      if (cx < r && cy < r && (r - cx) ** 2 + (r - cy) ** 2 > r * r) continue;
      return true;
    }
    return false;
  };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const col = inTile(x, y) ? white : blue, o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, false));
writeFileSync('public/icons/icon-512.png', png(512, false));
writeFileSync('public/icons/maskable-512.png', png(512, true));
writeFileSync('public/icons/apple-touch-icon.png', png(180, false));
console.log('icons written');
