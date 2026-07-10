// Shared per-platform props mechanism for the export matrix: fanning one
// picture-locked composition (LaunchVideo/SocialClip) into a platform's aspect via
// the optional {formatWidth, formatHeight} props read by calculateMetadata
// (Root.tsx) — no --width/--height CLI flags in the installed Remotion (4.0.486).
// Used by render-matrix.mjs and extract-thumbs.mjs so the base-props resolution
// stays in one place.
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

// Base props per composition. Launch is the canonical <brand>-launch.json; social
// prefers <brand>-social-launch.json, falling back to the first <brand>-social-*.json.
export function resolveBaseProps(root, brand, comp) {
  if (comp === 'LaunchVideo') {
    const p = join(root, 'props', `${brand}-launch.json`);
    if (!existsSync(p)) {
      console.error(`missing base props for LaunchVideo: ${p}`);
      process.exit(1);
    }
    return p;
  }
  const direct = join(root, 'props', `${brand}-social-launch.json`);
  if (existsSync(direct)) return direct;
  const match = readdirSync(join(root, 'props')).find(
    (f) => f.startsWith(`${brand}-social-`) && f.endsWith('.json'),
  );
  if (!match) {
    console.error(`missing base props for SocialClip (${brand}-social-*.json)`);
    process.exit(1);
  }
  return join(root, 'props', match);
}

// Per-composition base props cache, keyed by comp, so repeated platform rows for
// the same comp don't re-read the file from disk.
export function makeBaseLoader(root, brand) {
  const cache = new Map();
  return (comp) => {
    if (!cache.has(comp)) cache.set(comp, JSON.parse(readFileSync(resolveBaseProps(root, brand, comp), 'utf8')));
    return cache.get(comp);
  };
}

// Merges the formatWidth/formatHeight override into a composition's base props.
export function withFormat(base, width, height) {
  return {...base, formatWidth: width, formatHeight: height};
}
