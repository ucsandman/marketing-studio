"""truckside logo reveal: pickup side-view mark drawn on, 90 frames, alpha."""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
BRAND = json.loads((ROOT / "brands" / "truckside.json").read_text())

FPS = 30
FRAMES = 90
# TrucksideMark viewBox is 0 0 24 24 (same as sidetap); a full-bleed mark spans
# 4 blender units off the 24-unit box.
SIZE = 4.0 / 24.0
CENTER = 12.0  # viewBox 0 0 24 24 -> center at (12, 12)


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_color: str, alpha: float = 1.0):
    h = hex_color.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)) + (
        alpha,
    )


def sv(x: float, y: float):
    """Map svg coords (0..24, y down) to scene coords centered at origin, y up."""
    return ((x - CENTER) * SIZE, (CENTER - y) * SIZE, 0.0)


# default 1.0: higher strengths clip brand hues under the Standard view transform
def emission_material(name: str, color, strength: float = 1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True  # noqa: vulture
    nodes = mat.node_tree.nodes
    nodes.clear()
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color  # noqa: vulture
    em.inputs["Strength"].default_value = strength  # noqa: vulture
    out = nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


def poly_curve(name: str, points, cyclic: bool, bevel: float, mat) -> bpy.types.Object:
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"  # noqa: vulture
    curve.bevel_depth = bevel  # noqa: vulture
    curve.bevel_resolution = 6  # noqa: vulture
    curve.use_fill_caps = True  # noqa: vulture
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for pt, (x, y, z) in zip(spline.points, points):
        pt.co = (x, y, z, 1.0)  # noqa: vulture
    spline.use_cyclic_u = cyclic  # noqa: vulture
    obj = bpy.data.objects.new(name, curve)
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def line_points(x0, y0, x1, y1):
    """Two-point open polyline in svg coords."""
    return [sv(x0, y0), sv(x1, y1)]


def path_points(pairs):
    """Open polyline through svg coord pairs [(x,y), ...]."""
    return [sv(x, y) for x, y in pairs]


def circle_points(cx, cy, r, n_arc=48, overlap=4):
    """Sampled circle outline in svg coords as an OPEN spline.

    Blender 5.1 ignores bevel_factor_end on cyclic splines, so the wheel
    circles are open polylines. Per the PLAYBOOK notch gotcha, run the spline a
    few points PAST its own start (overlap) so the closing tube swallows both
    flat end-caps instead of carving a visible notch at the seam.
    """
    pts = []
    total = n_arc + overlap
    for i in range(total + 1):
        a = -math.pi / 2 + 2 * math.pi * i / n_arc  # start at top, clockwise
        pts.append(sv(cx + r * math.cos(a), cy - r * math.sin(a)))
    return pts


def keyframe_draw_on(obj, start: int, end: int) -> None:
    """Animate curve bevel_factor_end 0 -> 1 between start and end frames."""
    curve = obj.data
    curve.bevel_factor_end = 0.0  # noqa: vulture
    curve.keyframe_insert("bevel_factor_end", frame=start)
    curve.bevel_factor_end = 1.0  # noqa: vulture
    curve.keyframe_insert("bevel_factor_end", frame=end)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--frame", type=int)
    parser.add_argument("--animation", action="store_true")
    return parser.parse_args(argv)


def build_scene() -> None:
    scene = bpy.context.scene
    # Clear bpy.data.objects directly: scene.collection.objects misses the
    # factory Cube/Light/Camera living in a child collection (PLAYBOOK gotcha).
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    scene.render.engine = "BLENDER_EEVEE"  # noqa: vulture
    scene.render.film_transparent = True  # noqa: vulture
    scene.render.resolution_x = 1080  # noqa: vulture
    scene.render.resolution_y = 1080  # noqa: vulture
    scene.render.fps = FPS  # noqa: vulture
    scene.frame_start = 1  # noqa: vulture
    scene.frame_end = FRAMES  # noqa: vulture
    scene.view_settings.view_transform = "Standard"  # noqa: vulture
    scene.render.image_settings.file_format = "PNG"  # noqa: vulture
    scene.render.image_settings.color_mode = "RGBA"  # noqa: vulture

    # strength=1.0 reproduces the brand hex exactly under "Standard"; the mark
    # is the brand green #22c55e (brand color rule: green is the mark).
    brand_mat = emission_material(
        "brand", hex_rgba(BRAND["colors"]["brand"]), strength=1.0
    )

    stroke = 0.06  # tube radius in scene units, matching the mark's monoline weight
    parent = bpy.data.objects.new("mark", None)
    bpy.context.scene.collection.objects.link(parent)

    # Geometry sampled from studio/src/brands/TrucksideMark.tsx (viewBox 24):
    # body silhouette M2.6 15.4 V8.6 H12 V5.6 H16.2 L19.6 9.4 H21.4 V15.4 - the
    # bed floor up over the cab and sloped hood, an open polyline for the reveal.
    body = poly_curve(
        "body",
        path_points(
            [
                (2.6, 15.4),
                (2.6, 8.6),
                (12.0, 8.6),
                (12.0, 5.6),
                (16.2, 5.6),
                (19.6, 9.4),
                (21.4, 9.4),
                (21.4, 15.4),
            ]
        ),
        False,
        stroke,
        brand_mat,
    )
    # chassis line between the wheels: M9.2 15.4 H15.2
    chassis = poly_curve(
        "chassis", line_points(9.2, 15.4, 15.2, 15.4), False, stroke, brand_mat
    )
    # cab window: M13.6 8.6 V7.2 H15.6 L17.6 9.4
    window = poly_curve(
        "window",
        path_points([(13.6, 8.6), (13.6, 7.2), (15.6, 7.2), (17.6, 9.4)]),
        False,
        stroke,
        brand_mat,
    )
    # wheels: circles cx6.9 cy16.4 r2.1 (rear) and cx17.5 cy16.4 r2.1 (front)
    wheel_rear = poly_curve(
        "wheel_rear", circle_points(6.9, 16.4, 2.1), False, stroke, brand_mat
    )
    wheel_front = poly_curve(
        "wheel_front", circle_points(17.5, 16.4, 2.1), False, stroke, brand_mat
    )

    for obj in [body, chassis, window, wheel_rear, wheel_front]:
        obj.parent = parent

    # draw-on choreography (30fps): the body silhouette sweeps first, the chassis
    # joins the wheels, the wheels roll on rear-then-front, the cab window last.
    keyframe_draw_on(body, 6, 46)
    keyframe_draw_on(chassis, 42, 50)
    keyframe_draw_on(wheel_rear, 46, 58)
    keyframe_draw_on(wheel_front, 52, 64)
    keyframe_draw_on(window, 62, 74)

    # subtle 3D settle: parent rotates from an angled pose to straight-on
    parent.rotation_euler = (0.16, -0.32, 0.0)  # noqa: vulture
    parent.keyframe_insert("rotation_euler", frame=1)
    parent.rotation_euler = (0.0, 0.0, 0.0)  # noqa: vulture
    parent.keyframe_insert("rotation_euler", frame=80)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 70  # noqa: vulture  (wider than sidetap's 85: the truck is landscape)
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0.0, 0.0, 9.0)  # noqa: vulture
    bpy.context.scene.collection.objects.link(cam)
    scene.camera = cam  # noqa: vulture


def main() -> None:
    args = parse_args()
    build_scene()
    scene = bpy.context.scene
    if args.animation:
        scene.render.filepath = f"{args.out}/frame_"  # noqa: vulture
        bpy.ops.render.render(animation=True)
    else:
        frame = args.frame or 1
        scene.frame_set(frame)
        scene.render.filepath = f"{args.out}/frame_{frame:04d}.png"  # noqa: vulture
        bpy.ops.render.render(write_still=True)


main()
