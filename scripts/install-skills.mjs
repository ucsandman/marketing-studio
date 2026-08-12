// Installs the bundled skills (skills/*) into ~/.claude/skills so the slash
// commands (/marketing, /logo-reveal, ...) work from any repo. Rewrites the
// engine path baked into each SKILL.md to wherever this repo was cloned.
import {cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'skills');
const destDir = join(homedir(), '.claude', 'skills');

// The skills locate the engine as ${CLAUDE_SKILL_DIR}/../.., which is correct when
// they live inside the engine (the plugin layout: <engine>/skills/<name>/). Copying
// them to ~/.claude/skills/<name>/ breaks that walk-up, so bake in this clone's path.
const ENGINE_PLACEHOLDER = '${CLAUDE_SKILL_DIR}/../..';
const enginePath = root;

if (!existsSync(srcDir)) {
  console.error(`No skills directory at ${srcDir}`);
  process.exit(1);
}

mkdirSync(destDir, {recursive: true});

const skills = readdirSync(srcDir, {withFileTypes: true})
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

if (skills.length === 0) {
  console.error(`No skills found in ${srcDir}`);
  process.exit(1);
}

for (const name of skills) {
  const from = join(srcDir, name);
  const to = join(destDir, name);
  if (existsSync(to) && !lstatSync(to).isDirectory()) {
    console.warn(`skipped /${name}: ${to} exists as a symlink or file; left untouched`);
    continue;
  }
  cpSync(from, to, {recursive: true});
  const skillFile = join(to, 'SKILL.md');
  if (existsSync(skillFile)) {
    let text = readFileSync(skillFile, 'utf8');
    text = text.replaceAll(ENGINE_PLACEHOLDER, enginePath.replaceAll(sep, '/'));
    writeFileSync(skillFile, text);
  }
  console.log(`installed /${name} -> ${to}`);
}

console.log(`\n${skills.length} skills installed. Engine path: ${enginePath}`);
console.log('Restart Claude Code (or start a new session) to pick them up.');
