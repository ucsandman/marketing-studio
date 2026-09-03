"""DashClaw story-film hall plates: a dark data hall built from primitives.

Ground for shots 1/2/3/5/7 of out/dashclaw/marketing/film-spec.md (direction
NIGHT SHIFT). One level holds the whole hall (6 aisles x 16 racks a side); each
shot is its own LevelSequence and its own Movie Render Queue job, all five in ONE
queue in ONE launch (a launch is two ~45 s engine boots -- batch, never one per
shot). Structure, the two-stage MRQ hand-off, the idempotent level rebuild, the
keyframing and the camera cut are copied from scenes/cube_flythrough.py; read
docs/PLAYBOOK.md "Unreal Engine 5.8" before changing any of it.

Usage:
    render.py scenes/dashclaw_hall.py --out <dir> [--frame N | --animation]
                                      [--shot hall|agent|reach|release|wide|all]

FRAME MAPPING: with `--shot all` (the default) `--frame N` is IGNORED and each
shot renders its own representative frame from REP_FRAME below -- five stills in
one launch is the look-test deliverable, and one N cannot be representative of
five different shot lengths. Name a single shot to render an arbitrary frame of
it. `--animation` always renders each requested shot's full range.

OUTPUT LAYOUT: render.py globs `<out>/frame_*.png` to decide a run produced
anything, so the FIRST requested shot writes into `<out>` itself and every later
shot into `<out>/<shot>/`. All jobs use file_name_format "frame_{frame_number}".
(render.py is the coordinator's file; it will be generalised there, not here.)

`unreal` is imported only inside functions, never at module scope, so this file
stays importable (though not runnable) without an Unreal install.
"""

import argparse
import random
import sys
from pathlib import Path

FPS = 30
RES = (1920, 1080)
LEVEL_PATH = "/Game/StoryStage/DashClawHallLevel"
PACKAGE = "/Game/StoryStage"
MAT_PACKAGE = "/Game/StoryStage/Materials"

SHOTS = ["hall", "agent", "reach", "release", "wide"]
SHOT_LEN = {"hall": 150, "agent": 180, "reach": 120, "release": 150, "wide": 240}
REP_FRAME = {"hall": 120, "agent": 120, "reach": 90, "release": 100, "wide": 120}

# --- look knobs (tuned against rendered stills; see the DONE report) ----------
EXPOSURE_LOCK = 1.0  # auto-exposure min == max == locked EV; 0 auto exposure left
EXPOSURE_BIAS = 0.7  # the single iteration knob once the lock is in
SLIT_EMISSIVE = 5.0  # white rack slits: bright enough to peak, small enough to slit
STRIP_EMISSIVE = 8.0  # the orange rule that draws under the glyph in shot 3
AGENT_EMISSIVE = 10.0  # 12 cm sphere; it has to survive being 12 px wide
LED_EMISSIVE = 3.0  # 2 cm status dot: peaks past 200 without blooming to a blob
LED_OK_EMISSIVE = 2.0  # the 1-in-8 green: the product's own "ok" state, kept dim
# 2000 cd (the spec figure) floods the whole aisle orange through volumetric
# fog: mean 231, rgb (250,230,182). Orange is a SIGNAL in this brand, never a
# wash, so the agent is a small hot core with a short pool instead.
# 90 cd / 220 cm was still a wash: the rack face is 120 cm off the aisle centre,
# so it took 90/1.2^2 = 62 lux, and the measured knee on MI_Surface at this
# locked exposure is 10-17 lux (<=10 lux is indistinguishable from the ceiling-lit
# base; 17-30 lux reads +78 luminance). 22 cd behind a 150 cm radius lands the
# face at 22/1.44 x (1-(120/150)^4)^2 = 5.3 lux -- under the knee.
AGENT_CD = 22.0
# UE's inverse-squared falloff window is saturate(1-(d/R)^4)^2, i.e. EXACTLY zero
# at d == R. AGENT_Z is 120 and FACE_OFF is 120, so the floor under the agent and
# the rack face beside it are equidistant: R = 120 would kill the face wash and
# the floor pool together, and no (cd, R) pair lights one without the other.
# 150 keeps a 90 cm-radius floor pool while holding the face under the knee.
AGENT_RADIUS = 150.0
# Air, not surfaces: volumetric_scattering_intensity adds zero lux to a rack
# face, so it is the one knob that buys back the halo the 90 -> 22 cd cut spent
# (old product 90 x 0.4 = 36; new 22 x 1.2 = 26). Read back below -- a clamp here
# would not raise a _set warning.
AGENT_VOLUMETRIC = 1.2
# The 24 background agents in `wide`. At 72 cd / 220 cm their light tinted whole
# rack faces amber in the finale (film v2, 2026-09-03): a wash the brand forbids.
# Lower and tighter: the spheres stay dots, the pools stay on the floor.
WIDE_CD = 30.0
WIDE_RADIUS = 160.0
WIDE_VOLUMETRIC = 0.24
# Ceiling downlights replace the old per-4th-rack face fills. Those sat 90 cm
# off a rack face at 18 cd = 22 lux, which at this locked exposure is a blown
# white patch (measured: 78-94% of every >200 pixel sat in a >=25 px-wide run).
# The rack faces are left to read by their OWN leds and row slit, which is the
# point of the change. Candelas, not exposure bias, is the lever for hall level:
# bias scales the agent's own pool too (a "keep"), candelas scale only what the
# ROOM lights. The value is high because the barn doors below throw most of the
# hemisphere away -- 15 cd bare left the hall at frame mean 8.6 of 255, and 38 cd
# behind 30 deg doors still only reached 16.
CEIL_CD = 90.0
# A bare RectLight emits over a whole hemisphere, so at 300 cm spacing the five
# pools per aisle merged into one blown ribbon and the light also washed the
# rack TOPS -- invisible from the z=150 aisle cameras, obvious from release's
# z=397. Barn doors are the fixture's own answer: 30 deg clears the aisle floor
# (its far edge is atan(120/340)=19.4 deg off nadir) and cuts the rack tops
# (nearest top edge is 45 deg off nadir), so the pools stay discrete.
CEIL_BARN_ANGLE = 30.0
CEIL_BARN_LENGTH = 20.0
CEIL_RADIUS = 520.0  # 340 cm drop + 240 cm aisle; too short to cross to the next
CEIL_VOLUMETRIC = 0.15
# ~5500 K, cool (#cfd8e6): the only warm light in the hall is the agent. NOT run
# through _linear() -- a light colour is a tint multiplier, not a surface albedo,
# and gamma-decoding it would darken and saturate the tint.
CEIL_COLOR = (0.812, 0.847, 0.902)
CEIL_EVERY = 3  # a downlight every third rack
# The release pulse at 300 cd / 20 cm standoff was 7500 lux -- the blown patch in
# release/frame_0100. Same physics as the fills, so the same fix: back it off and
# stand it off. 1.2 cd at 40 cm = 7.5 lux base, x6 = 45 lux at the pulse peak.
PULSE_CD = 1.2  # release pulse keys this x1 -> x6 -> x1
PULSE_STANDOFF = 40.0
FOG_DENSITY = 0.012  # was 0.20: the fills were most of what it had to scatter
FOG_EXTINCTION = 1.0

