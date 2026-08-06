# Animation Studio Phase 3 — Blender Feeder (headless wrapper + LogoReveal + background loop)

> **Historical note:** this plan predates the later slim of the studio to
> synthacon-only. References to noban, dashclaw, or paperroute below are
> historical and describe brands that have since been removed from the repo.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless Blender feeder (bpy scene scripts + render wrapper), produce a noban.gg 3D logo reveal and a seamless brand background loop, and composite the reveal into a Remotion LogoReveal composition approved by the user.

**Architecture:** Agent-authored `bpy` scene scripts live in `feeders/blender/scenes/` and are executed by a thin Python wrapper (`feeders/blender/render.py`) that resolves the Blender binary from `.env` (`BLENDER_PATH`) or PATH, runs `blender --background --factory-startup --python <scene> -- --out <dir> [--frame N | --animation]`, and fails loudly if expected output files do not appear. Scenes read brand colors from `brands/noban.json` (single source of truth, no hardcoded brand values). Raw output lands in `assets/noban/<scene>/` (gitignored) as RGBA PNG sequences; a small stage script copies them into `studio/public/noban/` for the Remotion `LogoReveal` template, which plays the sequence over the brand backdrop and springs in the wordmark.

**Tech Stack:** Blender 5.1.2 (verified installed; headless bpy works; engine id `BLENDER_EEVEE`; `scene.render.film_transparent` exists), Python 3 stdlib (wrapper + unittest), Remotion 4.0.486 + zod 4.3.6 (existing studio).

## Global Constraints

- Platform: Windows 11, RTX 3070 Ti. Shell steps are Git Bash (POSIX) unless marked otherwise. Repo root: `C:\Projects\animations`.
- Blender binary resolution: `BLENDER_PATH` from repo `.env` first (currently `C:/Program Files/Blender Foundation/Blender 5.1/blender.exe`), then `shutil.which("blender")`. Never hardcode the path in code; `.env` is gitignored, `.env.example` documents the key.
- Verified probe facts (do not re-derive): engine enum is `['BLENDER_EEVEE']`; `film_transparent` attribute exists; `--python-expr "import bpy"` works headless.
- noban brand values come ONLY from `brands/noban.json` read at scene-build time: brand violet `#8847ff`, profit gold `#d6c23c` NEVER green, bg `#0b0a0f`, ink `#f4f4f6`. Emission-only materials; set `view_transform = 'Standard'` so hex colors are not tone-mapped away.
- Rendered proof protocol (spec): render single frames as PNG and visually inspect BEFORE committing to animation renders. A visual task is not done until the agent inspected a rendered frame.
- Everything fails loudly, exit non-zero; the wrapper must verify expected output files exist after Blender exits.
- `assets/`, `out/`, `studio/public/*/` are gitignored build products. Scene scripts and the wrapper are committed; renders are not.
- Outward copy (template text): no em dashes, no hype words. Smoke check (`node scripts/smoke.mjs`) must stay green and cover every composition.
- Run studio checks from `studio/`: `npm test`, `npm run lint`.

## File Structure (end state of Phase 3)

```
animations/
├── feeders/blender/
│   ├── render.py              # headless wrapper CLI (Task 1)
│   ├── test_render.py         # stdlib unittest for pure helpers (Task 1)
│   └── scenes/
│       ├── probe.py           # 1-frame default-cube health probe (Task 1)
│       ├── logo_reveal.py     # noban scope mark reveal, 90 frames, alpha (Task 2)
│       └── background_loop.py # seamless violet drift loop, 240 frames (Task 3)
├── assets/noban/              # raw PNG sequences (gitignored)
├── scripts/stage-blender-assets.mjs  # assets/noban -> studio/public/noban (Task 4)
├── studio/src/templates/LogoReveal.tsx  # (Task 4)
├── studio/src/Root.tsx        # + LogoReveal registration (Task 4)
└── scripts/smoke.mjs          # + LogoReveal (Task 4)
```

---

### Task 1: Headless render wrapper (`feeders/blender/render.py`)

**Files:**
- Create: `feeders/blender/render.py`
- Create: `feeders/blender/scenes/probe.py`
- Test: `feeders/blender/test_render.py`

