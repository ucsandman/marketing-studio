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

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
let brand = null;
let port = 4600;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--port') port = parseInt(argv[++i], 10);
  else if (a.startsWith('--port=')) port = parseInt(a.split('=')[1], 10);
  else if (!a.startsWith('-') && !brand) brand = a;
}
if (!brand) {
  console.error('usage: node scripts/mission-control.mjs <brandId> [--port 4600]');
  process.exit(1);
}
if (!Number.isFinite(port)) {
  console.error(`mission-control: invalid --port value`);
  process.exit(1);
}

const brandOut = join(root, 'out', brand); // media root — nothing is served from outside this dir
const marketingDir = join(brandOut, 'marketing');
const runPath = join(marketingDir, 'run.json');
const reviewPath = join(marketingDir, 'review.json');

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
function enrichAsset(entry) {
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
  return {...entry, _artifact, _stills: enrichStills(entry)};
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

// ---- read-only advisories (judges / results / staleness) --------------------
// All three are computed from files other tools write; Mission Control never
// mutates them. They ride on /state so the operator approves with the machine
// verdicts, engagement numbers, and footage freshness in view.

// Quality-judge verdict summaries from out/<brand>/marketing/judge-*.json.
function readJudges() {
  let files = [];
  try {
    files = readdirSync(marketingDir).filter((f) => /^judge-.+\.json$/.test(f));
  } catch {
    return [];
  }
  const judges = [];
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(join(marketingDir, f), 'utf8'));
      const findings = Array.isArray(r.findings) ? r.findings : [];
      judges.push({
        judge: r.judge ?? f.replace(/^judge-|\.json$/g, ''),
        verdict: r.verdict ?? 'UNKNOWN',
        warns: findings.filter((x) => x.level === 'WARN').length,
        fails: findings.filter((x) => x.level === 'FAIL' || x.level === 'ERROR').length,
        generatedAt: r.generatedAt ?? null,
        messages: findings.slice(0, 6).map((x) => `[${x.level}] ${x.message ?? x.check ?? ''}`),
      });
    } catch {
      judges.push({judge: f, verdict: 'UNREADABLE', warns: 0, fails: 0, generatedAt: null, messages: []});
    }
  }
  return judges;
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
  const enriched = {
    ...run,
    assets: Array.isArray(run.assets) ? run.assets.map(enrichAsset) : [],
    _judges: readJudges(),
    _results: readResults(),
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
.judge{position:relative;}
.judge summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-variant-numeric:tabular-nums;padding:3px 10px;border-radius:999px;border:1px solid #2b3138;background:#181c21;}
.judge summary::-webkit-details-marker{display:none;}
.judge .verdict{font-weight:700;letter-spacing:.4px;}
.judge .v-pass{color:#8ce6a5;}
.judge .v-warn{color:#e6b45a;}
.judge .v-fail{color:#ff8a8a;}
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
<main class="wrap" id="cards"></main>
<script>
const STATUSES = ['planned','rendered','approved','delivered'];
const cardsEl = document.getElementById('cards');
const lastRender = {}; // assetId -> serialized entry, so we only rebuild changed cards

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtSize(b){if(b==null)return null;if(b<1024)return b+' B';if(b<1048576)return (b/1024).toFixed(0)+' KB';return (b/1048576).toFixed(1)+' MB';}
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
    +meta+redo+stillsHtml(e)+variants
    +'<div class="controls">'
      +'<div class="row"><button class="btn approve" data-act="approve">Approve</button></div>'
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

cardsEl.addEventListener('click',ev=>{
  const btn=ev.target.closest('button[data-act]');if(!btn)return;
  const card=btn.closest('.card');if(!card)return;
  act(card.dataset.id,btn.dataset.act,card);
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
    const cls=j.verdict==='PASS'?(j.warns?'v-warn':'v-pass'):'v-fail';
    const label=j.verdict+(j.fails?' ('+j.fails+')':j.warns?' ('+j.warns+' warn)':'');
    const list=j.messages&&j.messages.length
      ?'<div class="findings"><ul>'+j.messages.map(m=>'<li>'+esc(m)+'</li>').join('')+'</ul></div>'
      :'';
    bits.push('<details class="judge"><summary>judge:'+esc(j.judge)+' <span class="verdict '+cls+'">'+esc(label)+'</span></summary>'+list+'</details>');
  });
  (run._staleness||[]).forEach(s=>{
    const what=s.commitsBehind==null
      ?'product repo unreachable ('+esc(s.productRepo)+')'
      :esc(s.stage)+' footage: '+(s.commitsBehind?s.commitsBehind+' commit(s) behind':'')+(s.commitsBehind&&s.dirty?', ':'')+(s.dirty?'dirty tree':'');
    bits.push('<span class="stale">&#9888; '+what+'</span>');
  });
  if(run._results&&run._results.postCount){
    bits.push('<span class="results-chip">results: '+run._results.postCount+' post(s), fetched '+esc((run._results.fetchedAt||'').slice(0,16).replace('T',' '))+'</span>');
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
