import {cpSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets', 'noban');
const dest = join(root, 'studio', 'public', 'noban');

if (!existsSync(src)) {
  console.error(`nothing to stage: ${src} does not exist (run the blender feeder first)`);
  process.exit(1);
}
for (const dir of ['logo-reveal', 'background-loop']) {
  const from = join(src, dir);
  if (!existsSync(from)) {
    console.log(`skip ${dir} (not rendered yet)`);
    continue;
  }
  cpSync(from, join(dest, dir), {recursive: true});
  console.log(`staged ${dir}`);
}