**Interfaces:**
- Produces (used by Tasks 2, 3, 5): CLI `python feeders/blender/render.py <scene.py> --out <dir> [--frame N | --animation]`. Exit 0 only if Blender exits 0 AND at least one `frame_*.png` exists in `--out`. Pure helpers (unit tested): `read_env(path: Path) -> dict`, `find_blender(env: dict) -> str | None`, `build_cmd(blender: str, scene: str, out: str, frame: int | None, animation: bool) -> list[str]`.
- Scene contract (implemented by every scene script): parse argv after `--` for `--out DIR` (required), `--frame N` (render single frame N), `--animation` (render the full range); write `frame_%04d.png` into DIR.

- [ ] **Step 1: Write the failing test** — `feeders/blender/test_render.py`

```python
import tempfile
import unittest
from pathlib import Path

from render import build_cmd, find_blender, read_env


class TestHelpers(unittest.TestCase):
    def test_read_env_parses_and_ignores_comments(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / ".env"
            p.write_text("# comment\nBLENDER_PATH=C:/x/blender.exe\nEMPTY_LINE_BELOW=1\n\n")
            env = read_env(p)
        self.assertEqual(env["BLENDER_PATH"], "C:/x/blender.exe")
        self.assertEqual(env["EMPTY_LINE_BELOW"], "1")

    def test_read_env_missing_file_is_empty(self):
        self.assertEqual(read_env(Path("definitely/not/here/.env")), {})

    def test_find_blender_prefers_existing_configured_path(self):
        with tempfile.NamedTemporaryFile(suffix=".exe", delete=False) as f:
            fake = f.name
        self.assertEqual(find_blender({"BLENDER_PATH": fake}), fake)

    def test_find_blender_ignores_missing_configured_path(self):
        # falls through to PATH lookup; result is whatever which() says (str or None)
        result = find_blender({"BLENDER_PATH": "Z:/nope/blender.exe"})
        self.assertNotEqual(result, "Z:/nope/blender.exe")

    def test_build_cmd_single_frame(self):
        cmd = build_cmd("blender.exe", "scenes/x.py", "outdir", frame=45, animation=False)
        self.assertEqual(cmd, [
            "blender.exe", "--background", "--factory-startup",
            "--python", "scenes/x.py", "--",
            "--out", "outdir", "--frame", "45",
        ])

    def test_build_cmd_animation(self):
        cmd = build_cmd("blender.exe", "scenes/x.py", "outdir", frame=None, animation=True)
        self.assertEqual(cmd, [
            "blender.exe", "--background", "--factory-startup",
            "--python", "scenes/x.py", "--",
            "--out", "outdir", "--animation",
        ])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Projects/animations/feeders/blender && python -m unittest test_render -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'render'`.

- [ ] **Step 3: Write `feeders/blender/render.py`**

```python
"""Headless Blender render wrapper: runs a scene script and verifies output.

Usage:
    python feeders/blender/render.py <scene.py> --out <dir> [--frame N | --animation]
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read_env(path: Path) -> dict:
    """Minimal KEY=VALUE .env reader (duplicated from launch.py to keep the feeder standalone)."""
    if not path.is_file():
        return {}
    out = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def find_blender(env: dict) -> str | None:
    configured = env.get("BLENDER_PATH")
    if configured and Path(configured).is_file():
        return configured
    return shutil.which("blender")


def build_cmd(blender: str, scene: str, out: str, frame: int | None, animation: bool) -> list[str]:
    cmd = [blender, "--background", "--factory-startup", "--python", scene, "--", "--out", out]
    if animation:
        cmd.append("--animation")
    else:
        cmd += ["--frame", str(frame)]
    return cmd


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scene", help="path to a bpy scene script")
    parser.add_argument("--out", required=True, help="output directory for frame_%%04d.png")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--frame", type=int, help="render a single frame")
    group.add_argument("--animation", action="store_true", help="render the scene's full range")
    args = parser.parse_args()

    scene = Path(args.scene)
    if not scene.is_file():
        print(f"scene script not found: {scene}", file=sys.stderr)
        return 1

    blender = find_blender(read_env(ROOT / ".env"))
    if not blender:
        print("Blender not found: set BLENDER_PATH in .env or add blender to PATH", file=sys.stderr)
        return 1

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = build_cmd(blender, str(scene), str(out_dir), args.frame, args.animation)
    print("render:", " ".join(cmd))
    proc = subprocess.run(cmd)
    if proc.returncode != 0:
        print(f"blender exited {proc.returncode}", file=sys.stderr)
        return proc.returncode or 1

    frames = sorted(out_dir.glob("frame_*.png"))
    if not frames:
        print(f"blender exited 0 but produced no frame_*.png in {out_dir}", file=sys.stderr)
        return 1
    print(f"render OK: {len(frames)} frame(s) in {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Projects/animations/feeders/blender && python -m unittest test_render -v`
