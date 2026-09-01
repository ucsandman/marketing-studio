"""practicalsystems logo reveal: hub-and-satellites mark drawn on, 90 frames, alpha.

Geometry only differs from logo_reveal.py (noban): materials, draw-on
choreography, camera, alpha and arg parsing are brand-agnostic and copied
unchanged per PLAYBOOK "Onboarding a new brand" step 6.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
BRAND = json.loads((ROOT / "brands" / "practicalsystems.json").read_text())

FPS = 30
FRAMES = 90
SIZE = 4.0 / 24.0  # svg unit -> blender unit (mark's 24x24 viewBox spans 4 units)

# mark geometry, mirrored from studio/src/brands/PracticalSystemsMark.tsx
HUB_R = 4.4
SAT_DIST = 8.6
SAT_R = 2.0
HEX_ANGLES = [90, 150, 210, 270, 330, 30]  # pointy-top hexagon vertices
SATELLITE_ANGLES = [90, 30, 330, 270, 210, 150]
CONNECTOR_INNER = HUB_R + 0.7
CONNECTOR_OUTER = SAT_DIST - SAT_R - 0.4
EYES = [(10.7, 12.0), (13.3, 12.0)]
EYE_R = 0.75

# The hub outline is an open spline whose ends meet at its top vertex (a sharp
# corner): two flat tube caps butted together there carve a visible V-notch, the
# same trap documented on the DashClaw shield tip. Run the spline this many
# points PAST its own start so the closing tube swallows both caps.
OVERLAP_PTS = 2


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_color: str, alpha: float = 1.0):
    h = hex_color.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)) + (
        alpha,
    )


def sv(x: float, y: float):
    """Map svg coords (0..24, y down) to scene coords centered at origin, y up."""
    return ((x - 12.0) * SIZE, (12.0 - y) * SIZE, 0.0)


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


def hex_points(cx: float, cy: float, r: float):
    """Pointy-top hexagon outline in svg coords, closed (first point repeated).

    Vertex order mirrors hexPath() in PracticalSystemsMark.tsx exactly.
    """
    pts = []
    for deg in HEX_ANGLES:
        rad = math.radians(deg)
        pts.append((cx + r * math.cos(rad), cy - r * math.sin(rad)))
    pts.append(pts[0])
    # continue past the start (see OVERLAP_PTS) so the closing tube swallows
    # both end caps at the top vertex instead of carving a notch out of it
    pts += pts[1 : 1 + OVERLAP_PTS]
    return [sv(x, y) for x, y in pts]


def connector_points(deg: float):
    """Straight connector from hub edge to satellite edge, mirrors the tsx's math."""
    rad = math.radians(deg)
    x1 = 12.0 + CONNECTOR_INNER * math.cos(rad)
    y1 = 12.0 - CONNECTOR_INNER * math.sin(rad)
    x2 = 12.0 + CONNECTOR_OUTER * math.cos(rad)
    y2 = 12.0 - CONNECTOR_OUTER * math.sin(rad)
    return [sv(x1, y1), sv(x2, y2)]


def satellite_center(deg: float):
    rad = math.radians(deg)
    return sv(12.0 + SAT_DIST * math.cos(rad), 12.0 - SAT_DIST * math.sin(rad))


def keyframe_draw_on(obj, start: int, end: int) -> None:
    """Animate curve bevel_factor_end 0 -> 1 between start and end frames."""
    curve = obj.data
    curve.bevel_factor_end = 0.0  # noqa: vulture
    curve.keyframe_insert("bevel_factor_end", frame=start)
    curve.bevel_factor_end = 1.0  # noqa: vulture
    curve.keyframe_insert("bevel_factor_end", frame=end)


def keyframe_pop(obj, start: int, end: int) -> None:
    """Animate a mesh's scale 0 -> 1 between start and end frames (satellites/eyes)."""
    obj.scale = (0.0, 0.0, 0.0)  # noqa: vulture
    obj.keyframe_insert("scale", frame=start)
    obj.scale = (1.0, 1.0, 1.0)  # noqa: vulture
    obj.keyframe_insert("scale", frame=end)


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
    # transform (see logo_reveal.py). teal = signal color (satellites +
    # connectors); ink = the white hub, per the brand's "one clear hub, many
    # working agents" voice rule.
    teal = emission_material("brand", hex_rgba(BRAND["colors"]["brand"]), strength=1.0)
    ink = emission_material("ink", hex_rgba(BRAND["colors"]["ink"]), strength=1.0)

    hub_stroke = 0.06
    connector_stroke = 0.045
    parent = bpy.data.objects.new("mark", None)
    bpy.context.scene.collection.objects.link(parent)

    # cyclic=False: bevel_factor_end reveal requires an open spline; hex_points
    # already closes the loop by repeating the first point (see logo_reveal.py).
    hub = poly_curve("hub", hex_points(12, 12, HUB_R), False, hub_stroke, ink)

    connectors = [
        poly_curve(
            f"connector{i}", connector_points(deg), False, connector_stroke, teal
        )
        for i, deg in enumerate(SATELLITE_ANGLES)
    ]

    satellites = []
    for i, deg in enumerate(SATELLITE_ANGLES):
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=6,
            radius=SAT_R * SIZE,
            depth=0.08,
            location=satellite_center(deg),
            rotation=(0.0, 0.0, math.radians(90)),  # pointy-top, matches hex_points
        )
        sat = bpy.context.active_object
        sat.name = f"satellite{i}"
        sat.data.materials.append(teal)
        satellites.append(sat)

    eyes = []
    for i, (ex, ey) in enumerate(EYES):
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=EYE_R * SIZE, location=sv(ex, ey), segments=32, ring_count=16
        )
        eye = bpy.context.active_object
        eye.name = f"eye{i}"
        eye.data.materials.append(ink)
        eyes.append(eye)

    for obj in [hub, *connectors, *satellites, *eyes]:
        obj.parent = parent

    # draw-on choreography (30fps): hub outline first, connectors sweep out
    # staggered, satellites pop in as their connector arrives, eyes pop last.
    keyframe_draw_on(hub, 6, 34)
    for i, connector in enumerate(connectors):
        keyframe_draw_on(connector, 34 + i * 3, 46 + i * 3)
    for i, sat in enumerate(satellites):
        keyframe_pop(sat, 46 + i * 3, 56 + i * 3)
    for eye in eyes:
        keyframe_pop(eye, 74, 84)

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