# --- hall geometry, centimetres (Unreal units) -------------------------------
RACK = (1.0, 0.6, 2.2)  # 100 x 60 x 220 cm off the 100 cm BasicShapes cube
RACK_LEN, RACK_DEPTH, RACK_H = 100.0, 60.0, 220.0
AISLE_W = 240.0
ROW_OFF = AISLE_W / 2 + RACK_DEPTH / 2  # rack-row centre from the aisle centre
FACE_OFF = AISLE_W / 2  # rack face toward the aisle
AISLE_PITCH = 360.0
N_AISLES = 6
N_RACKS = 16
ROW_SLIT_Z = 190.0  # ONE slim slit per cabinet: the row light the wide reads as a line
CEIL_Z = 350.0
# --- cabinet detail ----------------------------------------------------------
# The aisle shots all sit at y=0 z=150 and look straight down +X, so the rack
# faces at y=+-120 are nearly PARALLEL to the view ray. At that incidence an
# in-plane tone border foreshortens to nothing (a 5 cm bezel at x=1000 subtends
# 0.05 deg ~ 1.3 px) while depth relief EXPANDS (a 6 cm mullion subtends 0.44
# deg ~ 11 px, and self-shades). That asymmetry is exactly why the flush build
# rendered as a smooth light tunnel. So the cabinet boundary is a protruding
# mullion, not a painted frame.
MULLION_D = 6.0  # cm proud of the rack face, into the aisle
MULLION_W = 8.0
LED_SIZE = 0.02  # 2 cm cube
LED_ROWS_Z = (40.0, 65.0, 90.0, 115.0, 140.0, 165.0)
# Columns sit in the DOWNSTREAM half of each cabinet: a 6 cm mullion seen from
# 760 cm hides ~38 cm of the face behind it, and every aisle camera travels +X.
LED_COLS_X = (70.0, 78.0)
LED_OK_EVERY = 8  # 1 in 8 dots is the dim green "ok"
LED_SEED = 47
TILE = 60.0  # raised-floor tile pitch; seams are 1 cm seam cubes, aisle 0 only
TRAY_Z = 300.0  # overhead cable tray: 30 cm wide, 5 cm tall, one per aisle
TRAY_W, TRAY_H = 0.30, 0.05
FLOOR_C = (800.0, 900.0)  # hall centre in x, y
PARK = -5000.0  # actors a shot does not use live here (fog-proof, per advisor)
AGENT_Z = 120.0
TARGET_RACK = 12  # the rack the agent reaches for, row B of aisle 0
TARGET_X = TARGET_RACK * RACK_LEN + RACK_LEN / 2

_KEY_INTERP = None  # None = untested, True = 5-arg LINEAR works, False = 4-arg


def scene_args() -> list[str]:
    """Flags forwarded by the pythonscript commandlet land in sys.argv[1:]."""
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
    parser.add_argument("--shot", default="all", choices=SHOTS + ["all"])
    return parser.parse_args(argv)


def _set(obj, name, value) -> bool:
    """set_editor_property that logs instead of aborting the whole build.

    Every risky UProperty name in this file goes through here: a renamed
    property must show up as one warning in the log, not as a dead launch
    (a launch costs ~2 min of boot).
    """
    import unreal

    try:
        obj.set_editor_property(name, value)
        return True
    except Exception as exc:  # noqa: BLE001 - the point is to survive any of them
        unreal.log_warning(f"dashclaw_hall: set {name} failed: {exc}")
        return False


def _set_enum(obj, prop: str, cls_name: str, member: str) -> bool:
    """_set for an enum value, so a renamed ENUM is also a warning not a crash
    (the lookup itself happens before _set would ever see it)."""
    import unreal

    cls = getattr(unreal, cls_name, None)
    value = getattr(cls, member, None) if cls is not None else None
    if value is None:
        unreal.log_warning(f"dashclaw_hall: enum {cls_name}.{member} missing")
        return False
    return _set(obj, prop, value)


def _linear(hex_color: str):
    """Brand token (sRGB hex) -> unreal.LinearColor. LinearColor IS linear: feed
    it sRGB floats and every surface renders ~3x its token and orange skews
    yellow, which judge-palette would later fail."""
    import unreal

    h = hex_color.lstrip("#")
    parts = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255.0
        parts.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return unreal.LinearColor(parts[0], parts[1], parts[2], 1.0)


