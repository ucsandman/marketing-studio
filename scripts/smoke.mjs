import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out-dir');
const outDir = outIndex === -1 ? join(tmpdir(), 'animations-smoke') : args[outIndex + 1];
if (!outDir) {
  console.error('smoke FAILED: --out-dir requires a path');
  process.exit(1);
}
mkdirSync(outDir, {recursive: true});

const compositions = ['ComponentGallery', 'StagedGallery', 'SocialClip', 'ProductDemo', 'LogoReveal', 'LaunchVideo', 'PostflopFilm', 'DashClawFilm', 'AnimatedOG', 'StoreTile', 'Card', 'WrapClip', 'AgentSession'];
const rootSource = readFileSync(join(root, 'studio', 'src', 'Root.tsx'), 'utf8');
const registered = [...rootSource.matchAll(/<Composition\s+[\s\S]*?\bid="([^"]+)"/g)].map((match) => match[1]);
const missing = registered.filter((id) => !compositions.includes(id));
const stale = compositions.filter((id) => !registered.includes(id));
if (missing.length || stale.length || new Set(compositions).size !== compositions.length) {
  console.error(`smoke FAILED: registry=${registered.length} smoke=${compositions.length} missing=${missing.join(',') || 'none'} stale=${stale.join(',') || 'none'}`);
  process.exit(1);
}
console.log(`smoke coverage: registry=${registered.length} smoke=${compositions.length}`);

const scratch = mkdtempSync(join(tmpdir(), 'marketing-studio-smoke-'));
const publicDir = join(scratch, 'public');
const bundleDir = join(scratch, 'bundle');
const studioDir = join(root, 'studio');
const remotionCli = join(studioDir, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
mkdirSync(publicDir, {recursive: true});
execFileSync(process.execPath, [remotionCli, 'bundle', 'src/index.ts', '--out-dir', bundleDir, '--public-dir', publicDir], {
  cwd: studioDir,
  stdio: 'inherit',
});

for (const id of compositions) {
  const out = join(outDir, `${id}.png`);
  console.log(`smoke: rendering frame 0 of ${id}`);
  execFileSync(process.execPath, [remotionCli, 'still', bundleDir, id, out, '--frame=0'], {
    cwd: studioDir,
    stdio: 'inherit',
  });
  if (!existsSync(out)) {
    console.error(`smoke FAILED: ${out} was not produced`);
    process.exit(1);
  }
}
console.log(`smoke OK: ${compositions.length} compositions rendered to ${outDir}`);
