import {execSync} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out', 'smoke');
mkdirSync(outDir, {recursive: true});

const compositions = ['ComponentGallery', 'SocialClip', 'ProductDemo', 'LogoReveal'];

for (const id of compositions) {
  const out = join(outDir, `${id}.png`);
  console.log(`smoke: rendering frame 0 of ${id}`);
  execSync(`npx remotion still ${id} "${out}" --frame=0`, {
    cwd: join(root, 'studio'),
    stdio: 'inherit',
  });
  if (!existsSync(out)) {
    console.error(`smoke FAILED: ${out} was not produced`);
    process.exit(1);
  }
}
console.log(`smoke OK: ${compositions.length} compositions rendered to out/smoke/`);
