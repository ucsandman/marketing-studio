"""Seamless noban background loop: violet wave drift on near-black, 240 frames."""

import argparse
import json
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
BRAND = json.loads((ROOT / "brands" / "noban.json").read_text())

FPS = 30
FRAMES = 240
DRIFT_PERIODS = 3  # whole wave periods advanced over the loop => seamless;
# odd, so the frame-120 midpoint sits at a half-period offset (max contrast
# from frame 1) instead of coincidentally landing back near phase 0


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_color: str, alpha: float = 1.0):
    h = hex_color.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)) + (
        alpha,
    )


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--frame", type=int)
    parser.add_argument("--animation", action="store_true")
    return parser.parse_args(argv)


def build_scene() -> None:
    scene = bpy.context.scene
    # NOTE (Task 2 finding): scene.collection.objects only lists objects linked
    # directly to the master collection; the factory-startup Cube/Light/Camera
    # live one level deeper in a child collection named "Collection", so that
    # loop sees an empty list and removes nothing. Clear bpy.data.objects
    # directly to guarantee a truly empty scene.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    scene.render.engine = "BLENDER_EEVEE"  # noqa: vulture
    scene.render.film_transparent = False  # noqa: vulture
    scene.render.resolution_x = 1920  # noqa: vulture
    scene.render.resolution_y = 1080  # noqa: vulture
    scene.render.fps = FPS  # noqa: vulture
    scene.frame_start = 1  # noqa: vulture
    scene.frame_end = FRAMES  # noqa: vulture
    scene.view_settings.view_transform = "Standard"  # noqa: vulture
    scene.render.image_settings.file_format = "PNG"  # noqa: vulture
    scene.render.image_settings.color_mode = "RGB"  # noqa: vulture

    # emissive plane fills the camera; shader mixes bg -> violet by a wave texture
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    plane = bpy.context.active_object

    mat = bpy.data.materials.new("loop")
    mat.use_nodes = True  # noqa: vulture
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    coord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    wave = nodes.new("ShaderNodeTexWave")
    ramp = nodes.new("ShaderNodeValToRGB")
    emission = nodes.new("ShaderNodeEmission")
    output = nodes.new("ShaderNodeOutputMaterial")

    wave.wave_type = "BANDS"  # noqa: vulture
    wave.bands_direction = "DIAGONAL"  # noqa: vulture
    wave.inputs["Scale"].default_value = 1.2  # noqa: vulture
    wave.inputs["Distortion"].default_value = 2.4  # noqa: vulture
    wave.inputs["Detail"].default_value = 2.0  # noqa: vulture

    # bg -> faint violet ramp; violet stays subtle (backdrop, not hero)
    ramp.color_ramp.elements[0].position = 0.35  # noqa: vulture
    ramp.color_ramp.elements[0].color = hex_rgba(BRAND["colors"]["bg"])  # noqa: vulture
    ramp.color_ramp.elements[1].position = 1.0  # noqa: vulture
    # NOTE: 0.22 (as drafted) looked bright/saturated on render, not subtle -
    # sRGB gamma means a 22%-linear-scaled color still displays at ~50%
    # perceived brightness. 0.08 was tuned by rendering and inspecting frame 1.
    violet = hex_rgba(BRAND["colors"]["brand"])
    ramp.color_ramp.elements[1].color = (  # noqa: vulture
        violet[0] * 0.08,
        violet[1] * 0.08,
        violet[2] * 0.08,
        1.0,
    )

    # strength=1.0 (Task 2 finding): higher emission strength clips brand
    # colors to wrong hues under the "Standard" view transform.
    emission.inputs["Strength"].default_value = 1.0  # noqa: vulture

    links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], wave.inputs["Vector"])
    links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    plane.data.materials.append(mat)

    # seamless drift: advance the Wave node's Phase Offset by whole 2*pi cycles.
    # NOTE (found via rendered seam check): the brief animated mapping.Location
    # instead, on the theory that the wave repeats every 2*pi/scale. That is
    # true for the plain sine band, but Distortion's noise samples the (static)
    # Vector position, not a phase - shifting Location moves the noise sample
    # point too, and Blender's noise has no small-scale period, so frame 241
    # never matched frame 1 exactly (diff up to 65/255 per channel, confirmed
    # by rendering both and comparing). Phase Offset only shifts the sine
    # argument and leaves the Distortion noise field spatially fixed, so
    # advancing it by DRIFT_PERIODS full 2*pi cycles reproduces frame 1's
    # value exactly at frame 241 (diff <= 1/255, i.e. PNG encoding noise only).
    tau = 2 * 3.141592653589793
    wave.inputs["Phase Offset"].default_value = 0.0  # noqa: vulture
    wave.inputs["Phase Offset"].keyframe_insert("default_value", frame=1)
    wave.inputs["Phase Offset"].default_value = DRIFT_PERIODS * tau  # noqa: vulture
    wave.inputs["Phase Offset"].keyframe_insert("default_value", frame=FRAMES + 1)
    # Blender 5.1.2 uses layered actions: Action.fcurves no longer exists
    # (AttributeError). Fcurves live under action.layers[].strips[].channelbags[].
    action = mat.node_tree.animation_data.action
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in strip.channelbags:
                for fcurve in channelbag.fcurves:
                    for kp in fcurve.keyframe_points:
                        kp.interpolation = "LINEAR"  # noqa: vulture

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 50  # noqa: vulture
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0.0, 0.0, 5.0)  # noqa: vulture
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
