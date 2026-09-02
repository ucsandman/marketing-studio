import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const SKILL_PATH = join(ROOT, '.claude', 'skills', 'launch', 'SKILL.md');
const TOOLS_PATH = join(ROOT, 'docs', 'mcp-tool-inventory.md');

const MCP_NAME_RE =
  /\b(?:create|get|set|list|send|purchase|check|verify|add|apply|query|select|preflight|dashclaw)_[a-z_]+\b/g;

describe('/launch SKILL.md', () => {
  it('references only MCP tools that exist in the tools.md inventory (zero unknowns)', async () => {
    const skill = await readFile(SKILL_PATH, 'utf8');
    const tools = await readFile(TOOLS_PATH, 'utf8');
    const referenced = [...new Set(skill.match(MCP_NAME_RE) ?? [])];
    expect(referenced.length).toBeGreaterThan(15); // sanity: the skill names real tools
    const unknown = referenced.filter((name) => !tools.includes(name));
    expect(unknown, `MCP names in SKILL.md missing from tools.md: ${unknown.join(', ')}`).toEqual([]);
  });

  it('contains both SPEND GATEs and the PUBLISH GATE with explicit wait-for-approval language', async () => {
    const skill = await readFile(SKILL_PATH, 'utf8');
    expect(skill.match(/SPEND GATE/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(skill).toContain('PUBLISH GATE');
    expect(skill).toMatch(/WAIT for (their|the user's) answer/);
    expect(skill).toContain('Never call `purchase_domain` without a fresh approval');
    expect(skill).toContain('Nothing is published until the user approves');
  });

  it('documents the dry-run rehearsal path', async () => {
    const skill = await readFile(SKILL_PATH, 'utf8');
    expect(skill).toContain('## Dry-run rehearsal');
    expect(skill).toContain('post <dir> --all --dry-run');
    expect(skill).toContain('research <dir> --offline');
  });
});
