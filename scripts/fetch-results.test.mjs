import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tweetIdFromUrl, normalizeXMetrics} from './fetch-results.mjs';
import {resolveWorkspace} from './lib/workspace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const cli = join(here, 'fetch-results.mjs');
const BRAND = 'resultstest';

function tempProduct() {
  const project = mkdtempSync(join(tmpdir(), 'results-product-'));
  mkdirSync(join(project, '.git'));
  return {project, workspace: resolveWorkspace(root, {brand: BRAND, project})};
}

function runCli(args, project) {
  try {
    const stdout = execFileSync('node', [cli, ...args, '--project', project], {encoding: 'utf8'});
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

test('CLI cleanly skips (exit 0) when posts.json does not exist yet', () => {
  const {project} = tempProduct();
  try {
    const {status, stdout} = runCli([BRAND], project);
    assert.equal(status, 0);
    assert.match(stdout, /0 of 0 rows published/);
  } finally {
    rmSync(project, {recursive: true, force: true});
  }
});

test('a seeded, all-unpublished posts.json prints 0 of N rows published and exits 0', () => {
  const {project, workspace} = tempProduct();
  const dir = workspace.marketingDir;
  mkdirSync(dir, {recursive: true});
  try {
    writeFileSync(
      join(dir, 'posts.json'),
      JSON.stringify([
        {platform: 'x', url: null, variant: null, published: false},
        {platform: 'linkedin', url: null, variant: null, published: false},
      ]),
    );
    const {status, stdout} = runCli([BRAND], project);
    assert.equal(status, 0);
    assert.match(stdout, /0 of 2 rows published/);
    const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
    assert.deepEqual(results.posts.map((p) => p.source), ['skipped', 'skipped']);
  } finally {
    rmSync(project, {recursive: true, force: true});
  }
});

test('a row with published:false is skipped even when it carries a url', () => {
  const {project, workspace} = tempProduct();
  const dir = workspace.marketingDir;
  mkdirSync(dir, {recursive: true});
  try {
    writeFileSync(
      join(dir, 'posts.json'),
      JSON.stringify([{platform: 'x', url: 'https://x.com/u/status/1', variant: 'hook-1', published: false}]),
    );
    const {status} = runCli([BRAND], project);
    assert.equal(status, 0);
    const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
    assert.equal(results.posts[0].source, 'skipped');
  } finally {
    rmSync(project, {recursive: true, force: true});
  }
});

test('manual metrics pass through and exit 0; unresolvable posts degrade to exit 2', () => {
  const {project, workspace} = tempProduct();
  const dir = workspace.marketingDir;
  mkdirSync(dir, {recursive: true});
  try {
    // all-manual: exit 0
    writeFileSync(
      join(dir, 'posts.json'),
      JSON.stringify([{platform: 'linkedin', url: 'https://linkedin.com/posts/x', variant: 'hook-1', metrics: {impressions: 900, likes: 12}}]),
    );
    let r = runCli([BRAND], project);
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
    r = runCli([BRAND], project);
    assert.equal(r.status, 2);
    results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
    assert.equal(results.posts[0].source, 'unavailable');
  } finally {
    rmSync(project, {recursive: true, force: true});
  }
});
