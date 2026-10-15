// Minimal .zip writer using only Node (zlib deflate + crc32), so `npm run submit` works on
// Windows, Mac and Linux without zip/tar installed and without extra npm packages.
// Needs Node >= 20.15 for zlib.crc32. No zip64: each file and the whole zip must stay under 4 GB.
import zlib from 'node:zlib';

/** JS Date → MS-DOS time/date fields (local time, 2-second resolution, as zip tools expect). */
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * @param {{ name: string, data: Buffer | string }[]} entries  name uses forward slashes, e.g. 'src/main.js'
 * @param {{ date?: Date }} [options]  one timestamp for every file
 * @returns {Buffer} the complete zip archive
 */
export function createZip(entries, { date = new Date() } = {}) {
  const { time, date: day } = dosTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll('\\', '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length; // already-compressed files (glb, png, mp3) stay as they are
    const body = stored ? data : deflated;
    const crc = zlib.crc32(data);
    if (data.length > 0xfffffffe || offset > 0xfffffffe) throw new Error('Zip too big (over 4 GB)');

    const header = (signature, size) => {
      const h = Buffer.alloc(size);
      h.writeUInt32LE(signature, 0);
      return h;
    };
    const local = header(0x04034b50, 30);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flag: names are UTF-8
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = header(0x02014b50, 46);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  if (entries.length > 0xffff) throw new Error('Zip has too many files (over 65535)');
  return Buffer.concat([...locals, dir, end]);
}

/** Reads a zip made by createZip (used by tests and by graders' sanity checks). Returns name → Buffer. */
export function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    if (zlib.crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`);
    files.set(name, data);
    p += 46 + nameLen + extra;
  }
  return files;
}
