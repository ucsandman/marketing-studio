// Generates the shared, brand-agnostic sound-design library ONCE and stages it for
// rendering. Three short files, one generation call each (<=3 total), written to
// the product marketing assets/sfx/ and copied to its runtime public/sfx/.
//
// Idempotent and local-first: existing assets are staged without any network call.
// Missing files are reported and skipped unless --generate is explicitly supplied;
// that flag is a paid external action and must be approved before use.
import {copyFileSync, existsSync, mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const brand = argv.find((arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--project');
const project = projectArg(argv);
if (!brand || !project) {
  console.error('usage: node scripts/build-sfx.mjs <brand> --project <product-repo> [--generate]');
  process.exit(2);
}
const workspace = resolveWorkspace(root, {brand, project});
const assetsDir = join(workspace.assetsDir, 'sfx');
const publicDir = join(workspace.publicDir, 'sfx');
const allowGenerate = process.argv.includes('--generate');

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
let missing = 0;

for (const cue of LIBRARY) {
  const staticFile = join(publicDir, `${cue.name}.mp3`);
  if (existsSync(staticFile)) {
    console.log(`sfx skip: ${cue.name}.mp3 already staged`);
    staged += 1;
    continue;
  }

  const assetFile = join(assetsDir, `${cue.name}.mp3`);
  if (!existsSync(assetFile)) {
    if (!allowGenerate) {
      console.log(`sfx missing: ${cue.name}.mp3 (local-only run; --generate requires approval)`);
      missing += 1;
      continue;
    }
    const res = spawnSync(
      'node',
      [
        'feeders/audio/client.mjs',
        'sfx',
        '--project',
        workspace.projectRoot,
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

const verdict = missing === 0 ? 'OK' : 'INCOMPLETE';
console.log(`sfx ${verdict}: staged=${staged}/${LIBRARY.length} generated=${generated} missing=${missing}`);
