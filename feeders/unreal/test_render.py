import importlib.util
import tempfile
import unittest
from pathlib import Path

from render import build_cmd, find_unreal, read_env

SCENES_DIR = Path(__file__).resolve().parent / "scenes"


def _load_probe():
    """Imports scenes/probe.py by path (it isn't a package) without importing
    `unreal`, proving the module never touches `unreal` at import time."""
    spec = importlib.util.spec_from_file_location("probe", SCENES_DIR / "probe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestHelpers(unittest.TestCase):
    def test_read_env_parses_and_ignores_comments(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / ".env"
            p.write_text(
                "# comment\nUNREAL_PATH=C:/x/UnrealEditor-Cmd.exe\nEMPTY_LINE_BELOW=1\n\n"
            )
            env = read_env(p)
        self.assertEqual(env["UNREAL_PATH"], "C:/x/UnrealEditor-Cmd.exe")
        self.assertEqual(env["EMPTY_LINE_BELOW"], "1")

    def test_read_env_missing_file_is_empty(self):
        self.assertEqual(read_env(Path("definitely/not/here/.env")), {})

    def test_find_unreal_prefers_existing_configured_path(self):
        with tempfile.NamedTemporaryFile(suffix=".exe", delete=False) as f:
            fake = f.name
        self.assertEqual(find_unreal({"UNREAL_PATH": fake}), fake)

    def test_find_unreal_ignores_missing_configured_path(self):
        # falls through to the default install path / PATH lookup; result is
        # whatever those say (str or None), never the missing configured path
        result = find_unreal({"UNREAL_PATH": "Z:/nope/UnrealEditor-Cmd.exe"})
        self.assertNotEqual(result, "Z:/nope/UnrealEditor-Cmd.exe")

    def test_build_cmd_single_frame(self):
        cmd = build_cmd(
            "UnrealEditor-Cmd.exe",
            "project/StoryStage.uproject",
            "scenes/probe.py",
            "outdir",
            frame=1,
            animation=False,
        )
        self.assertEqual(
            cmd,
            [
                "UnrealEditor-Cmd.exe",
                "project/StoryStage.uproject",
                "-run=pythonscript",
                '-script="scenes/probe.py --out outdir --frame 1"',
                "-unattended",
                "-nosplash",
                "-nopause",
                "-stdout",
                "-FullStdOutLogOutput",
            ],
        )

    def test_build_cmd_animation(self):
        cmd = build_cmd(
            "UnrealEditor-Cmd.exe",
            "project/StoryStage.uproject",
            "scenes/cube_flythrough.py",
            "outdir",
            frame=None,
            animation=True,
        )
        self.assertEqual(
            cmd,
            [
                "UnrealEditor-Cmd.exe",
                "project/StoryStage.uproject",
                "-run=pythonscript",
                '-script="scenes/cube_flythrough.py --out outdir --animation"',
                "-unattended",
                "-nosplash",
                "-nopause",
                "-stdout",
                "-FullStdOutLogOutput",
            ],
        )

    def test_build_cmd_forwards_extra_scene_flags(self):
        cmd = build_cmd(
            "UnrealEditor-Cmd.exe",
            "project/StoryStage.uproject",
            "scenes/cube_flythrough.py",
            "outdir",
            frame=None,
            animation=True,
            extra=["--brand", "magnetic"],
        )
        self.assertEqual(
            cmd,
            [
                "UnrealEditor-Cmd.exe",
                "project/StoryStage.uproject",
                "-run=pythonscript",
                '-script="scenes/cube_flythrough.py --out outdir --animation --brand magnetic"',
                "-unattended",
                "-nosplash",
                "-nopause",
                "-stdout",
                "-FullStdOutLogOutput",
            ],
        )

    def test_build_cmd_quotes_only_spacey_parts(self):
        cmd = build_cmd(
            "UnrealEditor-Cmd.exe",
            "project/StoryStage.uproject",
            "C:/Program Files/scenes/probe.py",
            "outdir",
            frame=1,
            animation=False,
        )
        self.assertEqual(
            cmd[3],
            '-script=""C:/Program Files/scenes/probe.py" --out outdir --frame 1"',
        )

    def test_build_cmd_script_arg_is_a_single_element(self):
        cmd = build_cmd(
            "UnrealEditor-Cmd.exe",
            "project/StoryStage.uproject",
            "scenes/probe.py",
            "outdir",
            frame=None,
            animation=True,
            extra=["--brand", "magnetic", "--scale", "2.6"],
        )
        self.assertEqual(len(cmd), 9)
        script_args = [c for c in cmd if c.startswith("-script=")]
        self.assertEqual(len(script_args), 1)


class TestProbePngWriter(unittest.TestCase):
    """probe.py must import cleanly with no `unreal` install (guarded inside
    main()); this proves it and exercises the pure PNG writer it exposes."""

    def test_probe_importable_without_unreal(self):
        probe = _load_probe()
        self.assertTrue(hasattr(probe, "write_png_1x1"))

    def test_write_png_1x1_produces_a_valid_png_header(self):
        probe = _load_probe()
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "frame_0000.png"
            probe.write_png_1x1(out)
            data = out.read_bytes()
        self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertIn(b"IHDR", data)
        self.assertIn(b"IDAT", data)
        self.assertIn(b"IEND", data)


if __name__ == "__main__":
    unittest.main()
