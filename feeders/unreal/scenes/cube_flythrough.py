"""Cube orbit flythrough: builds a level (cube, lights, CineCameraActor) in code,
keyframes a 60-frame (2s @ 30fps) camera orbit into a LevelSequence, and renders
it through Movie Render Queue.

Verified end to end on 2026-09-03 against UE 5.8.2 (60 frames, cube framed,
lit). Every comment marked "verified" records a wrong-output bug that was hit on
the way; see docs/PLAYBOOK.md "Unreal Engine 5.8" before changing anything.

`unreal` is imported only inside functions, never at module scope, so this file
stays importable (though not runnable) without an Unreal install.
"""

import argparse
import math
import sys
from pathlib import Path

FPS = 30
FRAME_COUNT = 60  # one full orbit, 0..59
LEVEL_PATH = "/Game/StoryStage/CubeFlythroughLevel"
SEQUENCE_PACKAGE = "/Game/StoryStage"
SEQUENCE_NAME = "CubeFlythroughSequence"


def scene_args() -> list[str]:
    """Flags forwarded by the pythonscript commandlet land in sys.argv[1:].

    # The commandlet does forward them (verified 5.8.2); the raw-command-line
    # fallback stays for other launch modes. Duplicated from scenes/probe.py
    # to keep scenes standalone.
    """
    if len(sys.argv) > 1:
        return sys.argv[1:]
    import unreal

    cmdline = unreal.SystemLibrary.get_command_line()
    marker = Path(__file__).name
    idx = cmdline.find(marker)
    if idx == -1:
        return []
    return cmdline[idx + len(marker) :].split()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--frame", type=int)
    parser.add_argument("--animation", action="store_true")
    return parser.parse_args(argv)


def _spawn_mesh(eas, mesh, location, scale):
    """Spawns `mesh` as a StaticMeshActor.

    EditorActorSubsystem.spawn_actor_from_object returned None for both the
    cube and the floor mesh (engine logged "SpawnActorFromObject. No actor
    was spawned." twice) -- it resolves an editor actor factory that is
    unavailable under -run=pythonscript. spawn_actor_from_class needs no
    factory (it's the path the lights/sky/camera below already use, which is
    why those worked while the meshes silently didn't), so spawn a
    StaticMeshActor by class and assign the mesh to its component instead.
    """
    import unreal

    actor = eas.spawn_actor_from_class(unreal.StaticMeshActor, location)
    comp = actor.get_component_by_class(unreal.StaticMeshComponent)
    comp.set_mobility(unreal.ComponentMobility.MOVABLE)
    comp.set_static_mesh(mesh)
    actor.set_actor_scale3d(scale)
    return actor


