import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PLATFORM_MAP} from './build-postkit.mjs';
import {readPostsManifest} from './lib/posts-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonicalManifestPath = resolve(root, 'out/synthacon/marketing/posts.json');

export function buildPostProps(manifestPath = canonicalManifestPath, outputDirectory = resolve(root, 'props')) {
  const posts = readPostsManifest(manifestPath, Object.keys(PLATFORM_MAP));
  mkdirSync(outputDirectory, {recursive: true});
  return posts.map(({id, direction, headline, caption, light}) => {
    const path = resolve(outputDirectory, `synthacon-post-${id}.json`);
    writeFileSync(path, `${JSON.stringify({brandId: 'synthacon', direction, headline, caption, light}, null, 2)}\n`);
    return path;
  });
}

function main() {
  const manifestPath = process.argv[2] ? resolve(process.argv[2]) : canonicalManifestPath;
  let props;
  try {
    props = buildPostProps(manifestPath);
    if (manifestPath !== canonicalManifestPath) {
      const posts = readPostsManifest(manifestPath, Object.keys(PLATFORM_MAP));
      mkdirSync(dirname(canonicalManifestPath), {recursive: true});
      writeFileSync(canonicalManifestPath, `${JSON.stringify(posts, null, 2)}\n`);
    }
  } catch (error) {
    console.error(`build-synthacon-post-props: ${error.message}`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({manifest: canonicalManifestPath.slice(root.length + 1), props: props.map((path) => path.slice(root.length + 1))})}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
