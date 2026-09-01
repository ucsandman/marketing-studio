// Shared per-platform props mechanism for the export matrix: fanning one
// picture-locked composition (LaunchVideo/SocialClip) into a platform's aspect via
// the optional {formatWidth, formatHeight} props read by calculateMetadata
// (Root.tsx) — no --width/--height CLI flags in the installed Remotion (4.0.486).
// Used by render-matrix.mjs and extract-thumbs.mjs so the base-props resolution
// stays in one place.
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

// Base props per composition. Launch is the canonical <brand>-launch.json; social
// prefers <brand>-social-vertical.json for a portrait row (it is the one hand-tuned
// file that carries videoCropRegion; the alphabetical fallback lands on -linkedin,
// whose null crop rendered every 9:16 / 4:5 row uncropped and reported OK), then
// <brand>-social-launch.json, then the first <brand>-social-*.json.
//
// Launch exception: props/<brand>-launch.json carries no `audio` (only the
// EMBED_AUDIO brands in build-launch-props.mjs do), so rows built off it render
// SILENT and — worse — compute their act lengths from launchTiming's constants
// instead of the measured VO, drifting from the launch video itself.
// scripts/merge-launch-audio.mjs writes the complete launch props plus the audio
// manifest to out/<brand>/launch-audio-props.json; prefer it when it exists. With
// no merged file the resolution is unchanged. SocialClip has no audio track by
// design and is untouched.
export function resolveBaseProps(root, brand, comp, {portrait = false} = {}) {
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
  const vertical = join(root, 'props', `${brand}-social-vertical.json`);
  if (portrait && existsSync(vertical)) return vertical;
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

// Per-composition base props cache, keyed by comp + orientation, so repeated
// platform rows for the same comp don't re-read the file from disk.
export function makeBaseLoader(root, brand) {
  const cache = new Map();
  return (comp, {portrait = false} = {}) => {
    const key = `${comp}:${portrait ? 'portrait' : 'landscape'}`;
    if (!cache.has(key)) {
      cache.set(key, JSON.parse(readFileSync(resolveBaseProps(root, brand, comp, {portrait}), 'utf8')));
    }
    return cache.get(key);
  };
}

// Merges the formatWidth/formatHeight override into a composition's base props.
export function withFormat(base, width, height) {
  return {...base, formatWidth: width, formatHeight: height};
}