Expected: 6 tests PASS.

- [ ] **Step 5: Write the probe scene** — `feeders/blender/scenes/probe.py`

Renders the factory default cube for 1 frame at 320x240; proves the wrapper + Blender + GPU pipeline end to end without any brand logic.

```python
"""Health probe: renders the factory default cube, 1 frame, 320x240."""

import argparse
import sys

import bpy


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--frame", type=int, default=1)
    parser.add_argument("--animation", action="store_true")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 320
    scene.render.resolution_y = 240
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = f"{args.out}/frame_"
    if args.animation:
        scene.frame_start = 1
        scene.frame_end = 1
        bpy.ops.render.render(animation=True)
    else:
        scene.frame_set(args.frame)
        scene.render.filepath = f"{args.out}/frame_{args.frame:04d}.png"
        bpy.ops.render.render(write_still=True)


main()
```

- [ ] **Step 6: Run the probe end to end and inspect**

```bash
cd /c/Projects/animations
python feeders/blender/render.py feeders/blender/scenes/probe.py --out assets/probe --frame 1
```

Expected: `render OK: 1 frame(s) in assets\probe`, exit 0. Read `assets/probe/frame_0001.png` (Read tool): the default grey cube on a grey world background. Then delete the probe output: `rm -rf assets/probe`.

- [ ] **Step 7: Verify failure paths fail loudly**

```bash
python feeders/blender/render.py feeders/blender/scenes/missing.py --out assets/probe --frame 1; echo "exit=$?"
```

Expected: `scene script not found: ...`, `exit=1`.

- [ ] **Step 8: Commit**

```bash
cd /c/Projects/animations
git add feeders/blender/render.py feeders/blender/test_render.py feeders/blender/scenes/probe.py
git commit -m "feat: headless Blender render wrapper with output verification"
```

---

### Task 2: LogoReveal scene (`feeders/blender/scenes/logo_reveal.py`)

**Files:**
- Create: `feeders/blender/scenes/logo_reveal.py`

**Interfaces:**
- Consumes: wrapper CLI + scene contract (Task 1); `brands/noban.json` colors.
- Produces: 90-frame (30fps, 3s) RGBA PNG sequence, 1080x1080, transparent background: the noban scope mark (rounded-square outline, circle, 4 cross ticks, center dot — same geometry as `studio/src/brands/NobanMark.tsx`, viewBox 0..32) drawn on by curve bevel animation in brand violet emission, with a subtle parent-rotation settle. Task 5 renders it fully; Task 4's template consumes `frame_0001.png .. frame_0090.png`.

- [ ] **Step 1: Write `feeders/blender/scenes/logo_reveal.py`**

The mark is built from POLY curve splines sampled in Python (no interactive ops), beveled into thin tubes, and revealed by animating `bevel_factor_end`. All coordinates derive from the NobanMark SVG (viewBox 32, centered at 16,16), rescaled to a 4-unit box centered at origin in the XY plane; the camera looks down -Z.

