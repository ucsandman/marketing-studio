// Magnetic OG statics: AnimatedOG crops + 8s loop. effects.wash is 0 (single-
// accent voice rule) so the flat near-black backdrop is the spec-compliant look.
//
// brief.json (studio/src/lib/brief.ts schema) has no top-level `tagline` field —
// the approved short-form OG copy lives at `social.x.headline` ("The magnetic
// timeline, on Windows"), with `hook.headline` as a longer/data-heavy fallback
// for video hooks, not banner text. `cta` is a real top-level field.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out', 'magnetic');
mkdirSync(outDir, {recursive: true});

const brief = JSON.parse(readFileSync(join(outDir, 'marketing', 'brief.json'), 'utf8'));
const props = {
  brandId: 'magnetic',
  tagline: brief.social?.x?.headline ?? brief.hook?.headline ?? 'A magnetic-timeline video editor for Windows',
  cta: brief.cta || 'github.com/ucsandman/magnetic',
  heroImage: null,
  loopSequence: null,
  loopFrames: 1,
};
const propsPath = join(outDir, 'og-props.json');
writeFileSync(propsPath, JSON.stringify(props));

const studioDir = join(root, 'studio');

const still = (out, width, height) => {
  console.log(`still: ${out} (${width}x${height})`);
  execSync(
    `npx remotion still AnimatedOG "${join(outDir, out)}" --props="${propsPath}" --width=${width} --height=${height}`,
    {cwd: studioDir, stdio: 'inherit'},
  );
};

still('og-image.png', 1200, 630); // native AnimatedOG size
still('github-social-preview.png', 1280, 640); // GitHub repo social card

console.log('render: og.mp4');
execSync(`npx remotion render AnimatedOG "${join(outDir, 'og.mp4')}" --props="${propsPath}"`, {
  cwd: studioDir,
  stdio: 'inherit',
});

console.log('statics OK: og-image.png, github-social-preview.png, og.mp4 in out/magnetic/');
