import {execFileSync, execSync} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {motionVariants, writeMotionProps} from './build-synthacon-motion-props.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out', 'smoke');
mkdirSync(outDir, {recursive: true});

const compositions = ['ComponentGallery', 'SocialClip', 'ProductDemo', 'LogoReveal', 'LaunchVideo', 'AnimatedOG'];

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
const motionProps = writeMotionProps(join(outDir, 'props'));
for (const path of motionProps.filter((_, index) => motionVariants[index].direction === 'C')) {
  const variant = motionVariants[motionProps.indexOf(path)];
  const id = `MotionVariant-${variant.formatWidth}x${variant.formatHeight}`;
  const out = join(outDir, `${id}.png`);
  console.log(`smoke: rendering frame 120 of ${id}`);
  execFileSync('npx', ['remotion', 'still', 'MotionVariant', out, '--frame=120', `--props=${path}`], {cwd: join(root, 'studio'), stdio: 'inherit'});
  if (!existsSync(out)) throw new Error(`smoke FAILED: ${out} was not produced`);
}
console.log(`smoke OK: ${compositions.length + 2} compositions rendered to out/smoke/`);
