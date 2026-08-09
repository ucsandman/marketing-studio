"""TenWords logo reveal: pilcrow mark drawn on in brand accent red, 90 frames, alpha.

Geometry sampled from studio/src/brands/TenwordsMark.tsx (viewBox 0 0 24 24): a
filled half-disc bowl (SVG arc `M12.7 2.85 A5.1 5.1 0 0 0 12.7 13 Z`, reconstructed
as a filled NGON from sampled arc points) plus three independent straight strokes
matching the SVG's own three subpaths (`M12 3.6 V20.4` / `M16.4 3.6 V20.4` /
`M12 3.6 H18.2`) - top bar, left stem, right stem each built as their OWN 2-point
poly curve rather than one bent multi-point curve. A bent curve through the
bar/left-stem corner mitered Blender's tube bevel unevenly at the joint (thinner
cross-section, a tilted-looking bar, a visible step where the flat bowl NGON
crossed it); three straight tubes keep a constant bevel radius along their full
length. A small sphere at the shared (12, 3.6) corner gives that join a round cap
(SVG `strokeLinecap="round"`; curve tubes only have flat end-caps, per the
PLAYBOOK), and the bowl gets a Solidify modifier so its flat 2D fill has real Z
depth instead of paper-thin-clipping through the round tubes it overlaps.
Everything else (materials, draw-on choreography shape, camera, alpha, arg
parsing) is the brand-agnostic noban scene, unchanged.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy

ROOT = Path(__file__).resolve().parents[3]
BRAND = json.loads((ROOT / "brands" / "tenwords.json").read_text())

FPS = 30
FRAMES = 90
SIZE = 4.0 / 24.0  # svg unit -> blender unit (mark spans 4 units; viewBox is 24)


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


def filled_polygon(name: str, points, mat) -> bpy.types.Object:
    """Build a flat filled mesh NGON from a closed 2D outline (points already in
    scene coords via sv(); the polygon closes implicitly back to points[0]).

    Object origin is re-centered to the points' centroid (not left at the world
    origin like poly_curve objects) so a 0->1 scale pop grows from the shape's own
    center rather than sliding in from the mark's center - the bowl sits off to one
    side of the mark, unlike noban's dot which is already centered on it.
    """
    n = len(points)
    center = tuple(sum(p[i] for p in points) / n for i in range(3))
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [
        bm.verts.new((p[0] - center[0], p[1] - center[1], p[2] - center[2]))
        for p in points
    ]
    bm.faces.new(verts)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = center  # noqa: vulture
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def sphere_join(name: str, point, radius: float, mat) -> bpy.types.Object:
    """Small sphere at a stroke join point: gives two flat-capped curve tubes that
    meet at a corner a round cap (SVG strokeLinecap="round"), matching the join
    the SVG's overlapping round-capped subpaths produce for free."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = point  # noqa: vulture
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def bowl_points(n=48):
    """Filled half-disc bowl: `M12.7 2.85 A5.1 5.1 0 0 0 12.7 13 Z`. Both arc
    endpoints sit on the vertical line x=12.7 (chord ~= diameter, i.e. a
    semicircle); sweep-flag=0 bulges the arc toward -x (left), matching the
    pilcrow's rounded-left/flat-right bowl. Center + radius are derived from the
    two authored endpoints (not the nominal rx=ry=5.1) so the sampled arc lands
    exactly on the SVG's own points. The straight closing edge (the path's `Z`)
    is implicit: filled_polygon() closes the NGON back to points[0]."""
    top, bottom = (12.7, 2.85), (12.7, 13.0)
    cx, cy = top[0], (top[1] + bottom[1]) / 2.0
    r = (bottom[1] - top[1]) / 2.0
    pts = []
    for i in range(n + 1):
        theta = math.radians(-90.0 - 180.0 * i / n)  # sweeps through 180 deg (-x)
        pts.append(sv(cx + r * math.cos(theta), cy + r * math.sin(theta)))
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
    # transform; higher strengths clip channels unevenly and hue-shift the brand
    # color. The whole pilcrow (bowl + stems + bar) is one color, same as the SVG's
    # single currentColor fill/stroke - the PILCROW RULE reserves accent red for
    # exactly this mark, nothing else.
    red = emission_material("brand", hex_rgba(BRAND["colors"]["brand"]), strength=1.0)

    stroke = 0.75 * SIZE  # tube radius (svg strokeWidth 1.5, radius = half)
    parent = bpy.data.objects.new("mark", None)
    bpy.context.scene.collection.objects.link(parent)

    # top bar, left stem, right stem: three independent straight tubes, matching
    # the SVG's three separate subpaths ("M12 3.6 V20.4" / "M16.4 3.6 V20.4" /
    # "M12 3.6 H18.2") instead of bending one curve through the bar/left-stem
    # corner - a bent multi-point curve miters Blender's tube bevel unevenly at
    # the joint (uneven width, a tilted-looking bar). Both stems share the same
    # `stroke` radius and span y=3.6..20.4 with identical endpoints, so widths
    # and bottoms are guaranteed equal; the bar is a single straight segment at
    # a constant y=3.6, so it is guaranteed level with no corner artifact.
    top_bar = poly_curve("top_bar", [sv(12.0, 3.6), sv(18.2, 3.6)], False, stroke, red)
    left_stem = poly_curve(
        "left_stem", [sv(12.0, 3.6), sv(12.0, 20.4)], False, stroke, red
    )
    right_stem = poly_curve(
        "right_stem", [sv(16.4, 3.6), sv(16.4, 20.4)], False, stroke, red
    )
    # round-cap the shared bar/left-stem corner (both tubes start there with a
    # flat cap; the sphere fills the gap into a clean rounded join).
    corner = sphere_join("bar_stem_join", sv(12.0, 3.6), stroke, red)

    bowl = filled_polygon("bowl", bowl_points(), red)
    # the flat 2D NGON fill has zero Z depth and clips straight through the round
    # bar/left-stem tubes it overlaps near (12..12.7, 2.85..4.35), reading as a
    # visible step; give it real depth matching the tubes' diameter.
    bowl.modifiers.new("thickness", type="SOLIDIFY").thickness = stroke * 2  # noqa: vulture

    for obj in [top_bar, left_stem, right_stem, corner, bowl]:
        obj.parent = parent

    # draw-on choreography (30fps): the bar sweeps in from the corner, the left
    # stem continues down from the same corner right after (both originate at
    # (12, 3.6), same as the old single bent curve's sweep order), the right
    # stem sweeps in behind, then the filled bowl pops in once all strokes land.
    keyframe_draw_on(top_bar, 6, 22)
    keyframe_draw_on(left_stem, 22, 40)
    keyframe_draw_on(right_stem, 20, 50)

    # corner join pops in fast, right as the two tubes start drawing from it -
    # a static sphere would show as a stray dot before frame 6.
    corner.scale = (0.0, 0.0, 0.0)  # noqa: vulture
    corner.keyframe_insert("scale", frame=6)
    corner.scale = (1.0, 1.0, 1.0)  # noqa: vulture
    corner.keyframe_insert("scale", frame=9)

    bowl.scale = (0.0, 0.0, 0.0)  # noqa: vulture
    bowl.keyframe_insert("scale", frame=50)
    bowl.scale = (1.0, 1.0, 1.0)  # noqa: vulture
    bowl.keyframe_insert("scale", frame=64)

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