```python
"""noban.gg logo reveal: scope mark drawn on in brand violet, 90 frames, alpha."""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
BRAND = json.loads((ROOT / "brands" / "noban.json").read_text())

FPS = 30
FRAMES = 90
SIZE = 4.0 / 32.0  # svg unit -> blender unit (mark spans 4 units)


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_color: str, alpha: float = 1.0):
    h = hex_color.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)) + (alpha,)


def sv(x: float, y: float):
    """Map svg coords (0..32, y down) to scene coords centered at origin, y up."""
    return ((x - 16.0) * SIZE, (16.0 - y) * SIZE, 0.0)


def emission_material(name: str, color, strength: float = 4.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color
    em.inputs["Strength"].default_value = strength
    out = nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


def poly_curve(name: str, points, cyclic: bool, bevel: float, mat) -> bpy.types.Object:
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = bevel
    curve.bevel_resolution = 6
    curve.use_fill_caps = True
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for pt, (x, y, z) in zip(spline.points, points):
        pt.co = (x, y, z, 1.0)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def rounded_rect_points(cx, cy, w, h, r, n_arc=12):
    """Sampled rounded-rect outline in svg coords, clockwise from top-left arc end."""
    pts = []
    corners = [  # (corner center, start angle) going clockwise, svg y-down
        (cx - w / 2 + r, cy - h / 2 + r, math.pi, math.pi / 2),
        (cx + w / 2 - r, cy - h / 2 + r, math.pi / 2, 0.0),
        (cx + w / 2 - r, cy + h / 2 - r, 0.0, -math.pi / 2),
        (cx - w / 2 + r, cy + h / 2 - r, -math.pi / 2, -math.pi),
    ]
    for ccx, ccy, a0, a1 in corners:
        for i in range(n_arc + 1):
            a = a0 + (a1 - a0) * i / n_arc
            pts.append(sv(ccx + r * math.cos(a), ccy - r * math.sin(a)))
    return pts


def circle_points(cx, cy, r, n=64):
    return [sv(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def keyframe_draw_on(obj, start: int, end: int) -> None:
    """Animate curve bevel_factor_end 0 -> 1 between start and end frames."""
    curve = obj.data
    curve.bevel_factor_end = 0.0
    curve.keyframe_insert("bevel_factor_end", frame=start)
    curve.bevel_factor_end = 1.0
    curve.keyframe_insert("bevel_factor_end", frame=end)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--frame", type=int)
    parser.add_argument("--animation", action="store_true")
    return parser.parse_args(argv)


def build_scene() -> None:
    scene = bpy.context.scene
    for obj in list(scene.collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.resolution_x = 1080
    scene.render.resolution_y = 1080
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = FRAMES
    scene.view_settings.view_transform = "Standard"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    violet = emission_material("brand", hex_rgba(BRAND["colors"]["brand"]))
    ink = emission_material("ink", hex_rgba(BRAND["colors"]["ink"]), strength=2.0)

    stroke = 0.055  # tube radius in scene units (~1.4 svg units of the 32 box)
    parent = bpy.data.objects.new("mark", None)
    bpy.context.scene.collection.objects.link(parent)

    square = poly_curve("square", rounded_rect_points(16, 16, 29.5, 29.5, 8), True, stroke, violet)
    ring = poly_curve("ring", circle_points(16, 16, 8.5), True, stroke, violet)
    ticks = [
        poly_curve(f"tick{i}", [sv(*a), sv(*b)], False, stroke, violet)
        for i, (a, b) in enumerate([
            ((16, 4.5), (16, 9.5)),
            ((16, 22.5), (16, 27.5)),
            ((4.5, 16), (9.5, 16)),
            ((22.5, 16), (27.5, 16)),
        ])
    ]

    bpy.ops.mesh.primitive_uv_sphere_add(radius=2.6 * SIZE, location=(0, 0, 0), segments=32, ring_count=16)
    dot = bpy.context.active_object
    dot.name = "dot"
    dot.data.materials.append(ink)

    for obj in [square, ring, dot, *ticks]:
        obj.parent = parent

    # draw-on choreography (30fps): ring first, square sweeps, ticks, dot pops
    keyframe_draw_on(ring, 6, 34)
    keyframe_draw_on(square, 14, 52)
    for i, tick in enumerate(ticks):
        keyframe_draw_on(tick, 34 + i * 4, 46 + i * 4)

    dot.scale = (0.0, 0.0, 0.0)
    dot.keyframe_insert("scale", frame=52)
    dot.scale = (1.0, 1.0, 1.0)
    dot.keyframe_insert("scale", frame=64)

    # subtle 3D settle: parent rotates from an angled pose to straight-on
    parent.rotation_euler = (0.18, -0.35, 0.0)
    parent.keyframe_insert("rotation_euler", frame=1)
    parent.rotation_euler = (0.0, 0.0, 0.0)
    parent.keyframe_insert("rotation_euler", frame=80)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 85
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0.0, 0.0, 9.0)
    bpy.context.scene.collection.objects.link(cam)
    scene.camera = cam


def main() -> None:
    args = parse_args()
    build_scene()
    scene = bpy.context.scene
    if args.animation:
        scene.render.filepath = f"{args.out}/frame_"
        bpy.ops.render.render(animation=True)
    else:
        frame = args.frame or 1
        scene.frame_set(frame)
        scene.render.filepath = f"{args.out}/frame_{frame:04d}.png"
        bpy.ops.render.render(write_still=True)


main()
```

