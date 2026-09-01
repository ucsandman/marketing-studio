#!/usr/bin/env node
// scripts/verify-og-wired.mjs — prove the link preview actually changed: fetch the
// LIVE page, parse its og:image/twitter:image meta tags, fetch the image they point
// at, and compare its dimensions against the DELIVERED asset — out/<brand>/og.png or
// out/<brand>/og-image.png (the per-brand statics scripts disagree on the name; see
// scripts/render-*-statics.mjs). A green judge on the generated file proves nothing
// about what a visitor's browser actually fetches — this checks the wire, not the
// build output.
//
// Usage: node scripts/verify-og-wired.mjs <brand> [url] [--strict]
// url defaults to https:// + brands/<brand>.json's `url` field (a bare host).
// Advisory like the other judges: exit 0 with a PASS/FAIL verdict; --strict exits 1
// on FAIL. Exits 0 and SKIPS (no verdict) when the brand has no url configured and
// none was passed, or the page can't be reached — a site not deployed yet is not a
// failure.
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {decodePng} from './lib/png.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FETCH_TIMEOUT_MS = 8000;

// --- pure/testable -----------------------------------------------------------

// Tolerant scrape over <meta> tags: matches property="..." or name="...", either
// attribute order, single or double quotes — real pages vary all three.
export function parseMetaImages(html) {
  return {
    ogImage: matchMetaContent(html, 'og:image'),
    twitterImage: matchMetaContent(html, 'twitter:image'),
  };
}

function matchMetaContent(html, metaName) {
  const tagRe = /<meta\b[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    if (!new RegExp(`(?:property|name)\\s*=\\s*["']${metaName}["']`, 'i').test(tag)) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (content) return content[1];
  }
  return null;
}

// Decide PASS/FAIL for one meta tag given what the live page and the delivered
// asset actually say. remote: null (tag absent) | {error} (fetch/decode failed) |
// {contentType, width, height} (width/height null when not decodable as PNG).
// local: null (neither out/<brand>/{og.png,og-image.png} exists) | {path, width,
// height}. expectedPaths: the file(s) probed, for the "expected file" callout.
export function compareOgAsset({tagName, tagValue, remote, local, expectedPaths}) {
  const expected = expectedPaths.join(' or ');
  if (!tagValue) {
    return {
      verdict: 'FAIL',
      message: `no <meta property="${tagName}"> tag on the page — add one pointing at the delivered asset (expected ${expected})`,
    };
  }
  if (remote?.error) {
    return {
      verdict: 'FAIL',
      message: `<meta property="${tagName}" content="${tagValue}"> did not load (${remote.error}) — point it at ${expected}`,
    };
  }
  if (!local) {
    return {
      verdict: 'FAIL',
      message: `no delivered asset at ${expected} — render it (node scripts/render-<brand>-statics.mjs), then point <meta property="${tagName}"> at it`,
    };
  }
  if (remote.width == null || remote.height == null) {
    return {
      verdict: 'FAIL',
      message: `<meta property="${tagName}" content="${tagValue}"> serves ${remote.contentType} — can't decode dimensions to compare against ${local.path}`,
    };
  }
  if (remote.width !== local.width || remote.height !== local.height) {
    return {
      verdict: 'FAIL',
      message: `<meta property="${tagName}" content="${tagValue}"> is ${remote.width}x${remote.height}, but ${local.path} is ${local.width}x${local.height} — the live page is serving a stale build; redeploy`,
    };
  }
  return {
    verdict: 'PASS',
    message: `<meta property="${tagName}" content="${tagValue}"> matches ${local.path} (${remote.width}x${remote.height})`,
  };
}

// --- fetch/decode helpers -----------------------------------------------------

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {signal: controller.signal});
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Returns {contentType, width, height} (width/height null when not PNG or not
// decodable) or {error} on a fetch failure. Never throws.
async function fetchImageMeta(imageUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(imageUrl, {signal: controller.signal});
    if (!res.ok) return {error: `${res.status} ${res.statusText}`};
    const contentType = res.headers.get('content-type') || 'unknown';
    const bytes = Buffer.from(await res.arrayBuffer());
    let width = null;
    let height = null;
    if (contentType.includes('png')) {
      try {
        ({width, height} = decodePng(bytes));
      } catch {
        // leave width/height null — reported as "not decodable"
      }
    }
    return {contentType, bytes: bytes.length, width, height};
  } catch (err) {
    return {error: err.message};
  } finally {
    clearTimeout(timer);
  }
}

// Probes both names the statics scripts use and returns {path, bytes, width,
// height} for whichever exists first (og.png before og-image.png), or null.
function findLocalAsset(brand) {
  for (const name of ['og.png', 'og-image.png']) {
    const p = join(root, 'out', brand, name);
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    try {
      const {width, height} = decodePng(buf);
      return {path: p, bytes: buf.length, width, height};
    } catch {
      return {path: p, bytes: buf.length, width: null, height: null};
    }
  }
  return null;
}

// --- CLI -----------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const [brand, urlArg] = positional;
  if (!brand) {
    console.error('usage: node scripts/verify-og-wired.mjs <brand> [url] [--strict]');
    process.exit(1);
  }

  let pageUrl = urlArg;
  if (!pageUrl) {
    const brandPath = join(root, 'brands', `${brand}.json`);
    if (!existsSync(brandPath)) {
      console.error(`verify-og-wired: missing ${brandPath}`);
      process.exit(1);
    }
    const brandDef = JSON.parse(readFileSync(brandPath, 'utf8'));
    if (!brandDef.url) {
      console.log(`verify-og-wired: SKIP — brand "${brand}" has no url configured and none was passed`);
      process.exit(0);
    }
    pageUrl = `https://${brandDef.url}`;
  }

  let html;
  try {
    html = await fetchText(pageUrl);
  } catch (err) {
    console.log(`verify-og-wired: SKIP — ${pageUrl} unreachable (${err.message})`);
    process.exit(0);
  }

  const {ogImage, twitterImage} = parseMetaImages(html);
  const expectedPaths = [`out/${brand}/og.png`, `out/${brand}/og-image.png`];
  const local = findLocalAsset(brand);

  console.log(`page    ${pageUrl}`);
  console.log(`og:image       ${ogImage ?? '(absent)'}`);
  console.log(`twitter:image  ${twitterImage ?? '(absent)'}`);
  if (local) {
    console.log(`local asset    ${local.path} — ${local.bytes} bytes, ${local.width ?? '?'}x${local.height ?? '?'}`);
  } else {
    console.log(`local asset    none found (${expectedPaths.join(' or ')})`);
  }

  const remote = ogImage ? await fetchImageMeta(new URL(ogImage, pageUrl).href) : null;
  if (remote && !remote.error) {
    console.log(`remote image   ${remote.contentType} — ${remote.bytes} bytes, ${remote.width ?? '?'}x${remote.height ?? '?'}`);
  }

  const {verdict, message} = compareOgAsset({
    tagName: 'og:image',
    tagValue: ogImage,
    remote,
    local,
    expectedPaths,
  });

  console.log(`\nverify-og-wired: ${verdict} — ${message}`);
  process.exit(strict && verdict === 'FAIL' ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
