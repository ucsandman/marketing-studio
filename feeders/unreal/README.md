# feeders/unreal

Headless Unreal Engine 5.8 feeder on the Blender feeder's contract: a Python scene
script, a headless run, `frame_%04d.png` in `--out`. Verified end to end on
2026-09-03 (UE 5.8.2, RTX 3070 Ti): the cube orbit renders 60 frames at 1280x720.

## Usage
```
python feeders/unreal/render.py <scene.py> --out <dir> [--frame N | --animation] [--timeout S] [scene flags...]
```
`UNREAL_PATH` in `.env` points at `UnrealEditor-Cmd.exe`; the default 5.8 install
path is tried when it is unset. Exit codes: 0 frames written, 1 engine error or no
frames, 124 timeout (the whole process tree is killed).

## How a render runs (two engine launches)
1. `-run=pythonscript` runs the scene inside the editor: build the level and the
   LevelSequence in code, queue a Movie Render Queue job, save the queue as a
   manifest and write `<out>/mrq.json`.
2. render.py launches the engine again with `<map> -game -MoviePipelineConfig=<manifest>
   -RenderOffscreen`, which renders the queue and exits by itself. A commandlet cannot
   render MRQ (no PIE, no tick loop); this is Epic's own new-process executor route.

## Scenes
- `scenes/probe.py`: smoke. Proves the commandlet ran the script, forwarded its flags
  and could write to `--out`; leaves `probe.json` with the engine version.
- `scenes/cube_flythrough.py`: the reference scene. Cube, floor, sun, sky atmosphere,
  sky light and a CineCameraActor built in code; a 60-frame keyframed orbit with a
  camera cut; rendered through MRQ. Copy it to start a new scene.

The project at `project/` is a bare `.uproject` with the Python and MRQ plugins on;
`Content/`, `Saved/`, `Intermediate/` and `DerivedDataCache/` are build products
(gitignored) that the scenes recreate.

Gotchas are in docs/PLAYBOOK.md, "Unreal Engine 5.8". Read them before editing a scene.
