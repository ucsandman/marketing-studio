// Extracts the DashClaw README demo GIF (Approvals inbox holding a risk-scored
// action, one-click Allow resolves it) from this run's real product-demo footage
// (out/dashclaw/demo.mp4, Playwright capture rendered via ProductDemo) -- NOT a
// Remotion composition render. Segment 1.8s-11.0s of the 28.39s demo, chosen against
// props/dashclaw-demo.json telemetry: wide "held" establishing shot -> zoom to the
// risk-scored deploy card -> the Allow click ripple, ending before the beat cuts to
// the Decisions Ledger page.
//
// Bundled Remotion ffmpeg is a minimal build (--disable-filters, explicit
// --enable-filter allowlist) with NO `fps` or `select` filter. Workaround: trim via
// -ss/-t (container-level seek, not a filter), decimate frame rate via the legacy
// `-r` OUTPUT option (not the `fps` filter node), and use the two-pass
// palettegen/paletteuse (both enabled) instead of a naive single-pass palette.
import {execSync} from 'node:child_process';
import {statSync, unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const studioDir = join(root, 'studio');
const outDir = join(root, 'out', 'dashclaw');
const src = join(outDir, 'demo.mp4');
const palette = join(outDir, 'readme-demo-palette.png');
const out = join(outDir, 'readme-demo.gif');

const START = 1.8; // s -- wide "held" establishing shot
const DURATION = 9.2; // s -- through the Allow click ripple, before the ledger cut
const WIDTH = 760; // matches the README's <img width="760">
const FPS = 10;
const BUDGET_BYTES = 5 * 1024 * 1024; // README gif budget (docs/PLAYBOOK.md / check-budgets.mjs)

const run = (cmd) => execSync(cmd, {cwd: studioDir, stdio: 'inherit'});

console.log('pass 1/2: palettegen');
run(
  `npx remotion ffmpeg -ss ${START} -t ${DURATION} -i "${src}" -vf "scale=${WIDTH}:-1:flags=lanczos,palettegen" -y "${palette}"`,
);

console.log('pass 2/2: paletteuse');
run(
  `npx remotion ffmpeg -ss ${START} -t ${DURATION} -i "${src}" -i "${palette}" -filter_complex "[0:v]scale=${WIDTH}:-1:flags=lanczos[s];[s][1:v]paletteuse" -r ${FPS} -y "${out}"`,
);

unlinkSync(palette);

const bytes = statSync(out).size;
console.log(`readme-demo.gif: ${(bytes / 1024 / 1024).toFixed(2)}MB (budget ${BUDGET_BYTES / 1024 / 1024}MB) at out/dashclaw/readme-demo.gif`);
if (bytes > BUDGET_BYTES) {
  console.error('OVER BUDGET -- lower WIDTH/FPS or shorten DURATION');
  process.exit(1);
}
