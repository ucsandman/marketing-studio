# Unreal Engine 5.8

Read this when: touching the Unreal Engine feeder (feeders/unreal) or its scenes.

## Unreal Engine 5.8 (headless, feeders/unreal) — each verified 2026-09-03 on 5.8.2
- Resolve the executable through `UNREAL_PATH`; public documentation does not assume a
  machine-specific install directory.
- The Epic launcher is a Chromium canvas with no accessibility tree; nothing can drive
  it. The UE entitlement is granted only by accepting the EULA in it once (Wes did).
  After that, `legendary` (pip `legendary-gl`, `legendary auth --import` after copying
  `Saved/Config/WindowsEditor/GameUserSettings.ini` to `Saved/Config/Windows/`) is the
  scripted Epic client.
- 5.8 ships ONE plugin, `MovieRenderPipeline`; the older `MovieRenderPipelineCore` /
  `RenderPasses` / `Editor` names make the engine abort at startup.
- The `-script="..."` value must reach the engine with its own quotes: build the
  command line as a STRING. `subprocess` list quoting doubled them and the commandlet
  answered "-Script argument not specified".
- The commandlet applies C escapes to the `-script` value: `\ue-probe` became
  `\x0e-probe`. Forward slashes only inside it.
- A commandlet cannot render MRQ (no PIE, no tick). Save the queue with
  `MoviePipelineEditorLibrary.save_queue_to_manifest_file` and render it in a second
  `-game -MoviePipelineConfig=<manifest> -RenderOffscreen` launch (Epic's new-process
  executor does the same). `MoviePipelineQueueSubsystem` is the editor subsystem;
  `MoviePipelineQueueEngineSubsystem` is not reachable through `get_editor_subsystem`.
- `EditorActorSubsystem.spawn_actor_from_object` returns None in the commandlet (no
  actor factory): spawn `StaticMeshActor` by class and `set_static_mesh` on its
  component. Lights, sky and cameras spawn by class fine.
- `new_level` refuses an existing path and, in a commandlet, `does_asset_exist`
  answers False for it: unlink the stale `.umap`/`.uasset`, `scan_paths_synchronous`,
  then fall back to `load_level` + destroy actors.
- Transform keys: `section.get_channels_by_type(MovieSceneScriptingDoubleChannel)`
  gives nine channels (loc xyz, rot roll/pitch/yaw, scale xyz); `add_key(frame, value,
  0.0, MovieSceneTimeUnit.DISPLAY_RATE)`. `get_channels()` and `SequenceTimeUnit` do
  not exist.
- No camera cut track = 60 pure-black frames and exit 0. Add `MovieSceneCameraCutTrack`
  with `set_camera_binding_id(sequence.get_binding_id(binding))`.
- MRQ's custom end frame is exclusive: a single frame is `[n, n+1)`; `[n, n)` errors.
- A default DirectionalLight points along +X; with no sky and no floor the picture is
  black. Aim it down (`Rotator(roll=, pitch=-45, yaw=)`, keyword args, positional
  order is roll, pitch, yaw), set `atmosphere_sun_light`, add `SkyAtmosphere`, set the
  SkyLight's `real_time_capture`. A floor 200x the 100-unit plane keeps the black
  below-horizon atmosphere out of frame. Auto exposure stays on for probe scenes.
- Timing on the 3070 Ti: about 45 s per engine boot, so a run is ~2 min of boot for
  ~1 s of rendering a 60-frame 720p orbit. Batch shots per launch, never one per shot.
- Warm-DDC timing, 3041-actor hall, five MRQ jobs in one launch (measured 2026-09-03,
  3070 Ti): 63 s wall for 840 frames at 1920x1080, spatial_sample_count 2. Stage 1
  (build 3041 actors + 5 LevelSequences + save the queue) ~19 s; stage 2 boots `-game`
  in ~14 s then renders at 34-36 ms per output frame. The FIRST job in a queue costs
  ~3x that (108 ms/frame) -- it pays the map load and the shader/PSO warm for all of
  them -- so per-frame cost is only meaningful from job 2 on.
- `CineCameraComponent`'s default filmback is 16:9 Digital Film, 23.76 x 13.365 mm, NOT
  Super 35 (24.89 x 18.67). At 24 mm that is tan(hFOV/2) = 0.4950 and tan(vFOV/2) =
  0.2784, i.e. 52.8 x 31.1 degrees. Assuming Super 35 puts a projected world point ~40
  px off at 1080p, which is enough to make a pixel check sample the wrong rack. Fit it
  from a render before trusting any world-to-image maths: project known actors under
  each preset and keep the one whose predictions land on them.
- A RectLight's local axes rotate with it: after `Rotator(pitch=-90)` its local +X
  points at the floor, local Y runs ACROSS the aisle and local Z runs ALONG it, so a
  40 x 10 cm downlight is `source_height` 40 and `source_width` 10, not the reverse.
