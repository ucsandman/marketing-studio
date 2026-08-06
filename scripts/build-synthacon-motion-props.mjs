import {mkdirSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const copy = {
  A: {headline: "Every synth has a next owner.", caption: "Buy, sell, and rent synthesizers with people who know the difference.", light: false},
  C: {headline: "Whatever shape your setup takes.", caption: "Buy, sell, and rent on the marketplace built only for synthesizers.", light: false},
};

export const motionVariants = ["A", "C"] // Direction B excluded: r5 caption collision, queued as launch-motion-direction-b-caption-fix
  .flatMap((direction) => [
  {brandId: "synthacon", direction, ...copy[direction], formatWidth: 1080, formatHeight: 1920},
  {brandId: "synthacon", direction, ...copy[direction], formatWidth: 1080, formatHeight: 1080},
]);

export function writeMotionProps(outputDirectory = resolve(root, "out/synthacon-motion/props")) {
  mkdirSync(outputDirectory, {recursive: true});
  return motionVariants.map((props) => {
    const path = resolve(outputDirectory, `${props.direction}-${props.formatWidth}x${props.formatHeight}.json`);
    writeFileSync(path, `${JSON.stringify(props, null, 2)}\n`);
    return path;
  });
}

// The canonical base props the matrix/postkit pipeline reads for MotionVariant
// (props/<brand>-motion.json, resolved by scripts/lib/matrix-props.mjs) — always
// Direction A at 1080x1080, with per-platform formatWidth/formatHeight merged in
// at render time.
export function writeCanonicalProps(outputPath = resolve(root, "props", "synthacon-motion.json")) {
  const canonical = motionVariants.find(({direction, formatWidth, formatHeight}) => direction === "A" && formatWidth === 1080 && formatHeight === 1080);
  writeFileSync(outputPath, `${JSON.stringify(canonical, null, 2)}\n`);
  return outputPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const props = writeMotionProps().map((path) => path.slice(root.length + 1));
  const canonical = writeCanonicalProps().slice(root.length + 1);
  process.stdout.write(`${JSON.stringify({props, canonical})}\n`);
}