def build_materials() -> dict:
    """One master Material with parameters + five MaterialInstanceConstants.

    Five separate Materials would be five full shader permutation sets on a cold
    DDC; instances of one master compile once. Saved assets, not dynamic
    instances: the -game stage reloads the map from disk, so nothing created at
    runtime in the commandlet would survive to the render.
    """
    import unreal

    content = Path(unreal.Paths.project_content_dir())
    mat_dir = content / "StoryStage" / "Materials"
    if mat_dir.is_dir():
        for stale in mat_dir.glob("*.uasset"):
            stale.unlink()
            unreal.log(f"dashclaw_hall: removed stale {stale}")
    unreal.AssetRegistryHelpers.get_asset_registry().scan_paths_synchronous(
        [MAT_PACKAGE], True
    )
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    mel = unreal.MaterialEditingLibrary
    master = tools.create_asset(
        "M_Hall", MAT_PACKAGE, unreal.Material, unreal.MaterialFactoryNew()
    )
    base = mel.create_material_expression(
        master, unreal.MaterialExpressionVectorParameter, -700, 0
    )
    _set(base, "parameter_name", "BaseColor")
    mel.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
    rough = mel.create_material_expression(
        master, unreal.MaterialExpressionScalarParameter, -700, 200
    )
    _set(rough, "parameter_name", "Roughness")
    _set(rough, "default_value", 0.4)
    mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    tint = mel.create_material_expression(
        master, unreal.MaterialExpressionVectorParameter, -1000, 400
    )
    _set(tint, "parameter_name", "EmissiveColor")
    amount = mel.create_material_expression(
        master, unreal.MaterialExpressionScalarParameter, -1000, 600
    )
    _set(amount, "parameter_name", "EmissiveAmount")
    _set(amount, "default_value", 0.0)
    # Emissive = colour * scalar so intensity can exceed 1 without relying on a
    # vector parameter tolerating out-of-range components.
    mul = mel.create_material_expression(
        master, unreal.MaterialExpressionMultiply, -700, 400
    )
    mel.connect_material_expressions(tint, "", mul, "A")
    mel.connect_material_expressions(amount, "", mul, "B")
    mel.connect_material_property(mul, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(master)
    unreal.EditorAssetLibrary.save_loaded_asset(master)

    white = unreal.LinearColor(1.0, 1.0, 1.0, 1.0)
    black = unreal.LinearColor(0.0, 0.0, 0.0, 1.0)
    recipes = {
        # name: (base colour, roughness, emissive tint, emissive amount)
        "MI_Surface": (_linear("#15171c"), 0.35, black, 0.0),
        # A raised-floor tile is matte, and a glossy floor about to reflect 2304
        # emissive dots reads as busy: 0.15 was mirroring the slits into the
        # streaks along the bottom of hall/agent.
        "MI_Floor": (_linear("#0e1014"), 0.45, black, 0.0),
        # Mullions, floor seams and cable tray: one step lighter than the rack
        # body, so a lit edge separates from the face it stands on.
        "MI_Bezel": (_linear("#272b32"), 0.5, black, 0.0),
        "MI_Led": (black, 0.5, white, LED_EMISSIVE),
        "MI_LedOk": (black, 0.5, _linear("#22c55e"), LED_OK_EMISSIVE),
        "MI_Slit": (black, 0.5, white, SLIT_EMISSIVE),
        "MI_Strip": (black, 0.5, _linear("#f97316"), STRIP_EMISSIVE),
        "MI_Agent": (black, 0.5, _linear("#f97316"), AGENT_EMISSIVE),
    }
    mats = {}
    for name, (color, roughness, emis, amt) in recipes.items():
        mic = tools.create_asset(
            name,
            MAT_PACKAGE,
            unreal.MaterialInstanceConstant,
            unreal.MaterialInstanceConstantFactoryNew(),
        )
        mel.set_material_instance_parent(mic, master)
        mel.set_material_instance_vector_parameter_value(mic, "BaseColor", color)
        mel.set_material_instance_scalar_parameter_value(mic, "Roughness", roughness)
        mel.set_material_instance_vector_parameter_value(mic, "EmissiveColor", emis)
        mel.set_material_instance_scalar_parameter_value(mic, "EmissiveAmount", amt)
        unreal.EditorAssetLibrary.save_loaded_asset(mic)
        mats[name] = mic
    unreal.log(f"dashclaw_hall: materials via MaterialEditingLibrary = {list(mats)}")
    return mats


def _spawn_mesh(eas, mesh, location, scale, material=None, rotation=None):
    """StaticMeshActor by class + set_static_mesh: spawn_actor_from_object
    returns None under -run=pythonscript (no actor factory). See PLAYBOOK."""
    import unreal

    actor = eas.spawn_actor_from_class(unreal.StaticMeshActor, location)
    comp = actor.get_component_by_class(unreal.StaticMeshComponent)
    comp.set_mobility(unreal.ComponentMobility.MOVABLE)
    comp.set_static_mesh(mesh)
    if material is not None:
        comp.set_material(0, material)
    actor.set_actor_scale3d(scale)
    if rotation is not None:
        actor.set_actor_rotation(rotation, False)
    return actor


def _spawn_point_light(eas, location, color, candelas, radius, volumetric, shadows):
    import unreal

    light = eas.spawn_actor_from_class(unreal.PointLight, location)
    comp = light.get_component_by_class(unreal.PointLightComponent)
    comp.set_mobility(unreal.ComponentMobility.MOVABLE)
    _set_enum(comp, "intensity_units", "LightUnits", "CANDELAS")
    comp.set_intensity(candelas)
    comp.set_light_color(color)
    _set(comp, "attenuation_radius", radius)
    _set(comp, "cast_shadows", shadows)
    _set(comp, "volumetric_scattering_intensity", volumetric)
    # Read back: a silently CLAMPED float (this one is a candidate for a 0..1
    # clamp) leaves set_editor_property happy and _set silent.
    try:
        got = comp.get_editor_property("volumetric_scattering_intensity")
        if abs(float(got) - float(volumetric)) > 1e-3:
            unreal.log_warning(
                f"dashclaw_hall: volumetric_scattering_intensity asked "
                f"{volumetric} got {got}"
            )
    except Exception as exc:  # noqa: BLE001
        unreal.log_warning(f"dashclaw_hall: volumetric readback failed: {exc}")
    return light


def _spawn_ceiling_light(eas, location, color, candelas):
    """A RectLight aimed straight down: light pools on the floor instead of
    flooding a rack face.

    Rotator args are keyword because the positional order is (roll, pitch, yaw).
    After pitch -90 the light's local +X points at the floor, its local Y runs
    ACROSS the aisle and its local Z runs ALONG it -- so the 40 cm long axis is
    source_height and the 10 cm short axis is source_width, not the other way
    round. Shadows are off deliberately: 30 shadow-casting area lights buy
    nothing here (CEIL_RADIUS is too short to reach the next aisle) and cost a
    lot of a launch budget.
    """
    import unreal

    light = eas.spawn_actor_from_class(unreal.RectLight, location)
    light.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=-90.0, yaw=0.0), False)
    comp = light.get_component_by_class(unreal.RectLightComponent)
    comp.set_mobility(unreal.ComponentMobility.MOVABLE)
    _set_enum(comp, "intensity_units", "LightUnits", "CANDELAS")
    comp.set_intensity(candelas)
    comp.set_light_color(color)
    _set(comp, "source_width", 10.0)
    _set(comp, "source_height", 40.0)
    _set(comp, "barn_door_angle", CEIL_BARN_ANGLE)
    _set(comp, "barn_door_length", CEIL_BARN_LENGTH)
    _set(comp, "attenuation_radius", CEIL_RADIUS)
    _set(comp, "cast_shadows", False)
    _set(comp, "volumetric_scattering_intensity", CEIL_VOLUMETRIC)
    return light


