"""sidetap logo reveal: iPhone outline + terminal caret drawn on, 90 frames, alpha."""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
BRAND = json.loads((ROOT / "brands" / "sidetap.json").read_text())

FPS = 30
FRAMES = 90
# mark's viewBox is 0 0 24 24 (vs noban's 0 0 32 32); keep the same
# svg-units -> blender-units frame coverage as noban (a full-bleed mark
# spans 4 blender units) by scaling off the 24-unit box instead of 32.
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
    # channels unevenly and shifts brand hues.
    brand_mat = emission_material(
        "brand", hex_rgba(BRAND["colors"]["brand"]), strength=1.0
    )

    stroke = 0.055  # tube radius in scene units (~1.4 svg units of the 32 box)
    parent = bpy.data.objects.new("mark", None)
    bpy.context.scene.collection.objects.link(parent)

    # cyclic=False: bevel_factor_end reveal requires an open spline (see
    # rounded_rect_points docstring); the point list already closes the loop.
    # phone body: rounded rect x6.4 y2.2 w11.2 h19.6 rx2.6 -> center (12, 12)
    body = poly_curve(
        "body",
        rounded_rect_points(12.0, 12.0, 11.2, 19.6, 2.6),
        False,
        stroke,
        brand_mat,
    )
    # speaker slot: line (10.6,4.7)-(13.4,4.7)
    speaker = poly_curve(
        "speaker", [sv(10.6, 4.7), sv(13.4, 4.7)], False, stroke, brand_mat
    )
    # terminal caret ">": open polyline (9.4,10.2)-(12,12.3)-(9.4,14.4);
    # the tip at (12, 12.3) is an interior vertex, not a start/end join, so
    # the closed-loop notch gotcha does not apply here.
    caret = poly_curve(
        "caret",
        [sv(9.4, 10.2), sv(12.0, 12.3), sv(9.4, 14.4)],
        False,
        stroke,
        brand_mat,
    )
    # cursor underscore "_": line (13.2,14.4)-(15.4,14.4)
    underscore = poly_curve(
        "underscore", [sv(13.2, 14.4), sv(15.4, 14.4)], False, stroke, brand_mat
    )
    # home indicator: line (10.4,19.3)-(13.6,19.3)
    home = poly_curve(
        "home", [sv(10.4, 19.3), sv(13.6, 19.3)], False, stroke, brand_mat
    )

    for obj in [body, speaker, caret, underscore, home]:
        obj.parent = parent

    # draw-on choreography (30fps): body outline sweeps first, then screen
    # details draw in reading order (speaker -> caret -> underscore -> home).
    keyframe_draw_on(body, 6, 50)
    keyframe_draw_on(speaker, 50, 58)
    keyframe_draw_on(caret, 54, 68)
    keyframe_draw_on(underscore, 66, 74)
    keyframe_draw_on(home, 72, 80)

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
