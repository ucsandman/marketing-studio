#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { registerInit } from './commands/init.js';
import { registerResearch } from './commands/research.js';
import { registerCopy } from './commands/copy.js';
import { registerPost } from './commands/post.js';
import { registerStats } from './commands/stats.js';
import { registerNotify } from './commands/notify.js';
import { registerDoctor } from './commands/doctor.js';
import { registerStatus } from './commands/status.js';
import { registerUi } from './commands/ui.js';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
) as { version: string; description: string };

const program = new Command();

program
  .name('launch')
  .description(pkg.description)
  .version(pkg.version);

// Subcommands register here as phases land:
// init (phase 2), research (3), copy (4), post (5-7), notify (8), doctor/status (9)
type CommandRegistrar = (program: Command) => void;
const registrars: CommandRegistrar[] = [
  registerInit,
  registerResearch,
  registerCopy,
  registerPost,
  registerStats,
  registerNotify,
  registerDoctor,
  registerStatus,
  registerUi,
];

for (const register of registrars) {
  register(program);
}

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