def build_level():
    """Builds the cube/light/camera level in code. Returns the camera actor."""
    import unreal

    # Idempotent: the level and sequence are build products of this run, so a
    # previous run's files are removed first (new_level refuses to overwrite,
    # and in a commandlet the asset registry has not scanned them, so
    # EditorAssetLibrary.does_asset_exist answers False; verified 5.8.2).
    content = Path(unreal.Paths.project_content_dir())
    for rel in (
        "StoryStage/CubeFlythroughLevel.umap",
        f"StoryStage/{SEQUENCE_NAME}.uasset",
    ):
        stale = content / rel
        if stale.is_file():
            stale.unlink()
            unreal.log(f"cube_flythrough: removed stale {stale}")
    # The registry indexed those files at startup; make it notice they are gone.
    unreal.AssetRegistryHelpers.get_asset_registry().scan_paths_synchronous(
        [SEQUENCE_PACKAGE], True
    )

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    if not les.new_level(LEVEL_PATH):
        # Registry still holds the stale entry: reuse the level, emptied.
        if not les.load_level(LEVEL_PATH):
            raise RuntimeError(f"new_level and load_level failed for {LEVEL_PATH}")
        for actor in eas.get_all_level_actors():
            eas.destroy_actor(actor)
        unreal.log("cube_flythrough: reused existing level, actors cleared")
    # /Engine/BasicShapes/Plane.Plane loads fine (Plane.uasset is on disk,
    # verified 2026-09-03) -- the bare package path without the object suffix
    # is the one instrumented and confirmed to return a valid StaticMesh in
    # this run's log. The real crash was one line further down: see
    # _spawn_mesh below. # UNVERIFIED: whether the ".Plane"-suffixed form
    # also works was never actually tested, since load_asset was not the bug.
    cube_mesh = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube.Cube")
    plane_mesh = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Plane")
    _spawn_mesh(eas, cube_mesh, unreal.Vector(0, 0, 0), unreal.Vector(1, 1, 1))
    # 200x a 100-unit plane: past a smaller floor's edge the atmosphere below
    # the horizon rendered as a black band across the frame.
    _spawn_mesh(eas, plane_mesh, unreal.Vector(0, 0, -50), unreal.Vector(200, 200, 1))
    # A default DirectionalLight points along +X, i.e. AWAY from the camera's
    # side of the cube; with no sky and no floor that rendered 60 black frames
    # (verified 2026-09-03). Aim the sun down from the camera's side, make it
    # the atmosphere sun, and let the sky light capture that sky.
    sun = eas.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 300))
    sun.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=-45.0, yaw=210.0), False)
    sun_comp = sun.get_component_by_class(unreal.DirectionalLightComponent)
    sun_comp.set_intensity(4.0)
    sun_comp.set_editor_property("atmosphere_sun_light", True)
    eas.spawn_actor_from_class(unreal.SkyAtmosphere, unreal.Vector(0, 0, 0))
    sky = eas.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 0))
    sky.get_component_by_class(unreal.SkyLightComponent).set_editor_property(
        "real_time_capture", True
    )
    camera_actor = eas.spawn_actor_from_class(
        unreal.CineCameraActor, unreal.Vector(400, 0, 100)
    )
    camera_actor.set_actor_rotation(unreal.Rotator(0, 180, 0), False)
    unreal.log(
        "cube_flythrough: level actors = "
        f"{[a.get_class().get_name() for a in eas.get_all_level_actors()]}"
    )
    les.save_current_level()  # the -game render stage loads the map from disk
    return camera_actor


def build_sequence(camera_actor):
    """Creates a LevelSequence asset with a keyframed camera orbit. Returns it."""
    import unreal

    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    sequence = asset_tools.create_asset(
        SEQUENCE_NAME,
        SEQUENCE_PACKAGE,
        unreal.LevelSequence,
        unreal.LevelSequenceFactoryNew(),
    )
    sequence.set_playback_start(0)
    sequence.set_playback_end(FRAME_COUNT)
    sequence.set_display_rate(unreal.FrameRate(FPS, 1))

    binding = sequence.add_possessable(camera_actor)
    transform_track = binding.add_track(unreal.MovieScene3DTransformTrack)
    transform_section = transform_track.add_section()
    transform_section.set_range(0, FRAME_COUNT)

    # A 3D transform section carries nine double channels in this order:
    # location x/y/z, rotation x(roll)/y(pitch)/z(yaw), scale x/y/z.
    # Keys are added in DISPLAY_RATE frames (30 fps here), never tick
    # resolution. `get_channels()` does not exist (UE 5.8.2).
    channels = transform_section.get_channels_by_type(
        unreal.MovieSceneScriptingDoubleChannel
    )
    if len(channels) < 6:
        raise RuntimeError(f"expected 9 transform channels, got {len(channels)}")
    unit = unreal.MovieSceneTimeUnit.DISPLAY_RATE
    radius, height, steps = 400.0, 100.0, 5
    # Pitch down at the cube's centre: with pitch 0 the camera looked over the
    # cube at the horizon and the cube sat cut off at the frame's bottom edge
    # (verified 2026-09-03). Rotator order in the channels is roll, pitch, yaw.
    pitch = -math.degrees(math.atan2(height, radius))
    for i in range(steps + 1):
        frame = unreal.FrameNumber(int(FRAME_COUNT * i / steps))
        angle = 2 * math.pi * i / steps
        x = radius * math.cos(angle)
        y = radius * math.sin(angle)
        yaw = math.degrees(angle) + 180.0
        for ch, value in (
            (channels[0], x),
            (channels[1], y),
            (channels[2], height),
            (channels[3], 0.0),
            (channels[4], pitch),
            (channels[5], yaw),
        ):
            ch.add_key(frame, value, 0.0, unit)

    # Without a camera cut MRQ renders from no camera at all: 60 pure-black
    # frames, exit 0 (verified 2026-09-03). The cut is what picks the camera.
    cut_track = sequence.add_track(unreal.MovieSceneCameraCutTrack)
    cut = cut_track.add_section()
    cut.set_range(0, FRAME_COUNT)
    cut.set_camera_binding_id(sequence.get_binding_id(binding))
    unreal.EditorAssetLibrary.save_loaded_asset(sequence)
    return sequence


