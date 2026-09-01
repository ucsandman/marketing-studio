#!/usr/bin/env node
// Upload a brand's launch video to YouTube and record the live URL in posts.json.
//
// Same contract as publish-bluesky.mjs, no SDK: OAuth 2.0 installed-app flow and the
// resumable upload endpoint are three fetch calls, so googleapis (88 packages) stays
// out of the tree.
//
// Input:  out/<brand>/postkit/youtube/{launch-16x9.mp4, caption.txt, launch.srt?}
//         written by build-postkit.mjs; the title is the brief's hook headline
//         (out/<brand>/marketing/brief.json), falling back to brand.tagline.
// Creds:  YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET in .env (a Desktop-app OAuth
//         client from Google Cloud Console with the YouTube Data API v3 enabled).
//         `--auth` runs the consent flow once and stores the refresh token in
//         .youtube-token.json (gitignored). Neither value is ever printed.
// Wire:   oauth2.googleapis.com/token (refresh) -> POST /upload/youtube/v3/videos
//         ?uploadType=resumable (session) -> PUT the bytes -> video id.
// Output: https://youtu.be/<id>, appended to out/<brand>/marketing/posts.json via
//         Mission Control's applyPosted (one row per platform, last write wins).
//
// Uploads are PRIVATE by default (--privacy unlisted|public to change): a marketing
// upload should be watched once on the channel before it goes public, and the
// operator flips it in YouTube Studio.
//
// Exit codes: 0 = uploaded (or --dry-run built the request); 1 = bad input or API
// error; 2 = cannot publish yet (no postkit, no client creds, or no token) with the
// hint printed.
//
// Usage: node scripts/publish-youtube.mjs <brand> [--dry-run] [--json] [--auth]
//          [--privacy private|unlisted|public] [--variant <id>]
import {createServer} from 'node:http';
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readEnvVar} from './lib/env.mjs';
import {applyPosted} from './mission-control.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_PATH = join(root, '.youtube-token.json');
// upload for the publish, readonly so fetch-results can read videos.list statistics
// on private uploads (the upload scope alone gets a 403 there, seen 2026-09-01).
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
export const YT_MAX_TITLE = 100;
export const YT_MAX_DESCRIPTION = 5000;
export const YT_MAX_BYTES = 256 * 1024 * 1024 * 1024;

// --- pure helpers (unit-tested, no I/O) --------------------------------------

// YouTube rejects '<' and '>' in titles and hard-caps at 100 characters.
export function cleanTitle(title) {
  const t = String(title ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > YT_MAX_TITLE ? `${t.slice(0, YT_MAX_TITLE - 1).trimEnd()}…` : t;
}

export function buildVideoResource({title, description, privacy = 'private', tags = []}) {
  if (!['private', 'unlisted', 'public'].includes(privacy)) throw new Error(`privacy must be private|unlisted|public, got ${privacy}`);
  return {
    snippet: {
      title: cleanTitle(title),
      description: String(description ?? '').slice(0, YT_MAX_DESCRIPTION),
      tags,
      categoryId: '28', // Science & Technology
    },
    status: {privacyStatus: privacy, selfDeclaredMadeForKids: false},
  };
}

export function videoUrl(id) {
  return `https://youtu.be/${id}`;
}

export function videoIdFromUrl(url) {
  const m = /(?:youtu\.be\/|[?&]v=|\/shorts\/)([A-Za-z0-9_-]{6,})/.exec(String(url ?? ''));
  return m ? m[1] : null;
}

// statistics from videos.list?part=statistics -> the results.json metrics shape.
export function normalizeYtMetrics(stats) {
  if (!stats || typeof stats !== 'object') return null;
  return {
    impressions: stats.viewCount != null ? Number(stats.viewCount) : null,
    likes: Number(stats.likeCount ?? 0),
    reposts: 0,
    replies: Number(stats.commentCount ?? 0),
    bookmarks: stats.favoriteCount != null ? Number(stats.favoriteCount) : null,
  };
}

// Pure over a root so the test can point it at a temp dir.
export function loadPostkit(rootDir, brand) {
  const dir = join(rootDir, 'out', brand, 'postkit', 'youtube');
  if (!existsSync(dir)) return {ok: false, reason: `no out/${brand}/postkit/youtube/ yet — run node scripts/build-postkit.mjs ${brand}`};
  const video = join(dir, 'launch-16x9.mp4');
  if (!existsSync(video)) return {ok: false, reason: `missing ${video} (render the matrix first: node scripts/render-matrix.mjs ${brand} --comp LaunchVideo)`};
  const captionPath = join(dir, 'caption.txt');
  const description = existsSync(captionPath) ? readFileSync(captionPath, 'utf8').trim() : '';
  let title = '';
  const briefPath = join(rootDir, 'out', brand, 'marketing', 'brief.json');
  if (existsSync(briefPath)) {
    try {
      title = JSON.parse(readFileSync(briefPath, 'utf8')).hook?.headline ?? '';
    } catch {
      title = '';
    }
  }
  if (!title) {
    const brandPath = join(rootDir, 'brands', `${brand}.json`);
    if (existsSync(brandPath)) {
      const b = JSON.parse(readFileSync(brandPath, 'utf8'));
      title = b.tagline ? `${b.name ?? brand}: ${b.tagline}` : b.name ?? brand;
    } else title = brand;
  }
  const srt = join(dir, 'launch.srt');
  return {ok: true, dir, video, bytes: statSync(video).size, title, description, srt: existsSync(srt) ? srt : null};
}

// --- wire ----------------------------------------------------------------------

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`oauth token ${res.status}: ${json.error_description ?? json.error ?? res.statusText}`);
  return json;
}

