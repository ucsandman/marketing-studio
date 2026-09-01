#!/usr/bin/env node
// Results feedback loop: turns published posts into engagement numbers so the
// hook A/B pick can learn from reality instead of taste.
//
// Input:  out/<brand>/marketing/posts.json — seeded by build-postkit.mjs
//         (one unpublished row per platform: {platform, url: null, variant: null,
//         published: false}), then filled in by the operator or the launch-engine
//         after publishing. Shape (array or {posts: [...]}):
//           [{platform: 'x', url: 'https://x.com/u/status/123', variant: 'hook-2',
//             published: true},
//            {platform: 'linkedin', url: '...', variant: 'hook-1',
//             metrics: {impressions: 1200, likes: 40}}]   // manual entry
//         `variant` ties a post to run.json variants[] (hook A/B strategies).
//         A row with `published: false` or `url: null` (the seeded default, or
//         one that just hasn't gone out yet) is a clean skip, not an error.
//
// Fetching: X posts get public_metrics from the X API v2 (X_BEARER_TOKEN in the
// repo .env — value is never printed). Bluesky posts get like/repost/reply counts
// from the public AppView (no token: public.api.bsky.app). YouTube rows get
// videos.list statistics through the same OAuth token publish-youtube.mjs stored
// (private uploads are only visible to their owner). Other platforms
// (LinkedIn's stats API is partner-gated) carry inline `metrics` entered manually. Posts that cannot be
// resolved are written with source: 'unavailable', never dropped.
//
// Output: out/<brand>/marketing/results.json — Mission Control renders it next
// to the matching variants.
//
// Exit codes: 0 = all non-skipped posts resolved (a missing posts.json, or one
// with nothing published yet, is a clean 0 too); 1 = bad input (posts.json exists
// but isn't valid, or holds no posts); 2 = wrote what it could but at least one
// published post is unavailable (missing token / API error) — the same
// graceful-degradation contract as the audio/comfy feeders.
//
// Usage: node scripts/fetch-results.mjs <brand> [--json]
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {readEnvVar} from './lib/env.mjs';
import {normalizeBskyMetrics, parsePostUrl} from './publish-bluesky.mjs';
import {accessToken as youtubeAccessToken, hasYoutubeToken, normalizeYtMetrics, videoIdFromUrl} from './publish-youtube.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');


export function tweetIdFromUrl(url) {
  const m = /(?:twitter\.com|x\.com)\/[^/]+\/status(?:es)?\/(\d+)/.exec(String(url ?? ''));
  return m ? m[1] : null;
}

// Normalize X public_metrics to the results.json metrics shape.
export function normalizeXMetrics(pm) {
  if (!pm || typeof pm !== 'object') return null;
  return {
    impressions: pm.impression_count ?? null,
    likes: pm.like_count ?? 0,
    reposts: (pm.retweet_count ?? 0) + (pm.quote_count ?? 0),
    replies: pm.reply_count ?? 0,
    bookmarks: pm.bookmark_count ?? null,
  };
}

async function fetchXMetrics(ids, bearer) {
  const url = `https://api.x.com/2/tweets?ids=${ids.join(',')}&tweet.fields=public_metrics,created_at`;
  const res = await fetch(url, {headers: {authorization: `Bearer ${bearer}`}});
  if (!res.ok) {
    throw new Error(`X API ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  const byId = new Map();
  for (const t of body.data ?? []) byId.set(t.id, normalizeXMetrics(t.public_metrics));
  return byId;
}

// Bluesky: a bsky.app URL names the actor by handle, the AppView wants the AT URI,
// so resolve the handle to a DID first. Both endpoints are public and unauthenticated.
const BSKY_PUBLIC = 'https://public.api.bsky.app/xrpc';
async function fetchBskyMetrics(urls) {
  const byUrl = new Map();
  const uris = [];
  for (const url of urls) {
    const parsed = parsePostUrl(url);
    if (!parsed) continue;
    let did = parsed.actor;
    if (!did.startsWith('did:')) {
      const r = await fetch(`${BSKY_PUBLIC}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(parsed.actor)}`);
      if (!r.ok) throw new Error(`resolveHandle ${r.status}`);
      did = (await r.json()).did;
    }
    const uri = `at://${did}/app.bsky.feed.post/${parsed.rkey}`;
    uris.push(uri);
    byUrl.set(uri, url);
  }
  if (uris.length === 0) return new Map();
  const q = uris.map((u) => `uris=${encodeURIComponent(u)}`).join('&');
  const res = await fetch(`${BSKY_PUBLIC}/app.bsky.feed.getPosts?${q}`);
  if (!res.ok) throw new Error(`getPosts ${res.status} ${res.statusText}`);
  const body = await res.json();
  const out = new Map();
  for (const post of body.posts ?? []) out.set(byUrl.get(post.uri), normalizeBskyMetrics(post));
  return out;
}