def build_level(mats: dict) -> dict:
    """Builds the whole hall once; every shot is a camera move inside it."""
    import unreal

    content = Path(unreal.Paths.project_content_dir())
    stale_names = ["DashClawHallLevel.umap"] + [
        f"{s.capitalize()}Seq.uasset" for s in SHOTS
    ]
    for rel in stale_names:
        stale = content / "StoryStage" / rel
        if stale.is_file():
            stale.unlink()
    unreal.AssetRegistryHelpers.get_asset_registry().scan_paths_synchronous(
        [PACKAGE], True
    )
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    if not les.new_level(LEVEL_PATH):
        if not les.load_level(LEVEL_PATH):
            raise RuntimeError(f"new_level and load_level failed for {LEVEL_PATH}")
        for actor in eas.get_all_level_actors():
            eas.destroy_actor(actor)

    cube = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube.Cube")
    plane = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Plane")
    sphere = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Sphere")

    _spawn_mesh(
        eas,
        plane,
        unreal.Vector(FLOOR_C[0], FLOOR_C[1], 0.0),
        unreal.Vector(34, 34, 1),
        mats["MI_Floor"],
    )
    # BasicShapes/Plane is single sided with its normal on +Z: a ceiling needs
    # roll 180 or it is invisible from below and bounds nothing.
    ceiling = _spawn_mesh(
        eas,
        plane,
        unreal.Vector(FLOOR_C[0], FLOOR_C[1], CEIL_Z),
        unreal.Vector(34, 34, 1),
        mats["MI_Surface"],
        unreal.Rotator(roll=180.0, pitch=0.0, yaw=0.0),
    )

    white = unreal.LinearColor(0.85, 0.88, 1.0, 1.0)
    orange = unreal.LinearColor(1.0, 0.45, 0.09, 1.0)
    cool = unreal.LinearColor(*CEIL_COLOR, 1.0)
    led_rng = random.Random(LED_SEED)
    for aisle in range(N_AISLES):
        cy = aisle * AISLE_PITCH
        for side in (-1, 1):
            row_y = cy + side * ROW_OFF
            face_y = cy + side * FACE_OFF
            # Everything that stands proud of the face lives on this plane.
            det_y = face_y - side * 1.5
            for i in range(N_RACKS):
                x = i * RACK_LEN + RACK_LEN / 2
                _spawn_mesh(
                    eas,
                    cube,
                    unreal.Vector(x, row_y, RACK_H / 2),
                    unreal.Vector(*RACK),
                    mats["MI_Surface"],
                )
                # One row light per cabinet, not three full-length slits: three
                # continuous dashed lines running 16 m is the tunnel Wes saw.
                _spawn_mesh(
                    eas,
                    cube,
                    unreal.Vector(x, det_y, ROW_SLIT_Z),
                    unreal.Vector(0.8, 0.02, 0.02),
                    mats["MI_Slit"],
                )
                for z in LED_ROWS_Z:
                    for col in LED_COLS_X:
                        ok = led_rng.randrange(LED_OK_EVERY) == 0
                        _spawn_mesh(
                            eas,
                            cube,
                            unreal.Vector(i * RACK_LEN + col, det_y - side * 1.0, z),
                            unreal.Vector(LED_SIZE, LED_SIZE, LED_SIZE),
                            mats["MI_LedOk" if ok else "MI_Led"],
                        )
            # Mullions sit ON the cabinet boundaries, so there is one more of
            # them than there are racks.
            for i in range(N_RACKS + 1):
                _spawn_mesh(
                    eas,
                    cube,
                    unreal.Vector(
                        i * RACK_LEN,
                        face_y - side * MULLION_D / 2,
                        RACK_H / 2,
                    ),
                    unreal.Vector(MULLION_W / 100.0, MULLION_D / 100.0, RACK[2]),
                    mats["MI_Bezel"],
                )
        # Overhead cable tray down the aisle, with drops to the rack tops.
        _spawn_mesh(
            eas,
            cube,
            unreal.Vector(N_RACKS * RACK_LEN / 2, cy, TRAY_Z),
            unreal.Vector(N_RACKS * RACK_LEN / 100.0, TRAY_W, TRAY_H),
            mats["MI_Bezel"],
        )
        for n, i in enumerate((2, 6, 10, 14)):
            drop_side = 1 if n % 2 == 0 else -1
            _spawn_mesh(
                eas,
                cube,
                unreal.Vector(
                    i * RACK_LEN + RACK_LEN / 2,
                    cy + drop_side * 90.0,
                    (RACK_H + TRAY_Z) / 2,
                ),
                unreal.Vector(0.06, 0.06, (TRAY_Z - RACK_H) / 100.0),
                mats["MI_Bezel"],
            )
        for i in range(1, N_RACKS, CEIL_EVERY):
            _spawn_ceiling_light(
                eas,
                unreal.Vector(i * RACK_LEN + RACK_LEN / 2, cy, CEIL_Z - 10.0),
                cool,
                CEIL_CD,
            )

    # Raised-floor tile seams, aisle 0 only: every aisle camera lives here and a
    # plain floor is fine for the wide (where the floor is near black anyway).
    hall_len = N_RACKS * RACK_LEN
    for n in range(int(hall_len / TILE) + 1):
        _spawn_mesh(
            eas,
            cube,
            unreal.Vector(n * TILE, 0.0, 0.6),
            unreal.Vector(0.01, AISLE_W / 100.0, 0.012),
            mats["MI_Bezel"],
        )
    for ty in (-120.0, -60.0, 0.0, 60.0, 120.0):
        _spawn_mesh(
            eas,
            cube,
            unreal.Vector(hall_len / 2, ty, 0.6),
            unreal.Vector(hall_len / 100.0, 0.01, 0.012),
            mats["MI_Bezel"],
        )

    hero = _spawn_mesh(
        eas,
        sphere,
        unreal.Vector(0.0, 0.0, PARK),
        unreal.Vector(0.12, 0.12, 0.12),
        mats["MI_Agent"],
    )
    hero_light = _spawn_point_light(
        eas,
        unreal.Vector(0.0, 0.0, PARK),
        orange,
        AGENT_CD,
        AGENT_RADIUS,
        AGENT_VOLUMETRIC,
        True,
    )
    strip = _spawn_mesh(
        eas,
        cube,
        unreal.Vector(TARGET_X, FACE_OFF - 2.0, PARK),
        unreal.Vector(0.9, 0.02, 0.02),
        mats["MI_Strip"],
    )
    pulse = _spawn_point_light(
        eas,
        unreal.Vector(TARGET_X, FACE_OFF - PULSE_STANDOFF, PARK),
        white,
        PULSE_CD,
        400.0,
        0.3,
        False,
    )
    wide_agents = []
    for _ in range(24):
        s = _spawn_mesh(
            eas,
            sphere,
            unreal.Vector(0.0, 0.0, PARK),
            unreal.Vector(0.12, 0.12, 0.12),
            mats["MI_Agent"],
        )
        light = _spawn_point_light(
            eas,
            unreal.Vector(0.0, 0.0, PARK),
            orange,
            WIDE_CD,
            WIDE_RADIUS,
            WIDE_VOLUMETRIC,
            False,
        )
        wide_agents.append((s, light))

    fog = eas.spawn_actor_from_class(
        unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0)
    )
    fog_comp = fog.get_component_by_class(unreal.ExponentialHeightFogComponent)
    _set(fog_comp, "fog_density", FOG_DENSITY)
    _set(fog_comp, "fog_height_falloff", 0.5)
    # UE 5.8: FogInscatteringColor is DEPRECATED (renamed FogInscatteringLuminance)
    # and the volumetric bool is bEnableVolumetricFog, not VolumetricFog. Both old
    # names fail silently through _set and leave default milk-white km-scale fog.
    _set(
        fog_comp,
        "fog_inscattering_luminance",
        # Halved: this is what paints the flat grey card at the aisle's vanishing
        # point, and it is the one fog knob that does NOT dim the volumetric
        # light pools (those come off the lights' own scattering + albedo).
        unreal.LinearColor(0.010, 0.012, 0.016, 1.0),
    )
    _set(fog_comp, "start_distance", 0.0)
    _set(fog_comp, "enable_volumetric_fog", True)
    _set(fog_comp, "volumetric_fog_scattering_distribution", 0.2)
    _set(fog_comp, "volumetric_fog_extinction_scale", FOG_EXTINCTION)
    _set(fog_comp, "volumetric_fog_distance", 12000.0)
    _set(fog_comp, "volumetric_fog_albedo", unreal.Color(160, 165, 180, 255))
    sky = eas.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 200))
    sky_comp = sky.get_component_by_class(unreal.SkyLightComponent)
    _set(sky_comp, "real_time_capture", True)
    # Ambient is the safe hall lever: it lifts rack faces uniformly, so it can
    # pay for the ceiling candelas the release shot forced back down without
    # putting a pool anywhere.
    sky_comp.set_intensity(0.22)  # indoors: no SkyAtmosphere, no sun, just a floor

    camera = eas.spawn_actor_from_class(
        unreal.CineCameraActor, unreal.Vector(0, 0, 150)
    )
    cam_comp = camera.get_component_by_class(unreal.CineCameraComponent)
    _set(cam_comp, "current_focal_length", 24.0)
    _set(cam_comp, "current_aperture", 2.8)
    focus = cam_comp.get_editor_property("focus_settings")
    _set_enum(focus, "focus_method", "CameraFocusMethod", "DISABLE")
    _set(cam_comp, "focus_settings", focus)
    pp = cam_comp.get_editor_property("post_process_settings")
    # Lock exposure. With auto exposure live the tonemapper renormalises every
    # lighting change away and the frame mean parks near 110 whatever we do.
    _set_enum(pp, "auto_exposure_method", "AutoExposureMethod", "AEM_HISTOGRAM")
    for name, value in (
        ("override_auto_exposure_method", True),
        ("override_auto_exposure_min_brightness", True),
        ("auto_exposure_min_brightness", EXPOSURE_LOCK),
        ("override_auto_exposure_max_brightness", True),
        ("auto_exposure_max_brightness", EXPOSURE_LOCK),
        ("override_auto_exposure_bias", True),
        ("auto_exposure_bias", EXPOSURE_BIAS),
        ("override_bloom_intensity", True),
        ("bloom_intensity", 0.4),
        ("override_motion_blur_amount", True),
        ("motion_blur_amount", 0.5),
    ):
        _set(pp, name, value)
    _set(cam_comp, "post_process_settings", pp)
    try:
        back = cam_comp.get_editor_property("post_process_settings")
        unreal.log(
            "dashclaw_hall: exposure lock readback min="
            f"{back.get_editor_property('auto_exposure_min_brightness')} max="
            f"{back.get_editor_property('auto_exposure_max_brightness')} bias="
            f"{back.get_editor_property('auto_exposure_bias')} method="
            f"{back.get_editor_property('auto_exposure_method')}"
        )
    except Exception as exc:  # noqa: BLE001
        unreal.log_warning(f"dashclaw_hall: exposure readback failed: {exc}")
    unreal.log(f"dashclaw_hall: {len(eas.get_all_level_actors())} actors; saving level")
    les.save_current_level()
    return {
        "camera": camera,
        "hero": hero,
        "hero_light": hero_light,
        "strip": strip,
        "pulse": pulse,
        "ceiling": ceiling,
        "wide": wide_agents,
    }


