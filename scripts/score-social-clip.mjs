#!/usr/bin/env node
// scripts/score-social-clip.mjs — put the brand's music bed and ONE VO line under
// a rendered SocialClip.
//
// SocialClip has no audio track by design (PLAYBOOK), which is right for the
// muted-autoplay rows of the export matrix and wrong for a brand whose intake asked
// for music + VO: the X clip shipped silent (postflop, 2026-09-01). This is the
// post-render step that fixes that without touching the template: the clip is
// video-copied, the bed is trimmed to the clip and faded out, the VO line starts
// after a short lead, and the result goes through master-audio.mjs so it lands on
// the same -14 LUFS as the launch film.
//
// Usage: node scripts/score-social-clip.mjs <brand> <clipId> --vo <act> [--out <path>]
//   <clipId>  out/<brand>/<clipId>.mp4 (e.g. social-x)
//   --vo      act id from props/<brand>-audio.json (e.g. hook, feature-2); the line
//             must be shorter than the clip minus VO_LEAD_MS, or the script exits 1
//   default out: out/<brand>/<clipId>-scored.mp4
//
// Shells to plain `ffmpeg` on PATH (Remotion's bundled build lacks the filters).

import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const VO_LEAD_MS = 300; // music-only lead before the line starts
export const BED_GAIN = 0.18; // static duck: the line covers nearly the whole clip
export const BED_FADE_S = 0.8; // fade the bed out under the end card
// Speech has an 18 dB crest (postflop hook: I -26.4, peak -7.9). loudnorm cannot lift
// that 12 dB linearly under a -2 dBTP ceiling and falls to dynamic mode, which lands
// 0.2-1 LUFS short of target on a 10s clip. Gentle 4:1 compression on the line brings
// the crest to ~10 dB so master-audio converges in one pass.
export const VO_COMP = 'acompressor=threshold=-24dB:ratio=4:attack=3:release=100:makeup=8dB';

/** Pure: the ffmpeg filter graph for one clip. Exported for the test. */
export function scoreFilter(clipDurS, {lead = VO_LEAD_MS, bedGain = BED_GAIN, fade = BED_FADE_S} = {}) {
  const fadeStart = Math.max(0, clipDurS - fade).toFixed(3);
  return (
    `[1:a]atrim=0:${clipDurS.toFixed(3)},asetpts=PTS-STARTPTS,volume=${bedGain},` +
    `afade=t=out:st=${fadeStart}:d=${fade}[bed];` +
    `[2:a]${VO_COMP},adelay=${lead}|${lead}[vo];` +
    `[bed][vo]amix=inputs=2:duration=first:normalize=0[mix]`
  );
}

/** Pure: does the VO line fit the clip? Exported for the test. */
export function voFits(clipDurMs, voDurMs, lead = VO_LEAD_MS) {
  return lead + voDurMs <= clipDurMs;
}

function ffprobeDurationS(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {encoding: 'utf8'});
  const d = Number(String(r.stdout).trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe could not read duration of ${file}`);
  return d;
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const positional = argv.filter((a, i) => !a.startsWith('--') && !['--vo', '--out'].includes(argv[i - 1]));
  const [brand, clipId] = positional;
  const voAct = flag('--vo');
  if (!brand || !clipId || !voAct) {
    console.error('usage: node scripts/score-social-clip.mjs <brand> <clipId> --vo <act> [--out <path>]');
    process.exit(1);
  }

  const clip = join(root, 'out', brand, `${clipId}.mp4`);
  const audioPath = join(root, 'props', `${brand}-audio.json`);
  if (!existsSync(clip)) {
    console.error(`score-social-clip: missing ${clip}`);
    process.exit(1);
  }
  if (!existsSync(audioPath)) {
    console.error(`score-social-clip: missing ${audioPath} (run build-${brand}-audio.mjs first)`);
    process.exit(1);
  }
  const audio = JSON.parse(readFileSync(audioPath, 'utf8'));
  const line = (audio.lines ?? []).find((l) => l.act === voAct);
  if (!line) {
    console.error(`score-social-clip: no VO line for act "${voAct}" in ${audioPath}`);
    process.exit(1);
  }
  const publicDir = join(root, 'studio', 'public');
  const music = join(publicDir, audio.music.src);
  const vo = join(publicDir, line.src);
  for (const f of [music, vo]) {
    if (!existsSync(f)) {
      console.error(`score-social-clip: missing ${f}`);
      process.exit(1);
    }
  }

  const clipDurS = ffprobeDurationS(clip);
  const clipDurMs = Math.round(clipDurS * 1000);
  if (!voFits(clipDurMs, line.durationMs)) {
    console.error(
      `score-social-clip: VO "${voAct}" is ${line.durationMs}ms; clip is ${clipDurMs}ms minus ${VO_LEAD_MS}ms lead. ` +
        `Pick a shorter line or a longer clip; the copy is never trimmed here.`,
    );
    process.exit(1);
  }

  const out = resolve(flag('--out') ?? join(root, 'out', brand, `${clipId}-scored.mp4`));
  const args = [
    '-hide_banner', '-y',
    '-i', clip, '-i', music, '-i', vo,
    '-filter_complex', scoreFilter(clipDurS),
    '-map', '0:v', '-map', '[mix]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart',
    out,
  ];
  const r = spawnSync('ffmpeg', args, {encoding: 'utf8'});
  if (r.status !== 0 || !existsSync(out)) {
    console.error(`score-social-clip: ffmpeg failed (exit ${r.status})`);
    console.error(r.stderr ?? '');
    process.exit(1);
  }
  console.log(`score-social-clip OK: ${clipId} + bed + VO "${voAct}" (${line.durationMs}ms in ${clipDurMs}ms) -> ${out}`);
  console.log(`next: node scripts/master-audio.mjs ${out} --out out/${brand}/${clipId}-final.mp4`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