async function fetchYtMetrics(ids) {
  const token = await youtubeAccessToken(readEnvVar('YOUTUBE_CLIENT_ID'), readEnvVar('YOUTUBE_CLIENT_SECRET'));
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(',')}`, {
    headers: {authorization: `Bearer ${token}`},
  });
  if (!res.ok) throw new Error(`YouTube API ${res.status} ${res.statusText}`);
  const body = await res.json();
  const byId = new Map();
  for (const v of body.items ?? []) byId.set(v.id, normalizeYtMetrics(v.statistics));
  return byId;
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const brand = argv.find((a) => !a.startsWith('--'));
  if (!brand) {
    console.error('usage: node scripts/fetch-results.mjs <brand> [--json]');
    process.exit(1);
  }

  const marketingDir = join(root, 'out', brand, 'marketing');
  const postsPath = join(marketingDir, 'posts.json');
  if (!existsSync(postsPath)) {
    console.log(`fetch-results [${brand}]: no out/${brand}/marketing/posts.json yet (run build-postkit.mjs) — 0 of 0 rows published, skipping.`);
    process.exit(0);
  }

  let postsRaw;
  try {
    const parsed = JSON.parse(readFileSync(postsPath, 'utf8'));
    postsRaw = Array.isArray(parsed) ? parsed : parsed.posts;
  } catch (err) {
    console.error(`fetch-results: posts.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(postsRaw) || postsRaw.length === 0) {
    console.error('fetch-results: posts.json holds no posts (expected an array or {posts: [...]})');
    process.exit(1);
  }

  const posts = postsRaw.map((p) => ({
    platform: typeof p.platform === 'string' ? p.platform : 'unknown',
    url: p.url ?? null,
    id: tweetIdFromUrl(p.url) ?? p.id ?? null,
    variant: p.variant ?? null,
    metrics: p.metrics && typeof p.metrics === 'object' ? p.metrics : null,
    // A seeded, not-yet-published row (build-postkit.mjs writes published:false,
    // url:null) is a clean skip, not a failed fetch — it just hasn't gone out.
    source: p.metrics ? 'manual' : p.published === false || p.url == null ? 'skipped' : null,
  }));

  const xPending = posts.filter((p) => p.platform === 'x' && !p.metrics && p.id && p.source !== 'skipped');
  let degraded = false;
  if (xPending.length > 0) {
    const bearer = readEnvVar('X_BEARER_TOKEN');
    if (!bearer) {
      console.error(
        'fetch-results: X_BEARER_TOKEN missing from .env — X posts marked unavailable. ' +
          'Add the token (see .env.example) and re-run.',
      );
      degraded = true;
      for (const p of xPending) p.source = 'unavailable';
    } else {
      try {
        const byId = await fetchXMetrics(xPending.map((p) => p.id), bearer);
        for (const p of xPending) {
          const m = byId.get(p.id);
          if (m) {
            p.metrics = m;
            p.source = 'x-api';
          } else {
            p.source = 'unavailable';
            degraded = true;
          }
        }
      } catch (err) {
        console.error(`fetch-results: X fetch failed: ${err.message} — X posts marked unavailable.`);
        degraded = true;
        for (const p of xPending) p.source = 'unavailable';
      }
    }
  }
  const ytPending = posts.filter((p) => p.platform === 'youtube' && !p.metrics && videoIdFromUrl(p.url) && p.source !== 'skipped');
  if (ytPending.length > 0) {
    if (!hasYoutubeToken() || !readEnvVar('YOUTUBE_CLIENT_ID')) {
      console.error('fetch-results: no YouTube token (node scripts/publish-youtube.mjs --auth) — YouTube posts marked unavailable.');
      degraded = true;
      for (const p of ytPending) p.source = 'unavailable';
    } else {
      try {
        const byId = await fetchYtMetrics(ytPending.map((p) => videoIdFromUrl(p.url)));
        for (const p of ytPending) {
          const m = byId.get(videoIdFromUrl(p.url));
          if (m) {
            p.metrics = m;
            p.source = 'youtube-api';
          } else {
            p.source = 'unavailable';
            degraded = true;
          }
        }
      } catch (err) {
        console.error(`fetch-results: YouTube fetch failed: ${err.message} — YouTube posts marked unavailable.`);
        degraded = true;
        for (const p of ytPending) p.source = 'unavailable';
      }
    }
  }
  const bskyPending = posts.filter((p) => p.platform === 'bluesky' && !p.metrics && p.url && p.source !== 'skipped');
  if (bskyPending.length > 0) {
    try {
      const byUrl = await fetchBskyMetrics(bskyPending.map((p) => p.url));
      for (const p of bskyPending) {
        const m = byUrl.get(p.url);
        if (m) {
          p.metrics = m;
          p.source = 'bsky-api';
        } else {
          p.source = 'unavailable';
          degraded = true;
        }
      }
    } catch (err) {
      console.error(`fetch-results: Bluesky fetch failed: ${err.message} — Bluesky posts marked unavailable.`);
      degraded = true;
      for (const p of bskyPending) p.source = 'unavailable';
    }
  }
  for (const p of posts) {
    if (!p.source) {
      p.source = 'unavailable';
      degraded = true;
    }
  }

  const report = {
    brand,
    fetchedAt: new Date().toISOString(),
    posts,
  };
  mkdirSync(marketingDir, {recursive: true});
  const outPath = join(marketingDir, 'results.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const publishedCount = posts.filter((p) => p.source !== 'skipped').length;
    console.log(`fetch-results [${brand}]: ${publishedCount} of ${posts.length} rows published -> out/${brand}/marketing/results.json`);
    for (const p of posts) {
      const m = p.metrics;
      const stats = m
        ? `likes ${m.likes ?? '?'} · reposts ${m.reposts ?? '?'} · replies ${m.replies ?? '?'}` +
          (m.impressions != null ? ` · impressions ${m.impressions}` : '')
        : 'no metrics';
      console.log(`  [${p.source}] ${p.platform}${p.variant ? ` (${p.variant})` : ''}: ${stats}`);
    }
  }

  process.exit(degraded ? 2 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