def _add_key(channel, frame_number, value, unit) -> None:
    """LINEAR keys where 5.8 allows them: auto tangents bulge through the flat
    segments that ARE the freeze (the signature move of this film)."""
    import unreal

    global _KEY_INTERP
    if _KEY_INTERP is False:
        channel.add_key(frame_number, value, 0.0, unit)
        return
    try:
        channel.add_key(
            frame_number, value, 0.0, unit, unreal.MovieSceneKeyInterpolation.LINEAR
        )
        _KEY_INTERP = True
    except Exception as exc:  # noqa: BLE001
        if _KEY_INTERP is None:
            unreal.log_warning(f"dashclaw_hall: LINEAR keys unavailable ({exc})")
        _KEY_INTERP = False
        channel.add_key(frame_number, value, 0.0, unit)


def _key(channels, frame, loc, rot=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)) -> None:
    """Keys all nine transform channels. Rotation and scale are ALWAYS keyed:
    an unkeyed channel on a transform section falls back to the section default
    (0), which silently collapses a mesh's scale to nothing."""
    import unreal

    unit = unreal.MovieSceneTimeUnit.DISPLAY_RATE
    fn = unreal.FrameNumber(int(frame))
    for offset, values in ((0, loc), (3, rot), (6, scale)):
        for i, value in enumerate(values):
            _add_key(channels[offset + i], fn, float(value), unit)


