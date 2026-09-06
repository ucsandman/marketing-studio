// Regenerates the CostClaw audit evidence the demo capture films.
//
// Runs the SAME pipeline `costclaw audit` runs (loadAuditInputs -> buildAudit ->
// formatAudit / renderHtml) with color forced on, so terminal-after.txt holds the
// product's real ANSI bytes. Read-only: no history snapshot, no browser open, no
// writes anywhere near the product repo.
//
// Needs the product repo's toolchain (TS sources + tsx). Pass --project, or run
// it from that git worktree. Evidence defaults to the product-owned marketing
// workspace; an optional positional output must remain inside that repository.
//
// The default capture path reuses whatever is already on disk instead of calling
// this, because the audit reads LIVE logs: re-running changes every number, which
// would desync the footage from the stills and copy approved alongside it.
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { projectArg, resolveWorkspace, resolveWorkspacePath } from "../../scripts/lib/workspace.mjs";

const ENGINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const workspace = resolveWorkspace(ENGINE_ROOT, {brand: "costclaw", project: projectArg(argv)});
const outputArg = argv.find((arg, index) => !arg.startsWith("-") && argv[index - 1] !== "--project");
const outDir = outputArg
  ? resolveWorkspacePath(workspace, outputArg)
  : join(workspace.marketingDir, "demo");
const productImport = (path: string) => import(pathToFileURL(join(workspace.projectRoot, path)).href);
const [{buildAudit}, {loadAuditInputs, resolvePlan}, {formatAudit}, {renderHtml}, {readSetup}] =
  await Promise.all([
    productImport("packages/engine/src/index.ts"),
    productImport("apps/cli/src/audit-command.ts"),
    productImport("apps/cli/src/format.ts"),
    productImport("apps/cli/src/html-report.ts"),
    productImport("apps/cli/src/read-setup.ts"),
  ]);

const { logs, claudeMd, claudeMdSource, root, skipped } = await loadAuditInputs({});
const setup = await readSetup();
const { plan, planSource } = await resolvePlan(join(homedir(), ".costclaw"), undefined);
const record = buildAudit({ logs, claudeMd, questionnaire: {}, setup, plan });
const meta = { root, sessionCount: logs.length, skipped, claudeMdSource, planSource };

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "terminal-after.txt"), formatAudit(record, meta, true) + "\n", "utf8");
await writeFile(join(outDir, "html-after.html"), renderHtml(record, meta), "utf8");
process.stdout.write(`evidence written to ${outDir} (plan=${plan}, sessions=${logs.length})\n`);
