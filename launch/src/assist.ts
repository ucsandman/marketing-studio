import { spawn } from 'node:child_process';

/**
 * Assisted-launch plumbing: open a prefilled URL in the default browser and put
 * companion text on the clipboard. The HUMAN clicks submit — never the engine
 * (HN/PH automation is a ban risk by design, see providers/hackernews.ts).
 */

export interface SpawnCall {
  command: string;
  args: string[];
  /** Text piped to stdin (clipboard payloads). */
  stdin?: string;
}

export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): SpawnCall {
  switch (platform) {
    case 'win32':
      // `start` is a cmd builtin; empty "" is the window title slot.
      return { command: 'cmd', args: ['/c', 'start', '', url] };
    case 'darwin':
      return { command: 'open', args: [url] };
    default:
      return { command: 'xdg-open', args: [url] };
  }
}

export function clipboardCommand(text: string, platform: NodeJS.Platform = process.platform): SpawnCall {
  switch (platform) {
    case 'win32':
      return { command: 'powershell', args: ['-NoProfile', '-Command', '$input | Set-Clipboard'], stdin: text };
    case 'darwin':
      return { command: 'pbcopy', args: [], stdin: text };
    default:
      return { command: 'xclip', args: ['-selection', 'clipboard'], stdin: text };
  }
}

export type SpawnImpl = (call: SpawnCall) => Promise<void>;

const defaultSpawn: SpawnImpl = (call) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(call.command, call.args, { stdio: ['pipe', 'ignore', 'ignore'], detached: false });
    child.on('error', reject);
    child.on('close', () => resolvePromise());
    if (call.stdin !== undefined) {
      child.stdin?.write(call.stdin);
    }
    child.stdin?.end();
  });

export async function openInBrowser(
  url: string,
  deps: { platform?: NodeJS.Platform; spawnImpl?: SpawnImpl } = {},
): Promise<void> {
  await (deps.spawnImpl ?? defaultSpawn)(browserCommand(url, deps.platform));
}

export async function copyToClipboard(
  text: string,
  deps: { platform?: NodeJS.Platform; spawnImpl?: SpawnImpl } = {},
): Promise<void> {
  await (deps.spawnImpl ?? defaultSpawn)(clipboardCommand(text, deps.platform));
}