// One-time consent: a loopback server catches the redirect, the refresh token is
// stored next to .env (gitignored). The operator clicks Allow in their own browser.
async function authorize(clientId, clientSecret) {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirect = `http://127.0.0.1:${server.address().port}/`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  }).toString();
  console.log(`publish-youtube: open this URL and approve access:\n${url}`);
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('consent timed out after 10 minutes')), 10 * 60 * 1000);
    server.on('request', (req, res) => {
      const q = new URL(req.url, redirect).searchParams;
      res.end(q.get('code') ? 'Authorized. You can close this tab.' : `Denied: ${q.get('error')}`);
      clearTimeout(timer);
      q.get('code') ? resolve(q.get('code')) : reject(new Error(`consent denied: ${q.get('error')}`));
    });
  }).finally(() => server.close());
  const tok = await tokenRequest({code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code'});
  if (!tok.refresh_token) throw new Error('no refresh_token returned (revoke the app at myaccount.google.com/permissions and re-run --auth)');
  writeFileSync(TOKEN_PATH, JSON.stringify({refresh_token: tok.refresh_token, scope: SCOPE, obtainedAt: new Date().toISOString()}, null, 2) + '\n');
  console.log(`publish-youtube: refresh token stored in ${TOKEN_PATH}`);
}

export function hasYoutubeToken() {
  return existsSync(TOKEN_PATH);
}

export async function accessToken(clientId, clientSecret) {
  const stored = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
  const tok = await tokenRequest({refresh_token: stored.refresh_token, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token'});
  return tok.access_token;
}

async function upload(token, kit, resource) {
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': 'video/mp4',
      'x-upload-content-length': String(kit.bytes),
    },
    body: JSON.stringify(resource),
  });
  if (!start.ok) throw new Error(`upload session ${start.status}: ${(await start.text()).slice(0, 300)}`);
  const session = start.headers.get('location');
  const put = await fetch(session, {
    method: 'PUT',
    headers: {'content-type': 'video/mp4', 'content-length': String(kit.bytes)},
    body: readFileSync(kit.video),
  });
  const json = await put.json().catch(() => ({}));
  if (!put.ok) throw new Error(`upload ${put.status}: ${json.error?.message ?? put.statusText}`);
  return json.id;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const dryRun = argv.includes('--dry-run');
  const asJson = argv.includes('--json');
  const doAuth = argv.includes('--auth');
  const privacy = flag('--privacy') ?? 'private';
  const variant = flag('--variant');
  const brand = argv.find((a, i) => !a.startsWith('--') && !['--privacy', '--variant'].includes(argv[i - 1]));

  const clientId = readEnvVar('YOUTUBE_CLIENT_ID');
  const clientSecret = readEnvVar('YOUTUBE_CLIENT_SECRET');
  if (doAuth) {
    if (!clientId || !clientSecret) {
      console.error('publish-youtube: YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET missing from .env (see .env.example).');
      process.exit(2);
    }
    await authorize(clientId, clientSecret);
    if (!brand) return;
  }
  if (!brand) {
    console.error('usage: node scripts/publish-youtube.mjs <brand> [--dry-run] [--json] [--auth] [--privacy private|unlisted|public] [--variant <id>]');
    process.exit(1);
  }

  const kit = loadPostkit(root, brand);
  if (!kit.ok) {
    console.error(`publish-youtube [${brand}]: ${kit.reason}`);
    process.exit(2);
  }
  const resource = buildVideoResource({title: kit.title, description: kit.description, privacy});

  if (dryRun) {
    const summary = {brand, dryRun: true, video: kit.video, bytes: kit.bytes, srt: kit.srt, resource};
    if (asJson) console.log(JSON.stringify(summary, null, 2));
    else console.log(`publish-youtube [${brand}] dry run: "${resource.snippet.title}" (${privacy}), ${kit.bytes} bytes, description ${resource.snippet.description.length} chars${kit.srt ? ', srt present' : ''}`);
    process.exit(0);
  }

  if (!clientId || !clientSecret) {
    console.error('publish-youtube: YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET missing from .env (see .env.example) — nothing uploaded.');
    process.exit(2);
  }
  if (!existsSync(TOKEN_PATH)) {
    console.error(`publish-youtube: no ${TOKEN_PATH} — run node scripts/publish-youtube.mjs --auth once, then retry.`);
    process.exit(2);
  }
  const token = await accessToken(clientId, clientSecret);
  const id = await upload(token, kit, resource);
  const url = videoUrl(id);
  const posted = applyPosted(join(root, 'out', brand, 'marketing', 'posts.json'), {platform: 'youtube', url, variant});
  if (posted.status !== 200) {
    console.error(`publish-youtube: uploaded but could not record it: ${posted.body.error}`);
    process.exit(1);
  }
  if (asJson) console.log(JSON.stringify({brand, url, id, privacy, variant}, null, 2));
  else console.log(`publish-youtube [${brand}]: uploaded ${url} as ${privacy} (recorded in out/${brand}/marketing/posts.json)`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(`publish-youtube: ${err.message}`);
    process.exit(1);
  });
}
