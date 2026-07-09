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
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)) + (
        alpha,
    )


def sv(x: float, y: float):
    """Map svg coords (0..32, y down) to scene coords centered at origin, y up."""
    return ((x - 16.0) * SIZE, (16.0 - y) * SIZE, 0.0)


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


def rounded_rect_points(cx, cy, w, h, r, n_arc=12):
    """Sampled rounded-rect outline in svg coords, clockwise from top-left arc end.

    Closed explicitly (first point repeated at the end) rather than via
    use_cyclic_u: Blender 5.1 ignores curve.bevel_factor_end on cyclic
    splines (always renders the full loop), so the draw-on reveal needs an
    open spline with a matching start/end point instead.
    """
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
    pts.append(pts[0])
    return pts


def circle_points(cx, cy, r, n=64):
    """Closed explicitly (n+1 points, first == last); see rounded_rect_points."""
    return [
        sv(
            cx + r * math.cos(2 * math.pi * i / n),
            cy + r * math.sin(2 * math.pi * i / n),
        )
        for i in range(n + 1)
    ]


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
    # NOTE: scene.collection.objects only lists objects linked directly to the
    # master collection; the factory-startup Cube/Light/Camera live one level
    # deeper in a child collection named "Collection", so that loop removed
    # nothing and the default cube/light leaked into every render. Clear
    # bpy.data.objects directly to guarantee a truly empty scene.
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

    # strength=1.0 reproduces the brand hex exactly under the "Standard" view
    # transform; the emission_material() default of 4.0 overexposes/clips the
    # channels unevenly and shifts brand violet #8847ff toward hot pink.
    violet = emission_material(
        "brand", hex_rgba(BRAND["colors"]["brand"]), strength=1.0
    )
    ink = emission_material("ink", hex_rgba(BRAND["colors"]["ink"]), strength=1.0)

    stroke = 0.055  # tube radius in scene units (~1.4 svg units of the 32 box)
    parent = bpy.data.objects.new("mark", None)
    bpy.context.scene.collection.objects.link(parent)

    # cyclic=False: bevel_factor_end reveal requires an open spline (see
    # rounded_rect_points docstring); the point lists already close the loop.
    square = poly_curve(
        "square", rounded_rect_points(16, 16, 29.5, 29.5, 8), False, stroke, violet
    )
    ring = poly_curve("ring", circle_points(16, 16, 8.5), False, stroke, violet)
    ticks = [
        poly_curve(f"tick{i}", [sv(*a), sv(*b)], False, stroke, violet)
        for i, (a, b) in enumerate(
            [
                ((16, 4.5), (16, 9.5)),
                ((16, 22.5), (16, 27.5)),
                ((4.5, 16), (9.5, 16)),
                ((22.5, 16), (27.5, 16)),
            ]
        )
    ]

    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=2.6 * SIZE, location=(0, 0, 0), segments=32, ring_count=16
    )
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

    dot.scale = (0.0, 0.0, 0.0)  # noqa: vulture
    dot.keyframe_insert("scale", frame=52)
    dot.scale = (1.0, 1.0, 1.0)  # noqa: vulture
    dot.keyframe_insert("scale", frame=64)

    # subtle 3D settle: parent rotates from an angled pose to straight-on
    parent.rotation_euler = (0.18, -0.35, 0.0)  # noqa: vulture
    parent.keyframe_insert("rotation_euler", frame=1)
    parent.rotation_euler = (0.0, 0.0, 0.0)  # noqa: vulture
    parent.keyframe_insert("rotation_euler", frame=80)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 85  # noqa: vulture
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
