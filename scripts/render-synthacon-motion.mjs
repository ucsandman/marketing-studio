import {execFileSync} from "node:child_process";
import {mkdirSync, rmSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {motionVariants, writeMotionProps} from "./build-synthacon-motion-props.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const studio = resolve(root, "studio");

export function renderPlan(propsDirectory, outputDirectory) {
  return motionVariants.map(({direction, formatWidth, formatHeight}) => {
    const name = `${direction}-${formatWidth}x${formatHeight}`;
    return {
      name,
      propsPath: resolve(propsDirectory, `${name}.json`),
      rawPath: resolve(outputDirectory, `${name}.raw.mp4`),
      finalPath: resolve(outputDirectory, `${name}.mp4`),
    };
  });
}

export function renderMotionVariants(outputDirectory = resolve(root, "out/synthacon-motion/rendered")) {
  const propsDirectory = resolve(root, "out/synthacon-motion/props");
  writeMotionProps(propsDirectory);
  mkdirSync(outputDirectory, {recursive: true});
  const plan = renderPlan(propsDirectory, outputDirectory);
  for (const item of plan) {
    rmSync(item.rawPath, {force: true});
    rmSync(item.finalPath, {force: true});
    execFileSync("npx", ["remotion", "render", "MotionVariant", item.rawPath, `--props=${item.propsPath}`], {cwd: studio, stdio: "inherit"});
    execFileSync("npx", ["remotion", "ffmpeg", "-y", "-i", item.rawPath, "-c", "copy", "-movflags", "+faststart", item.finalPath], {cwd: studio, stdio: "inherit"});
    rmSync(item.rawPath, {force: true});
  }
  return plan.map(({finalPath}) => finalPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rendered = renderMotionVariants(process.argv[2] ? resolve(process.argv[2]) : undefined);
  process.stdout.write(`${JSON.stringify({rendered})}\n`);
}
