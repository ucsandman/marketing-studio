"""Health probe: confirms the -run=pythonscript path works end to end.

Writes probe.json (engine version, project dir, MRQ subsystem availability) and
a 1x1 frame_0000.png (pure Python, no PIL) so render.py's frame check passes.
This is the smoke test that proves the commandlet actually launched, ran this
script, and could write into --out — it does not touch any rendering API.

`unreal` is imported only inside main(), never at module scope, so this file
can be imported by test_render.py on a machine with no Unreal install.
"""

import argparse
import json
import struct
import sys
import zlib
from pathlib import Path


def write_png_1x1(path: Path) -> None:
    """Writes a minimal valid 1x1 white RGB PNG using only stdlib zlib/struct."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)  # 1x1, 8-bit, RGB
    raw_scanline = b"\x00" + b"\xff\xff\xff"  # filter byte + one white pixel
    idat = zlib.compress(raw_scanline)
    png = signature + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    Path(path).write_bytes(png)


def scene_args() -> list[str]:
    """Flags forwarded by the pythonscript commandlet land in sys.argv[1:].

    # The commandlet forwards argv (verified 5.8.2). Fallback: if it doesn't (the
    # real engine runs this), fall back to slicing them out of the raw engine
    # command line. Duplicated in cube_flythrough.py to keep scenes standalone,
    # matching the Blender scenes' pattern.
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


def main() -> int:
    import unreal

    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--frame", type=int, default=1)
    parser.add_argument("--animation", action="store_true")
    args = parser.parse_args(scene_args())

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    facts = {
        "engine_version": unreal.SystemLibrary.get_engine_version(),
        "project_dir": unreal.Paths.project_dir(),
        "has_MoviePipelineQueueEngineSubsystem": hasattr(
            unreal, "MoviePipelineQueueEngineSubsystem"
        ),
        "has_MoviePipelineQueueSubsystem": hasattr(
            unreal, "MoviePipelineQueueSubsystem"
        ),
    }
    (out_dir / "probe.json").write_text(json.dumps(facts, indent=2))
    write_png_1x1(out_dir / "frame_0000.png")
    unreal.log(f"probe OK: {facts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