def render(sequence, world, out_dir: str, frame: int | None, animation: bool) -> None:
    """Queues `sequence` for Movie Render Queue and hands the render to render.py.

    A commandlet cannot run MRQ (no PIE, no tick loop), so this follows Epic's
    own new-process executor: build the job here, save the queue as a manifest,
    and write <out>/mrq.json. render.py then launches the engine a second time
    with `<map> -game -MoviePipelineConfig=<manifest> -RenderOffscreen`, which
    renders and exits on its own.
    """
    import json
    import unreal

    subsystem = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
    queue = subsystem.get_queue()
    job = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
    # These are UProperty sets on engine objects, read by MRQ, not by this
    # file; vulture cannot see that, hence the noqa markers.
    job.sequence = unreal.SoftObjectPath(sequence.get_path_name())  # noqa: vulture
    job.map = unreal.SoftObjectPath(world.get_path_name())  # noqa: vulture

    config = job.get_configuration()
    out_set = config.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
    out_set.output_directory = unreal.DirectoryPath(str(out_dir))  # noqa: vulture
    out_set.file_name_format = "frame_{frame_number}"  # noqa: vulture
    out_set.output_resolution = unreal.IntPoint(1280, 720)  # noqa: vulture
    out_set.zero_pad_frame_numbers = 4  # noqa: vulture
    out_set.use_custom_frame_rate = True  # noqa: vulture
    out_set.output_frame_rate = unreal.FrameRate(FPS, 1)  # noqa: vulture
    if not animation:
        # End is exclusive: [n, n) makes MRQ error out with zero frames.
        out_set.use_custom_playback_range = True  # noqa: vulture
        out_set.custom_start_frame = frame  # noqa: vulture
        out_set.custom_end_frame = frame + 1  # noqa: vulture

    config.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)
    config.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_PNG)

    ok, manifest = unreal.MoviePipelineEditorLibrary.save_queue_to_manifest_file(queue)
    if not ok:
        raise RuntimeError(
            "MoviePipelineEditorLibrary.save_queue_to_manifest_file failed"
        )
    manifest_abs = unreal.Paths.convert_relative_path_to_full(manifest)
    handoff = {"map": world.get_path_name().split(".")[0], "manifest": manifest_abs}
    (Path(out_dir) / "mrq.json").write_text(json.dumps(handoff, indent=2))
    unreal.log(f"cube_flythrough: queued -> {handoff}")


def main() -> int:
    import unreal

    args = parse_args(scene_args())
    camera_actor = build_level()
    sequence = build_sequence(camera_actor)
    world = unreal.EditorLevelLibrary.get_editor_world()
    render(sequence, world, args.out, args.frame, args.animation)
    return 0


if __name__ == "__main__":
    sys.exit(main())
