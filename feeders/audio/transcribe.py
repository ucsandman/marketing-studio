"""feeders/audio/transcribe.py — shim to the harness ears tool.

The whisper sidecar moved to ~/.claude/tools/ears/ears.py on 2026-08-13 so any
repo on this machine can hear media, not just this one. This shim keeps the
judge-audio.mjs contract exactly: same argv (a list of files), same JSON on
stdout, same exit codes. If the harness tool is missing, exit 2 — the judge
already treats that as "whisper unavailable" and degrades to levels-and-picture
instead of dying, so a clean clone of this repo on a machine without the
harness loses only the transcript checks.

Override the harness location with EARS_HOME (also how the exit-2 path is
tested). Model facts, verified numbers, and the openai-whisper warning live
with the tool and in docs/superpowers/specs/2026-08-12-judge-audio-design.md.
"""

import os
import subprocess
import sys

home = os.environ.get("EARS_HOME") or os.path.join(
    os.path.expanduser("~"), ".claude", "tools", "ears"
)
script = os.path.join(home, "ears.py")
if not os.path.isfile(script):
    print(
        f"transcribe.py: harness ears tool not found at {script} "
        "(set EARS_HOME or install ~/.claude/tools/ears)",
        file=sys.stderr,
    )
    sys.exit(2)

result = subprocess.run([sys.executable, script, "transcribe", *sys.argv[1:]])
sys.exit(result.returncode)