- [ ] **Step 2: Rendered proof, three key frames**

```bash
cd /c/Projects/animations
python feeders/blender/render.py feeders/blender/scenes/logo_reveal.py --out assets/noban/logo-reveal --frame 20
python feeders/blender/render.py feeders/blender/scenes/logo_reveal.py --out assets/noban/logo-reveal --frame 55
python feeders/blender/render.py feeders/blender/scenes/logo_reveal.py --out assets/noban/logo-reveal --frame 90
```

Inspect each PNG (Read tool). Checklist: frame 20 = ring partially drawn, square starting, angled pose; frame 55 = all strokes complete or near, dot appearing, pose nearly straight; frame 90 = complete mark, straight-on, crisp violet strokes, ink dot, TRANSPARENT background (checker/absence, not black). Strokes must read as the scope mark (compare `studio/src/brands/NobanMark.tsx` proportions). Iterate on stroke, timing, or rotation until intentional.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/animations
git add feeders/blender/scenes/logo_reveal.py
git commit -m "feat: noban logo reveal bpy scene with draw-on animation"
```

---

### Task 3: Background loop scene (`feeders/blender/scenes/background_loop.py`)

**Files:**
- Create: `feeders/blender/scenes/background_loop.py`

**Interfaces:**
- Consumes: wrapper CLI + scene contract (Task 1); `brands/noban.json` colors.
- Produces: 240-frame (30fps, 8s) seamless-looping opaque PNG sequence, 1920x1080: near-black brand background with slow-drifting violet wave bands. Seamlessness comes from advancing a periodic wave texture by an exact whole number of wavelengths across the loop with LINEAR interpolation, so frame 241 equals frame 1.

- [ ] **Step 1: Write `feeders/blender/scenes/background_loop.py`**

```python
"""Seamless noban background loop: violet wave drift on near-black, 240 frames."""

import argparse
import json
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
BRAND = json.loads((ROOT / "brands" / "noban.json").read_text())

FPS = 30
FRAMES = 240
DRIFT_PERIODS = 2  # whole wave periods advanced over the loop => seamless


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_color: str, alpha: float = 1.0):
    h = hex_color.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)) + (alpha,)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--frame", type=int)
    parser.add_argument("--animation", action="store_true")
    return parser.parse_args(argv)


def build_scene() -> None:
    scene = bpy.context.scene
    for obj in list(scene.collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = False
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = FRAMES
    scene.view_settings.view_transform = "Standard"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"

    # emissive plane fills the camera; shader mixes bg -> violet by a wave texture
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    plane = bpy.context.active_object

    mat = bpy.data.materials.new("loop")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    coord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    wave = nodes.new("ShaderNodeTexWave")
    ramp = nodes.new("ShaderNodeValToRGB")
    emission = nodes.new("ShaderNodeEmission")
    output = nodes.new("ShaderNodeOutputMaterial")

    wave.wave_type = "BANDS"
    wave.bands_direction = "DIAGONAL"
    wave.inputs["Scale"].default_value = 1.2
    wave.inputs["Distortion"].default_value = 2.4
    wave.inputs["Detail"].default_value = 2.0

    # bg -> faint violet ramp; violet stays subtle (backdrop, not hero)
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = hex_rgba(BRAND["colors"]["bg"])
    ramp.color_ramp.elements[1].position = 1.0
    violet = hex_rgba(BRAND["colors"]["brand"])
    ramp.color_ramp.elements[1].color = (violet[0] * 0.22, violet[1] * 0.22, violet[2] * 0.22, 1.0)

    emission.inputs["Strength"].default_value = 1.0

    links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], wave.inputs["Vector"])
    links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    plane.data.materials.append(mat)

    # seamless drift: advance mapping location by whole wave periods over the loop.
    # wave period in object space = 2*pi/scale; LINEAR interpolation end to end.
    period = 2 * 3.141592653589793 / wave.inputs["Scale"].default_value
    mapping.inputs["Location"].default_value[0] = 0.0
    mapping.inputs["Location"].keyframe_insert("default_value", index=0, frame=1)
    mapping.inputs["Location"].default_value[0] = DRIFT_PERIODS * period
    mapping.inputs["Location"].keyframe_insert("default_value", index=0, frame=FRAMES + 1)
    for fcurve in mat.node_tree.animation_data.action.fcurves:
        for kp in fcurve.keyframe_points:
            kp.interpolation = "LINEAR"

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0.0, 0.0, 5.0)
    bpy.context.scene.collection.objects.link(cam)
    scene.camera = cam


