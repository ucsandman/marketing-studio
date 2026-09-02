import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CorruptedStateError } from './state.js';
import { RecentsFileSchema, type RecentsFile } from './types.js';

/**
 * Registry of recently-opened launch targets for the dashboard, stored at
 * `<base>/.launch-engine/recents.json` (base defaults to the home directory;
 * injectable for tests).
 */
export class RecentsStore {
  readonly filePath: string;

  constructor(baseDir: string = homedir()) {
    this.filePath = join(baseDir, '.launch-engine', 'recents.json');
  }

  /**
   * Load the registry. Entries whose `dir` no longer exists are pruned from
   * the returned value only — the file is rewritten on the next touch().
   */
  async load(): Promise<RecentsFile> {
    if (!existsSync(this.filePath)) return { version: 1, targets: [] };
    const raw = await readFile(this.filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new CorruptedStateError(this.filePath, err);
    }
    const result = RecentsFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new CorruptedStateError(this.filePath, result.error);
    }
    return { ...result.data, targets: result.data.targets.filter((t) => existsSync(t.dir)) };
  }

  async save(file: RecentsFile): Promise<void> {
    const validated = RecentsFileSchema.parse(file);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(validated, null, 2) + '\n', 'utf8');
  }

  /** Upsert by dir with a fresh lastOpened, most recent first; persists (pruning sticks here). */
  async touch(entry: { dir: string; name: string; domain?: string }): Promise<RecentsFile> {
    const current = await this.load();
    const updated: RecentsFile = {
      version: 1,
      targets: [
        { ...entry, lastOpened: new Date().toISOString() },
        ...current.targets.filter((t) => t.dir !== entry.dir),
      ],
    };
    await this.save(updated);
    return updated;
  }
}
