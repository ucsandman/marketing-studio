"""costclaw logo reveal: claw+coin mark drawn on in brand clay/rare, 90 frames, alpha.

Geometry sampled from studio/src/brands/CostClawMark.tsx (viewBox 0 0 28 28):
three tapered claw strokes (filled SVG paths -> centerline + per-point bevel
radius sampled from the two bounding bezier walls), a stroked coin ring, and a
dollar sign (vertical bar + one chained-bezier S-curve). Coin ring uses
brand.colors.brand (clay, matches the filled favicon coin); claws + dollar
sign use brand.colors.rare (matches the favicon's claw/glyph color) -
everything else (materials/choreography shape/camera/alpha/args) is the
brand-agnostic noban scene, unchanged.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
BRAND = json.loads((ROOT / "brands" / "costclaw.json").read_text())

FPS = 30
FRAMES = 90
SIZE = 4.0 / 28.0  # svg unit -> blender unit (mark spans 4 units; viewBox is 28)


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_color: str, alpha: float = 1.0):
    h = hex_color.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)) + (
        alpha,
    )


# Depth separation for the coin knockout (judge fix): claws sit BEHIND the
# occluder, which sits behind the ring + dollar sign. The camera is at +Z
# looking toward the origin, so larger z renders in front. Offsets are tiny
# relative to the mark's ~4-unit span - imperceptible as depth, but enough for
# Eevee's z-test to give a deterministic front-to-back order instead of the
# z-fighting all-z=0 geometry had.
CLAW_Z = -0.03
OCCLUDER_Z = 0.0
FRONT_Z = 0.03


def sv(x: float, y: float, z: float = 0.0):
    """Map svg coords (0..28, y down) to scene coords centered at origin, y up."""
    return ((x - 14.0) * SIZE, (14.0 - y) * SIZE, z)


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


def poly_curve(
    name: str, points, cyclic: bool, bevel: float, mat, radii=None
) -> bpy.types.Object:
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"  # noqa: vulture
    curve.bevel_depth = bevel  # noqa: vulture
    curve.bevel_resolution = 6  # noqa: vulture
    curve.use_fill_caps = True  # noqa: vulture
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for i, (pt, (x, y, z)) in enumerate(zip(spline.points, points)):
        pt.co = (x, y, z, 1.0)  # noqa: vulture
        if radii is not None:
            pt.radius = radii[i]  # noqa: vulture
    spline.use_cyclic_u = cyclic  # noqa: vulture
    obj = bpy.data.objects.new(name, curve)
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def circle_points(cx, cy, r, z=0.0, n=64):
    """Closed explicitly (n+1 points, first == last); flat end-caps butt together
    at the join, so this shape stays cyclic-safe for a STROKE ring (no draw-on
    reveal is applied to it beyond bevel_factor_end, same as noban's ring)."""
    return [
        sv(
            cx + r * math.cos(2 * math.pi * i / n),
            cy + r * math.sin(2 * math.pi * i / n),
            z,
        )
        for i in range(n + 1)
    ]


def bezier_point(p0, p1, p2, p3, t):
    mt = 1.0 - t
    x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
    y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
    return (x, y)


def claw_geometry(outer, inner, z=0.0, n=24):
    """outer/inner: each a (P0,P1,P2,P3) cubic in svg coords, both walls of a
    tapered claw stroke, outer running base->tip and inner running tip->base
    (as authored in the SVG path). Returns (points, radii): the centerline
    (midpoint of the two walls at matching t) and the local half-width at each
    sample, base->tip - the taper the SVG fill communicates as a solid shape,
    reconstructed as a per-point bevel radius on an open (non-cyclic) tube so
    bevel_factor_end can still draw it on.

    The claw's true tip (t=1) lands well inside the coin (its centerline is
    only ~3.2 svg units from the coin center, versus the coin's r=6) - the
    approved 2D mark hides that overlap behind a coin-knockout mask rather
    than trimming the path, so here the full untrimmed claw is kept and a
    background disc (see build_scene) occludes the part that falls inside
    the coin instead.
    """
    points, half_widths = [], []
    for i in range(n + 1):
        t = i / n
        ax, ay = bezier_point(*outer, t)
        # inner wall is authored tip->base; reverse the parameter to walk it
        # base->tip in lockstep with the outer wall.
        rx, ry = bezier_point(inner[3], inner[2], inner[1], inner[0], t)
        cx, cy = (ax + rx) / 2.0, (ay + ry) / 2.0
        half_widths.append(math.hypot(ax - rx, ay - ry) / 2.0)
        points.append(sv(cx, cy, z))
    return points, half_widths


def sample_chained_bezier(segments, z=0.0, n_per_segment=8):
    """segments: list of (P0,P1,P2,P3) cubics, each starting where the previous
    ends (as chained SVG "C" commands share their start point)."""
    points = []
    for si, seg in enumerate(segments):
        start = 1 if si > 0 else 0  # skip the duplicate join point
        for i in range(start, n_per_segment + 1):
            t = i / n_per_segment
            points.append(sv(*bezier_point(*seg, t), z))
    return points


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
    # transform; higher strengths clip channels unevenly and hue-shift brand
    # colors. Coin ring = brand.brand (clay, matches the filled favicon coin);
    # claws + dollar sign = brand.rare (matches the favicon's claw/glyph color).
    clay = emission_material("clay", hex_rgba(BRAND["colors"]["brand"]), strength=1.0)
    rare = emission_material("rare", hex_rgba(BRAND["colors"]["rare"]), strength=1.0)
    # coin-knockout occluder (see build_scene note below): opaque, matches the
    # composited page background (always white for this brand), not a graphic
    # color, so it reads as "nothing here" rather than a colored disc.
    bg = emission_material("bg_occluder", hex_rgba(BRAND["colors"]["bg"]), strength=1.0)

    stroke = 0.05  # dollar-sign tube radius in scene units (svg strokeWidth 1.25)
    parent = bpy.data.objects.new("mark", None)
    bpy.context.scene.collection.objects.link(parent)

    # coin ring: stroked circle (cx=14, cy=17.8, r=6 in the 28-unit viewBox),
    # same treatment as noban's ring. FRONT_Z: renders in front of the claws
    # and the coin-knockout occluder (see below).
    ring = poly_curve("ring", circle_points(14, 17.8, 6, z=FRONT_Z), False, 0.055, clay)

    # Coin-knockout occluder: the approved 2D mark (CostClawMark.tsx) masks out
    # the part of each claw that falls inside the coin (r=6.7 mask, just past
    # the ring's outer edge) so claw tips never show inside the ring - only the
    # dollar sign does. Reproduced here as a flat disc, background-colored and
    # opaque, sitting between the claws (behind) and the ring + dollar sign
    # (in front): it hides whatever claw geometry falls under it without
    # needing to trim the claw curves themselves.
    occluder_r = 6.7 * SIZE
    bpy.ops.mesh.primitive_circle_add(
        vertices=64,
        radius=occluder_r,
        fill_type="NGON",
        location=(0.0, 0.0, OCCLUDER_Z),
    )
    occluder = bpy.context.active_object
    occluder.name = "coin_occluder"
    occluder.data.materials.append(bg)
    occluder.parent = parent

    # three claws: filled tapered SVG paths -> centerline + per-point bevel
    # radius (see claw_geometry docstring). bevel_depth=1.0 is a unit reference
    # so bevel_depth * point.radius == the actual per-point radius in scene
    # units; radii below are already svg-half-width * SIZE.
    claw_defs = [
        # left claw: base (4.4,3.4)/(6.8,3.4), tip (10.9,17.1), base cap r=1.2
        (
            ((4.4, 3.4), (4.4, 11.0), (6.8, 15.4), (10.9, 17.1)),
            ((10.9, 17.1), (8.2, 14.4), (6.8, 10.4), (6.8, 3.4)),
            1.2,
        ),
        # middle claw: base (12.9,2.6)/(15.1,2.6), tip (14,14.2), base cap r=1.1
        (
            ((12.9, 2.6), (12.9, 8.3), (13.3, 11.8), (14.0, 14.2)),
            ((14.0, 14.2), (14.7, 11.8), (15.1, 8.3), (15.1, 2.6)),
            1.1,
        ),
        # right claw: base (23.6,3.4)/(21.2,3.4), tip (17.1,17.1), base cap r=1.2
        (
            ((23.6, 3.4), (23.6, 11.0), (21.2, 15.4), (17.1, 17.1)),
            ((17.1, 17.1), (19.8, 14.4), (21.2, 10.4), (21.2, 3.4)),
            1.2,
        ),
    ]
    claws = []
    for i, (outer, inner, base_r) in enumerate(claw_defs):
        points, half_widths = claw_geometry(outer, inner, z=CLAW_Z)
        radii = [w * SIZE for w in half_widths]
        claw = poly_curve(f"claw{i}", points, False, 1.0, rare, radii=radii)
        claws.append(claw)
        # round the flat tube end-cap at the base (the SVG's small arc cap);
        # curve tubes only have flat caps (PLAYBOOK gotcha), so a static
        # sphere fills the join with no extra animation needed.
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=base_r * SIZE, location=points[0], segments=16, ring_count=8
        )
        cap = bpy.context.active_object
        cap.name = f"claw{i}_cap"
        cap.data.materials.append(rare)
        cap.parent = parent

    # dollar sign: vertical bar + one chained-bezier S-curve (6 cubic segments,
    # sampled with sample_chained_bezier), grouped so it can pop in as a unit.
    dollar_group = bpy.data.objects.new("dollar", None)
    bpy.context.scene.collection.objects.link(dollar_group)
    dollar_line = poly_curve(
        "dollar_line",
        [sv(14, 15.2, FRONT_Z), sv(14, 21.8, FRONT_Z)],
        False,
        stroke,
        rare,
    )
    dollar_curve_segments = [
        ((15.9, 16.6), (15.4, 16.0), (14.8, 15.8), (14.0, 15.8)),
        ((14.0, 15.8), (13.0, 15.8), (12.25, 16.35), (12.25, 17.15)),
        ((12.25, 17.15), (12.25, 17.95), (13.1, 18.25), (14.0, 18.45)),
        ((14.0, 18.45), (14.9, 18.65), (15.75, 18.95), (15.75, 19.8)),
        ((15.75, 19.8), (15.75, 20.6), (15.0, 21.1), (14.0, 21.1)),
        ((14.0, 21.1), (13.15, 21.1), (12.5, 20.85), (12.05, 20.3)),
    ]
    dollar_curve = poly_curve(
        "dollar_curve",
        sample_chained_bezier(dollar_curve_segments, z=FRONT_Z),
        False,
        stroke,
        rare,
    )
    dollar_line.data.bevel_factor_end = 1.0  # noqa: vulture
    dollar_curve.data.bevel_factor_end = 1.0  # noqa: vulture
    dollar_line.parent = dollar_group
    dollar_curve.parent = dollar_group

    for obj in [ring, dollar_group, *claws]:
        obj.parent = parent

    # draw-on choreography (30fps): ring first, three claws sweep (staggered,
    # noban's single "square" sweep split across three shapes), dollar sign
    # pops last (noban's dot-pop role).
    keyframe_draw_on(ring, 6, 34)
    for i, claw in enumerate(claws):
        keyframe_draw_on(claw, 14 + i * 4, 52 + i * 4)

    dollar_group.scale = (0.0, 0.0, 0.0)  # noqa: vulture
    dollar_group.keyframe_insert("scale", frame=58)
    dollar_group.scale = (1.0, 1.0, 1.0)  # noqa: vulture
    dollar_group.keyframe_insert("scale", frame=70)

    # subtle 3D settle: parent rotates from an angled pose to straight-on
    # (costclaw's motion voice is restrained - exuberance 0.1 - so the pose is
    # a shallower angle than noban's, and it settles later to land after the
    # dollar-sign pop instead of colliding with it).
    parent.rotation_euler = (0.1, -0.18, 0.0)  # noqa: vulture
    parent.keyframe_insert("rotation_euler", frame=1)
    parent.rotation_euler = (0.0, 0.0, 0.0)  # noqa: vulture
    parent.keyframe_insert("rotation_euler", frame=82)

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