def main() -> None:
    args = parse_args()
    build_scene()
    scene = bpy.context.scene
    if args.animation:
        scene.render.filepath = f"{args.out}/frame_"
        bpy.ops.render.render(animation=True)
    else:
        frame = args.frame or 1
        scene.frame_set(frame)
        scene.render.filepath = f"{args.out}/frame_{frame:04d}.png"
        bpy.ops.render.render(write_still=True)


main()
```

Note: the loop keyframes land on frame 1 and frame `FRAMES + 1` (241). Frame 241 is never rendered; frame 1 equals it exactly, so playing 1..240 on repeat is seamless.

- [ ] **Step 2: Rendered proof including the seam**

```bash
cd /c/Projects/animations
python feeders/blender/render.py feeders/blender/scenes/background_loop.py --out assets/noban/background-loop --frame 1
python feeders/blender/render.py feeders/blender/scenes/background_loop.py --out assets/noban/background-loop --frame 120
python feeders/blender/render.py feeders/blender/scenes/background_loop.py --out assets/noban/background-loop --frame 241
```

Inspect all three (Read tool): near-black with subtle violet diagonal bands (NOT bright, NOT green anywhere); frame 120 visibly different phase from frame 1; **frame 241 visually identical to frame 1** (the seam check). Then byte-compare as a second check: `python -c "print(open('assets/noban/background-loop/frame_0001.png','rb').read() == open('assets/noban/background-loop/frame_0241.png','rb').read())"` — PNG encoding may differ slightly, so identical-looking is the requirement, byte-equality is a bonus. Delete frame_0241 after the check: `rm assets/noban/background-loop/frame_0241.png`.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/animations
git add feeders/blender/scenes/background_loop.py
git commit -m "feat: seamless noban background loop bpy scene"
```

---

### Task 4: LogoReveal Remotion template + stage script + smoke

**Files:**
- Create: `studio/src/templates/LogoReveal.tsx`
- Create: `scripts/stage-blender-assets.mjs`
- Modify: `studio/src/Root.tsx` (register `LogoReveal`)
- Modify: `scripts/smoke.mjs` (add `LogoReveal`)

**Interfaces:**
- Consumes: `getBrand`, `loadBrandFonts`, `NobanMark` (phase 1). PNG sequence contract from Task 2 (`frame_%04d.png`, 90 frames).
- Produces: composition id `LogoReveal`, 150 frames @ 30fps, 1920x1080; `logoRevealSchema = z.object({brandId: z.string(), sequence: z.string().nullable(), frameCount: z.number().int().positive(), cta: z.string()})`. `sequence` is a dir under `studio/public/` (e.g. `noban/logo-reveal`); null renders a static NobanMark placeholder (clean-clone smoke safety).

- [ ] **Step 1: Write `scripts/stage-blender-assets.mjs`**

```js
import {cpSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets', 'noban');
const dest = join(root, 'studio', 'public', 'noban');

if (!existsSync(src)) {
  console.error(`nothing to stage: ${src} does not exist (run the blender feeder first)`);
  process.exit(1);
}
for (const dir of ['logo-reveal', 'background-loop']) {
  const from = join(src, dir);
  if (!existsSync(from)) {
    console.log(`skip ${dir} (not rendered yet)`);
    continue;
  }
  cpSync(from, join(dest, dir), {recursive: true});
  console.log(`staged ${dir}`);
}
```

