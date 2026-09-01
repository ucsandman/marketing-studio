"""postflop logo reveal: the spade mark drawn on as one continuous ink
stroke, 90 frames, alpha.

Geometry only differs from logo_reveal.py (noban): materials, draw-on
choreography, camera, alpha and arg parsing are brand-agnostic and copied
unchanged per PLAYBOOK "Onboarding a new brand" step 6.
"""

import argparse
import json
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
BRAND = json.loads((ROOT / "brands" / "postflop.json").read_text())

FPS = 30
FRAMES = 90
SIZE = 4.0 / 32.0  # svg unit -> blender unit (mark's 32x32 viewBox spans 4 units)

# postflop spade outline, mirrored from PostflopMark.tsx's single <path d="...">
# (viewBox 0 0 32 32). Every segment is stored as a cubic bezier (p0, c1, c2, p1);
# a straight SVG line/v/h command is encoded with c1==p0 and c2==p1, which is an
# exact cubic-bezier reparameterization of that same straight segment (not an
# approximation) so one sampler handles both. The path is ONE closed contour
# that pinches through (16.0, 21.1) to cut the two-legged stem notch -- the
# same point is visited twice by the source SVG's own construction, not a
# sampling artifact.
SPADE_CURVES = [
    ((16.0, 4.5), (13.4, 9.5), (7.5, 12.9), (7.5, 18.0)),
    ((7.5, 18.0), (7.5, 20.9), (9.7, 22.8), (12.3, 22.8)),
    ((12.3, 22.8), (13.7, 22.8), (15.0, 22.2), (16.0, 21.1)),
    ((16.0, 21.1), (17.0, 22.2), (18.3, 22.8), (19.7, 22.8)),
    ((19.7, 22.8), (22.3, 22.8), (24.5, 20.9), (24.5, 18.0)),
    ((24.5, 18.0), (24.5, 12.9), (18.6, 9.5), (16.0, 4.5)),
]
SPADE_LINES = [
    (16.0, 21.1),
    (16.0, 24.5),
    (12.8, 24.5),
    (12.8, 26.3),
    (19.2, 26.3),
    (19.2, 24.5),
    (16.0, 24.5),
    (16.0, 21.1),
]

# sharp cusp at the top point (16, 4.5): run the spline this many points PAST
# its own start so the closing tube swallows both flat end caps instead of
# carving a visible notch (same trap as the DashClaw shield tip / the
# practicalsystems hub's top vertex).
OVERLAP_PTS = 2


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


def _spade_outline(n_curve: int = 12):
    """Sample SPADE_CURVES/SPADE_LINES into a closed svg-coord point loop
    (first point repeated at the end), no overlap, no scene-coord mapping.
    """
    pts = []
    for p0, c1, c2, p1 in SPADE_CURVES[:3]:
        for i in range(n_curve):  # excludes t=1; next segment supplies that point
            t = i / n_curve
            mt = 1 - t
            x = (
                mt**3 * p0[0]
                + 3 * mt**2 * t * c1[0]
                + 3 * mt * t**2 * c2[0]
                + t**3 * p1[0]
            )
            y = (
                mt**3 * p0[1]
                + 3 * mt**2 * t * c1[1]
                + 3 * mt * t**2 * c2[1]
                + t**3 * p1[1]
            )
            pts.append((x, y))
    pts.extend(SPADE_LINES[:-1])  # the straight stem-notch segments (7 points)
    for p0, c1, c2, p1 in SPADE_CURVES[3:]:
        for i in range(n_curve):
            t = i / n_curve
            mt = 1 - t
            x = (
                mt**3 * p0[0]
                + 3 * mt**2 * t * c1[0]
                + 3 * mt * t**2 * c2[0]
                + t**3 * p1[0]
            )
            y = (
                mt**3 * p0[1]
                + 3 * mt**2 * t * c1[1]
                + 3 * mt * t**2 * c2[1]
                + t**3 * p1[1]
            )
            pts.append((x, y))
    pts.append(pts[0])  # close the loop (path already returns to (16, 4.5))
    return pts


def spade_stroke_points(n_curve: int = 12):
    """Outline for the draw-on tube: open spline (see keyframe_draw_on), run
    past its own start so the closing tube swallows both flat end caps at the
    sharp top cusp instead of carving a visible notch (same trap as the
    DashClaw shield tip / the practicalsystems hub's top vertex).
    """
    pts = _spade_outline(n_curve)
    pts += pts[1 : 1 + OVERLAP_PTS]
    return [sv(x, y) for x, y in pts]


STEM_PENTAGON = [(16.0, 21.1), (12.8, 24.5), (12.8, 26.3), (19.2, 26.3), (19.2, 24.5)]


