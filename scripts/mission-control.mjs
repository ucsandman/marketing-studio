// Mission Control — local click-to-approve run console for a marketing run.
// Replaces the one-shot static contact sheet: the operator watches the run
// manifest fill in live and approves / requests redos per asset from the browser.
//
//   node scripts/mission-control.mjs <brandId> [--port 4600]
//
// Zero npm deps (node:http/fs/path only). The manifest is written concurrently
// by the running /marketing skill process, so run.json is re-read on every
// request and all writes are atomic (temp file + rename). Read-modify-write on a
// POST re-reads the manifest at write time — never a stale in-memory copy.
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  statSync,
  createReadStream,
} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve, relative, isAbsolute, basename, extname} from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Import-safe (scripts/mission-control.test.mjs imports the pure functions
// below): only parse argv, bind the port, and start the server when executed
// directly — matching review-in-magnetic.mjs's / pull-magnetic-verdicts.mjs's
// isMain convention. Everything else in this file is a function declaration
// (hoisted, not executed at import time), so importing this module for its
// pure helpers never binds a port or touches argv.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// ---- args ------------------------------------------------------------------
let brand = null;
let port = 4600;
let snapshotOnly = false;
let brandOut, marketingDir, runPath, reviewPath, postsPath; // bound below once brand is known

if (isMain) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') port = parseInt(argv[++i], 10);
    else if (a.startsWith('--port=')) port = parseInt(a.split('=')[1], 10);
    else if (a === '--snapshot-approved') snapshotOnly = true;
    else if (!a.startsWith('-') && !brand) brand = a;
  }
  if (!brand) {
    console.error('usage: node scripts/mission-control.mjs <brandId> [--port 4600] [--snapshot-approved]');
    process.exit(1);
  }
  if (!Number.isFinite(port)) {
    console.error(`mission-control: invalid --port value`);
    process.exit(1);
  }

  brandOut = join(root, 'out', brand); // media root — nothing is served from outside this dir
  marketingDir = join(brandOut, 'marketing');
  runPath = join(marketingDir, 'run.json');
  reviewPath = join(marketingDir, 'review.json');
  postsPath = join(marketingDir, 'posts.json');
}

// ---- manifest i/o ----------------------------------------------------------
function readRun() {
  try {
    return JSON.parse(readFileSync(runPath, 'utf8'));
  } catch {
    return null;
  }
}

