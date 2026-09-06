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
export function resolveBaseProps(workspace, brand, comp, {portrait = false} = {}) {
  if (comp === 'LaunchVideo') {
    const merged = join(workspace.brandRoot, 'launch-audio-props.json');
    if (existsSync(merged)) return merged;
    const p = join(workspace.propsDir, `${brand}-launch.json`);
    if (!existsSync(p)) {
      console.error(`missing base props for LaunchVideo: ${p}`);
      process.exit(1);
    }
    return p;
  }
  const vertical = join(workspace.propsDir, `${brand}-social-vertical.json`);
  if (portrait && existsSync(vertical)) return vertical;
  const direct = join(workspace.propsDir, `${brand}-social-launch.json`);
  if (existsSync(direct)) return direct;
  const match = readdirSync(workspace.propsDir).find(
    (f) => f.startsWith(`${brand}-social-`) && f.endsWith('.json'),
  );
  if (!match) {
    console.error(`missing base props for SocialClip (${brand}-social-*.json)`);
    process.exit(1);
  }
  return join(workspace.propsDir, match);
}

// Per-composition base props cache, keyed by comp + orientation, so repeated
// platform rows for the same comp don't re-read the file from disk.
export function makeBaseLoader(workspace, brand) {
  const cache = new Map();
  return (comp, {portrait = false} = {}) => {
    const key = `${comp}:${portrait ? 'portrait' : 'landscape'}`;
    if (!cache.has(key)) {
      cache.set(key, JSON.parse(readFileSync(resolveBaseProps(workspace, brand, comp, {portrait}), 'utf8')));
    }
    return cache.get(key);
  };
}

// Merges the formatWidth/formatHeight override into a composition's base props.
export function withFormat(base, width, height) {
  return {...base, formatWidth: width, formatHeight: height};
}

export function withBoundCaptions(comp, base, audio) {
  if (!audio || !Array.isArray(audio.lines) || audio.lines.length === 0) {
    throw new Error(`${comp} caption rendering requires audio.lines inside the selected props`);
  }
  if (comp === 'LaunchVideo') return {...base, audio, burnCaptions: true};
  if (comp === 'SocialClip') {
    return {
      ...base,
      voLines: audio.lines.map(({act, text, durationMs}) => ({act, text, durationMs})),
      burnCaptions: true,
    };
  }
  throw new Error(`caption rendering is not supported for ${comp}`);
}

export function productionHeroFrame(shotPlan, fallback) {
  const hero = Array.isArray(shotPlan?.shots) ? shotPlan.shots.find((shot) => shot?.hero === true) : null;
  const from = Number(hero?.from);
  const len = Number(hero?.len ?? hero?.durationFrames);
  if (!Number.isFinite(from) || !Number.isFinite(len) || len <= 0) return fallback;
  const midpoint = Math.round(from + (len - 1) / 2);
  const total = Number(shotPlan?.total ?? shotPlan?.totalFrames);
  return Number.isFinite(total) && total > 0 ? Math.max(0, Math.min(total - 1, midpoint)) : Math.max(0, midpoint);
}
