import {readFileSync} from 'node:fs';
import {lintJson} from '../lint-copy.mjs';

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIRECTIONS = new Set(['A', 'C']);

function fail(message) {
  throw new Error(`posts manifest: ${message}`);
}

export function parsePostsManifest(input, platformKeys) {
  if (!Array.isArray(input)) fail('expected a JSON array of posts');
  const platformSet = new Set(platformKeys);
  const ids = new Set();

  return input.map((raw, index) => {
    const path = `post ${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${path}: expected an object`);
    const {id, direction, headline, caption} = raw;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) fail(`${path}: id must be a lowercase filesystem-safe slug`);
    if (ids.has(id)) fail(`duplicate post id: ${id}`);
    ids.add(id);
    if (!DIRECTIONS.has(direction)) fail(`${path} (${id}): unknown direction "${direction}"`);
    if (typeof headline !== 'string') fail(`${path} (${id}): headline must be a string`);
    if (typeof caption !== 'string') fail(`${path} (${id}): caption must be a string`);
    if (raw.light !== undefined && typeof raw.light !== 'boolean') fail(`${path} (${id}): light must be a boolean`);
    if (raw.platforms !== undefined && !Array.isArray(raw.platforms)) fail(`${path} (${id}): platforms must be an array`);

    const platforms = raw.platforms ?? platformKeys;
    for (const platform of platforms) {
      if (typeof platform !== 'string' || !platformSet.has(platform)) fail(`${path} (${id}): unknown platform key "${platform}"`);
    }

    const errors = lintJson({headline, caption}).filter((violation) => violation.level === 'ERROR');
    if (errors.length > 0) {
      fail(`${path} (${id}): lint-copy rejected public copy (${errors.map((violation) => violation.rule).join(', ')})`);
    }

    return {id, direction, headline, caption, light: raw.light ?? false, platforms: [...platforms]};
  });
}

export function readPostsManifest(path, platformKeys) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`failed to read ${path}: ${error.message}`);
  }
  return parsePostsManifest(parsed, platformKeys);
}
