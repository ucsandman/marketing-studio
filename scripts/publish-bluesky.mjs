#!/usr/bin/env node
// Publish a brand's postkit to Bluesky and record the live URL in posts.json.
//
// Bluesky is the one platform with an open write + metrics API (no partner review),
// so this is the first hop of the publish record that the results loop
// (fetch-results.mjs -> Mission Control) has never had real data for.
//
// Input:  out/<brand>/postkit/bluesky/{caption.txt, alt.txt, social-16x9.mp4}
//         written by build-postkit.mjs (PLATFORM_MAP.bluesky).
// Creds:  BLUESKY_HANDLE + BLUESKY_APP_PASSWORD in the repo .env (an app password
//         from Settings > App passwords, never the account password). Never printed.
// Wire:   com.atproto.server.createSession -> com.atproto.server.getServiceAuth ->
//         video.bsky.app app.bsky.video.uploadVideo (+ getJobStatus polling) ->
//         com.atproto.repo.createRecord with an app.bsky.embed.video embed.
// Output: the post URL, appended to out/<brand>/marketing/posts.json through
//         Mission Control's applyPosted (one row per platform, last write wins).
//
// Exit codes: 0 = posted (or --dry-run built the record); 1 = bad input or API
// error; 2 = cannot publish yet (no postkit folder, or creds missing) with the hint
// printed — the same graceful-degradation contract as fetch-results.mjs.
//
// Usage: node scripts/publish-bluesky.mjs <brand> [--dry-run] [--json] [--variant <id>]
import {existsSync, readFileSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readEnvVar} from './lib/env.mjs';
import {applyPosted} from './mission-control.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const BSKY_MAX_GRAPHEMES = 300;
export const BSKY_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const ENTRY_HOST = 'https://bsky.social';
const VIDEO_HOST = 'https://video.bsky.app';

// --- pure helpers (unit-tested, no I/O) --------------------------------------

export function graphemeCount(text) {
  return [...new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(String(text ?? ''))].length;
}

// Bluesky renders links only where a facet says so; offsets are UTF-8 BYTES.
export function linkFacets(text) {
  const facets = [];
  for (const m of String(text ?? '').matchAll(/https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g)) {
    const byteStart = Buffer.byteLength(text.slice(0, m.index), 'utf8');
    facets.push({
      index: {byteStart, byteEnd: byteStart + Buffer.byteLength(m[0], 'utf8')},
      features: [{$type: 'app.bsky.richtext.facet#link', uri: m[0]}],
    });
  }
  return facets;
}

export function buildRecord({text, alt, videoBlob, width, height, createdAt = new Date()}) {
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: createdAt.toISOString(),
  };
  const facets = linkFacets(text);
  if (facets.length) record.facets = facets;
  if (videoBlob) {
    record.embed = {
      $type: 'app.bsky.embed.video',
      video: videoBlob,
      alt: alt || undefined,
      aspectRatio: {width, height},
    };
  }
  return record;
}

