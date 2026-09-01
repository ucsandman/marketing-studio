// Tests for `install-skills.mjs --check`, the drift check between the bundled
// skills/ mirror and the installed ~/.claude/skills copies. Fixtures stand in for
// both sides (INSTALL_SKILLS_SRC / INSTALL_SKILLS_DEST) so the test never reads or
// writes the real home directory.
// Run: node --test scripts/install-skills.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = join(dirname(fileURLToPath(import.meta.url)), 'install-skills.mjs');

// The bundled copy uses the placeholder and CRLF; the installed copy carries a
// baked engine path (both slash forms, as the git -C lines do) and LF. Same content.
const BUNDLED = [
  '# Marketing',
  '',
  'Work in `${CLAUDE_SKILL_DIR}/../..`.',
  'Guard: `git -C "${CLAUDE_SKILL_DIR}/../.." status --short`.',
  'Read `${CLAUDE_SKILL_DIR}/../../docs/PLAYBOOK.md` first.',
  '',
].join('\r\n');
const INSTALLED = BUNDLED.replaceAll('\r\n', '\n')
  .replaceAll('${CLAUDE_SKILL_DIR}/../../docs', 'D:/elsewhere/animations/docs')
  .replace('git -C "${CLAUDE_SKILL_DIR}/../.."', 'git -C "D:\\elsewhere\\animations"')
  .replaceAll('${CLAUDE_SKILL_DIR}/../..', 'D:/elsewhere/animations');

function fixture(installedText) {
  const base = mkdtempSync(join(tmpdir(), 'install-skills-'));
  const src = join(base, 'skills');
  const dest = join(base, 'installed');
  mkdirSync(join(src, 'marketing'), {recursive: true});
  mkdirSync(join(src, 'marketing', 'references'), {recursive: true});
  mkdirSync(join(src, 'unpublished'), {recursive: true});
  mkdirSync(join(dest, 'marketing'), {recursive: true});
  writeFileSync(join(src, 'marketing', 'SKILL.md'), BUNDLED);
  writeFileSync(join(src, 'marketing', 'references', 'hooks.md'), 'one hook\r\n');
  writeFileSync(join(src, 'unpublished', 'SKILL.md'), 'never installed\r\n');
  writeFileSync(join(dest, 'marketing', 'SKILL.md'), installedText);
  mkdirSync(join(dest, 'marketing', 'references'), {recursive: true});
  writeFileSync(join(dest, 'marketing', 'references', 'hooks.md'), 'one hook\n');
  return {src, dest};
}

// The check warns and never fails: exit 0 either way, drift on stderr.
function check({src, dest}) {
  const run = spawnSync('node', [cli, '--check'], {
    encoding: 'utf8',
    env: {...process.env, INSTALL_SKILLS_SRC: src, INSTALL_SKILLS_DEST: dest},
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout + run.stderr;
}

test('identical modulo CRLF and the baked engine path is not drift', () => {
  const out = check(fixture(INSTALLED));
  // 1 of 2: the skill absent on the installed side is skipped, not reported as drift.
  assert.match(out, /1 of 2 skills compared, 0 differ/);
});

test('one changed line is drift, and the differing file is named', () => {
  const edited = INSTALLED.replace('Read `D:/elsewhere/animations/docs/PLAYBOOK.md` first.', 'Read the playbook first.');
  assert.notEqual(edited, INSTALLED, 'fixture edit must actually change the installed copy');
  const out = check(fixture(edited));
  assert.match(out, /1 of 2 skills compared, 1 differ/);
  assert.match(out, /drift \/marketing: SKILL\.md/);
});
