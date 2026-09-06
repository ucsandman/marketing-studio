import {copyFileSync, mkdirSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {projectArg, resolveWorkspace, resolveWorkspacePath} from './lib/workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const NOBAN_ASSETS = ['cockpit.webp', 'governance.webp', 'ledger.webp'];

const optionValue = (args, name) => {
  const index = args.indexOf(name);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return value;
  }
  const prefix = `${name}=`;
  const arg = args.find((item) => item.startsWith(prefix));
  if (arg && arg.length === prefix.length) throw new Error(`${name} requires a value`);
  return arg?.slice(prefix.length) ?? null;
};

export const resolveNobanAssetPaths = (args = [], cwd = process.cwd()) => {
  const workspace = resolveWorkspace(root, {
    brand: 'noban',
    project: projectArg(args),
    cwd,
  });
  return {
    workspace,
    sourceDir: resolveWorkspacePath(
      workspace,
      optionValue(args, '--source') ?? join(workspace.projectRoot, 'marketing', 'assets', 'shots'),
    ),
    destDir: resolveWorkspacePath(
      workspace,
      optionValue(args, '--out') ?? join(workspace.publicDir, 'noban'),
    ),
  };
};

export const copyNobanAssets = ({sourceDir, destDir}) => {
  if (!existsSync(sourceDir)) throw new Error(`source not found: ${sourceDir}`);
  mkdirSync(destDir, {recursive: true});
  for (const file of NOBAN_ASSETS) {
    copyFileSync(join(sourceDir, file), join(destDir, file));
    console.log(`copied ${file}`);
  }
  return NOBAN_ASSETS.length;
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    copyNobanAssets(resolveNobanAssetPaths(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