// at://did:plc:xyz/app.bsky.feed.post/3kabc -> https://bsky.app/profile/<handle>/post/3kabc
export function postUrl(handle, atUri) {
  const rkey = String(atUri).split('/').pop();
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

// https://bsky.app/profile/<handle-or-did>/post/<rkey> -> {actor, rkey}
export function parsePostUrl(url) {
  const m = /bsky\.app\/profile\/([^/]+)\/post\/([A-Za-z0-9._~-]+)/.exec(String(url ?? ''));
  return m ? {actor: m[1], rkey: m[2]} : null;
}

// app.bsky.feed.defs#postView counts -> the results.json metrics shape fetch-results
// already writes for X (impressions/bookmarks are not exposed by Bluesky).
export function normalizeBskyMetrics(post) {
  if (!post || typeof post !== 'object') return null;
  return {
    impressions: null,
    likes: post.likeCount ?? 0,
    reposts: (post.repostCount ?? 0) + (post.quoteCount ?? 0),
    replies: post.replyCount ?? 0,
    bookmarks: null,
  };
}

// Where the postkit put the pieces this publisher needs. Pure over a root so the
// test can point it at a temp dir.
export function loadPostkit(rootDir, brand) {
  const dir = join(rootDir, 'out', brand, 'postkit', 'bluesky');
  if (!existsSync(dir)) return {ok: false, reason: `no out/${brand}/postkit/bluesky/ yet — run node scripts/build-postkit.mjs ${brand}`};
  const captionPath = join(dir, 'caption.txt');
  if (!existsSync(captionPath)) return {ok: false, reason: `missing ${captionPath}`};
  const text = readFileSync(captionPath, 'utf8').trim();
  const altPath = join(dir, 'alt.txt');
  const alt = existsSync(altPath) ? readFileSync(altPath, 'utf8').trim() : '';
  const videoPath = join(dir, 'social-16x9.mp4');
  const video = existsSync(videoPath) ? videoPath : null;
  const platforms = JSON.parse(readFileSync(join(rootDir, 'scripts', 'platforms.json'), 'utf8'));
  const row = platforms.find((p) => p.id === 'social-16x9') ?? {width: 1920, height: 1080};
  return {ok: true, dir, text, alt, video, width: row.width, height: row.height};
}

// --- wire ----------------------------------------------------------------------

async function xrpc(base, nsid, {method = 'GET', token, query, body, contentType} = {}) {
  const url = new URL(`${base}/xrpc/${nsid}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof Uint8Array) {
    headers['content-type'] = contentType;
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, {method, headers, body: payload});
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${nsid} ${res.status}: ${json.message ?? json.error ?? res.statusText}`);
  return json;
}

function pdsFromSession(session) {
  const svc = (session.didDoc?.service ?? []).find((s) => s.type === 'AtprotoPersonalDataServer');
  return svc?.serviceEndpoint ?? ENTRY_HOST;
}

async function uploadVideo(session, pds, videoPath, name) {
  const bytes = readFileSync(videoPath);
  if (bytes.length > BSKY_MAX_VIDEO_BYTES) throw new Error(`video is ${bytes.length} bytes, over Bluesky's ${BSKY_MAX_VIDEO_BYTES}`);
  const {token} = await xrpc(pds, 'com.atproto.server.getServiceAuth', {
    token: session.accessJwt,
    query: {
      aud: `did:web:${new URL(pds).host}`,
      lxm: 'com.atproto.repo.uploadBlob',
      exp: String(Math.floor(Date.now() / 1000) + 30 * 60),
    },
  });
  let job = await xrpc(VIDEO_HOST, 'app.bsky.video.uploadVideo', {
    method: 'POST',
    token,
    query: {did: session.did, name},
    body: new Uint8Array(bytes),
    contentType: 'video/mp4',
  });
  // Processing is async: poll until the job hands back the blob ref.
  const deadline = Date.now() + 5 * 60 * 1000;
  while (!job.blob) {
    if (job.state === 'JOB_STATE_FAILED') throw new Error(`video processing failed: ${job.error ?? 'unknown'}`);
    if (Date.now() > deadline) throw new Error('video processing timed out after 5 minutes');
    await new Promise((r) => setTimeout(r, 2000));
    const status = await xrpc(VIDEO_HOST, 'app.bsky.video.getJobStatus', {token, query: {jobId: job.jobId}});
    job = status.jobStatus ?? status;
  }
  return job.blob;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const asJson = argv.includes('--json');
  const variantIdx = argv.indexOf('--variant');
  const variant = variantIdx >= 0 ? argv[variantIdx + 1] : null;
  const brand = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--variant');
  if (!brand) {
    console.error('usage: node scripts/publish-bluesky.mjs <brand> [--dry-run] [--json] [--variant <id>]');
    process.exit(1);
  }

  const kit = loadPostkit(root, brand);
  if (!kit.ok) {
    console.error(`publish-bluesky [${brand}]: ${kit.reason}`);
    process.exit(2);
  }
  const graphemes = graphemeCount(kit.text);
  if (graphemes > BSKY_MAX_GRAPHEMES) {
    console.error(`publish-bluesky [${brand}]: caption is ${graphemes} graphemes, Bluesky allows ${BSKY_MAX_GRAPHEMES}`);
    process.exit(1);
  }

  if (dryRun) {
    const record = buildRecord({
      text: kit.text,
      alt: kit.alt,
      videoBlob: kit.video ? {$type: 'blob', ref: {$link: '<uploaded at publish time>'}, mimeType: 'video/mp4', size: statSync(kit.video).size} : null,
      width: kit.width,
      height: kit.height,
    });
    const summary = {brand, dryRun: true, graphemes, video: kit.video, record};
    if (asJson) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`publish-bluesky [${brand}] dry run: ${graphemes} graphemes, ${record.facets?.length ?? 0} link facets, video ${kit.video ? `${statSync(kit.video).size} bytes` : 'none'}`);
      console.log(record.text);
    }
    process.exit(0);
  }

  const handle = readEnvVar('BLUESKY_HANDLE');
  const password = readEnvVar('BLUESKY_APP_PASSWORD');
  if (!handle || !password) {
    console.error('publish-bluesky: BLUESKY_HANDLE / BLUESKY_APP_PASSWORD missing from .env (see .env.example) — nothing published.');
    process.exit(2);
  }

  const session = await xrpc(ENTRY_HOST, 'com.atproto.server.createSession', {
    method: 'POST',
    body: {identifier: handle, password},
  });
  const pds = pdsFromSession(session);
  const videoBlob = kit.video ? await uploadVideo(session, pds, kit.video, `${brand}-social-16x9.mp4`) : null;
  const record = buildRecord({text: kit.text, alt: kit.alt, videoBlob, width: kit.width, height: kit.height});
  const created = await xrpc(pds, 'com.atproto.repo.createRecord', {
    method: 'POST',
    token: session.accessJwt,
    body: {repo: session.did, collection: 'app.bsky.feed.post', record},
  });
  const url = postUrl(session.handle ?? handle, created.uri);
  const postsPath = join(root, 'out', brand, 'marketing', 'posts.json');
  const posted = applyPosted(postsPath, {platform: 'bluesky', url, variant});
  if (posted.status !== 200) {
    console.error(`publish-bluesky: posted but could not record it: ${posted.body.error}`);
    process.exit(1);
  }
  if (asJson) console.log(JSON.stringify({brand, url, uri: created.uri, variant}, null, 2));
  else console.log(`publish-bluesky [${brand}]: posted ${url} (recorded in out/${brand}/marketing/posts.json)`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(`publish-bluesky: ${err.message}`);
    process.exit(1);
  });
}