def spade_body_fill_points(n_curve: int = 12):
    """Body-only fill outline (SPADE_CURVES, no stem lines): an ordinary
    closed loop with no self-touching vertex, unlike the full 13-segment
    outline. Closed via use_cyclic_u (fill_curve), no manual closing point.

    Blender 5.1's curve fill (BKE_curve BOTH fill) does NOT correctly
    triangulate the full stroke outline's self-touching pinch at
    (16.0, 21.1) -- rendered proof showed a wrong white wedge cut into one
    side of the stem notch even though the two path halves are geometrically
    symmetric (SVG nonzero-winding fill has no such gap: the pinch is a
    zero-width slit that cancels out, so the true filled mark is fully solid
    body+stem). Splitting into this ordinary body loop plus the stem pentagon
    below sidesteps the self-touching case entirely -- both pieces are plain
    simple polygons any fill algorithm handles correctly, and their shared
    edge at the valley point/rectangle top is invisible (same ink material).
    """
    pts = []
    for p0, c1, c2, p1 in SPADE_CURVES:
        for i in range(n_curve):
            t = i / n_curve
            mt = 1 - t
            x = (
                mt**3 * p0[0]
                + 3 * mt**2 * t * c1[0]
                + 3 * mt * t**2 * c2[0]
                + t**3 * p1[0]
            )
            y = (
                mt**3 * p0[1]
                + 3 * mt**2 * t * c1[1]
                + 3 * mt * t**2 * c2[1]
                + t**3 * p1[1]
            )
            pts.append((x, y))
    return [sv(x, y) for x, y in pts]


def spade_stem_fill_points():
    """Stem fill: the valley point fanned straight to the base rectangle's
    two top corners, fused with the rectangle -- see spade_body_fill_points
    docstring. A plain pentagon, closed via use_cyclic_u."""
    return [sv(x, y) for x, y in STEM_PENTAGON]


def fill_curve(name: str, points, mat) -> bpy.types.Object:
    """Flat filled 2D curve (no bevel tube) -- the solid ink spade that pops
    in after the outline finishes drawing, so the settled mark matches the
    product's real (filled) favicon instead of staying outline-only."""
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "2D"  # noqa: vulture
    curve.fill_mode = "BOTH"  # noqa: vulture
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for pt, (x, y, z) in zip(spline.points, points):
        pt.co = (x, y, z, 1.0)  # noqa: vulture
    spline.use_cyclic_u = True  # noqa: vulture
    obj = bpy.data.objects.new(name, curve)
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def keyframe_draw_on(obj, start: int, end: int) -> None:
    """Animate curve bevel_factor_end 0 -> 1 between start and end frames."""
    curve = obj.data
    curve.bevel_factor_end = 0.0  # noqa: vulture
    curve.keyframe_insert("bevel_factor_end", frame=start)
    curve.bevel_factor_end = 1.0  # noqa: vulture
    curve.keyframe_insert("bevel_factor_end", frame=end)


def keyframe_pop(obj, start: int, end: int) -> None:
    """Animate a mesh/curve's scale 0 -> 1 between start and end frames
    (matches practicalsystems' satellite/eye pop-in precedent)."""
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
    # transform (see logo_reveal.py). The spade is ink drawn on paper -- the
    # brand's yellow token appears only as a filled block later in the
    # Remotion composite, never as mark linework (voice: "yellow appears ONLY
    # as a filled block ... never as ... decoration").
    ink = emission_material("ink", hex_rgba(BRAND["colors"]["ink"]), strength=1.0)

    stroke = 0.05  # tube radius in scene units
    parent = bpy.data.objects.new("mark", None)
    bpy.context.scene.collection.objects.link(parent)

    # cyclic=False: bevel_factor_end reveal requires an open spline;
    # spade_stroke_points already closes the loop (see its docstring).
    spade = poly_curve("spade", spade_stroke_points(), False, stroke, ink)
    spade.parent = parent

    # flat filled spade (body + stem, see their docstrings), same ink material
    # as the outline, that pops in once the stroke finishes drawing -- the
    # product's real mark (favicon, site, workbench) is a solid spade, so an
    # outline-only settle would read as a different mark. Sits under the
    # stroke (both plain ink, so no seam).
    fill_body = fill_curve("spade_fill_body", spade_body_fill_points(), ink)
    fill_stem = fill_curve("spade_fill_stem", spade_stem_fill_points(), ink)
    fill_body.parent = parent
    fill_stem.parent = parent

    # draw-on choreography (30fps): the spade is one continuous ink stroke,
    # drawn in a single pen motion -- postflop's mark is one closed SVG path
    # already pinched through its own stem notch, with no separate parts to
    # stagger (unlike noban's ring/square/ticks/dot or practicalsystems'
    # hub/connectors/satellites/eyes). The fill pops in right after the
    # stroke completes and settles well before the wordmark beat (frame 66).
    keyframe_draw_on(spade, 6, 58)
    keyframe_pop(fill_body, 58, 68)
    keyframe_pop(fill_stem, 58, 68)

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
