// node --test scripts/lib/png.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  decodePng,
  encodePng,
  solidImage,
  meanAbsDelta,
  quantize,
  rgbToHsv,
  hexToRgb,
  colorDistance,
} from './png.mjs';

// Hand-build a 2x2 truecolor (colorType 2) PNG that exercises every filter type
// (rows use filters None, Sub, Up, Paeth) so the unfilter path is covered, not
// just the encoder's filter-0 output.
function buildFilterSweepPng() {
  const width = 2;
  const height = 4;
  const channels = 3;
  const stride = width * channels;
  // Target pixels (row-major RGB) we want back after decoding.
  const pixels = [
    [10, 20, 30], [40, 50, 60], // row 0
    [70, 80, 90], [100, 110, 120], // row 1
    [130, 140, 150], [160, 170, 180], // row 2
    [190, 200, 210], [220, 230, 240], // row 3
  ];
  const recon = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < stride; x++) row.push(pixels[y * width + x / channels | 0][x % channels]);
    recon.push(row);
  }
  const filters = [0, 1, 2, 4]; // None, Sub, Up, Paeth
  const raw = [];
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };
  for (let y = 0; y < height; y++) {
    const f = filters[y];
    raw.push(f);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? recon[y][x - channels] : 0;
      const b = y > 0 ? recon[y - 1][x] : 0;
      const c = x >= channels && y > 0 ? recon[y - 1][x - channels] : 0;
      let filt;
      if (f === 0) filt = recon[y][x];
      else if (f === 1) filt = recon[y][x] - a;
      else if (f === 2) filt = recon[y][x] - b;
      else filt = recon[y][x] - paeth(a, b, c);
      raw.push(filt & 0xff);
    }
  }
  const idat = zlib.deflateSync(Buffer.from(raw));
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let cc = n;
      for (let k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
      t[n] = cc >>> 0;
    }
    return t;
  })();
  const crc32 = (b) => {
    let cc = 0xffffffff;
    for (let i = 0; i < b.length; i++) cc = crcTable[(cc ^ b[i]) & 0xff] ^ (cc >>> 8);
    return (cc ^ 0xffffffff) >>> 0;
  };
  const mkChunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // colorType 2 (RGB)
  return {
    buf: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mkChunk('IHDR', ihdr),
      mkChunk('IDAT', idat),
      mkChunk('IEND', Buffer.alloc(0)),
    ]),
    pixels,
    width,
    height,
  };
}

test('encode -> decode round trip preserves RGBA pixels', () => {
  const width = 3;
  const height = 2;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = (i * 37) & 0xff;
    rgba[i * 4 + 1] = (i * 53) & 0xff;
    rgba[i * 4 + 2] = (i * 71) & 0xff;
    rgba[i * 4 + 3] = 255;
  }
  const png = encodePng(width, height, rgba);
  const dec = decodePng(png);
  assert.equal(dec.width, width);
  assert.equal(dec.height, height);
  assert.deepEqual([...dec.data], [...rgba]);
});

test('decoder unfilters all filter types (None/Sub/Up/Paeth) on a truecolor PNG', () => {
  const {buf, pixels, width, height} = buildFilterSweepPng();
  const dec = decodePng(buf);
  assert.equal(dec.width, width);
  assert.equal(dec.height, height);
  for (let i = 0; i < width * height; i++) {
    assert.equal(dec.data[i * 4], pixels[i][0], `pixel ${i} R`);
    assert.equal(dec.data[i * 4 + 1], pixels[i][1], `pixel ${i} G`);
    assert.equal(dec.data[i * 4 + 2], pixels[i][2], `pixel ${i} B`);
    assert.equal(dec.data[i * 4 + 3], 255, `pixel ${i} A`);
  }
});

test('decoder rejects unsupported bit depth / interlace loudly', () => {
  const {buf} = buildFilterSweepPng();
  const bad = Buffer.from(buf);
  bad[24] = 16; // corrupt IHDR bit depth
  assert.throws(() => decodePng(bad), /bit depth/);
});

test('meanAbsDelta: identical images = 0, opposite = 255', () => {
  const black = solidImage(4, 4, {r: 0, g: 0, b: 0});
  const white = solidImage(4, 4, {r: 255, g: 255, b: 255});
  assert.equal(meanAbsDelta(black, black), 0);
  assert.equal(meanAbsDelta(black, white), 255);
});

test('meanAbsDelta: known partial delta', () => {
  const a = solidImage(2, 2, {r: 100, g: 100, b: 100});
  const b = solidImage(2, 2, {r: 100, g: 100, b: 130}); // only B differs by 30
  assert.equal(meanAbsDelta(a, b), 10); // (0+0+30)/3
});

test('meanAbsDelta rejects mismatched dimensions', () => {
  assert.throws(
    () => meanAbsDelta(solidImage(2, 2, {r: 0, g: 0, b: 0}), solidImage(3, 2, {r: 0, g: 0, b: 0})),
    /dimension mismatch/,
  );
});

test('quantize: a solid image collapses to one dominant bucket', () => {
  const img = solidImage(8, 8, {r: 0, g: 255, b: 0});
  const {total, buckets} = quantize(img, {bucket: 32});
  assert.equal(total, 64);
  assert.equal(buckets[0].fraction, 1);
  assert.ok(buckets[0].g > 200 && buckets[0].r < 40 && buckets[0].b < 40);
});

test('quantize: mask region is excluded from counts', () => {
  // Left half green, right half red; mask out the red half -> only green counted.
  const w = 4;
  const h = 2;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const green = x < 2;
      data[o] = green ? 0 : 255;
      data[o + 1] = green ? 255 : 0;
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  const {total, buckets} = quantize({width: w, height: h, data}, {bucket: 32, mask: {x: 2, y: 0, w: 2, h: 2}});
  assert.equal(total, 4); // only the green half
  assert.equal(buckets.length, 1);
  assert.ok(buckets[0].g > 200);
});

test('rgbToHsv: pure green hue ~120, pure red hue 0', () => {
  assert.equal(Math.round(rgbToHsv(0, 255, 0).h), 120);
  assert.equal(rgbToHsv(0, 255, 0).s, 1);
  assert.equal(rgbToHsv(255, 0, 0).h, 0);
});

test('colorDistance + hexToRgb: pure green is far from the synthacon safe token', () => {
  const green = {r: 0, g: 255, b: 0};
  const safe = hexToRgb('#3fd08c');
  assert.ok(colorDistance(green, safe) > 100);
});
