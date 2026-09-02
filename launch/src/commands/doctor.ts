import type { Command } from 'commander';
import { buildProviders } from '../providers/index.js';
import type { Provider } from '../providers/types.js';

export interface DoctorOptions {
  json?: boolean;
}

export interface DoctorRow {
  provider: string;
  mode: 'api' | 'assist' | 'blocked';
  detail: string;
  fixHint?: string;
}

export interface DoctorResult {
  exitCode: number;
  rows: DoctorRow[];
  messages: string[];
}

/** Core of `launch doctor` — a report, so exit 0 always. */
export async function runDoctor(deps: { providers?: Provider[] } = {}): Promise<DoctorResult> {
  const providers = deps.providers ?? buildProviders();
  const rows: DoctorRow[] = [];

  for (const provider of providers) {
    const mode = provider.mode();
    const status = await provider.ready();
    rows.push({
      provider: provider.name,
      mode,
      detail: status.detail,
      fixHint: status.ok ? undefined : status.fixHint,
    });
  }

  const width = Math.max(...rows.map((r) => r.provider.length));
  const messages = [
    `${'provider'.padEnd(width)} | mode    | status`,
    `${'-'.repeat(width)}-+---------+-------`,
    ...rows.map(
      (r) =>
        `${r.provider.padEnd(width)} | ${r.mode.padEnd(7)} | ${r.detail}` +
        (r.fixHint ? `\n${' '.repeat(width)} |         |   fix: ${r.fixHint}` : ''),
    ),
  ];

  return { exitCode: 0, rows, messages };
}

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check every posting provider: mode (api/assist/blocked) + credential health')
    .option('--json', 'machine-readable output for the /launch skill')
    .action(async (opts: DoctorOptions) => {
      const result = await runDoctor();
      if (opts.json) {
        console.log(JSON.stringify(result.rows, null, 2));
      } else {
        for (const message of result.messages) console.log(message);
      }
      process.exitCode = result.exitCode;
    });
}
