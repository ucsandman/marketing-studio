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
//
// Launch exception: props/<brand>-launch.json carries no `audio` (only the
// EMBED_AUDIO brands in build-launch-props.mjs do), so rows built off it render
// SILENT and — worse — compute their act lengths from launchTiming's constants
// instead of the measured VO, drifting from the launch video itself.
// scripts/merge-launch-audio.mjs writes the complete launch props plus the audio
// manifest to out/<brand>/launch-audio-props.json; prefer it when it exists. With
// no merged file the resolution is unchanged. SocialClip has no audio track by
// design and is untouched.
export function resolveBaseProps(root, brand, comp) {
  if (comp === 'LaunchVideo') {
    const merged = join(root, 'out', brand, 'launch-audio-props.json');
    if (existsSync(merged)) return merged;
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
