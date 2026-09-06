import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PLAYBOOK_PATH = path.join(ROOT, 'docs', 'PLAYBOOK.md');
const PLAYBOOK_DIR = path.join(ROOT, 'docs', 'playbook');
const SKILLS_DIR = path.join(ROOT, 'skills');

function readLines(p) {
  return fs.readFileSync(p, 'utf8').split(/\r\n|\n/);
}

function headingsOf(lines) {
  return lines
    .filter((l) => /^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^#{1,6}\s+/, '').trim());
}

const playbookLines = readLines(PLAYBOOK_PATH);
const topicFiles = fs.readdirSync(PLAYBOOK_DIR).filter((f) => f.endsWith('.md'));

test('every docs/playbook/*.md file is linked from PLAYBOOK.md\'s index, and every index link resolves to an existing file', () => {
  const indexStart = playbookLines.findIndex((l) => l.startsWith('## Gotchas by topic'));
  assert.ok(indexStart !== -1, 'PLAYBOOK.md must have a "## Gotchas by topic" section');

  const indexEnd = playbookLines.findIndex(
    (l, i) => i > indexStart && /^#{2,3}\s/.test(l),
  );
  const indexBlock = playbookLines.slice(indexStart, indexEnd === -1 ? playbookLines.length : indexEnd);

  const linked = new Set();
  for (const line of indexBlock) {
    const m = line.match(/\]\(playbook\/([^)]+\.md)\)/);
    if (m) linked.add(m[1]);
  }

  assert.ok(linked.size > 0, 'the index table must link at least one playbook/*.md file');

  for (const file of topicFiles) {
    assert.ok(linked.has(file), `docs/playbook/${file} exists but is not linked from PLAYBOOK.md's index`);
  }
  for (const file of linked) {
    assert.ok(
      fs.existsSync(path.join(PLAYBOOK_DIR, file)),
      `PLAYBOOK.md's index links to playbook/${file}, which does not exist`,
    );
  }
});

test('every topic file starts with an H1 and a "Read this when" line', () => {
  for (const file of topicFiles) {
    const lines = readLines(path.join(PLAYBOOK_DIR, file)).filter((l) => l.trim().length > 0);
    assert.ok(lines.length > 0, `${file} is empty`);
    assert.ok(/^# .+/.test(lines[0]), `${file}: first non-empty line must be a one-line H1, got: ${lines[0]}`);
    const hasReadWhen = lines.slice(0, 5).some((l) => /^Read this when:/i.test(l.trim()));
    assert.ok(hasReadWhen, `${file}: must have a "Read this when: ..." line near the top`);
  }
});

test('no skill under skills/ (except skills/marketing) points at a PLAYBOOK section heading that no longer exists', () => {
  const allHeadingTexts = new Set(headingsOf(playbookLines).map((h) => h.toLowerCase()));
  for (const file of topicFiles) {
    for (const h of headingsOf(readLines(path.join(PLAYBOOK_DIR, file)))) {
      allHeadingTexts.add(h.toLowerCase());
    }
  }

  const skillFiles = fs
    .readdirSync(SKILLS_DIR)
    .map((name) => path.join(SKILLS_DIR, name, 'SKILL.md'))
    .filter((p) => fs.existsSync(p))
    .filter((p) => path.basename(path.dirname(p)) !== 'marketing');

  assert.ok(skillFiles.length > 0, 'expected at least one skills/*/SKILL.md to check');

  // Matches "PLAYBOOK's "<Name>" section" and "PLAYBOOK's <Name> section" (unquoted,
  // greedy up to " section") plus the standalone quoted form 'PLAYBOOK "<Name>"'.
  const patterns = [
    /PLAYBOOK'?s\s+["“]([^"”]+)["”]\s+section/gi,
    /PLAYBOOK'?s\s+([A-Z][\w /-]*?)\s+section\b/g,
    /PLAYBOOK\s+["“]([^"”]+)["”]/gi,
  ];

  for (const skillPath of skillFiles) {
    const text = fs.readFileSync(skillPath, 'utf8');
    const names = new Set();
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        names.add(m[1].trim());
      }
    }
    for (const name of names) {
      const nameLower = name.toLowerCase();
      const found = [...allHeadingTexts].some((h) => h.includes(nameLower));
      assert.ok(
        found,
        `${path.relative(ROOT, skillPath)} points at PLAYBOOK section "${name}", which has no matching heading in PLAYBOOK.md or docs/playbook/*.md`,
      );
    }
  }
});
