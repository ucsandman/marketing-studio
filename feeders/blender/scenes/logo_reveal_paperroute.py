"""PaperRoute logo reveal: desktop frame + ad slot + underscore drawn on in ledger
green, 90 frames, alpha.

Geometry is the only thing that differs from scenes/logo_reveal.py (noban): the
desktop outline, inner ad-slot rect, and underscore bar traced from
studio/src/brands/PaperRouteMark.tsx's 24x24 viewBox. Materials, camera, draw-on
choreography, alpha and arg parsing are brand-agnostic and unchanged. Per the ONE
GREEN RULE, every stroke uses the brand accent (no separate ink material).
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
BRAND = json.loads((ROOT / "brands" / "paperroute.json").read_text())

FPS = 30
FRAMES = 90

# svg unit -> blender unit. PaperRouteMark's 0..24 viewBox is centered on (12, 12);
# the desktop frame is the widest feature at 19 svg units, and the full mark
# (frame top to underscore) spans ~17.3 units tall. 3.6 scene units for the widest
# span keeps it inside the 3.81 units the 85mm camera sees at z=9, matching the
# noban/dashclaw framing convention.
SIZE = 3.6 / 19.0
CENTER = 12.0

# svg stroke-widths from PaperRouteMark.tsx: frame 1.1, ad slot 0.85, underscore
# 1.4 (bolder, it's a solid cursor bar not an outline). bevel_depth is a radius,
# so halve each.
FRAME_STROKE = 1.1 / 2 * SIZE
SLOT_STROKE = 0.85 / 2 * SIZE
UNDERSCORE_STROKE = 1.4 / 2 * SIZE


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


def frame_points():
    """PaperRouteMark desktop frame: rect x=2.5 y=3.5 w=19 h=13.5 rx=1.8."""
    return rounded_rect_points(12.0, 10.25, 19.0, 13.5, 1.8)


def slot_points():
    """PaperRouteMark measured ad slot: rect x=12.6 y=9.2 w=6.4 h=5.1 rx=0.9."""
    return rounded_rect_points(15.8, 11.75, 6.4, 5.1, 0.9)


def underscore_points():
    """PaperRouteMark earning cursor: path M8.5 20.8 h7 (open segment, round caps)."""
    return [sv(8.5, 20.8), sv(15.5, 20.8)]


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
    # transform; higher strengths clip channels unevenly and shift the hue. ONE
    # GREEN RULE: every stroke is the single brand accent, no second material.
    green = emission_material("brand", hex_rgba(BRAND["colors"]["brand"]), strength=1.0)

    parent = bpy.data.objects.new("mark", None)
    bpy.context.scene.collection.objects.link(parent)

    frame_obj = poly_curve("frame", frame_points(), False, FRAME_STROKE, green)
    slot_obj = poly_curve("slot", slot_points(), False, SLOT_STROKE, green)
    underscore = poly_curve(
        "underscore", underscore_points(), False, UNDERSCORE_STROKE, green
    )

    # underscore is a genuinely open 2-point segment (unlike frame/slot, whose
    # first==last point already closes the loop): curve tubes have flat end-caps
    # only, so add small spheres at both ends to reproduce the svg's
    # stroke-linecap="round" on this bar.
    caps = []
    for i, (x, y, z) in enumerate(underscore_points()):
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=UNDERSCORE_STROKE, location=(x, y, z), segments=16, ring_count=8
        )
        cap = bpy.context.active_object
        cap.name = f"underscore_cap{i}"
        cap.data.materials.append(green)
        caps.append(cap)

    for obj in [frame_obj, slot_obj, underscore, *caps]:
        obj.parent = parent

    # draw-on choreography (30fps): the desktop frame traces first, the smaller
    # ad-slot rect nests inside it next, then the underscore cursor lands last.
    keyframe_draw_on(frame_obj, 4, 46)
    keyframe_draw_on(slot_obj, 40, 66)
    keyframe_draw_on(underscore, 64, 78)

    for cap in caps:
        cap.scale = (0.0, 0.0, 0.0)  # noqa: vulture
        cap.keyframe_insert("scale", frame=72)
        cap.scale = (1.0, 1.0, 1.0)  # noqa: vulture
        cap.keyframe_insert("scale", frame=82)

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
