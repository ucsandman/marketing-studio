// Shared cache-input fingerprint for the record-*-demo.mjs capture scripts.
//
// A capture is reproducible only if all of these are byte-identical to last run:
//   - the PRODUCT repo's committed state (git HEAD) AND its dirty tree
//     (git status --porcelain — an uncommitted change to the product MUST bust
//     the cache, or we'd reuse stale footage of a UI that has since changed)
//   - the capture script's own source (covers viewport, holds, the inline step
//     sequence, curated fixtures, selectors — everything textual in the script)
//   - the resolved capture config (viewport, holds, view metadata) — the knobs
//     that change the rendered footage
//
// If the product repo can't be fingerprinted (path missing / not a git repo) the
// caller must DISABLE caching for that run: we cannot prove the product is
// unchanged, so serving a hit would risk reusing stale footage. gitState reports
// this via head === null.
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {cacheKey} from '../../scripts/lib/cache.mjs';

/** {head, porcelain} for a product repo, or head:null when it can't be resolved. */
export function gitState(repo) {
  if (!repo || !existsSync(repo)) return {head: null, porcelain: null};
  try {
    const opts = {cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']};
    const head = execFileSync('git', ['rev-parse', 'HEAD'], opts).trim();
    const porcelain = execFileSync('git', ['status', '--porcelain'], opts);
    return {head, porcelain};
  } catch {
    return {head: null, porcelain: null}; // not a git repo / git missing
  }
}

/** The named key parts for a capture stage. head === null => caching disabled. */
export function captureKeyParts({repo, scriptPath, config}) {
  const git = gitState(repo);
  return {
    productHead: git.head,
    productPorcelain: git.porcelain,
    captureScript: readFileSync(scriptPath, 'utf8'),
    config,
  };
}

export function captureCacheKey(args) {
  return cacheKey(captureKeyParts(args));
}
