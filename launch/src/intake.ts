import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LaunchConfig } from './types.js';

const execFileAsync = promisify(execFile);

export interface ScanResult {
  /** Fields inferred from the target project. */
  scanned: Partial<LaunchConfig>;
  /** Required LaunchConfig fields that could not be inferred. */
  missing: string[];
}

const REQUIRED_FIELDS = [
  'name',
  'tagline',
  'description',
  'domain',
  'productUrl',
  'pricing',
] as const;

/** Convert a git remote URL (ssh or https) to a https URL, or undefined. */
function remoteToHttps(remote: string): string | undefined {
  const trimmed = remote.trim().replace(/\.git$/, '');
  if (trimmed.startsWith('https://')) return trimmed;
  const ssh = /^git@([^:]+):(.+)$/.exec(trimmed);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return undefined;
}

async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | undefined> {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function detectStack(targetDir: string, pkg: Record<string, unknown> | undefined): string[] {
  const stack: string[] = [];
  const deps: Record<string, unknown> = {
    ...(pkg?.dependencies as Record<string, unknown> | undefined),
    ...(pkg?.devDependencies as Record<string, unknown> | undefined),
  };
  if ('next' in deps || existsSync(join(targetDir, 'next.config.js')) || existsSync(join(targetDir, 'next.config.ts'))) {
    stack.push('nextjs');
  }
  if ('vite' in deps) stack.push('vite');
  if ('express' in deps) stack.push('express');
  if (pkg && stack.length === 0) stack.push('node');
  if (existsSync(join(targetDir, 'pyproject.toml')) || existsSync(join(targetDir, 'requirements.txt'))) {
    stack.push('python');
  }
  return stack;
}

/** Extract first `# heading` text and first non-heading paragraph from markdown. */
function parseReadme(markdown: string): { heading?: string; paragraph?: string } {
  let heading: string | undefined;
  let paragraph: string | undefined;
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (!heading && line.startsWith('#')) {
      heading = line.replace(/^#+\s*/, '').trim();
      continue;
    }
    if (heading && !paragraph && line.length > 0 && !line.startsWith('#')) {
      const para: string[] = [line];
      for (let j = i + 1; j < lines.length; j++) {
        const next = (lines[j] ?? '').trim();
        if (next.length === 0 || next.startsWith('#')) break;
        para.push(next);
      }
      paragraph = para.join(' ');
      break;
    }
  }
  return { heading, paragraph };
}

/**
 * Scan a target project directory and infer as much of LaunchConfig as possible.
 * Never throws on a readable directory; git remote lookup is best-effort.
 */
export async function scanTarget(targetDir: string): Promise<ScanResult> {
  const scanned: Partial<LaunchConfig> = {};

  const pkg = await readJsonIfExists(join(targetDir, 'package.json'));
  if (typeof pkg?.name === 'string' && pkg.name.length > 0) scanned.name = pkg.name;
  if (typeof pkg?.description === 'string' && pkg.description.length > 0) {
    scanned.description = pkg.description;
  }

  const readmePath = join(targetDir, 'README.md');
  if (existsSync(readmePath)) {
    const { heading, paragraph } = parseReadme(await readFile(readmePath, 'utf8'));
    if (heading) scanned.tagline = heading;
    if (!scanned.description && paragraph) scanned.description = paragraph;
  }

  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: targetDir,
    });
    const url = remoteToHttps(stdout);
    if (url) scanned.repoUrl = url;
  } catch {
    // best-effort: no git, no remote, or not a repo — repoUrl stays unset
  }

  scanned.stack = detectStack(targetDir, pkg);

  const missing = REQUIRED_FIELDS.filter((f) => scanned[f] === undefined);
  return { scanned, missing };
}
