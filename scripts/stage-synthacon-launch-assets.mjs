import {copyFileSync, mkdirSync} from "node:fs";
import {basename, dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const studioRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolve(process.argv[2] ?? "../synthacon/synthacon-app");
const sourceRoot = resolve(appRoot, "marketing/social/campaigns/launch/assets/gear");
const destination = resolve(studioRoot, "studio/public/synthacon/launch");
const assets = ["synth-poly-dark.png"];

mkdirSync(destination, {recursive: true});
for (const asset of assets) copyFileSync(resolve(sourceRoot, asset), resolve(destination, basename(asset)));
process.stdout.write(`${JSON.stringify({staged: assets.length, destination})}\n`);
