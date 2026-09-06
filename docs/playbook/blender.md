# Blender 5.1.2

Read this when: touching the Blender (headless bpy) feeder or its scenes.

## Blender 5.1.2 (headless bpy) — each of these was a silent wrong-output bug
- Scene cleanup: `for obj in list(bpy.data.objects): bpy.data.objects.remove(obj, do_unlink=True)`.
  `scene.collection.objects` MISSES the default cube/light/camera (child collection).
- Emission strength must be 1.0 under `view_transform = 'Standard'`; higher strengths
  clip channels and hue-shift brand colors (violet -> hot pink at 4.0).
- `bevel_factor_end` draw-on animation NO-OPS on cyclic splines: build outlines as
  non-cyclic POLY splines with the first point repeated at the end. AND: the open
  spline's two flat end-caps butt together at the join and can carve a visible notch
  at pointed features — run the spline several points PAST its own start so the
  closing tube swallows both caps (discovered on the DashClaw shield tip).
- Curve tubes have flat end-caps only (no stroke-linecap round equivalent). Reads as
  a chisel at display sizes; if a brand needs round caps, add small spheres at the
  endpoints.
- Keyframe fcurves live at `action.layers[].strips[].channelbags[].fcurves`
  (`Action.fcurves` is gone).
- Seamless texture loops: animate the Wave texture's **Phase Offset** by whole 2*pi
  cycles with LINEAR keys at frame 1 and frame N+1. Animating Mapping location breaks
  the seam (distortion noise is not periodic in the offset).
- Alpha: `film_transparent = True` + PNG RGBA. Engine id: `BLENDER_EEVEE`.
- Always render single-frame proofs (and verify alpha: corner pixel `(0,0,0,0)`)
  before committing to an animation render. Renders were fast on the RTX 3070 Ti
  (~21s for 90 frames, ~96s for 240).
- Long single-process `--animation` runs can HANG mid-sequence (observed: 66 frames
  in ~34s then zero output until killed, frame 67/360). Verified workaround: chunked
  renders — fresh Blender process per ~60 frames (`--start-frame`/`--end-frame`;
  keyframes unchanged, so chunk output is pixel-identical) with a hard timeout
  (`render.py --timeout N`). On Windows the timeout must kill the process TREE
  (`taskkill /T /F`) — killing only the shell/python parent orphans blender.exe, which
  keeps writing frames into the output dir (see build-magnetic-demo-media.mjs).