- Bare RectLights emit over the whole hemisphere: at 300 cm spacing, 340 cm up, five
  per aisle merged into one blown ribbon. `barn_door_angle` 30 with `barn_door_length`
  20 separates them into discrete pools and throws away most of the hemisphere, so the
  same fixture needs ~2.4x the candelas for the same hall level (15 cd bare read frame
  mean 8.6 of 255; 38 cd behind 30-degree doors read 16).
- Rack-TOP wash from a ceiling light is invisible from an aisle camera at z=150 and
  obvious from a camera that looks down (release rises to z=397, wide sits at z=1400).
  Judge overhead-light spill on the shot that looks down, never on the eye-level one.
- At grazing incidence an in-plane tone border vanishes and depth relief expands: a
  5 cm painted bezel on a rack face 1000 cm down the aisle subtends ~1.3 px, while a
  6 cm mullion standing proud of that face subtends ~11 px and self-shades. Cabinet
  separation in an aisle shot has to be GEOMETRY; a material border renders as a smooth
  light tunnel.
- `set_light_color` takes normalized sRGB, not linear. A light colour is a tint
  multiplier, not a surface albedo: running it through an sRGB-to-linear decode (which
  IS right for `BaseColor`/`EmissiveColor` on a material) darkens and over-saturates it.
- `AssetRegistry.scan_paths_synchronous` on a path whose `.umap`/`.uasset` you just
  unlinked logs `OpenFile failed: ... Failed to open file for reading` and `Package ...
  could not be opened during gathering`. Both are benign and expected in the idempotent
  rebuild; do not chase them.
- `FogInscatteringColor` is DEPRECATED (renamed `FogInscatteringLuminance`) and the
  volumetric switch is `bEnableVolumetricFog`. In Python that is
  `fog_inscattering_luminance` and `enable_volumetric_fog`; the old names fail silently
  through a guarded setter and leave default milk-white kilometre-scale fog.
- Lock auto exposure BEFORE tuning any light: set `auto_exposure_min_brightness ==
  auto_exposure_max_brightness` (with both `override_*` flags) and iterate on
  `auto_exposure_bias`. With auto exposure live the tonemapper renormalises every
  lighting change away and the frame mean parks near 110 whatever you do. Read the lock
  back and log it -- an ignored override looks exactly like a light that did nothing.
- What reads as SIGNAL vs WASH on the dark rack material (#15171c, roughness 0.35, at
  the locked exposure): <=10 lux on a face is indistinguishable from the ceiling-lit
  base, 10-17 lux is the knee, 17-30 lux lifts the face band median by ~78 luminance.
  The agent point light at 90 cd / 220 cm radius put 62 lux on a face 120 cm away
  (face-band median +48 over the no-agent control, 70% of the band above base+15,
  frame R-B +15) -- a wash. 22 cd / 150 cm radius puts 5.3 lux there (+2.0, 21%, R-B
  -8.5, matching the control's -10.2) and the emissive sphere still peaks 245.
- UE's inverse-squared falloff window is `saturate(1 - (d/R)^4)^2`, i.e. EXACTLY zero
  at `d == R`. Setting `attenuation_radius` to the distance you want lit kills it. In
  this hall the aisle half-width and the agent's height are both 120 cm, so R=120 would
  have removed the face wash AND the floor pool together; no (cd, R) pair lights a
  floor pool without lighting an equidistant wall.
- A point light standing 60 cm off a wall cannot be tamed by intensity: it puts
  cd/0.36 lux on it, so anything bright enough to read anywhere reads as a lit wall
  there. Move the LIGHT, not the value -- a mesh and its light are separate Sequencer
  bindings, so the emissive prop can reach the wall while its light holds a standoff.
- A transform key that teleports an actor into frame (park at z=-5000 -> place) renders
  the ARRIVAL frame as a motion-blur smear of the whole travel: the 90 x 2 cm orange
  rule arrived as a blown orange panel over a 220 cm rack face, on the film's cut
  frame. Make it appear by opening its cross-section instead (scale (len, 0, 0) ->
  (len, t, t) at the same position): the only velocity left is the half-thickness, so
  it pops on clean. Cost 176k blown orange pixels -> 947.
- The first frame of a flat-key HOLD still carries half a shutter of the motion that
  stopped on it, so it is NOT identical to the rest: consecutive-frame diff was 0.66
  mean at hold_start -> hold_start+1 and 0.021-0.068 for all 58 frames after, and the
  residual sits on high-contrast edges (median local gradient 29.6 vs the frame's 0.3).
  That is correct shutter behaviour, not a failed key. Assert a hold with the
  consecutive-diff SERIES (flat or converging = fine; growing or structured = broken),
  never with one first-vs-last number. The renderer is DETERMINISTIC -- two launches of
  an unchanged shot came back bit-identical (mean abs diff 0.00) -- so the residual
  during a hold is not noise: it is Lumen's temporal accumulation still converging for
  ~15 frames after the motion stops (0.25 -> 0.03 mean abs against the last frame).
  Expect zero variance, and treat any variance as a real change.
- Scoring a pulse on a rack slit with `max` reads the constant emissive strip beside it
  and never moves; use the MEAN of the box, and only over frames where the camera is
  static (a fixed box stops tracking the rack the moment the camera moves).
