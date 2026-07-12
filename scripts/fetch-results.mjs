#!/usr/bin/env node
// Results feedback loop: turns published posts into engagement numbers so the
// hook A/B pick can learn from reality instead of taste.
//
// Input:  out/<brand>/marketing/posts.json — written by the operator or the
//         launch-engine after publishing. Shape (array or {posts: [...]}):
//           [{platform: 'x', url: 'https://x.com/u/status/123', variant: 'hook-2'},
//            {platform: 'linkedin', url: '...', variant: 'hook-1',
//             metrics: {impressions: 1200, likes: 40}}]   // manual entry
//         `variant` ties a post to run.json variants[] (hook A/B strategies).
//
// Fetching: X posts get public_metrics from the X API v2 (X_BEARER_TOKEN in the
// repo .env — value is never printed). Other platforms (LinkedIn's stats API is
// partner-gated) carry inline `metrics` entered manually. Posts that cannot be
// resolved are written with source: 'unavailable', never dropped.
//
// Output: out/<brand>/marketing/results.json — Mission Control renders it next
// to the matching variants.
//
// Exit codes: 0 = all posts resolved; 1 = bad input; 2 = wrote what it could
// but at least one post is unavailable (missing token / API error) — the same
// graceful-degradation contract as the audio/comfy feeders.
//
// Usage: node scripts/fetch-results.mjs <brand> [--json]
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env reader: KEY=VALUE lines, no expansion. Values never printed.
function readEnvVar(name) {
  if (process.env[name]) return process.env[name];
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return null;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] === name && m[2]) return m[2].replace(/^["']|["']$/g, '');
  }
  return null;
}

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
    console.error(
      `fetch-results: ${postsPath} not found.\n` +
        `Write it after publishing (array of {platform, url, variant?, metrics?}) — ` +
        `the launch-engine or the operator records which post carried which variant.`,
    );
    process.exit(1);
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
    source: p.metrics ? 'manual' : null,
  }));

  const xPending = posts.filter((p) => p.platform === 'x' && !p.metrics && p.id);
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
    console.log(`fetch-results [${brand}]: ${posts.length} post(s) -> out/${brand}/marketing/results.json`);
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
