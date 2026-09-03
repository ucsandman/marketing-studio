"""Headless Unreal Engine render wrapper: runs a scene script and verifies output.

Usage:
    python feeders/unreal/render.py <scene.py> --out <dir> [--frame N | --animation] [scene-specific flags...]

Any flag not recognized by this wrapper (e.g. a scene's --brand/--seed knobs) is
forwarded verbatim to the scene script.

UE 5.8 has no headless `--background --python` equivalent to Blender's; instead
the bundled project (project/StoryStage.uproject) is launched with
`-run=pythonscript -script="<scene.py> <its flags>"`, which runs the scene inside
the editor's embedded Python interpreter. See README.md.
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UPROJECT = Path(__file__).resolve().parent / "project" / "StoryStage.uproject"

# Fallback install location if UNREAL_PATH is unset (the install this feeder was
# drafted against; the coordinator's real path may differ once installed).
DEFAULT_UNREAL_PATH = (
    "C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe"
)


def read_env(path: Path) -> dict:
    """Minimal KEY=VALUE .env reader (duplicated from launch.py to keep the feeder standalone)."""
    if not path.is_file():
        return {}
    out = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def find_unreal(env: dict) -> str | None:
    configured = env.get("UNREAL_PATH")
    if configured and Path(configured).is_file():
        return configured
    if Path(DEFAULT_UNREAL_PATH).is_file():
        return DEFAULT_UNREAL_PATH
    return shutil.which("UnrealEditor-Cmd")


def kill_tree(pid: int) -> None:
    """Kill a process and its whole descendant tree.

    Windows: taskkill /T /F — a plain Popen.kill() TerminateProcess-es only the
    direct child and leaves grandchildren (anything the editor spawned) running,
    free to keep writing into the output directory. Same rationale as the
    Blender feeder's kill_tree.
    """
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        subprocess.run(["kill", "-9", str(pid)], capture_output=True)


def _quote_if_space(value: str) -> str:
    return f'"{value}"' if " " in value else value


# The -script="..." wrapper matches Epic's own `-script="D:\...\x.py"` form:
# Unreal reads the quoted value as one token, then splits it into sys.argv.
# Its outer quotes must reach the engine VERBATIM, so this list is joined by
# command_line() below, never by subprocess.list2cmdline(): that re-quoted the
# element (it has spaces) into -script=""..."" and the commandlet answered
# "-Script argument not specified" (verified 2026-09-03, UE 5.8.2).
def build_cmd(
    unreal: str,
    uproject: str,
    scene: str,
    out: str,
    frame: int | None,
    animation: bool,
    extra: list[str] | None = None,
) -> list[str]:
    # Forward slashes only inside the -script value: the commandlet applies
    # C-style escapes to it, so `...\scratchpad\ue-probe` reached the script
    # as `scratchpad\x0e-probe` (verified 2026-09-03, UE 5.8.2).
    scene = scene.replace("\\", "/")
    out = out.replace("\\", "/")
    script_parts = [_quote_if_space(scene), "--out", _quote_if_space(out)]
    if animation:
        script_parts.append("--animation")
    else:
        script_parts += ["--frame", str(frame)]
    if extra:
        script_parts += [_quote_if_space(e) for e in extra]
    script_value = " ".join(script_parts)

    return [
        unreal,
        uproject,
        "-run=pythonscript",
        f'-script="{script_value}"',
        "-unattended",
        "-nosplash",
        "-nopause",
        "-stdout",
        "-FullStdOutLogOutput",
    ]


def command_line(cmd: list[str]) -> str:
    """Join build_cmd's list for CreateProcess: quote elements with spaces
    (the exe and the project live under "Program Files") EXCEPT the -script=
    element, which already carries its own quotes and must pass through as is."""
    return " ".join(
        c if c.startswith(("-script=", "-MoviePipelineConfig=")) else _quote_if_space(c)
        for c in cmd
    )


def build_render_cmd(
    unreal: str, uproject: str, map_path: str, manifest: str
) -> list[str]:
    """Stage-2 command: the engine in -game mode renders a saved MRQ queue
    manifest offscreen and exits when the pipeline finishes."""
    return [
        unreal,
        uproject,
        map_path,
        "-game",
        f'-MoviePipelineConfig="{manifest.replace(chr(92), "/")}"',
        "-RenderOffscreen",
        "-windowed",
        "-resx=1280",
        "-resy=720",
        "-NoLoadingScreen",
        "-NoTextureStreaming",
        "-unattended",
        "-nosplash",
        "-nopause",
        "-stdout",
        "-FullStdOutLogOutput",
    ]


def run(line: str, timeout: float | None) -> int:
    """Runs one engine launch; 0 on success, 124 on timeout (tree killed).

    Popen + wait(timeout) instead of subprocess.run: on expiry the whole
    editor process TREE must die (kill_tree) — an orphan surviving a
    parent-only kill can keep writing frames into out_dir after the caller
    has moved on (same rationale as the Blender feeder's frame-67 hang).
    A STRING, not a list: see command_line().
    """
    print("render:", line)
    proc = subprocess.Popen(line)
    try:
        returncode = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        kill_tree(proc.pid)
        proc.wait()
        print(
            f"unreal timed out after {timeout}s; process tree killed", file=sys.stderr
        )
        return 124
    if returncode != 0:
        print(f"unreal exited {returncode}", file=sys.stderr)
        return returncode or 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scene", help="path to an unreal-python scene script")
    parser.add_argument(
        "--out", required=True, help="output directory for frame_%%04d.png"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--frame", type=int, help="render a single frame")
    group.add_argument(
        "--animation", action="store_true", help="render the scene's full range"
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=None,
        help="seconds before the UnrealEditor-Cmd process TREE is killed (exit "
        "124). Editor renders can hang; callers should always set this.",
    )
    args, extra = parser.parse_known_args()

    scene = Path(args.scene).resolve()
    if not scene.is_file():
        print(f"scene script not found: {scene}", file=sys.stderr)
        return 1

    if not UPROJECT.is_file():
        print(f"project not found: {UPROJECT}", file=sys.stderr)
        return 1

    unreal = find_unreal(read_env(ROOT / ".env"))
    if not unreal:
        print(
            "Unreal Editor not found: set UNREAL_PATH in .env or add "
            "UnrealEditor-Cmd to PATH",
            file=sys.stderr,
        )
        return 1

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = build_cmd(
        unreal,
        str(UPROJECT),
        str(scene),
        str(out_dir),
        args.frame,
        args.animation,
        extra,
    )
    rc = run(command_line(cmd), args.timeout)
    if rc != 0:
        return rc

    # Stage 2: a scene that queued a Movie Render Queue job leaves mrq.json
    # behind (a commandlet cannot render MRQ itself: no PIE, no tick loop).
    # Epic's own new-process executor does exactly this second launch.
    handoff = out_dir / "mrq.json"
    if handoff.is_file():
        spec = json.loads(handoff.read_text())
        rc = run(
            command_line(
                build_render_cmd(unreal, str(UPROJECT), spec["map"], spec["manifest"])
            ),
            args.timeout,
        )
        if rc != 0:
            return rc

    frames = sorted(out_dir.glob("frame_*.png"))
    if not frames:
        print(
            f"unreal exited 0 but produced no frame_*.png in {out_dir}",
            file=sys.stderr,
        )
        return 1
    print(f"render OK: {len(frames)} frame(s) in {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
