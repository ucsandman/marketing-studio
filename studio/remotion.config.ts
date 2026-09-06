/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig(enableTailwind);

// GPU rendering. Measured 2026-09-06 on the 24-core RTX 3070 Ti box, 60 frames each,
// two rounds: LaunchVideo 28-30s -> 6-7s, LogoReveal 30-33s -> 6-8s, stills unchanged
// (browser start dominates). Output is visually identical (mean channel delta about
// 1/255; 0.1% of pixels differ by more than 8, at antialiased edges and grain), not
// byte identical, so SHA-compared refactor proofs must render both sides the same way.
// Chrome for Testing downloads once into studio/node_modules/.remotion (about 685 MB).
// CI has no GPU and would pay that download every run, so it keeps the headless shell.
// Override per call with --chrome-mode / --gl; see docs/playbook/remotion.md.
if (!process.env.CI && process.env.REMOTION_GPU !== '0') {
  Config.setChromeMode('chrome-for-testing');
  Config.setChromiumOpenGlRenderer('angle');
}
