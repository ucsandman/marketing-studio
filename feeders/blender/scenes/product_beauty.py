"""Physical product-beauty plate built around a real product image.

The image stays the subject: it is mapped onto a shallow, square-cornered
display slab with neutral studio lighting, a matte brand stage, and a restrained
camera move. No logo sculpture, glow, or particles are added.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scene_utils import (  # noqa: E402
    area_light,
    beveled_box,
    clear_scene,
    configure_render,
    hex_rgba,
    image_material,
    principled_material,
)

FPS = 30
FRAME_COUNT = 120
OUTPUT_SIZE = (1920, 1080)
SUBJECT_X = 1.45
SUBJECT_YAW = 0.0


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--frame", type=int)
    parser.add_argument("--animation", action="store_true")
    parser.add_argument("--brand", required=True)
    parser.add_argument("--plate", required=True, help="real product PNG or JPEG")
    parser.add_argument(
        "--project",
        default=None,
        help="product repo; relative plate paths resolve here and output must stay inside it",
    )
    parser.add_argument("--frame-count", type=int, default=FRAME_COUNT)
    parser.add_argument(
        "--focus",
        default="0,0,1,1",
        help="normalized source crop x,y,width,height (y measured from top)",
    )
    return parser.parse_args(argv)


def _brand(brand_id: str) -> dict:
    path = ROOT / "brands" / f"{brand_id}.json"
    if not path.is_file():
        raise FileNotFoundError(f"brand not found: {path}")
    return json.loads(path.read_text())


def _plate_path(value: str, project: str | None) -> Path:
    path = Path(value)
    project_root = Path(project).resolve() if project else None
    if not path.is_absolute():
        path = (project_root or ROOT) / path
    path = path.resolve()
    if project_root and not path.is_relative_to(project_root):
        raise ValueError(f"product plate must stay inside --project: {path}")
    if not path.is_file() or path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        raise FileNotFoundError(f"product plate must be a PNG or JPEG: {path}")
    return path


def _focus_region(value: str) -> tuple[float, float, float, float]:
    try:
        x, y, width, height = (float(part) for part in value.split(","))
    except (TypeError, ValueError) as exc:
        raise ValueError("--focus must be x,y,width,height") from exc
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1 or y + height > 1:
        raise ValueError("--focus must stay inside normalized source bounds")
    return x, y, width, height


def _add_screen(width: float, height: float, z: float, material, focus):
    bpy.ops.mesh.primitive_plane_add(
        size=2,
        location=(SUBJECT_X, -0.071, z),
        rotation=(math.pi / 2, 0.0, SUBJECT_YAW),
    )
    screen = bpy.context.active_object
    screen.name = "real_product_plate"
    screen.scale = (width / 2, height / 2, 1.0)
    screen.data.materials.append(material)
    x, y, crop_w, crop_h = focus
    uv_layer = screen.data.uv_layers.active.data
    for loop in screen.data.loops:
        uv = uv_layer[loop.index].uv
        uv.x = x + uv.x * crop_w
        uv.y = 1.0 - y - crop_h + uv.y * crop_h
    return screen


def build_scene(args: argparse.Namespace, brand: dict, plate: Path) -> None:
    scene = bpy.context.scene
    out_dir = Path(args.out).resolve()
    if args.project:
        project_root = Path(args.project).resolve()
        if not project_root.is_dir() or not (project_root / ".git").exists():
            raise FileNotFoundError(f"product git worktree not found: {project_root}")
        if not out_dir.is_relative_to(project_root):
            raise ValueError(f"--out must stay inside --project: {out_dir}")
    out_dir.mkdir(parents=True, exist_ok=True)
    clear_scene()
    configure_render(scene, out_dir, *OUTPUT_SIZE, FPS, args.frame_count)

    focus = _focus_region(args.focus)
    plate_mat, image = image_material("product_plate", plate)
    aspect = (image.size[0] * focus[2]) / (image.size[1] * focus[3])
    screen_w = 5.25
    screen_h = screen_w / aspect
    if screen_h > 4.75:
        screen_h = 4.75
        screen_w = screen_h * aspect
    screen_z = 0.58 + screen_h / 2

    stage_mat = principled_material("stage", hex_rgba(brand["colors"]["line"]), 0.7)
    frame_mat = principled_material(
        "frame", hex_rgba(brand["colors"]["ink"]), 0.22, metallic=0.34
    )

    frame = beveled_box(
        "display_body",
        (SUBJECT_X, 0.0, screen_z),
        (screen_w + 0.16, 0.13, screen_h + 0.16),
        frame_mat,
        0.028,
    )
    _add_screen(screen_w, screen_h, screen_z, plate_mat, focus)

    bpy.ops.mesh.primitive_plane_add(size=32, location=(0.0, 0.0, 0.0))
    floor = bpy.context.active_object
    floor.name = "matte_stage"
    floor.data.materials.append(stage_mat)

    frame.rotation_euler[2] = SUBJECT_YAW

    world = bpy.data.worlds.new("studio_world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (
        0.004,
        0.004,
        0.006,
        1.0,
    )
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.12
    scene.world = world

    target = bpy.data.objects.new("product_focus", None)
    target.location = (SUBJECT_X - 0.25, 0.0, screen_z)
    bpy.context.scene.collection.objects.link(target)

    # Large sources make the slab read as a photographed object while keeping
    # the product UI flat, legible, and free of synthetic glow.
    area_light(
        "key_softbox",
        (-3.8, -5.8, 7.6),
        360.0,
        5.8,
        (1.0, 0.95, 0.9),
        target.location,
    )
    area_light(
        "fill_softbox",
        (5.8, -4.0, 3.8),
        80.0,
        4.5,
        (0.82, 0.9, 1.0),
        target.location,
    )
    area_light(
        "edge_strip",
        (4.8, 2.4, 7.2),
        260.0,
        1.2,
        (1.0, 1.0, 1.0),
        target.location,
    )

    cam_data = bpy.data.cameras.new("beauty_camera")
    cam_data.lens = 58
    cam_data.dof.use_dof = True
    cam_data.dof.focus_object = target
    cam_data.dof.aperture_fstop = 5.6
    camera = bpy.data.objects.new("beauty_camera", cam_data)
    camera.location = (-2.4, -15.8, screen_z + 1.05)
    bpy.context.scene.collection.objects.link(camera)
    track = camera.constraints.new(type="TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"
    camera.keyframe_insert("location", frame=1)
    camera.location = (-1.9, -15.2, screen_z + 0.82)
    camera.keyframe_insert("location", frame=args.frame_count)
    scene.camera = camera

    provenance = {
        "brand": brand["id"],
        "source": plate.relative_to(ROOT).as_posix()
        if plate.is_relative_to(ROOT)
        else plate.name,
        "sourcePixels": [int(image.size[0]), int(image.size[1])],
        "outputPixels": list(OUTPUT_SIZE),
        "frameCount": args.frame_count,
        "intent": "real product plate on a deterministic physical studio stage",
    }
    (out_dir / "product-beauty.json").write_text(json.dumps(provenance, indent=2))


def main() -> None:
    args = parse_args()
    brand = _brand(args.brand)
    plate = _plate_path(args.plate, args.project)
    build_scene(args, brand, plate)
    scene = bpy.context.scene
    if args.animation:
        bpy.ops.render.render(animation=True)
    else:
        frame = args.frame or 1
        scene.frame_set(frame)
        scene.render.filepath = str(Path(args.out).resolve() / f"frame_{frame:04d}.png")
        bpy.ops.render.render(write_still=True)


main()
