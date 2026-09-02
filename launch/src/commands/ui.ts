import type { Command } from 'commander';
import { openInBrowser, type SpawnImpl } from '../assist.js';
import { createUiServer } from '../ui/server.js';
import { registerReadRoutes } from '../ui/routes-read.js';
import { registerActionRoutes } from '../ui/routes-actions.js';

export interface RunUiOptions {
  /** 0 = ephemeral (tests). Default 4400. */
  port?: number;
  /** false = --no-open. */
  open?: boolean;
  /** Test seams. */
  spawnImpl?: SpawnImpl;
  webRoot?: string;
  token?: string;
}

export interface RunUiResult {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function runUi(opts: RunUiOptions = {}): Promise<RunUiResult> {
  const ui = createUiServer({ port: opts.port ?? 4400, webRoot: opts.webRoot, token: opts.token });
  registerReadRoutes(ui);
  registerActionRoutes(ui);
  await ui.listen();
  if (opts.open !== false) {
    await openInBrowser(ui.url, { spawnImpl: opts.spawnImpl });
  }
  return { url: ui.url, port: ui.port, close: () => ui.close() };
}

export function registerUi(program: Command): void {
  program
    .command('ui')
    .description('Open the launch dashboard — a local web GUI for init, drafts, doctor, preview, and posting')
    .option('--port <port>', 'port to serve the dashboard on (binds 127.0.0.1 only)', '4400')
    .option('--no-open', 'do not open the browser automatically')
    .action(async (opts: { port: string; open: boolean }) => {
      const port = Number.parseInt(opts.port, 10);
      if (Number.isNaN(port) || port < 0 || port > 65535) {
        console.error(`Invalid port: ${opts.port}`);
        process.exitCode = 1;
        return;
      }
      try {
        const running = await runUi({ port, open: opts.open });
        console.log(`Launch dashboard: ${running.url}`);
        console.log('Press Ctrl+C to stop.');
        const shutdown = (): void => {
          void running.close().then(() => process.exit(0));
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        console.error(
          code === 'EADDRINUSE'
            ? `Port ${port} is already in use — pick another with --port`
            : err instanceof Error
              ? err.message
              : String(err),
        );
        process.exitCode = 1;
      }
    });
}
