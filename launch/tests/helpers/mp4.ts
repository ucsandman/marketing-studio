/** Minimal valid-enough MP4 builders for probe tests. Box layout per ISO/IEC 14496-12. */

export function box(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, body]);
}

/** mvhd body: version(1) flags(3), then v0: creation(4) modification(4) timescale(4) duration(4); v1: creation(8) modification(8) timescale(4) duration(8). */
export function mvhd(opts: { version: 0 | 1; timescale: number; duration: number }): Buffer {
  if (opts.version === 0) {
    const body = Buffer.alloc(100);
    body.writeUInt32BE(opts.timescale, 12);
    body.writeUInt32BE(opts.duration, 16);
    return box('mvhd', body);
  }
  const body = Buffer.alloc(112);
  body.writeUInt8(1, 0);
  body.writeUInt32BE(opts.timescale, 20);
  body.writeBigUInt64BE(BigInt(opts.duration), 24);
  return box('mvhd', body);
}

/** ftyp + mdat + moov(mvhd) — moov deliberately AFTER mdat to exercise the top-level scan. */
export function syntheticMp4(opts: { durationSeconds: number; version?: 0 | 1; padBytes?: number }): Buffer {
  const timescale = 1000;
  const duration = Math.round(opts.durationSeconds * timescale);
  return Buffer.concat([
    box('ftyp', Buffer.from('isom\0\0\0\0isomiso2', 'ascii')),
    box('mdat', Buffer.alloc(opts.padBytes ?? 64)),
    box('moov', mvhd({ version: opts.version ?? 0, timescale, duration })),
  ]);
}