- [ ] **Step 2: Write `studio/src/templates/LogoReveal.tsx`**

```tsx
import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {z} from 'zod';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {NobanMark} from '../brands/NobanMark';

export const logoRevealSchema = z.object({
  brandId: z.string(),
  sequence: z.string().nullable(),
  frameCount: z.number().int().positive(),
  cta: z.string(),
});

type Props = z.infer<typeof logoRevealSchema>;

export const LogoReveal: React.FC<Props> = ({sequence, frameCount, cta}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand('noban');
  const fonts = loadBrandFonts();
  const seqFrame = Math.min(frame + 1, frameCount); // sequence is 1-indexed
  const wordmarkIn = spring({frame: frame - 66, fps, config: {damping: 200}});
  const ctaIn = interpolate(frame, [96, 110], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(55% 45% at 50% 40%, ${brand.colors.brand}2a, transparent 70%)`,
        }}
      />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', gap: 28}}>
        <div style={{width: 520, height: 520, filter: `drop-shadow(0 0 42px ${brand.colors.brand}66)`}}>
          {sequence ? (
            <Img
              src={staticFile(`${sequence}/frame_${String(seqFrame).padStart(4, '0')}.png`)}
              style={{width: '100%', height: '100%', display: 'block'}}
            />
          ) : (
            <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', position: 'relative'}}>
              <NobanMark size={420} color={brand.colors.brand} />
            </AbsoluteFill>
          )}
        </div>
        <div
          style={{
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: 104,
            color: brand.colors.ink,
            opacity: wordmarkIn,
            transform: `translateY(${(1 - wordmarkIn) * 30}px)`,
          }}
        >
          {brand.name}
        </div>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 32,
            letterSpacing: '0.22em',
            color: brand.colors.profit,
            opacity: ctaIn,
          }}
        >
          {cta.toUpperCase()}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 3: Register in `studio/src/Root.tsx`**

Add the import and composition to the existing fragment:

```tsx
import { LogoReveal, logoRevealSchema } from "./templates/LogoReveal";
```

```tsx
<Composition
  id="LogoReveal"
  component={LogoReveal}
  durationInFrames={150}
  fps={30}
  width={1920}
  height={1080}
  schema={logoRevealSchema}
  defaultProps={{
    brandId: "noban",
    sequence: null,
    frameCount: 90,
    cta: "Simulate free at noban.gg",
  }}
/>
```

- [ ] **Step 4: Add to smoke and verify placeholder**

In `scripts/smoke.mjs`: `const compositions = ['ComponentGallery', 'SocialClip', 'ProductDemo', 'LogoReveal'];`

```bash
cd /c/Projects/animations/studio
npx remotion still LogoReveal ../out/smoke/logo-placeholder.png --frame=100
cd /c/Projects/animations && node scripts/smoke.mjs
```

Inspect the placeholder still: static violet NobanMark, wordmark in, gold CTA (never green), no crash. Smoke: `smoke OK: 4 compositions`.

- [ ] **Step 5: Tests + lint**

