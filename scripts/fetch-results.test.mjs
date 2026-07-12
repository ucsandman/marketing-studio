import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tweetIdFromUrl, normalizeXMetrics} from './fetch-results.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const cli = join(here, 'fetch-results.mjs');
const BRAND = '__resultstest__'; // out/__resultstest__/ is gitignored build product

function runCli(args) {
  try {
    const stdout = execFileSync('node', [cli, ...args], {encoding: 'utf8'});
    return {stdout, status: 0};
  } catch (err) {
    return {stdout: err.stdout ?? '', stderr: err.stderr ?? '', status: err.status};
  }
}

test('tweetIdFromUrl parses x.com and twitter.com status URLs', () => {
  assert.equal(tweetIdFromUrl('https://x.com/user/status/1234567890'), '1234567890');
  assert.equal(tweetIdFromUrl('https://twitter.com/user/statuses/42'), '42');
  assert.equal(tweetIdFromUrl('https://x.com/user'), null);
  assert.equal(tweetIdFromUrl(null), null);
});

test('normalizeXMetrics maps public_metrics and merges quotes into reposts', () => {
  const m = normalizeXMetrics({impression_count: 100, like_count: 5, retweet_count: 2, quote_count: 3, reply_count: 1, bookmark_count: 4});
  assert.deepEqual(m, {impressions: 100, likes: 5, reposts: 5, replies: 1, bookmarks: 4});
  assert.equal(normalizeXMetrics(null), null);
});

test('CLI exits 1 with guidance when posts.json is missing', () => {
  rmSync(join(root, 'out', BRAND), {recursive: true, force: true});
  const {status, stderr} = runCli([BRAND]);
  assert.equal(status, 1);
  assert.match(stderr, /posts\.json/);
});

test('manual metrics pass through and exit 0; unresolvable posts degrade to exit 2', () => {
  const dir = join(root, 'out', BRAND, 'marketing');
  mkdirSync(dir, {recursive: true});
  try {
    // all-manual: exit 0
    writeFileSync(
      join(dir, 'posts.json'),
      JSON.stringify([{platform: 'linkedin', url: 'https://linkedin.com/posts/x', variant: 'hook-1', metrics: {impressions: 900, likes: 12}}]),
    );
    let r = runCli([BRAND]);
    assert.equal(r.status, 0);
    let results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
    assert.equal(results.posts[0].source, 'manual');
    assert.equal(results.posts[0].metrics.impressions, 900);
    assert.equal(results.posts[0].variant, 'hook-1');

    // a post with no metrics and no way to fetch: written as unavailable, exit 2
    writeFileSync(
      join(dir, 'posts.json'),
      JSON.stringify([{platform: 'discord', url: 'https://discord.com/channels/1/2/3', variant: 'hook-2'}]),
    );
    r = runCli([BRAND]);
    assert.equal(r.status, 2);
    results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
    assert.equal(results.posts[0].source, 'unavailable');
  } finally {
    rmSync(join(root, 'out', BRAND), {recursive: true, force: true});
  }
});
