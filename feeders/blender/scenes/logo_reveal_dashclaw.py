"""DashClaw logo reveal: shield mark drawn on in brand orange, 90 frames, alpha.

Geometry is the only thing that differs from scenes/logo_reveal.py (noban): the
shield outline from brand/logo.svg plus its three claw strokes. Materials, camera,
draw-on choreography, alpha and arg parsing are brand-agnostic and unchanged.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
BRAND = json.loads((ROOT / "brands" / "dashclaw.json").read_text())

FPS = 30
FRAMES = 90

# svg unit -> blender unit. The mark's 0..24 viewBox is centered on (12, 12) and
# the shield spans 20 svg units tall; 3.4 scene units keeps it inside the 3.81
# units the 85mm camera sees at z=9, with room for the stroke tube.
SIZE = 3.4 / 20.0
CENTER = 12.0

# svg stroke-width is 0.85 (brand/logo.svg); bevel_depth is a radius, so halve it.
STROKE = 0.425 * SIZE

# points per svg unit when flattening the outline; keeps the draw-on sweep at an
# even speed, because bevel_factor_end advances per spline point, not per length.
DENSITY = 3.0

# The outline is an open spline whose ends meet at the shield's bottom tip. Two
# flat tube caps butted together there carve a V-notch out of the point, so the
# spline is run this many points PAST its own start: the trailing tube then covers
# both caps and the tip renders as a solid miter.
OVERLAP_PTS = 5


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


def cubic_at(p0, c0, c1, p1, t: float):
    """Cubic bezier point at t, in svg coords."""
    u = 1.0 - t
    return (
        u * u * u * p0[0]
        + 3 * u * u * t * c0[0]
        + 3 * u * t * t * c1[0]
        + t**3 * p1[0],
        u * u * u * p0[1]
        + 3 * u * u * t * c0[1]
        + 3 * u * t * t * c1[1]
        + t**3 * p1[1],
    )


def cubic_length(p0, c0, c1, p1, n: int = 32) -> float:
    pts = [cubic_at(p0, c0, c1, p1, i / n) for i in range(n + 1)]
    return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


def flatten_path(segments):
    """Flatten a list of ('L', p0, p1) / ('C', p0, c0, c1, p1) segments to svg points.

    Each segment contributes points proportional to its arc length so the draw-on
    reveal advances at a constant apparent speed. The start point of every segment
    after the first is dropped (it duplicates the previous endpoint).
    """
    out = []
    for seg in segments:
        if seg[0] == "L":
            _, p0, p1 = seg
            n = max(2, round(math.dist(p0, p1) * DENSITY))
            pts = [
                (p0[0] + (p1[0] - p0[0]) * i / n, p0[1] + (p1[1] - p0[1]) * i / n)
                for i in range(n + 1)
            ]
        else:
            _, p0, c0, c1, p1 = seg
            n = max(2, round(cubic_length(p0, c0, c1, p1) * DENSITY))
            pts = [cubic_at(p0, c0, c1, p1, i / n) for i in range(n + 1)]
        out.extend(pts[1:] if out else pts)
    return [sv(x, y) for x, y in out]


def shield_points():
    """brand/logo.svg: M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z

    Traced from the bottom tip clockwise (up the right flank, across the crown,
    down the left flank, back to the tip) so the draw-on closes the loop where it
    started. Built as an OPEN spline whose last point equals its first: Blender 5.1
    ignores bevel_factor_end on cyclic splines, so a closed loop cannot draw on.
    """
    tip = (12.0, 22.0)
    pts = flatten_path(
        [
            # "s8-4 8-10": smooth cubic, first of the path so its c0 is the tip itself
            ("C", tip, tip, (20.0, 18.0), (20.0, 12.0)),
            ("L", (20.0, 12.0), (20.0, 5.0)),  # V5
            ("L", (20.0, 5.0), (12.0, 2.0)),  # l-8-3
            ("L", (12.0, 2.0), (4.0, 5.0)),  # l-8 3
            ("L", (4.0, 5.0), (4.0, 12.0)),  # v7
            ("C", (4.0, 12.0), (4.0, 18.0), (12.0, 22.0), tip),  # c0 6 8 10 8 10
        ]
    )
    # pts[0] == pts[-1] == the tip. Carry on a few points up the right flank so the
    # closing tube swallows both end caps (see OVERLAP_PTS).
    return pts + pts[1 : 1 + OVERLAP_PTS]


def claw_points():
    """The three centered claw strokes, each ordered top -> bottom so the reveal
    reads as a downward swipe."""
    return [[sv(x1, 8.3), sv(x1 + 0.7, 16.1)] for x1 in (9.75, 11.95, 14.15)]


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
    # scene.collection.objects only lists objects linked directly to the master
    # collection; the factory-startup Cube/Light/Camera live one level deeper in a
    # child collection, so clear bpy.data.objects directly for a truly empty scene.
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
    # transform; higher strengths clip channels unevenly and shift the hue.
    orange = emission_material(
        "brand", hex_rgba(BRAND["colors"]["brand"]), strength=1.0
    )

    parent = bpy.data.objects.new("mark", None)
    bpy.context.scene.collection.objects.link(parent)

    shield = poly_curve("shield", shield_points(), False, STROKE, orange)
    claws = [
        poly_curve(f"claw{i}", pts, False, STROKE, orange)
        for i, pts in enumerate(claw_points())
    ]

    for obj in [shield, *claws]:
        obj.parent = parent

    # draw-on choreography (30fps): the shield traces the full outline, then the
    # three claws swipe down in sequence so the strike lands last.
    keyframe_draw_on(shield, 4, 54)
    for i, claw in enumerate(claws):
        keyframe_draw_on(claw, 52 + i * 5, 64 + i * 5)

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