Run: `cd /c/Projects/animations/studio && npm test && npm run lint`
Expected: 19 tests pass, lint clean.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/animations
git add studio/src/templates/LogoReveal.tsx studio/src/Root.tsx scripts/stage-blender-assets.mjs scripts/smoke.mjs
git commit -m "feat: LogoReveal composition with staged Blender sequence"
```

---

### Task 5: Full renders + composite + docs (exit criterion)

**Files:**
- Modify: `README.md` (feeder run steps)
- Generated (gitignored): `assets/noban/logo-reveal/*.png` (90), `assets/noban/background-loop/*.png` (240), `studio/public/noban/...`, `out/noban/logo-reveal.mp4`

**Interfaces:**
- Consumes: everything above.
- Produces: `out/noban/logo-reveal.mp4`, reviewed by the user. **Phase exit criterion: user approves the composited logo reveal.**

- [ ] **Step 1: Render both animations** (Eevee on the RTX 3070 Ti; expect roughly 1-3s/frame, so ~2-8 min for the reveal and ~5-15 min for the loop)

```bash
cd /c/Projects/animations
python feeders/blender/render.py feeders/blender/scenes/logo_reveal.py --out assets/noban/logo-reveal --animation
python feeders/blender/render.py feeders/blender/scenes/background_loop.py --out assets/noban/background-loop --animation
```

Expected: `render OK: 90 frame(s)` and `render OK: 240 frame(s)`. Spot-inspect frames 30 and 75 of the reveal for animation defects (tube artifacts, popped keyframes).

- [ ] **Step 2: Stage into the studio**

```bash
node scripts/stage-blender-assets.mjs
```

Expected: `staged logo-reveal`, `staged background-loop`.

- [ ] **Step 3: Render the composite and inspect spot frames**

```bash
cd /c/Projects/animations/studio
npx remotion still LogoReveal ../out/smoke/logo-a.png --frame=30 --props='{"brandId":"noban","sequence":"noban/logo-reveal","frameCount":90,"cta":"Simulate free at noban.gg"}'
npx remotion still LogoReveal ../out/smoke/logo-b.png --frame=80 --props='{"brandId":"noban","sequence":"noban/logo-reveal","frameCount":90,"cta":"Simulate free at noban.gg"}'
npx remotion still LogoReveal ../out/smoke/logo-c.png --frame=130 --props='{"brandId":"noban","sequence":"noban/logo-reveal","frameCount":90,"cta":"Simulate free at noban.gg"}'
npx remotion render LogoReveal ../out/noban/logo-reveal.mp4 --props='{"brandId":"noban","sequence":"noban/logo-reveal","frameCount":90,"cta":"Simulate free at noban.gg"}'
```

Checklist: frame 30 = mark mid-draw over brand bg with violet glow; frame 80 = complete mark, wordmark springing in; frame 130 = full lockup with gold CTA. The Blender strokes must composite cleanly over the backdrop (no black fringe; if fringing appears, the sequence was not rendered with alpha). Iterate until intentional.

- [ ] **Step 4: Update `README.md`**

Under Run (manual equivalents), after the capture line:

```markdown
    python feeders/blender/render.py feeders/blender/scenes/logo_reveal.py --out assets/noban/logo-reveal --animation
    node scripts/stage-blender-assets.mjs     # copy rendered sequences into studio/public/
```

Under Render:

```markdown
    npx remotion render LogoReveal ../out/noban/logo-reveal.mp4 --props='{"brandId":"noban","sequence":"noban/logo-reveal","frameCount":90,"cta":"Simulate free at noban.gg"}'
```

- [ ] **Step 5: Send for user review**

Send `out/noban/logo-reveal.mp4` to the user. **Exit criterion: user approval.** Apply redlines and re-render as needed.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/animations
git add README.md
git commit -m "docs: blender feeder run steps"
```

---

## Self-Review Notes

- **Spec coverage (phase 3 scope):** headless wrapper with output verification (T1), agent-authored bpy scripts (T2, T3), single-frame verification before animation renders (every scene task), LogoReveal template compositing Blender output in Remotion (T4), rendered + user-approved artifact (T5). Background loop is rendered and staged in this phase; it becomes footage for phase 4's LaunchVideo (registering a dedicated background composition now would be YAGNI).
- **Type consistency:** scene contract (`--out`, `--frame`, `--animation`, `frame_%04d.png`) is identical across probe/logo/loop scenes and matches what `render.py` verifies and what `LogoReveal.tsx` consumes (`frame_0001..frame_0090`); `logoRevealSchema` matches the Task 5 props JSON.
- **Known judgment calls:** Eevee over Cycles (emission-only scenes; speed on 8GB VRAM); glow applied in Remotion (CSS drop-shadow) instead of Blender compositor nodes since Eevee in recent Blender removed the bloom toggle; `read_env` deliberately duplicated from `launch.py` to keep the feeder standalone; `brandId` prop accepted but noban resolved directly, consistent with the phase 1 decision until a second brand exists.
- **Risk noted for implementers:** bpy API details (node names, keyframe API) were written against Blender 4/5 conventions and the 5.1 probe facts, but exact enum/attribute names may still drift in 5.1 — if a scene script errors, fix the API call and note it; the scene contract and visual checklist are the requirements, not the exact API line.
