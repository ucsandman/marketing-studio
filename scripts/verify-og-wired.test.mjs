// node --test scripts/verify-og-wired.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMetaImages, compareOgAsset} from './verify-og-wired.mjs';
import {encodePng, decodePng, solidImage} from './lib/png.mjs';

// --- parseMetaImages ---------------------------------------------------------

test('parseMetaImages finds og:image with property/content order', () => {
  const html = '<head><meta property="og:image" content="https://x.test/og.png"></head>';
  assert.equal(parseMetaImages(html).ogImage, 'https://x.test/og.png');
});

test('parseMetaImages finds twitter:image with name=, content before name, single quotes', () => {
  const html = `<meta content='https://x.test/tw.png' name='twitter:image'>`;
  assert.equal(parseMetaImages(html).twitterImage, 'https://x.test/tw.png');
});

test('parseMetaImages returns null for both tags when neither is present', () => {
  const html = '<head><title>no og tags here</title></head>';
  const {ogImage, twitterImage} = parseMetaImages(html);
  assert.equal(ogImage, null);
  assert.equal(twitterImage, null);
});

// --- compareOgAsset -----------------------------------------------------------

const expectedPaths = ['out/noban/og.png', 'out/noban/og-image.png'];

test('L1: absent og:image meta tag is reported as FAIL, not skipped or passed', () => {
  const {ogImage} = parseMetaImages('<head></head>');
  const {verdict, message} = compareOgAsset({
    tagName: 'og:image',
    tagValue: ogImage,
    remote: null,
    local: {path: 'out/noban/og.png', width: 1200, height: 630},
    expectedPaths,
  });
  assert.equal(verdict, 'FAIL');
  assert.match(message, /no <meta property="og:image">/);
  assert.match(message, /out\/noban\/og\.png/);
});

test('remote image fetch/decode failure is FAIL and names the tag to fix', () => {
  const {verdict, message} = compareOgAsset({
    tagName: 'og:image',
    tagValue: 'https://x.test/og.png',
    remote: {error: '404 Not Found'},
    local: {path: 'out/noban/og.png', width: 1200, height: 630},
    expectedPaths,
  });
  assert.equal(verdict, 'FAIL');
  assert.match(message, /did not load \(404 Not Found\)/);
});

test('missing delivered asset is FAIL and names both probed paths', () => {
  const {verdict, message} = compareOgAsset({
    tagName: 'og:image',
    tagValue: 'https://x.test/og.png',
    remote: {contentType: 'image/png', width: 1200, height: 630},
    local: null,
    expectedPaths,
  });
  assert.equal(verdict, 'FAIL');
  assert.match(message, /out\/noban\/og\.png or out\/noban\/og-image\.png/);
});

test('a non-PNG remote image is FAIL and reports the content type instead of guessing dimensions', () => {
  const {verdict, message} = compareOgAsset({
    tagName: 'og:image',
    tagValue: 'https://x.test/og.jpg',
    remote: {contentType: 'image/jpeg', width: null, height: null},
    local: {path: 'out/noban/og.png', width: 1200, height: 630},
    expectedPaths,
  });
  assert.equal(verdict, 'FAIL');
  assert.match(message, /image\/jpeg/);
});

test('dimension mismatch between live image and delivered asset is FAIL and quotes both', () => {
  const {verdict, message} = compareOgAsset({
    tagName: 'og:image',
    tagValue: 'https://x.test/og.png',
    remote: {contentType: 'image/png', width: 600, height: 315},
    local: {path: 'out/noban/og.png', width: 1200, height: 630},
    expectedPaths,
  });
  assert.equal(verdict, 'FAIL');
  assert.match(message, /600x315/);
  assert.match(message, /1200x630/);
});

test('matching dimensions is PASS', () => {
  const {verdict, message} = compareOgAsset({
    tagName: 'og:image',
    tagValue: 'https://x.test/og.png',
    remote: {contentType: 'image/png', width: 1200, height: 630},
    local: {path: 'out/noban/og.png', width: 1200, height: 630},
    expectedPaths,
  });
  assert.equal(verdict, 'PASS');
  assert.match(message, /matches out\/noban\/og\.png/);
});

// --- tiny generated PNG round trip: proves the comparison uses real decoded
// dimensions, not just numbers typed into the test --------------------------

test('a real encoded PNG round-trips through decodePng into a PASS/FAIL verdict', () => {
  const img = solidImage(8, 4, {r: 200, g: 40, b: 40});
  const png = encodePng(img.width, img.height, img.data);
  const decoded = decodePng(png);

  const same = compareOgAsset({
    tagName: 'og:image',
    tagValue: 'https://x.test/og.png',
    remote: {contentType: 'image/png', width: decoded.width, height: decoded.height},
    local: {path: 'out/noban/og.png', width: decoded.width, height: decoded.height},
    expectedPaths,
  });
  assert.equal(same.verdict, 'PASS');

  const resized = decodePng(encodePng(4, 4, solidImage(4, 4, {r: 0, g: 0, b: 0}).data));
  const different = compareOgAsset({
    tagName: 'og:image',
    tagValue: 'https://x.test/og.png',
    remote: {contentType: 'image/png', width: resized.width, height: resized.height},
    local: {path: 'out/noban/og.png', width: decoded.width, height: decoded.height},
    expectedPaths,
  });
  assert.equal(different.verdict, 'FAIL');
});
