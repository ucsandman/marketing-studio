// node --test scripts/publish-youtube.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  buildVideoResource,
  cleanTitle,
  loadPostkit,
  normalizeYtMetrics,
  videoIdFromUrl,
  videoUrl,
  youtubeCredentialError,
} from './publish-youtube.mjs';
import {resolveWorkspace} from './lib/workspace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const cli = join(here, 'publish-youtube.mjs');
const BRAND = 'yttest';

function tempProduct() {
  const project = mkdtempSync(join(tmpdir(), 'youtube-product-'));
  mkdirSync(join(project, '.git'));
  return {project, workspace: resolveWorkspace(root, {brand: BRAND, project})};
}

function runCli(args, project, env = {}) {
  try {
    const stdout = execFileSync('node', [cli, ...args, '--project', project], {encoding: 'utf8', env: {...process.env, ...env}});
    return {stdout, status: 0};
  } catch (err) {
    return {stdout: err.stdout ?? '', stderr: err.stderr ?? '', status: err.status};
  }
}

function kit(workspace, {caption = 'A launch video.', video = true, briefTitle = null} = {}) {
  const dir = join(workspace.postkitDir, 'youtube');
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'caption.txt'), caption);
  if (video) writeFileSync(join(dir, 'launch-16x9.mp4'), Buffer.alloc(2048));
  if (briefTitle) {
    mkdirSync(workspace.marketingDir, {recursive: true});
    writeFileSync(join(workspace.marketingDir, 'brief.json'), JSON.stringify({brandId: BRAND, hook: {headline: briefTitle}}));
  }
}

test('cleanTitle strips angle brackets, collapses whitespace and caps at 100', () => {
  assert.equal(cleanTitle('  Nothing <sensitive>  runs '), 'Nothing sensitive runs');
  const long = cleanTitle('x'.repeat(140));
  assert.equal(long.length, 100);
  assert.ok(long.endsWith('…'));
});

test('buildVideoResource defaults to private and refuses an unknown privacy', () => {
  const r = buildVideoResource({title: 't', description: 'd'});
  assert.equal(r.status.privacyStatus, 'private');
  assert.equal(r.status.selfDeclaredMadeForKids, false);
  assert.equal(r.snippet.categoryId, '28');
  assert.equal(buildVideoResource({title: 't', description: 'd', privacy: 'unlisted'}).status.privacyStatus, 'unlisted');
  assert.throws(() => buildVideoResource({title: 't', description: 'd', privacy: 'secret'}), /privacy must be/);
  assert.equal(buildVideoResource({title: 't', description: 'y'.repeat(6000)}).snippet.description.length, 5000);
});

test('videoUrl / videoIdFromUrl round-trip and parse watch and shorts URLs', () => {
  assert.equal(videoUrl('dQw4w9WgXcQ'), 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(videoIdFromUrl('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(videoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1'), 'dQw4w9WgXcQ');
  assert.equal(videoIdFromUrl('https://youtube.com/shorts/abc123XYZ'), 'abc123XYZ');
  assert.equal(videoIdFromUrl('https://x.com/u/status/1'), null);
});

test('normalizeYtMetrics maps statistics strings to numbers; views land in impressions', () => {
  assert.deepEqual(normalizeYtMetrics({viewCount: '120', likeCount: '7', commentCount: '2', favoriteCount: '0'}), {
    impressions: 120,
    likes: 7,
    reposts: 0,
    replies: 2,
    bookmarks: 0,
  });
  assert.equal(normalizeYtMetrics(undefined), null);
});

test('loadPostkit needs the matrix launch video and takes the title from the brief hook headline', () => {
  const {project, workspace} = tempProduct();
  try {
    assert.match(loadPostkit(root, workspace, BRAND).reason, /build-postkit/);
    kit(workspace, {video: false});
    assert.match(loadPostkit(root, workspace, BRAND).reason, /render-matrix/);
    kit(workspace, {briefTitle: 'Nothing sensitive runs until you allow it'});
    const k = loadPostkit(root, workspace, BRAND);
    assert.equal(k.ok, true);
    assert.equal(k.title, 'Nothing sensitive runs until you allow it');
    assert.equal(k.bytes, 2048);
    assert.equal(k.description, 'A launch video.');
  } finally {
    rmSync(project, {recursive: true, force: true});
  }
});

test('--dry-run builds the request without credentials and exits 0; missing evidence blocks live publish first', () => {
  const {project, workspace} = tempProduct();
  kit(workspace, {briefTitle: 'Title <here>'});
  try {
    const r = runCli([BRAND, '--dry-run', '--json', '--privacy', 'unlisted'], project, {YOUTUBE_CLIENT_ID: '', YOUTUBE_CLIENT_SECRET: ''});
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.resource.snippet.title, 'Title here');
    assert.equal(out.resource.status.privacyStatus, 'unlisted');
    assert.equal(out.bytes, 2048);
    const live = runCli([BRAND], project, {YOUTUBE_CLIENT_ID: '', YOUTUBE_CLIENT_SECRET: ''});
    assert.equal(live.status, 2);
    assert.match(live.stderr, /live publish blocked before credentials\/network: delivery-evidence\.json is missing/);
  } finally {
    rmSync(project, {recursive: true, force: true});
  }
});

test('credential validation distinguishes missing client credentials from a missing auth token', () => {
  assert.match(youtubeCredentialError('', '', false), /YOUTUBE_CLIENT_ID \/ YOUTUBE_CLIENT_SECRET/);
  assert.match(youtubeCredentialError('client', 'secret', false), /--auth/);
  assert.equal(youtubeCredentialError('client', 'secret', true), null);
});

test('a bad --privacy value is refused before any network call', () => {
  const {project, workspace} = tempProduct();
  kit(workspace);
  try {
    const r = runCli([BRAND, '--dry-run', '--privacy', 'secret'], project);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /privacy must be/);
  } finally {
    rmSync(project, {recursive: true, force: true});
  }
});
