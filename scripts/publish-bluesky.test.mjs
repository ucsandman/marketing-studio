// node --test scripts/publish-bluesky.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  BSKY_MAX_GRAPHEMES,
  blueskyCredentialError,
  buildRecord,
  graphemeCount,
  linkFacets,
  loadPostkit,
  normalizeBskyMetrics,
  parsePostUrl,
  postUrl,
} from './publish-bluesky.mjs';
import {resolveWorkspace} from './lib/workspace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const cli = join(here, 'publish-bluesky.mjs');
const BRAND = 'bskytest';

function tempProduct() {
  const project = mkdtempSync(join(tmpdir(), 'bsky-product-'));
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

function kit(workspace, {caption, video = true}) {
  const dir = join(workspace.postkitDir, 'bluesky');
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'caption.txt'), caption);
  writeFileSync(join(dir, 'alt.txt'), 'A terminal running the audit.');
  if (video) writeFileSync(join(dir, 'social-16x9.mp4'), Buffer.alloc(1024));
  return dir;
}

test('graphemeCount counts what Bluesky counts: an emoji with a skin tone is one', () => {
  assert.equal(graphemeCount('hi 👍🏽'), 4);
  assert.equal(graphemeCount(''), 0);
  assert.equal(BSKY_MAX_GRAPHEMES, 300);
});

test('linkFacets uses UTF-8 byte offsets and drops trailing punctuation', () => {
  const text = 'café → https://example.com/x, then https://a.b/c.';
  const f = linkFacets(text);
  assert.equal(f.length, 2);
  assert.equal(f[0].features[0].uri, 'https://example.com/x');
  const start = Buffer.byteLength('café → ', 'utf8');
  assert.deepEqual(f[0].index, {byteStart: start, byteEnd: start + 'https://example.com/x'.length});
  assert.equal(f[1].features[0].uri, 'https://a.b/c');
  assert.deepEqual(linkFacets('no links here'), []);
});

test('buildRecord attaches the video embed with aspect ratio only when a blob exists', () => {
  const blob = {$type: 'blob', ref: {$link: 'bafy'}, mimeType: 'video/mp4', size: 1};
  const at = new Date('2026-09-01T00:00:00Z');
  const withVideo = buildRecord({text: 'see https://x.y', alt: 'alt', videoBlob: blob, width: 1920, height: 1080, createdAt: at});
  assert.equal(withVideo.$type, 'app.bsky.feed.post');
  assert.equal(withVideo.createdAt, '2026-09-01T00:00:00.000Z');
  assert.equal(withVideo.facets.length, 1);
  assert.deepEqual(withVideo.embed, {$type: 'app.bsky.embed.video', video: blob, alt: 'alt', aspectRatio: {width: 1920, height: 1080}});
  const textOnly = buildRecord({text: 'plain', alt: '', videoBlob: null, width: 1, height: 1, createdAt: at});
  assert.equal('embed' in textOnly, false);
  assert.equal('facets' in textOnly, false);
});

test('postUrl / parsePostUrl round-trip through the bsky.app URL shape', () => {
  const url = postUrl('brand.bsky.social', 'at://did:plc:abc/app.bsky.feed.post/3kxyz');
  assert.equal(url, 'https://bsky.app/profile/brand.bsky.social/post/3kxyz');
  assert.deepEqual(parsePostUrl(url), {actor: 'brand.bsky.social', rkey: '3kxyz'});
  assert.equal(parsePostUrl('https://x.com/u/status/1'), null);
});

test('normalizeBskyMetrics folds quotes into reposts and leaves impressions null', () => {
  assert.deepEqual(normalizeBskyMetrics({likeCount: 3, repostCount: 1, quoteCount: 2, replyCount: 4}), {
    impressions: null,
    likes: 3,
    reposts: 3,
    replies: 4,
    bookmarks: null,
  });
  assert.equal(normalizeBskyMetrics(null), null);
});

test('loadPostkit reports a missing kit as a reason, not a throw', () => {
  const {project, workspace} = tempProduct();
  try {
    const r = loadPostkit(root, workspace, BRAND);
    assert.equal(r.ok, false);
    assert.match(r.reason, /build-postkit/);
  } finally {
    rmSync(project, {recursive: true, force: true});
  }
});

test('--dry-run builds the record from the postkit without credentials and exits 0', () => {
  const {project, workspace} = tempProduct();
  kit(workspace, {caption: 'Nothing sensitive runs until you allow it. https://dashclaw.dev'});
  try {
    const r = runCli([BRAND, '--dry-run', '--json'], project, {BLUESKY_HANDLE: '', BLUESKY_APP_PASSWORD: ''});
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.dryRun, true);
    assert.equal(out.record.embed.$type, 'app.bsky.embed.video');
    assert.equal(out.record.embed.aspectRatio.width, 1920);
    assert.equal(out.record.facets.length, 1);
  } finally {
    rmSync(project, {recursive: true, force: true});
  }
});

test('a caption over 300 graphemes is refused before any network call', () => {
  const {project, workspace} = tempProduct();
  kit(workspace, {caption: 'x'.repeat(301)});
  try {
    const r = runCli([BRAND, '--dry-run'], project);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /301 graphemes/);
  } finally {
    rmSync(project, {recursive: true, force: true});
  }
});

test('without a postkit the CLI exits 2 with the build-postkit hint; missing evidence blocks before credentials', () => {
  const {project, workspace} = tempProduct();
  try {
    const none = runCli([BRAND], project);
    assert.equal(none.status, 2);
    assert.match(none.stderr, /build-postkit/);
    kit(workspace, {caption: 'short'});
    const r = runCli([BRAND], project, {BLUESKY_HANDLE: '', BLUESKY_APP_PASSWORD: ''});
    assert.equal(r.status, 2);
    assert.match(r.stderr, /live publish blocked before credentials\/network: delivery-evidence\.json is missing/);
  } finally {
    rmSync(project, {recursive: true, force: true});
  }
});

test('credential validation names the missing Bluesky variables without invoking the publisher', () => {
  assert.match(blueskyCredentialError('', ''), /BLUESKY_HANDLE \/ BLUESKY_APP_PASSWORD/);
  assert.equal(blueskyCredentialError('brand.bsky.social', 'app-password'), null);
});
