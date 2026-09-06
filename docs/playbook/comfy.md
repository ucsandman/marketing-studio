# ComfyUI

Read this when: touching the ComfyUI feeder (non-load-bearing).

## ComfyUI (non-load-bearing)
- Ports 8000/8188; models live at
  `%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Shared\models\checkpoints` (config:
  `%APPDATA%\Comfy Desktop\shared_model_paths.yaml`). New checkpoints are picked up
  without a restart.
- Workflow graphs are stored JSON with `{{TOKEN}}` placeholders;
  `CheckpointLoaderSimple` outputs: model=0, clip=1, vae=2. Deterministic seeds
  (default 47) make heroes reproducible; `--seed N` re-rolls.
- The fallback is part of the contract: exit 2 + message; `render-statics.mjs` logs
  the procedural fallback. Never make an asset depend on ComfyUI being up.
- The Comfy hero prompt remains visually NoBan-specific (violet, near-black, and no
  green). `--brand` safely namespaces product-owned output but does not retune that
  prompt; other brands should select a procedural fallback until it is parameterized.
