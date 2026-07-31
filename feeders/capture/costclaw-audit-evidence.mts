// Regenerates the CostClaw audit evidence the demo capture films.
//
// Runs the SAME pipeline `costclaw audit` runs (loadAuditInputs -> buildAudit ->
// formatAudit / renderHtml) with color forced on, so terminal-after.txt holds the
// product's real ANSI bytes. Read-only: no history snapshot, no browser open, no
// writes anywhere near the product repo.
//
// Needs the product repo's toolchain (TS sources + tsx), so run it FROM there:
//   cd C:\Projects\costclaw
//   npx tsx C:\Projects\animations\feeders\capture\costclaw-audit-evidence.mts \
//     C:\Projects\animations\out\costclaw\marketing\demo
//
// The default capture path reuses whatever is already on disk instead of calling
// this, because the audit reads LIVE logs: re-running changes every number, which
// would desync the footage from the stills and copy approved alongside it.
import { buildAudit } from "file:///C:/Projects/costclaw/packages/engine/src/index.ts";
import { loadAuditInputs, resolvePlan } from "file:///C:/Projects/costclaw/apps/cli/src/audit-command.ts";
import { formatAudit } from "file:///C:/Projects/costclaw/apps/cli/src/format.ts";
import { renderHtml } from "file:///C:/Projects/costclaw/apps/cli/src/html-report.ts";
import { readSetup } from "file:///C:/Projects/costclaw/apps/cli/src/read-setup.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: tsx costclaw-audit-evidence.mts <outDir>");
  process.exit(1);
}

const { logs, claudeMd, claudeMdSource, root, skipped } = await loadAuditInputs({});
const setup = await readSetup();
const { plan, planSource } = await resolvePlan(join(homedir(), ".costclaw"), undefined);
const record = buildAudit({ logs, claudeMd, questionnaire: {}, setup, plan });
const meta = { root, sessionCount: logs.length, skipped, claudeMdSource, planSource };

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "terminal-after.txt"), formatAudit(record, meta, true) + "\n", "utf8");
await writeFile(join(outDir, "html-after.html"), renderHtml(record, meta), "utf8");
process.stdout.write(`evidence written to ${outDir} (plan=${plan}, sessions=${logs.length})\n`);