def _new_sequence(name: str, length: int):
    import unreal

    sequence = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        name, PACKAGE, unreal.LevelSequence, unreal.LevelSequenceFactoryNew()
    )
    sequence.set_playback_start(0)
    sequence.set_playback_end(length)
    sequence.set_display_rate(unreal.FrameRate(FPS, 1))
    return sequence


def _track(sequence, actor, length):
    import unreal

    binding = sequence.add_possessable(actor)
    section = binding.add_track(unreal.MovieScene3DTransformTrack).add_section()
    section.set_range(0, length)
    channels = section.get_channels_by_type(unreal.MovieSceneScriptingDoubleChannel)
    if len(channels) < 9:
        raise RuntimeError(f"expected 9 transform channels, got {len(channels)}")
    return binding, channels


def _cut(sequence, binding, length) -> None:
    """No camera cut = black frames and exit 0 (PLAYBOOK)."""
    import unreal

    cut = sequence.add_track(unreal.MovieSceneCameraCutTrack).add_section()
    cut.set_range(0, length)
    cut.set_camera_binding_id(sequence.get_binding_id(binding))


AGENT_S = (0.12, 0.12, 0.12)
STRIP_S = (0.9, 0.02, 0.02)
CEIL_S = (34.0, 34.0, 1.0)
CEIL_R = (180.0, 0.0, 0.0)