function atomicWrite(target, data) {
  const tmp = join(
    dirname(target),
    `.${basename(target)}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  writeFileSync(tmp, data);
  renameSync(tmp, target); // rename over target is atomic; a concurrent reader sees old-or-new, never partial
}

// ---- approved-set snapshot -------------------------------------------------
// Approving an asset copies its artifact into out/<brand>/approved/<YYYY-MM-DD>/.
// That directory is the calibration set judge-drift's --ref wants: pointed at it,
// drift becomes "distance from what a human approved" instead of "distance from
// the average of whatever is on disk". Nothing else in the run produces such a
// set, and asking an operator to curate one by hand is how calibration never
// happens.
//
// Dated because approval is a point in time: last quarter's approved look is not
// this quarter's, and a flat directory would blend the two into a centroid
// nobody ever approved. judge-drift skips out/<brand>/approved/ when it walks
// the set (SKIP_DIRS), so a snapshot never re-enters the population it calibrates.
//
// Returns the destination path, or null when there is nothing to copy — a
// missing artifact must not fail an approval the operator already made.
export function snapshotApproved(brandOutDir, rel, {now = new Date()} = {}) {
  if (!rel) return null;
  const src = resolve(brandOutDir, rel);
  const inside = relative(brandOutDir, src);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return null; // never copy in from outside the media root
  try {
    if (!statSync(src).isFile()) return null;
  } catch {
    return null; // not rendered yet
  }
  const destDir = join(brandOutDir, 'approved', now.toISOString().slice(0, 10));
  mkdirSync(destDir, {recursive: true});
  // Flattened, not basename: social/x/clip.mp4 and social/li/clip.mp4 both end
  // in clip.mp4, and a collision would quietly drop one approved asset from the
  // reference set — the exact silent-denominator failure judge-drift exists to
  // catch. The flattened name stays traceable back to the source path.
  const dest = join(destDir, inside.replaceAll('\\', '/').replaceAll('/', '-'));
  atomicWrite(dest, readFileSync(src)); // same temp-file + rename as every other write here
  return dest;
}

// ---- artifact resolution ---------------------------------------------------
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.json': 'application/json',
};

// The manifest stores artifact paths either bare (relative to out/<brand>/) or
// repo-root-relative (out/<brand>/foo.mp4). Normalise both to a path relative
// to the media root, so /media/<rel> resolves inside out/<brand>/.
function artifactRel(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let p = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  const prefix = `out/${brand}/`;
  if (p.startsWith(prefix)) p = p.slice(prefix.length);
  return p;
}

// Pick the single artifact to embed for a card. output may be a string or an
// object (og-assets ships {static, animatedLoop, ...}).
function primaryRaw(entry) {
  const o = entry.output ?? entry.artifact ?? entry.file ?? entry.path;
  if (!o) return null;
  if (typeof o === 'string') return o;
  if (typeof o === 'object') {
    const order = ['static', 'poster', 'image', 'png', 'animatedLoop', 'mp4', 'video', 'animatedGif', 'gif', 'readmeGif'];
    for (const k of order) if (typeof o[k] === 'string') return o[k];
    const first = Object.values(o).find((v) => typeof v === 'string');
    return first ?? null;
  }
  return null;
}

function mediaKind(rel) {
  const ext = extname(rel).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

// Resolve the on-disk artifact for an asset and, if it exists, attach a
// computed _artifact {url, kind, sizeBytes}. Returns the entry enriched (never
// mutates the manifest on disk).
function enrichAsset(entry, verdictsByAsset = {}) {
  const rel = artifactRel(primaryRaw(entry));
  let _artifact = null;
  if (rel) {
    const full = safeMediaPath(rel);
    if (full && existsSync(full)) {
      let size = null;
      try {
        const st = statSync(full);
        if (st.isFile()) size = st.size;
      } catch {
        size = null;
      }
      if (size != null) {
        const kind = mediaKind(rel);
        if (kind) _artifact = {url: '/media/' + rel.split('/').map(encodeURIComponent).join('/'), kind, sizeBytes: size};
      }
    }
  }
  return {...entry, _artifact, _stills: enrichStills(entry), _verdict: verdictsByAsset[entry.id] ?? null};
}

// ---- contact-sheet stills (scripts/contact-sheet.mjs) ----------------------
// Maps an asset's skill to the composition its contact sheet was generated
// for. Assets with no still-first comp (product-demo, audio-track) get none.
const SKILL_TO_COMP = {
  '/launch-video': 'LaunchVideo',
  '/social-clip': 'SocialClip',
  '/logo-reveal': 'LogoReveal',
  '/og-assets': 'AnimatedOG',
};
const STILLS_DIR_REL = 'marketing/stills'; // relative to brandOut, same media root as run.json

function mediaUrl(relToBrandOut) {
  return '/media/' + relToBrandOut.split('/').map(encodeURIComponent).join('/');
}

// Returns {sheetUrl, thumbs:[{label,url}]} when scripts/contact-sheet.mjs has
// produced a sheet for this asset's composition, else null. Never mutates the
// manifest on disk (same contract as enrichAsset).
function enrichStills(entry) {
  const comp = SKILL_TO_COMP[entry.skill];
  if (!comp) return null;
  const stillsDir = join(brandOut, STILLS_DIR_REL);
  if (!existsSync(join(stillsDir, `${comp}-sheet.html`))) return null;
  let thumbs = [];
  try {
    thumbs = readdirSync(stillsDir)
      .filter((f) => f.startsWith(`${comp}-`) && f.endsWith('.png'))
      .sort()
      .map((f) => ({
        label: f.slice(comp.length + 1, -'.png'.length),
        url: mediaUrl(`${STILLS_DIR_REL}/${f}`),
      }));
  } catch {
    thumbs = [];
  }
  return {sheetUrl: mediaUrl(`${STILLS_DIR_REL}/${comp}-sheet.html`), thumbs};
}

// ---- media path safety -----------------------------------------------------
// Returns an absolute path guaranteed to sit inside brandOut, or null if the
// request escapes the media root (.. traversal, absolute paths, other drives).
function safeMediaPath(relPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const full = resolve(brandOut, decoded);
  const rel = relative(brandOut, full);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return full;
}

function serveMedia(req, res, relPath) {
  const full = safeMediaPath(relPath);
  if (!full || !existsSync(full)) {
    res.writeHead(404, {'content-type': 'text/plain'});
    res.end('not found');
    return;
  }
  let st;
  try {
    st = statSync(full);
  } catch {
    res.writeHead(404, {'content-type': 'text/plain'});
    res.end('not found');
    return;
  }
  if (!st.isFile()) {
    res.writeHead(404, {'content-type': 'text/plain'});
    res.end('not found');
    return;
  }
  const type = CONTENT_TYPES[extname(full).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === '' ? null : parseInt(m[1], 10);
      let end = m[2] === '' ? null : parseInt(m[2], 10);
      if (start === null) {
        // suffix range: last N bytes
        start = Math.max(0, st.size - end);
        end = st.size - 1;
      } else if (end === null || end >= st.size) {
        end = st.size - 1;
      }
      if (start > end || start >= st.size) {
        res.writeHead(416, {'content-range': `bytes */${st.size}`});
        res.end();
        return;
      }
      res.writeHead(206, {
        'content-type': type,
        'content-range': `bytes ${start}-${end}/${st.size}`,
        'accept-ranges': 'bytes',
        'content-length': end - start + 1,
        'cache-control': 'no-store',
      });
      createReadStream(full, {start, end}).pipe(res);
      return;
    }
  }
  res.writeHead(200, {
    'content-type': type,
    'content-length': st.size,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  });
  createReadStream(full).pipe(res);
}

// ---- POST /asset/:id -------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > 1_000_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleAssetPost(req, res, id) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)) || '{}');
  } catch {
    res.writeHead(400, {'content-type': 'application/json'});
    res.end(JSON.stringify({error: 'invalid json body'}));
    return;
  }
  const action = payload.action;
  if (action !== 'approve' && action !== 'redo') {
    res.writeHead(400, {'content-type': 'application/json'});
    res.end(JSON.stringify({error: "action must be 'approve' or 'redo'"}));
    return;
  }

  // Re-read the manifest at write time — the skill process may have written it
  // since the page last loaded.
  const run = readRun();
  if (!run || !Array.isArray(run.assets)) {
    res.writeHead(404, {'content-type': 'application/json'});
    res.end(JSON.stringify({error: 'no run manifest'}));
    return;
  }
  const entry = run.assets.find((a) => a.id === id);
  if (!entry) {
    res.writeHead(404, {'content-type': 'application/json'});
    res.end(JSON.stringify({error: `no asset '${id}'`}));
    return;
  }

  if (action === 'approve') {
    entry.status = 'approved';
    if (typeof payload.variant === 'string' && payload.variant) entry.selectedVariant = payload.variant;
    delete entry.redoNote;
    // The click is the only moment the approval exists as an event; capture the
    // artifact now, while it is still the file the human looked at.
    try {
      snapshotApproved(brandOut, artifactRel(primaryRaw(entry)));
    } catch (err) {
      console.error(`mission-control: could not snapshot ${id} into approved/:`, err.message);
    }
  } else {
    const note = typeof payload.note === 'string' ? payload.note : '';
    // review.json is the correction log the skill polls. Re-read fresh so we
    // append to whatever is already there.
    let review = [];
    if (existsSync(reviewPath)) {
      try {
        const parsed = JSON.parse(readFileSync(reviewPath, 'utf8'));
        if (Array.isArray(parsed)) review = parsed;
      } catch {
        review = [];
      }
    }
    review.push({assetId: id, action: 'redo', note, at: new Date().toISOString()});
    atomicWrite(reviewPath, JSON.stringify(review, null, 2) + '\n');
    entry.status = 'planned';
    entry.redoNote = note;
    if (typeof payload.variant === 'string' && payload.variant) entry.selectedVariant = payload.variant;
  }

  atomicWrite(runPath, JSON.stringify(run, null, 2) + '\n');
  res.writeHead(200, {'content-type': 'application/json'});
  res.end(JSON.stringify({ok: true, id, status: entry.status}));
}

// ---- POST /posted ----------------------------------------------------------
// Records where a variant actually went live. posts.json is not a new format —
// it is the input scripts/fetch-results.mjs already reads (array of {platform,
// url, variant, metrics?}), so marking a post here closes the hook A/B loop
// without the operator hand-editing JSON next to a browser tab.
//
// One row per platform, last write wins: a corrected URL must REPLACE the typo,
// never sit beside it, because fetch-results counts rows and a duplicate would
// double that platform's weight in the variant stats. Other platforms' rows and
// any metrics already recorded for this one survive the overwrite.
//
// Pure and path-injected so the test drives the real write path against a temp
// dir rather than a mock.
export function applyPosted(path, payload, {now = new Date()} = {}) {
  const platform = typeof payload?.platform === 'string' ? payload.platform.trim() : '';
  if (!platform) return {status: 400, body: {error: 'platform is required'}};
  // A URL is the whole point of the row — fetch-results derives the post id from
  // it. Anything that is not a real http(s) link (a bare handle, "todo", a
  // file:// path) is rejected here rather than silently producing a row that
  // metric fetching can never resolve.
  let parsed = null;
  try {
    parsed = new URL(String(payload?.url ?? ''));
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return {status: 400, body: {error: 'url must be an http or https link'}};
  }

  const rows = readPosts(path);
  const row = {
    platform,
    url: String(payload.url),
    variant: typeof payload.variant === 'string' && payload.variant ? payload.variant : null,
    // build-postkit seeds every row with published:false; without this the spread
    // below kept that flag and fetch-results skipped the row as unpublished.
    published: true,
    postedAt: now.toISOString(),
  };
  const i = rows.findIndex((r) => r && r.platform === platform);
  if (i >= 0) rows[i] = {...rows[i], ...row}; // spread keeps metrics already recorded for this platform
  else rows.push(row);

  mkdirSync(dirname(path), {recursive: true});
  atomicWrite(path, JSON.stringify(rows, null, 2) + '\n');
  return {status: 200, body: {ok: true, platform, posted: rows.length}};
}

// Absent, unreadable, or {posts: [...]} — all three become a plain array. An
// unreadable file starts a fresh log rather than throwing: the operator is
// mid-launch and the alternative is losing the URL they just pasted.
function readPosts(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const rows = Array.isArray(parsed) ? parsed : parsed?.posts;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function handlePostedPost(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)) || '{}');
  } catch {
    res.writeHead(400, {'content-type': 'application/json'});
    res.end(JSON.stringify({error: 'invalid json body'}));
    return;
  }
  const {status, body} = applyPosted(postsPath, payload);
  res.writeHead(status, {'content-type': 'application/json'});
  res.end(JSON.stringify(body));
}

// ---- POST /review-in-magnetic, POST /pull-verdicts -------------------------
// Both spawn a CLI driver (Tasks 5/6) as a CHILD process rather than
// importing it in-process: each driver's own main() calls process.exit() on
// failure, which would kill this long-running server if imported directly.
// execFileSync isolates that in a child process and hands back its
// stdout/stderr verbatim, so the operator sees the sidecar's exact hint (e.g.
// "enable Agent Access in the sidebar") inline instead of a generic 500.
//
// timeoutMs is a hard ceiling: execFileSync BLOCKS this server's event loop
// (/state polling, media serving, approve/redo all wait), so a hung child —
// e.g. a stale discovery file pointing at a port something unresponsive
// holds — must be killed rather than wedging the console forever. The
// sidecar client's own 30s fetch timeout (scripts/lib/magnetic-sidecar.mjs)
// normally fires first; this is the backstop. Injectable so tests use a
// small timeout, not 60s.
export function runCliScript(scriptPath, args, {timeoutMs = 60_000} = {}) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      killSignal: 'SIGTERM',
    });
    return {ok: true, stdout};
  } catch (err) {
    // Timed out: execFileSync killed the child (err.code ETIMEDOUT and/or
    // err.signal = killSignal, platform-dependent). Say so explicitly — the
    // child's stderr is empty or truncated here, not the real story.
    if (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') {
      return {ok: false, error: `review CLI timed out after ${Math.round(timeoutMs / 1000)}s — is Magnetic responding?`};
    }
    // execFileSync populates err.stdout/err.stderr as strings when encoding
    // is set. The driver's own main().catch prints err.message to stderr and
    // exits 1 — that text is exactly what must reach the operator's eyes.
    const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : '';
    return {ok: false, error: stderr || err.message || String(err)};
  }
}

function handleReviewInMagnetic(res) {
  const result = runCliScript(join(root, 'scripts', 'review-in-magnetic.mjs'), [brand]);
  res.writeHead(result.ok ? 200 : 502, {'content-type': 'application/json'});
  res.end(JSON.stringify(result));
}

function handlePullVerdicts(res) {
  const result = runCliScript(join(root, 'scripts', 'pull-magnetic-verdicts.mjs'), [brand]);
  res.writeHead(result.ok ? 200 : 502, {'content-type': 'application/json'});
  res.end(JSON.stringify(result));
}

// The one platform with an open posting API. The publisher itself writes the
// posts.json row, so a refresh shows the post as recorded. Video processing on
// Bluesky's side takes tens of seconds; 4 minutes is the ceiling before the
// server declares it hung.
// ponytail: blocks the event loop like the other two run-level actions; move to
// execFile + a job id if a second long-running publisher lands.
function handlePublishBluesky(res) {
  const result = runCliScript(join(root, 'scripts', 'publish-bluesky.mjs'), [brand], {timeoutMs: 240_000});
  res.writeHead(result.ok ? 200 : 502, {'content-type': 'application/json'});
  res.end(JSON.stringify(result));
}

// ---- read-only advisories (judges / results / staleness) --------------------
// All three are computed from files other tools write; Mission Control never
// mutates them. They ride on /state so the operator approves with the machine
// verdicts, engagement numbers, and footage freshness in view.

// The gates a complete run puts the set through (CLAUDE.md). Six write a JSON
// report next to run.json; check-budgets is exit-code only and writes none, so
// it can never produce a row from disk.
//
// Listing all seven, rather than only the files that happen to exist, is the
// whole point: a judge that NEVER RAN is invisible in a directory listing, and
// an advisory bar showing four green chips looks identical whether the other
// three passed, were skipped, or crashed. The denominator has to be declared to
// be missed (agnostic-rules L2 — a verdict carries the volume it processed).
export const EXPECTED_JUDGES = [
  {judge: 'av-sync', file: 'judge-av-sync.json'},
  {judge: 'demo-pacing', file: 'judge-demo-pacing.json'},
  {judge: 'palette', file: 'judge-palette.json'},
  {judge: 'motion', file: 'judge-motion.json'},
  {judge: 'audio', file: 'judge-audio.json'},
  {judge: 'drift', file: 'judge-drift.json'},
  {judge: 'check-budgets', file: null}, // exit code only, writes no report
];

// Every judge already records how much it looked at, in its own report: drift in
// input.scored, motion in input.sourceFiles, av-sync / audio / demo-pacing in
// summary. Read those back instead of dropping the fields — a PASS over 0 assets
// and a PASS over 40 render the same chip otherwise.
const VOLUME_KEYS = ['scored', 'sourceFiles', 'frames', 'voLines', 'linesInManifest', 'activityEvents'];
function judgeVolume(r) {
  for (const src of [r.input, r.summary]) {
    if (!src || typeof src !== 'object') continue;
    for (const k of VOLUME_KEYS) {
      const v = src[k];
      const n = typeof v === 'number' ? v : Array.isArray(v) ? v.length : null;
      if (n === null) continue;
      return `${n} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`;
    }
  }
  return null;
}

// Quality-judge verdict summaries from out/<brand>/marketing/judge-*.json, one
// row per EXPECTED_JUDGES entry plus any judge report on disk the list does not
// name yet (a new judge must not vanish just because nobody updated this file).
export function readJudges(dir = marketingDir) {
  let onDisk = [];
  try {
    onDisk = readdirSync(dir).filter((f) => /^judge-.+\.json$/.test(f));
  } catch {
    onDisk = [];
  }
  const named = new Set(EXPECTED_JUDGES.map((e) => e.file));
  const rows = [
    ...EXPECTED_JUDGES,
    ...onDisk.filter((f) => !named.has(f)).map((f) => ({judge: f.replace(/^judge-|\.json$/g, ''), file: f})),
  ];

  const blank = {ran: false, warns: 0, fails: 0, generatedAt: null, volume: null, messages: []};
  return rows.map(({judge, file}) => {
    if (!file) return {...blank, judge, verdict: 'NOT REPORTED', volume: 'exit code only, writes no report'};
    if (!onDisk.includes(file)) return {...blank, judge, verdict: 'NEVER RAN'};
    try {
      const r = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const findings = Array.isArray(r.findings) ? r.findings : [];
      return {
        judge: r.judge ?? judge,
        verdict: r.verdict ?? 'UNKNOWN',
        ran: true,
        warns: findings.filter((x) => x.level === 'WARN').length,
        fails: findings.filter((x) => x.level === 'FAIL' || x.level === 'ERROR').length,
        generatedAt: r.generatedAt ?? null,
        volume: judgeVolume(r),
        messages: findings.slice(0, 6).map((x) => `[${x.level}] ${x.message ?? x.check ?? ''}`),
      };
    } catch {
      return {...blank, judge, verdict: 'UNREADABLE', ran: true};
    }
  });
}

// Engagement results (scripts/fetch-results.mjs) aggregated per variant id so
// the variant radio can show what each hook actually did.
function readResults() {
  const p = join(marketingDir, 'results.json');
  if (!existsSync(p)) return null;
  try {
    const r = JSON.parse(readFileSync(p, 'utf8'));
    const posts = Array.isArray(r.posts) ? r.posts : [];
    const variantStats = {};
    for (const post of posts) {
      if (!post.variant || !post.metrics) continue;
      const v = (variantStats[post.variant] ??= {likes: 0, reposts: 0, replies: 0, impressions: 0, posts: 0});
      v.likes += post.metrics.likes ?? 0;
      v.reposts += post.metrics.reposts ?? 0;
      v.replies += post.metrics.replies ?? 0;
      v.impressions += post.metrics.impressions ?? 0;
      v.posts += 1;
    }
    return {fetchedAt: r.fetchedAt ?? null, postCount: posts.length, variantStats};
  } catch {
    return null;
  }
}

// Footage staleness: cache.json entries that recorded {productRepo, productHead}
// meta are compared against the product repo's CURRENT git state. Memoized for
// 30s — /state polls every 2s and git subprocesses are not free.
let stalenessMemo = {at: 0, value: []};
function readStaleness() {
  if (Date.now() - stalenessMemo.at < 30_000) return stalenessMemo.value;
  const value = [];
  try {
    const store = JSON.parse(readFileSync(join(marketingDir, 'cache.json'), 'utf8'));
    for (const [stage, entry] of Object.entries(store)) {
      const meta = entry?.meta;
      if (!meta?.productRepo || !meta?.productHead) continue;
      try {
        const opts = {cwd: meta.productRepo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']};
        const behind = parseInt(
          execFileSync('git', ['rev-list', '--count', `${meta.productHead}..HEAD`], opts).trim(),
          10,
        );
        const dirty = execFileSync('git', ['status', '--porcelain'], opts).trim().length > 0;
        if (behind > 0 || dirty) {
          value.push({stage, productRepo: meta.productRepo, commitsBehind: behind, dirty, storedAt: entry.storedAt ?? null});
        }
      } catch {
        value.push({stage, productRepo: meta.productRepo, commitsBehind: null, dirty: null, storedAt: entry.storedAt ?? null});
      }
    }
  } catch {
    // no cache.json — nothing to report
  }
  stalenessMemo = {at: Date.now(), value};
  return value;
}

// ---- magnetic review verdicts (pull-magnetic-verdicts.mjs writes review.json) ----
// review.json is APPEND-ONLY (mission-control's own log semantics, shared
// with the verdict puller): the same assetId can appear more than once — a
// redo note today, a Magnetic approve/reject verdict tomorrow. Displaying it
// means reading the LATEST entry per assetId, never counting entries or
// trusting anything but "last write wins" in append order.
export function latestVerdictsByAsset(review) {
  const byAsset = {};
  for (const entry of Array.isArray(review) ? review : []) {
    if (entry && typeof entry.assetId === 'string') byAsset[entry.assetId] = entry;
  }
  return byAsset;
}

function readReview() {
  if (!existsSync(reviewPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(reviewPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---- state -----------------------------------------------------------------
// Serves the run manifest, each asset enriched with a computed _artifact
// (url/kind/sizeBytes) resolved against the disk at read time. The file is
// never mutated; _artifact just spares the client from having to stat.
function serveState(res) {
  const run = readRun();
  if (!run) {
    res.writeHead(404, {'content-type': 'application/json'});
    res.end(JSON.stringify({error: 'no run found'}));
    return;
  }
  const verdictsByAsset = latestVerdictsByAsset(readReview());
  const enriched = {
    ...run,
    assets: Array.isArray(run.assets) ? run.assets.map((a) => enrichAsset(a, verdictsByAsset)) : [],
    _judges: readJudges(),
    _results: readResults(),
    _posted: readPosts(postsPath),
    _staleness: readStaleness(),
  };
  res.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'});
  res.end(JSON.stringify(enriched));
}

// ---- pages -----------------------------------------------------------------
function noRunPage() {
  return `<!doctype html><meta charset="utf-8"><title>Mission Control — no run</title>
<style>${PAGE_CSS}</style>
<div class="empty">
  <h1>No run found</h1>
  <p>Expected a manifest at:</p>
  <code>out/${escapeHtml(brand)}/marketing/run.json</code>
  <p class="dim">Start a <b>/marketing</b> run for <b>${escapeHtml(brand)}</b>, then reload. This page re-checks every 3s.</p>
</div>
<script>setInterval(function(){fetch('/state').then(function(r){if(r.ok)location.reload();}).catch(function(){});},3000);</script>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

const PAGE_CSS = `
:root{color-scheme:dark;}
*{box-sizing:border-box;}
body{margin:0;background:#0d0f12;color:#e6e8eb;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;}
header{position:sticky;top:0;z-index:10;background:#14171b;border-bottom:1px solid #262b31;padding:14px 22px;display:flex;flex-wrap:wrap;align-items:baseline;gap:16px;}
header h1{margin:0;font-size:17px;font-weight:650;letter-spacing:.3px;}
header .brand{color:#7fb2ff;}
header .started{color:#8a929b;font-size:13px;}
.counts{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap;}
.count{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-variant-numeric:tabular-nums;padding:3px 10px;border-radius:999px;border:1px solid #2b3138;background:#181c21;}
.count b{font-size:13px;}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;}
.advisories{padding:10px 22px;background:#101317;border-bottom:1px solid #21262c;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;font-size:12px;}
.advisories:empty{display:none;}
.mcbar{padding:10px 22px;background:#101317;border-bottom:1px solid #21262c;display:flex;flex-wrap:wrap;align-items:center;gap:10px;}
.mcbar .btn{padding:7px 14px;flex:none;}
.mcstatus{font-size:12px;color:#8ce6a5;}
.mcerror{margin:0;padding:10px 22px;background:#2a1414;border-bottom:1px solid #5a2323;color:#ff8a8a;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;white-space:pre-wrap;word-break:break-word;}
.mcerror[hidden]{display:none;}
.judge{position:relative;}
.judge summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-variant-numeric:tabular-nums;padding:3px 10px;border-radius:999px;border:1px solid #2b3138;background:#181c21;}
.judge summary::-webkit-details-marker{display:none;}
.judge .verdict{font-weight:700;letter-spacing:.4px;}
.judge .v-pass{color:#8ce6a5;}
.judge .v-warn{color:#e6b45a;}
.judge .v-fail{color:#ff8a8a;}
.judge .v-missing{color:#8a929b;font-weight:600;letter-spacing:.3px;}
.judge summary.missing{border-style:dashed;color:#8a929b;}
.jvol,.jage{color:#6b7480;font-size:11px;font-variant-numeric:tabular-nums;}
.jage.age-stale{color:#e6b45a;}
.judge .findings{position:absolute;z-index:20;top:calc(100% + 6px);left:0;min-width:320px;max-width:520px;background:#181c21;border:1px solid #2b3138;border-radius:10px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.5);}
.judge .findings li{margin:4px 0 4px 16px;color:#c9d1d9;}
.stale{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;border:1px solid #6b4f1f;background:#332612;color:#e6b45a;}
.results-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;border:1px solid #284876;background:#13233d;color:#7fb2ff;font-variant-numeric:tabular-nums;}
.vstats{color:#8a929b;font-size:11px;font-variant-numeric:tabular-nums;margin-left:4px;}
.wrap{padding:22px;display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px;max-width:1500px;margin:0 auto;}
.card{background:#14171b;border:1px solid #262b31;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;}
.card-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #21262c;}
.card-head h2{margin:0;font-size:14px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.card-head .skill{color:#6b7480;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
.chip{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:3px 9px;border-radius:6px;border:1px solid;}
.chip-planned{color:#c9d1d9;background:#20262d;border-color:#39424c;}
.chip-rendered{color:#7fb2ff;background:#13233d;border-color:#284876;}
.chip-approved{color:#8ce6a5;background:#123023;border-color:#256b45;}
.chip-delivered{color:#d7b2ff;background:#241a3a;border-color:#4a3a75;}
.chip-unknown{color:#e6b45a;background:#332612;border-color:#6b4f1f;}
.dot-planned{background:#8a929b;}.dot-rendered{background:#7fb2ff;}.dot-approved{background:#8ce6a5;}.dot-delivered{background:#d7b2ff;}
.media{background:#0a0c0e;display:flex;align-items:center;justify-content:center;min-height:150px;border-bottom:1px solid #21262c;}
.media video,.media img{max-width:100%;max-height:320px;display:block;}
.media .placeholder{color:#5a636d;font-size:13px;padding:38px 12px;text-align:center;}
.meta{padding:9px 14px;font-size:12px;color:#8a929b;font-variant-numeric:tabular-nums;display:flex;gap:14px;flex-wrap:wrap;border-bottom:1px solid #21262c;}
.redonote{padding:9px 14px;font-size:12px;color:#e6b45a;background:#1c1509;border-bottom:1px solid #21262c;}
.verdict-badge{padding:9px 14px;font-size:12px;border-bottom:1px solid #21262c;}
.verdict-badge.v-approved{color:#8ce6a5;background:#0f2318;}
.verdict-badge.v-rejected{color:#ff8a8a;background:#2a1414;}
.verdict-badge.v-unreviewed{color:#8a929b;background:#15181c;}
.variants{padding:10px 14px;border-bottom:1px solid #21262c;}
.variants .vtitle{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#8a929b;margin-bottom:6px;}
.variants label{display:flex;align-items:center;gap:7px;font-size:13px;padding:3px 0;cursor:pointer;}
.stills{padding:10px 14px;border-bottom:1px solid #21262c;}
.stills-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}
.stills-head .vtitle{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#8a929b;}
.sheet-link{font-size:11px;color:#7fb2ff;text-decoration:none;}
.sheet-link:hover{text-decoration:underline;}
.stills-strip{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;}
.still-thumb{flex:0 0 auto;display:block;border-radius:6px;overflow:hidden;border:1px solid #262b31;line-height:0;}
.still-thumb img{display:block;height:44px;width:auto;}
.controls{padding:12px 14px;display:flex;flex-direction:column;gap:10px;margin-top:auto;}
.controls .row{display:flex;gap:9px;}
.btn{font:inherit;font-size:13px;font-weight:600;border-radius:8px;border:1px solid;padding:8px 14px;cursor:pointer;transition:filter .12s;}
.btn:hover{filter:brightness(1.15);}
.btn:active{filter:brightness(.9);}
.btn.approve{background:#1c8a4c;border-color:#25a35b;color:#fff;flex:1;}
.btn.redo{background:#2a2f36;border-color:#3a424c;color:#e6e8eb;}
.btn.posted{background:#1b2b46;border-color:#284876;color:#cfe0ff;}
textarea{width:100%;background:#0d0f12;color:#e6e8eb;border:1px solid #2b3138;border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;resize:vertical;min-height:48px;}
textarea::placeholder{color:#5a636d;}
.empty{max-width:520px;margin:12vh auto;text-align:center;padding:0 20px;}
.empty h1{font-size:22px;margin-bottom:12px;}
.empty code{display:inline-block;background:#14171b;border:1px solid #262b31;border-radius:8px;padding:8px 12px;font-family:ui-monospace,Consolas,monospace;color:#7fb2ff;margin:8px 0;}
.empty .dim{color:#8a929b;font-size:13px;}
`;

function consolePage() {
  return `<!doctype html><meta charset="utf-8"><title>Mission Control — ${escapeHtml(brand)}</title>
<style>${PAGE_CSS}</style>
<header>
  <h1>Mission Control · <span class="brand" id="hBrand"></span></h1>
  <span class="started" id="hStarted"></span>
  <div class="counts" id="hCounts"></div>
</header>
<div class="advisories" id="advisories"></div>
<div class="mcbar">
  <button class="btn approve" id="btnReviewMagnetic">Review in Magnetic</button>
  <button class="btn posted" id="btnPublishBluesky">Publish to Bluesky</button>
  <button class="btn redo" id="btnPullVerdicts">Pull verdicts</button>
  <span class="mcstatus" id="mcStatus"></span>
</div>
<pre class="mcerror" id="mcError" hidden></pre>
<main class="wrap" id="cards"></main>
<script>
const STATUSES = ['planned','rendered','approved','delivered'];
const cardsEl = document.getElementById('cards');
const lastRender = {}; // assetId -> serialized entry, so we only rebuild changed cards

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtSize(b){if(b==null)return null;if(b<1024)return b+' B';if(b<1048576)return (b/1024).toFixed(0)+' KB';return (b/1048576).toFixed(1)+' MB';}
function ageMs(iso){const t=Date.parse(iso);return isFinite(t)?Date.now()-t:0;}
function fmtAge(iso){
  const ms=ageMs(iso);
  if(ms<3600000)return Math.max(0,Math.round(ms/60000))+'m ago';
  if(ms<172800000)return Math.round(ms/3600000)+'h ago';
  return Math.round(ms/86400000)+'d ago';
}
function fmtDur(e){
  let ms=null;
  if(typeof e.durationMs==='number')ms=e.durationMs;
  else if(typeof e.durationSec==='number')ms=e.durationSec*1000;
  else if(typeof e.duration==='number')ms=e.duration*1000;
  if(ms==null)return null;
  const s=ms/1000;
  if(s<60)return s.toFixed(s<10?1:0)+'s';
  const m=Math.floor(s/60);return m+':'+String(Math.round(s-m*60)).padStart(2,'0');
}
function variantLabel(v,i){
  if(typeof v==='string')return v;
  if(v&&typeof v==='object')return v.label||v.id||v.name||('variant '+(i+1));
  return 'variant '+(i+1);
}
function variantValue(v,i){
  if(typeof v==='string')return v;
  if(v&&typeof v==='object')return v.id||v.label||v.name||String(i);
  return String(i);
}
function stillsHtml(e){
  const st=e._stills;
  if(!st||!st.thumbs.length)return'';
  const thumbs=st.thumbs.map(t=>'<a class="still-thumb" href="'+esc(t.url)+'" target="_blank" title="'+esc(t.label)+'"><img loading="lazy" src="'+esc(t.url)+'" alt="'+esc(t.label)+'"></a>').join('');
  return '<div class="stills"><div class="stills-head"><span class="vtitle">Stills</span><a class="sheet-link" href="'+esc(st.sheetUrl)+'" target="_blank">contact sheet &#8599;</a></div><div class="stills-strip">'+thumbs+'</div></div>';
}
// Latest-per-assetId verdict from review.json (pull-magnetic-verdicts.mjs or
// mission-control's own redo writer). action carries approved/rejected/
// unreviewed/redo — anything other than approved/rejected renders neutral.
function verdictHtml(e){
  const v=e._verdict;
  if(!v)return'';
  const action=v.action||'unreviewed';
  const cls=action==='approved'?'v-approved':action==='rejected'?'v-rejected':'v-unreviewed';
  return '<div class="verdict-badge '+cls+'">magnetic: '+esc(action)+(v.note?' — '+esc(v.note):'')+'</div>';
}

function cardHtml(e){
  const status=STATUSES.indexOf(e.status)>=0?e.status:'unknown';
  let media='<div class="placeholder">no artifact yet</div>';
  if(e._artifact){
    if(e._artifact.kind==='video')media='<video controls preload="metadata" src="'+esc(e._artifact.url)+'"></video>';
    else media='<img loading="lazy" src="'+esc(e._artifact.url)+'" alt="'+esc(e.id)+'">';
  }
  const size=e._artifact?fmtSize(e._artifact.sizeBytes):null;
  const dur=fmtDur(e);
  const metaBits=[];
  if(size)metaBits.push('<span>'+esc(size)+'</span>');
  if(dur)metaBits.push('<span>'+esc(dur)+'</span>');
  if(e.platform)metaBits.push('<span>'+esc(e.platform)+'</span>');
  const meta=metaBits.length?'<div class="meta">'+metaBits.join('')+'</div>':'';
  const redo=e.redoNote?'<div class="redonote">redo: '+esc(e.redoNote)+'</div>':'';
  let variants='';
  if(Array.isArray(e.variants)&&e.variants.length){
    const opts=e.variants.map((v,i)=>{
      const val=variantValue(v,i);const checked=e.selectedVariant===val?' checked':'';
      const st=lastResults&&lastResults.variantStats&&lastResults.variantStats[val];
      const stats=st?'<span class="vstats">'+st.likes+' likes · '+st.reposts+' reposts · '+st.replies+' replies'+(st.impressions?' · '+st.impressions+' impr':'')+'</span>':'';
      return '<label><input type="radio" name="var-'+esc(e.id)+'" value="'+esc(val)+'"'+checked+'>'+esc(variantLabel(v,i))+stats+'</label>';
    }).join('');
    variants='<div class="variants"><div class="vtitle">Variant</div>'+opts+'</div>';
  }
  return '<div class="card-head">'
      +'<span class="chip chip-'+status+'">'+esc(e.status||'—')+'</span>'
      +'<h2>'+esc(e.id)+'</h2>'
      +(e.skill?'<span class="skill">'+esc(e.skill)+'</span>':'')
    +'</div>'
    +'<div class="media">'+media+'</div>'
    +meta+redo+verdictHtml(e)+stillsHtml(e)+variants
    +'<div class="controls">'
      +'<div class="row"><button class="btn approve" data-act="approve">Approve</button>'
        +'<button class="btn posted" data-act="posted">Mark posted</button></div>'
      +'<textarea placeholder="Redo note: what should change"></textarea>'
      +'<div class="row"><button class="btn redo" data-act="redo">Request redo</button></div>'
    +'</div>';
}

function selectedVariant(cardEl){
  const r=cardEl.querySelector('input[type=radio]:checked');
  return r?r.value:undefined;
}

async function act(id,action,cardEl){
  const note=action==='redo'?(cardEl.querySelector('textarea')?.value||''):undefined;
  const body={action};
  if(note!==undefined)body.note=note;
  const variant=selectedVariant(cardEl);
  if(variant!==undefined)body.variant=variant;
  const btns=cardEl.querySelectorAll('button');btns.forEach(b=>b.disabled=true);
  try{
    const r=await fetch('/asset/'+encodeURIComponent(id),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    if(!r.ok){const t=await r.text();alert('Action failed: '+t);}
  }catch(err){alert('Action failed: '+err.message);}
  finally{btns.forEach(b=>b.disabled=false);}
  refresh(); // pull fresh state immediately
}

// Records the live URL for the variant this card is showing, so the operator
// never leaves the console to hand-edit posts.json. window.prompt is the whole
// UI on purpose: pasting one URL does not need a form.
async function markPosted(id,cardEl){
  const platform=cardEl.dataset.platform||id;
  const url=window.prompt('Live post URL for '+platform,'https://');
  if(!url)return;
  const body={platform:platform,url:url};
  const variant=selectedVariant(cardEl);
  if(variant!==undefined)body.variant=variant;
  const btns=cardEl.querySelectorAll('button');btns.forEach(b=>b.disabled=true);
  try{
    const r=await fetch('/posted',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)alert('Mark posted failed: '+(j.error||('HTTP '+r.status)));
  }catch(err){alert('Mark posted failed: '+err.message);}
  finally{btns.forEach(b=>b.disabled=false);}
  refresh();
}

cardsEl.addEventListener('click',ev=>{
  const btn=ev.target.closest('button[data-act]');if(!btn)return;
  const card=btn.closest('.card');if(!card)return;
  if(btn.dataset.act==='posted'){markPosted(card.dataset.id,card);return;}
  act(card.dataset.id,btn.dataset.act,card);
});

// ---- run-level actions: Review in Magnetic / Pull verdicts ----------------
const btnReviewMagnetic=document.getElementById('btnReviewMagnetic');
const btnPullVerdicts=document.getElementById('btnPullVerdicts');
const mcStatusEl=document.getElementById('mcStatus');
const mcErrorEl=document.getElementById('mcError');

function showMcError(text){mcErrorEl.textContent=text;mcErrorEl.hidden=false;}
function clearMcError(){mcErrorEl.hidden=true;mcErrorEl.textContent='';}

async function runMcAction(path,btn,otherBtn,successText){
  clearMcError();
  mcStatusEl.textContent='';
  btn.disabled=true;otherBtn.disabled=true;
  try{
    const r=await fetch(path,{method:'POST'});
    const body=await r.json().catch(()=>({}));
    if(!r.ok||body.ok===false){showMcError(body.error||('request failed: HTTP '+r.status));return;}
    mcStatusEl.textContent=successText;
    refresh();
  }catch(err){showMcError(err.message);}
  finally{btn.disabled=false;otherBtn.disabled=false;}
}

btnReviewMagnetic.addEventListener('click',()=>runMcAction('/review-in-magnetic',btnReviewMagnetic,btnPullVerdicts,'Proposal sent to Magnetic.'));
btnPullVerdicts.addEventListener('click',()=>runMcAction('/pull-verdicts',btnPullVerdicts,btnReviewMagnetic,'Verdicts pulled.'));
const btnPublishBluesky=document.getElementById('btnPublishBluesky');
btnPublishBluesky.addEventListener('click',()=>{
  if(!window.confirm('Publish the Bluesky postkit now? This posts publicly.'))return;
  runMcAction('/publish-bluesky',btnPublishBluesky,btnPullVerdicts,'Posted to Bluesky (see the bluesky row below).');
});

function renderHeader(run){
  document.getElementById('hBrand').textContent=run.brand||run.brandId||'';
  const started=run.startedAt||run.started||'';
  document.getElementById('hStarted').textContent=started?('started '+started):'';
  const counts={planned:0,rendered:0,approved:0,delivered:0};
  (run.assets||[]).forEach(a=>{if(counts[a.status]!=null)counts[a.status]++;});
  document.getElementById('hCounts').innerHTML=STATUSES.map(s=>
    '<span class="count"><span class="dot dot-'+s+'"></span>'+s+' <b>'+counts[s]+'</b></span>'
  ).join('');
}

let lastAdvisories='';
function renderAdvisories(run){
  const bits=[];
  (run._judges||[]).forEach(j=>{
    const cls=!j.ran?'v-missing':j.verdict==='PASS'?(j.warns?'v-warn':'v-pass'):'v-fail';
    const label=!j.ran?j.verdict:j.verdict+(j.fails?' ('+j.fails+')':j.warns?' ('+j.warns+' warn)':'');
    // Volume and age travel with the verdict: PASS over 0 files and PASS over
    // 40 must not render the same chip, and a July report sitting beside an
    // August one has to READ stale rather than green.
    const vol=j.volume?' <span class="jvol">'+esc(j.volume)+'</span>':'';
    const age=j.generatedAt?' <span class="jage'+(ageMs(j.generatedAt)>=864e5?' age-stale':'')+'">'+esc(fmtAge(j.generatedAt))+'</span>':'';
    const list=j.messages&&j.messages.length
      ?'<div class="findings"><ul>'+j.messages.map(m=>'<li>'+esc(m)+'</li>').join('')+'</ul></div>'
      :'';
    bits.push('<details class="judge"><summary'+(j.ran?'':' class="missing"')+'>judge:'+esc(j.judge)+' <span class="verdict '+cls+'">'+esc(label)+'</span>'+vol+age+'</summary>'+list+'</details>');
  });
  (run._staleness||[]).forEach(s=>{
    const what=s.commitsBehind==null
      ?'product repo unreachable ('+esc(s.productRepo)+')'
      :esc(s.stage)+' footage: '+(s.commitsBehind?s.commitsBehind+' commit(s) behind':'')+(s.commitsBehind&&s.dirty?', ':'')+(s.dirty?'dirty tree':'');
    bits.push('<span class="stale">&#9888; '+what+'</span>');
  });
  // Engagement chip, inverted: the interesting state is posts that went live and
  // were never measured. Hiding the chip when results.json is absent made the
  // un-fetched case look exactly like the nothing-posted case, which is how a
  // launch's numbers go uncollected for a week without anyone noticing.
  if(run._results&&run._results.postCount){
    bits.push('<span class="results-chip">results: '+run._results.postCount+' post(s), fetched '+esc((run._results.fetchedAt||'').slice(0,16).replace('T',' '))+'</span>');
  }else if((run._posted||[]).length){
    bits.push('<span class="results-chip">engagement: never fetched ('+run._posted.length+' posted)</span>');
  }
  const html=bits.join('');
  if(html!==lastAdvisories){lastAdvisories=html;document.getElementById('advisories').innerHTML=html;}
}

let lastResults=null;
function render(run){
  renderHeader(run);
  // results feed variant stat lines inside cards: when they change, force
  // affected cards to re-render by clearing their lastRender entries.
  const resKey=JSON.stringify(run._results||null);
  if(JSON.stringify(lastResults||null)!==resKey){lastResults=run._results||null;Object.keys(lastRender).forEach(k=>delete lastRender[k]);}
  renderAdvisories(run);
  const assets=run.assets||[];
  const seen=new Set();
  assets.forEach(e=>{
    seen.add(e.id);
    const key=JSON.stringify(e);
    if(lastRender[e.id]===key)return; // entry unchanged — leave DOM (and any playing video) alone
    lastRender[e.id]=key;
    let card=cardsEl.querySelector('.card[data-id="'+CSS.escape(e.id)+'"]');
    if(!card){card=document.createElement('div');card.className='card';card.dataset.id=e.id;cardsEl.appendChild(card);}
    card.dataset.platform=e.platform||e.id;
    card.innerHTML=cardHtml(e);
  });
  // drop cards for assets no longer in the manifest
  Array.from(cardsEl.children).forEach(c=>{if(!seen.has(c.dataset.id)){delete lastRender[c.dataset.id];c.remove();}});
}

async function refresh(){
  try{
    const r=await fetch('/state',{cache:'no-store'});
    if(r.status===404){location.reload();return;} // run.json vanished — show the no-run page
    if(!r.ok)return;
    render(await r.json());
  }catch(err){/* transient — try again next tick */}
}

refresh();
setInterval(refresh,2000);
</script>`;
}

// ---- server ----------------------------------------------------------------
// Only bound when run directly (see the isMain guard at the top of the
// file) — importing this module for its pure helpers must never open a port.
if (isMain) {
  // Full-auto runs never click Approve — the main-loop judge writes run.json
  // directly (skills/marketing/SKILL.md Phase 4), which would leave
  // out/<brand>/approved/ empty and judge-drift with nothing to calibrate
  // against. This flag replays the SAME snapshot copy over every asset the
  // manifest already marks approved, so both approval paths produce one
  // identical reference set instead of two half-truths.
  if (snapshotOnly) {
    const run = readRun();
    const approved = (run?.assets ?? []).filter((a) => a.status === 'approved');
    let copied = 0;
    for (const entry of approved) {
      if (snapshotApproved(brandOut, artifactRel(primaryRaw(entry)))) copied++;
    }
    const day = new Date().toISOString().slice(0, 10);
    console.log(
      `mission-control: snapshotted ${copied} of ${approved.length} approved asset(s) -> out/${brand}/approved/${day}/`,
    );
    process.exit(0);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    if (req.method === 'POST' && path.startsWith('/asset/')) {
      const id = decodeURIComponent(path.slice('/asset/'.length));
      handleAssetPost(req, res, id).catch((err) => {
        console.error('mission-control: POST error', err);
        if (!res.headersSent) {
          res.writeHead(500, {'content-type': 'application/json'});
          res.end(JSON.stringify({error: 'internal error'}));
        }
      });
      return;
    }

    if (req.method === 'POST' && path === '/posted') {
      handlePostedPost(req, res).catch((err) => {
        console.error('mission-control: POST /posted error', err);
        if (!res.headersSent) {
          res.writeHead(500, {'content-type': 'application/json'});
          res.end(JSON.stringify({error: 'internal error'}));
        }
      });
      return;
    }

    if (req.method === 'POST' && path === '/review-in-magnetic') {
      handleReviewInMagnetic(res);
      return;
    }

    if (req.method === 'POST' && path === '/pull-verdicts') {
      handlePullVerdicts(res);
      return;
    }

    if (req.method === 'POST' && path === '/publish-bluesky') {
      handlePublishBluesky(res);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, {'content-type': 'text/plain'});
      res.end('method not allowed');
      return;
    }

    if (path === '/state') {
      serveState(res);
      return;
    }

    if (path.startsWith('/media/')) {
      serveMedia(req, res, path.slice('/media/'.length));
      return;
    }

    if (path === '/' || path === '/index.html') {
      const run = readRun();
      if (!run) {
        console.error(`mission-control: no run manifest at ${runPath}`);
        res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
        res.end(noRunPage());
        return;
      }
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
      res.end(consolePage());
      return;
    }

    res.writeHead(404, {'content-type': 'text/plain'});
    res.end('not found');
  });

  server.on('error', (err) => {
    console.error(`mission-control: failed to bind port ${port}:`, err.message);
    process.exit(1);
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}/`;
    if (!existsSync(runPath)) {
      console.error(`mission-control: WARNING no manifest at ${runPath} yet — serving a "no run found" page until it appears.`);
    }
    console.log(`mission-control: ${brand} console at ${url}  (manifest: out/${brand}/marketing/run.json)`);
  });
}
