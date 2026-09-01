// Minimal .env reader shared by the publish/results scripts: KEY=VALUE lines, no
// expansion, process.env wins. Values are never printed by any caller.
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function readEnvVar(name, envPath = join(root, '.env')) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(envPath)) return null;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] === name && m[2]) return m[2].replace(/^["']|["']$/g, '');
  }
  return null;
}