def build_shot(shot: str, actors: dict):
    """One LevelSequence per shot. Actors a shot does not use stay parked at
    z=PARK in the level, which is why no visibility tracks are needed: racks
    2.2 m tall fully occlude the neighbouring aisles from a 1.5 m camera."""
    length = SHOT_LEN[shot]
    end = length - 1
    sequence = _new_sequence(f"{shot.capitalize()}Seq", length)
    cam_binding, cam = _track(sequence, actors["camera"], length)
    ceiling = actors["ceiling"]
    down = (FLOOR_C[0], FLOOR_C[1], -6000.0)

    if shot == "hall":
        _key(cam, 0, (-100.0, 0.0, 150.0))
        _key(cam, end, (320.0, 0.0, 150.0))
    elif shot == "agent":
        _, hero = _track(sequence, actors["hero"], length)
        _, hlight = _track(sequence, actors["hero_light"], length)
        _key(cam, 0, (-200.0, 0.0, 150.0))
        _key(cam, end, (600.0, 0.0, 150.0))
        for channels, scale in ((hero, AGENT_S), (hlight, (1.0, 1.0, 1.0))):
            _key(channels, 0, (200.0, 0.0, AGENT_Z), scale=scale)
            _key(channels, end, (1000.0, 0.0, AGENT_Z), scale=scale)
    elif shot == "reach":
        _, hero = _track(sequence, actors["hero"], length)
        _, hlight = _track(sequence, actors["hero_light"], length)
        _, strip = _track(sequence, actors["strip"], length)
        stop = 60  # the HOLD: flat keys from here, camera and agent both
        _key(cam, 0, (500.0, 0.0, 150.0), rot=(0.0, 0.0, 0.0))
        _key(cam, stop, (850.0, 0.0, 150.0), rot=(0.0, 0.0, 10.0))
        _key(cam, end, (850.0, 0.0, 150.0), rot=(0.0, 0.0, 10.0))
        # The SPHERE reaches to y=60 (60 cm off the face); its LIGHT stays on the
        # aisle centreline. They are separate bindings and this is the only place
        # the difference matters: a point light 60 cm off a rack face puts
        # AGENT_CD/0.36 lux on it, and at ANY intensity that still reads as a lit
        # face rather than a signal. The reach beat is carried by the emissive
        # sphere and by MI_Strip's orange rule, both unaffected by this.
        _key(hero, 0, (900.0, 0.0, AGENT_Z), scale=AGENT_S)
        _key(hero, stop, (TARGET_X, 60.0, AGENT_Z), scale=AGENT_S)
        _key(hero, end, (TARGET_X, 60.0, AGENT_Z), scale=AGENT_S)
        _key(hlight, 0, (900.0, 0.0, AGENT_Z))
        _key(hlight, stop, (TARGET_X, 0.0, AGENT_Z))
        _key(hlight, end, (TARGET_X, 0.0, AGENT_Z))
        face = (TARGET_X, FACE_OFF - 2.0, 112.0)
        # The rule appears by OPENING ITS THICKNESS at `stop`, never by moving.
        # Keying it from PARK (z=-5000) to the face across one frame gave frame 60
        # -- the film's cut frame -- a motion-blur smear of the strip over the
        # whole 220 cm rack face: a blown orange panel, i.e. exactly the wash the
        # brand forbids, on the most important frame in the film. Position is
        # constant here, so the only velocity is the 1 cm of half-thickness the
        # cross-section opens, and the rule pops on clean.
        _key(strip, 0, face, scale=(STRIP_S[0], 0.0, 0.0))
        _key(strip, stop - 1, face, scale=(STRIP_S[0], 0.0, 0.0))
        _key(strip, stop, face, scale=STRIP_S)
        _key(strip, end, face, scale=STRIP_S)
    elif shot == "release":
        _, hero = _track(sequence, actors["hero"], length)
        _, hlight = _track(sequence, actors["hero_light"], length)
        _, strip = _track(sequence, actors["strip"], length)
        _, pulse = _track(sequence, actors["pulse"], length)
        _, ceil = _track(sequence, ceiling, length)
        # The camera rises to 6 m, i.e. above the 3.5 m ceiling: key the ceiling
        # out of this shot rather than fly the camera through it.
        _key(ceil, 0, down, rot=CEIL_R, scale=CEIL_S)
        _key(cam, 0, (850.0, 0.0, 150.0), rot=(0.0, 0.0, 10.0))
        _key(cam, 40, (850.0, 0.0, 150.0), rot=(0.0, 0.0, 10.0))
        _key(cam, end, (300.0, 0.0, 600.0), rot=(0.0, -20.0, 10.0))
        _key(hero, 0, (TARGET_X, 60.0, AGENT_Z), scale=AGENT_S)
        _key(hero, 20, (TARGET_X, 130.0, AGENT_Z), scale=(0.001, 0.001, 0.001))
        _key(hero, end, (TARGET_X, 130.0, AGENT_Z), scale=(0.001, 0.001, 0.001))
        # Starts on the centreline: release cuts straight off reach's held frame,
        # where the light is at y=0 and the sphere at y=60.
        _key(hlight, 0, (TARGET_X, 0.0, AGENT_Z))
        _key(hlight, 20, (TARGET_X, 130.0, AGENT_Z))
        _key(hlight, end, (TARGET_X, 130.0, AGENT_Z))
        face = (TARGET_X, FACE_OFF - 2.0, 112.0)
        _key(strip, 0, face, scale=STRIP_S)
        _key(strip, end, face, scale=STRIP_S)
        lit = (TARGET_X, FACE_OFF - PULSE_STANDOFF, 125.0)
        _key(pulse, 0, lit)
        _key(pulse, end, lit)
        _pulse_intensity(sequence, actors["pulse"], length)
    elif shot == "wide":
        _, ceil = _track(sequence, ceiling, length)
        _key(ceil, 0, down, rot=CEIL_R, scale=CEIL_S)
        # 14 m up. 25 degrees down puts the hall below the frame's lower edge at
        # 24 mm (half-FOV 15.5 deg, so the ground band starts 16 m past the far
        # rack). At -38 from 16 m back the visible ground band is x -564..1780,
        # i.e. the 16 x 20 m hall fills the frame: at -30 it filled 60% and the
        # rest was black, which pulled the frame mean to 17 of 255. Geometry,
        # not taste.
        _key(cam, 0, (-1600.0, 900.0, 1400.0), rot=(0.0, -38.0, 0.0))
        _key(cam, end, (-1200.0, 900.0, 1400.0), rot=(0.0, -38.0, 0.0))
        rng = random.Random(47)
        for idx, (sphere, light) in enumerate(actors["wide"]):
            aisle = idx % N_AISLES
            y = aisle * AISLE_PITCH + rng.uniform(-40.0, 40.0)
            x0 = rng.uniform(-150.0, 800.0)
            travel = rng.uniform(400.0, 1100.0)
            freeze = rng.randint(30, end - 40)
            hold = 12
            rate = travel / (length - hold)
            steps = [
                (0, x0),
                (freeze, x0 + rate * freeze),
                (freeze + hold, x0 + rate * freeze),
                (end, x0 + rate * (end - hold)),
            ]
            _, s_ch = _track(sequence, sphere, length)
            _, l_ch = _track(sequence, light, length)
            for frame, x in steps:
                _key(s_ch, frame, (x, y, AGENT_Z), scale=AGENT_S)
                _key(l_ch, frame, (x, y, AGENT_Z))

    _cut(sequence, cam_binding, length)
    import unreal

    unreal.EditorAssetLibrary.save_loaded_asset(sequence)
    return sequence


