// Installs the bundled skills (skills/*) into ~/.claude/skills so the slash
// commands (/marketing, /logo-reveal, ...) work from any repo. Rewrites the
// engine path baked into each SKILL.md to wherever this repo was cloned.
// --check installs nothing: it reports which bundled skills have drifted from
// the installed copies (the mirror rule in CLAUDE.md: change one, change both).
import {cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// The env overrides exist so the drift check can be tested against fixtures.
const srcDir = process.env.INSTALL_SKILLS_SRC || join(root, 'skills');
const destDir = process.env.INSTALL_SKILLS_DEST || join(homedir(), '.claude', 'skills');

// The skills locate the engine as ${CLAUDE_SKILL_DIR}/../.., which is correct when
// they live inside the engine (the plugin layout: <engine>/skills/<name>/). Copying
// them to ~/.claude/skills/<name>/ breaks that walk-up, so bake in this clone's path.
const ENGINE_PLACEHOLDER = '${CLAUDE_SKILL_DIR}/../..';
const enginePath = root;

// Undo that bake so a bundled file and its installed copy compare equal. The installed
// copy may carry a different clone's path (a worktree, a moved checkout) and may carry it
// with either slash, so recover the baked path from the file itself before falling back
// to this clone's. Detection anchors on the text right after the first placeholder.
function unbake(bundled, installed) {
  const at = bundled.indexOf(ENGINE_PLACEHOLDER);
  let baked = enginePath;
  if (at >= 0 && installed.startsWith(bundled.slice(0, at))) {
    const after = bundled.slice(at + ENGINE_PLACEHOLDER.length, at + ENGINE_PLACEHOLDER.length + 16);
    const end = installed.indexOf(after, at);
    if (end > at) baked = installed.slice(at, end);
  }
  return installed
    .replaceAll(baked.replaceAll(sep, '/'), ENGINE_PLACEHOLDER)
    .replaceAll(baked.replaceAll('/', '\\'), ENGINE_PLACEHOLDER);
}

function sameAfterInstall(bundledFile, installedFile) {
  if (!existsSync(installedFile)) return false;
  const bundled = readFileSync(bundledFile, 'utf8').replaceAll('\r\n', '\n');
  return unbake(bundled, readFileSync(installedFile, 'utf8').replaceAll('\r\n', '\n')) === bundled;
}

if (!existsSync(srcDir)) {
  console.error(`No skills directory at ${srcDir}`);
  process.exit(1);
}

const skills = readdirSync(srcDir, {withFileTypes: true})
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

if (skills.length === 0) {
  console.error(`No skills found in ${srcDir}`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  let compared = 0;
  let drifted = 0;
  for (const name of skills) {
    const from = join(srcDir, name);
    const to = join(destDir, name);
    // Not installed at all (plugin layout, or a skill that ships only in the repo)
    // is not drift; a symlink or file is what the install itself refuses to touch.
    if (!existsSync(to) || !lstatSync(to).isDirectory()) continue;
    compared += 1;
    const differ = readdirSync(from, {recursive: true})
      .map((f) => f.replaceAll(sep, '/'))
      .filter((f) => statSync(join(from, f)).isFile() && !sameAfterInstall(join(from, f), join(to, f)));
    if (differ.length > 0) {
      drifted += 1;
      console.warn(`drift /${name}: ${differ.join(', ')}`);
    }
  }
  console.log(`${compared} of ${skills.length} skills compared, ${drifted} differ`);
  process.exit(0);
}

mkdirSync(destDir, {recursive: true});

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
