// Merges props/<brand>-launch.json with props/<brand>-audio.json for rendering/preview.
// Brand-agnostic: pass the brand id as argv[2] (defaults to noban for back-compat).
// Do not fold this into build-<brand>-audio.mjs or build-launch-props.mjs.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = process.argv[2] || 'noban';
const launch = JSON.parse(readFileSync(join(root, 'props', `${brand}-launch.json`), 'utf8'));
const audio = JSON.parse(readFileSync(join(root, 'props', `${brand}-audio.json`), 'utf8'));

const merged = {...launch, audio};

const outPath = join(root, 'out', brand, 'launch-audio-props.json');
mkdirSync(dirname(outPath), {recursive: true});
writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n');
console.log(`wrote ${outPath}`);