def _pulse_intensity(sequence, light_actor, length) -> None:
    """Rack slit pulse: intensity x1 -> x6 -> x1 over frames 20-50.

    A float track on a light COMPONENT binding. Guarded: it is invisible at the
    release shot's representative still (frame 100), so a property-path change
    must cost a warning, not the look test."""
    import unreal

    try:
        comp = light_actor.get_component_by_class(unreal.PointLightComponent)
        binding = sequence.add_possessable(comp)
        track = binding.add_track(unreal.MovieSceneFloatTrack)
        track.set_property_name_and_path("Intensity", "Intensity")
        section = track.add_section()
        section.set_range(0, length)
        channel = section.get_channels_by_type(unreal.MovieSceneScriptingFloatChannel)[
            0
        ]
        unit = unreal.MovieSceneTimeUnit.DISPLAY_RATE
        for frame, mult in (
            (0, 1.0),
            (20, 1.0),
            (35, 6.0),
            (50, 1.0),
            (length - 1, 1.0),
        ):
            channel.add_key(unreal.FrameNumber(frame), PULSE_CD * mult, 0.0, unit)
    except Exception as exc:  # noqa: BLE001
        unreal.log_warning(f"dashclaw_hall: pulse intensity track skipped: {exc}")


def render(sequences, world, out_dir: str, shots, frame, animation) -> None:
    """One queue, one manifest, one hand-off: render.py's second engine launch
    renders every job. See cube_flythrough.render for the two-stage rationale."""
    import json
    import unreal

    subsystem = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
    queue = subsystem.get_queue()
    queue.delete_all_jobs()
    for index, shot in enumerate(shots):
        job = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
        _set(job, "job_name", shot)
        job.sequence = unreal.SoftObjectPath(sequences[shot].get_path_name())  # noqa: vulture
        job.map = unreal.SoftObjectPath(world.get_path_name())  # noqa: vulture
        config = job.get_configuration()
        out_set = config.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
        # First job writes to <out> itself so render.py's frame_*.png glob hits.
        target = out_dir if index == 0 else f"{out_dir}/{shot}"
        out_set.output_directory = unreal.DirectoryPath(target)  # noqa: vulture
        out_set.file_name_format = "frame_{frame_number}"  # noqa: vulture
        out_set.output_resolution = unreal.IntPoint(*RES)  # noqa: vulture
        out_set.zero_pad_frame_numbers = 4  # noqa: vulture
        # Without this MRQ can skip or suffix an existing frame_0120.png and a
        # later launch's pixel check silently reads the first launch's frame.
        _set(out_set, "override_existing_output", True)
        out_set.use_custom_frame_rate = True  # noqa: vulture
        out_set.output_frame_rate = unreal.FrameRate(FPS, 1)  # noqa: vulture
        if not animation:
            still = REP_FRAME[shot] if frame is None else frame
            out_set.use_custom_playback_range = True  # noqa: vulture
            out_set.custom_start_frame = still  # noqa: vulture
            out_set.custom_end_frame = still + 1  # noqa: vulture (end is exclusive)
        # A single Lumen frame with no warm-up comes back near-black; that reads
        # as a lighting bug and is not one. Temporal samples stay at 1: they
        # smear a still.
        try:
            aa = config.find_or_add_setting_by_class(
                unreal.MoviePipelineAntiAliasingSetting
            )
            _set(aa, "engine_warm_up_count", 24)
            _set(aa, "render_warm_up_count", 8)
            _set(aa, "spatial_sample_count", 2)
            _set(aa, "temporal_sample_count", 1)
        except Exception as exc:  # noqa: BLE001
            unreal.log_warning(f"dashclaw_hall: AA/warm-up setting skipped: {exc}")
        config.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)
        config.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_PNG)

    ok, manifest = unreal.MoviePipelineEditorLibrary.save_queue_to_manifest_file(queue)
    if not ok:
        raise RuntimeError("save_queue_to_manifest_file failed")
    handoff = {
        "map": world.get_path_name().split(".")[0],
        "manifest": unreal.Paths.convert_relative_path_to_full(manifest),
    }
    (Path(out_dir) / "mrq.json").write_text(json.dumps(handoff, indent=2))
    unreal.log(f"dashclaw_hall: queued {shots} -> {handoff}")


def main() -> int:
    import unreal

    args = parse_args(scene_args())
    shots = SHOTS if args.shot == "all" else [args.shot]
    # `--frame 0` is a real frame; `args.frame or default` would swallow it.
    frame = None if args.shot == "all" else args.frame
    mats = build_materials()
    actors = build_level(mats)
    sequences = {shot: build_shot(shot, actors) for shot in shots}
    world = unreal.EditorLevelLibrary.get_editor_world()
    render(sequences, world, args.out, shots, frame, args.animation)
    return 0


if __name__ == "__main__":
    sys.exit(main())
