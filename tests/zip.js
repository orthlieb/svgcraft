// Minimal zip reading and writing for tests (node:zlib does the deflate).
import zlib from 'node:zlib';

// { name: Buffer } for every file in a zip.
export function readZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('no end of central directory');
  const files = {};
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0, n = buf.readUInt16LE(e + 10); i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central header');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const at = buf.readUInt32LE(p + 42);
    if (buf.readUInt32LE(at) !== 0x04034b50) throw new Error('bad local header');
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    if (zlib.crc32(data) !== crc) throw new Error(`bad CRC for ${name}`);
    files[name] = data;
    p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
}

// A zip of [name, string | Buffer] entries, deflated when `deflate` is set.
export function makeZip(entries, { deflate = false } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.from(content);
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const fname = Buffer.from(name);
    const fields = Buffer.alloc(26);
    fields.writeUInt16LE(20, 0);
    fields.writeUInt16LE(0x0800, 2);
    fields.writeUInt16LE(deflate ? 8 : 0, 4);
    fields.writeUInt32LE(zlib.crc32(data), 10);
    fields.writeUInt32LE(body.length, 14);
    fields.writeUInt32LE(data.length, 18);
    fields.writeUInt16LE(fname.length, 22);
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), fields]);
    parts.push(local, fname, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    fields.copy(cen, 6);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, fname);
    offset += local.length + fname.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
