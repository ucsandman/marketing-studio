// Generates the shared, brand-agnostic sound-design library ONCE and stages it for
// rendering: whoosh (act-cut transition), tick (feature-line reveal), riser (build
// into the end-card CTA). Three short files, one generation call each (<=3 total),
// written to assets/sfx/ (gitignored) and copied to studio/public/sfx/ (gitignored).
//
// Idempotent: skips any file already staged. Silent-fallback: if the audio feeder
// exits 2 (no ELEVENLABS_API_KEY) nothing is generated and this script exits 0 — the
// launch video simply renders without the cue layer (build-<brand>-audio.mjs then
// leaves the manifest's sfx gate off). NEVER a hard failure on a missing key.
import {copyFileSync, existsSync, mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'assets', 'sfx');
const publicDir = join(root, 'studio', 'public', 'sfx');

// Prompts tuned for short, clean, non-musical UI/transition sounds. durationSec must
// sit in the feeder's 0.5-30s window; the spec caps each cue at <=2s.
const LIBRARY = [
  {
    name: 'whoosh',
    durationSec: 1.2,
    prompt: 'short clean transition whoosh, soft air swish, quick swell and fade, no music, no reverb tail',
  },
  {
    name: 'tick',
    durationSec: 0.5,
    prompt: 'soft subtle UI tick, single short muted digital blip, clean and quiet, no reverb',
  },
  {
    name: 'riser',
    durationSec: 2.0,
    prompt: 'smooth rising synth riser building tension into a hit, clean upward sweep, no drums, no vocals',
  },
];

mkdirSync(assetsDir, {recursive: true});
mkdirSync(publicDir, {recursive: true});

let generated = 0;
let staged = 0;

for (const cue of LIBRARY) {
  const staticFile = join(publicDir, `${cue.name}.mp3`);
  if (existsSync(staticFile)) {
    console.log(`sfx skip: ${cue.name}.mp3 already staged`);
    staged += 1;
    continue;
  }

  const assetFile = join(assetsDir, `${cue.name}.mp3`);
  if (!existsSync(assetFile)) {
    const res = spawnSync(
      'node',
      [
        'feeders/audio/client.mjs',
        'sfx',
        '--prompt',
        cue.prompt,
        '--duration-sec',
        String(cue.durationSec),
        '--out',
        assetFile,
      ],
      {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']},
    );
    process.stdout.write(res.stdout ?? '');
    process.stderr.write(res.stderr ?? '');
    if (res.status === 2) {
      // Documented silent fallback: no key -> no sfx library, and that is fine.
      console.log('sfx fallback: ELEVENLABS_API_KEY absent; skipping sfx generation (video renders without the cue layer).');
      process.exit(0);
    }
    if (res.status !== 0) {
      console.error(`sfx FAILED generating ${cue.name}.mp3 (exit ${res.status})`);
      process.exit(1);
    }
    generated += 1;
  }

  copyFileSync(assetFile, staticFile);
  staged += 1;
  console.log(`sfx staged: ${cue.name}.mp3`);
}

console.log(`sfx OK: ${staged}/${LIBRARY.length} staged to studio/public/sfx/ (${generated} generated this run)`);
