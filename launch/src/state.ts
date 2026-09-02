import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  ContactsSchema,
  LaunchConfigSchema,
  LedgerEntrySchema,
  DraftSchema,
  type Contacts,
  type Draft,
  type LaunchConfig,
  type DraftPlatform,
  type LedgerEntry,
} from './types.js';
import { z } from 'zod';

/** Thrown when a state file exists but cannot be parsed/validated. */
export class CorruptedStateError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly cause2: unknown,
  ) {
    super(
      `Corrupted launch state file: ${filePath} — ${cause2 instanceof Error ? cause2.message : String(cause2)}`,
    );
    this.name = 'CorruptedStateError';
  }
}

const LedgerSchema = z.array(LedgerEntrySchema);

/**
 * Per-target launch state, stored under `<target>/.launch/`:
 *   launch.config.json   — LaunchConfig
 *   ledger.json          — append-only LedgerEntry[]
 *   drafts/<platform>.json
 *   research/<platform>.md
 *   out/                 — rendered artifacts (email html, PH kit, ...)
 */
export class LaunchStore {
  readonly launchDir: string;

  constructor(public readonly targetDir: string) {
    this.launchDir = join(targetDir, '.launch');
  }

  get configPath(): string {
    return join(this.launchDir, 'launch.config.json');
  }

  get ledgerPath(): string {
    return join(this.launchDir, 'ledger.json');
  }

  get draftsDir(): string {
    return join(this.launchDir, 'drafts');
  }

  get researchDir(): string {
    return join(this.launchDir, 'research');
  }

  get outDir(): string {
    return join(this.launchDir, 'out');
  }

  async ensureDirs(): Promise<void> {
    for (const dir of [this.launchDir, this.draftsDir, this.researchDir, this.outDir]) {
      await mkdir(dir, { recursive: true });
    }
  }

  hasConfig(): boolean {
    return existsSync(this.configPath);
  }

  private async readJson<T>(
    filePath: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T> {
    const raw = await readFile(filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new CorruptedStateError(filePath, err);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new CorruptedStateError(filePath, result.error);
    }
    return result.data;
  }

  // --- config ---------------------------------------------------------------

  async loadConfig(): Promise<LaunchConfig> {
    return this.readJson(this.configPath, LaunchConfigSchema);
  }

  async saveConfig(config: LaunchConfig): Promise<void> {
    await this.ensureDirs();
    const validated = LaunchConfigSchema.parse(config);
    await writeFile(this.configPath, JSON.stringify(validated, null, 2) + '\n', 'utf8');
  }

  // --- drafts ---------------------------------------------------------------

  draftPath(platform: DraftPlatform): string {
    return join(this.draftsDir, `${platform}.json`);
  }

  async loadDraft(platform: DraftPlatform): Promise<Draft | undefined> {
    const filePath = this.draftPath(platform);
    if (!existsSync(filePath)) return undefined;
    return this.readJson(filePath, DraftSchema);
  }

  async saveDraft(draft: Draft): Promise<void> {
    await this.ensureDirs();
    const validated = DraftSchema.parse(draft);
    await writeFile(
      this.draftPath(validated.platform as DraftPlatform),
      JSON.stringify(validated, null, 2) + '\n',
      'utf8',
    );
  }

  // --- contacts ---------------------------------------------------------------

  get contactsPath(): string {
    return join(this.launchDir, 'contacts.json');
  }

  hasContacts(): boolean {
    return existsSync(this.contactsPath);
  }

  async loadContacts(): Promise<Contacts> {
    return this.readJson(this.contactsPath, ContactsSchema);
  }

  // --- ledger ---------------------------------------------------------------

  async loadLedger(): Promise<LedgerEntry[]> {
    if (!existsSync(this.ledgerPath)) return [];
    return this.readJson(this.ledgerPath, LedgerSchema);
  }

  async appendLedger(entry: LedgerEntry): Promise<void> {
    await this.ensureDirs();
    const validated = LedgerEntrySchema.parse(entry);
    const existing = await this.loadLedger();
    const previous = existing.find((e) => e.idempotencyKey === validated.idempotencyKey);
    const ledger = existing.filter((e) => e.idempotencyKey !== validated.idempotencyKey);
    // A --force repost SUPERSEDES the earlier publication, it does not erase it:
    // this ledger is the only record of what went out, and --mark-posted refuses
    // a key already present, so a dropped url would be unrecoverable.
    ledger.push(
      previous
        ? { ...validated, supersedes: { url: previous.url, postedAt: previous.postedAt } }
        : validated,
    );
    // Unique per call: a fixed `.tmp` is shared by every writer, so two concurrent
    // appends interleave into one file and the atomic rename publishes a torn ledger.
    const tmpPath = `${this.ledgerPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
      await rename(tmpPath, this.ledgerPath);
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }
  }

  async has(idempotencyKey: string): Promise<boolean> {
    const ledger = await this.loadLedger();
    return ledger.some((e) => e.idempotencyKey === idempotencyKey);
  }
}
