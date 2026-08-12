"""feeders/audio/transcribe.py — faster-whisper sidecar for scripts/judge-audio.mjs.

Transcribes one or more audio/video files with faster-whisper (model "small",
device="cpu", compute_type="int8" — verified working on this machine; see
docs/superpowers/specs/2026-08-12-judge-audio-design.md "Verified facts").
openai-whisper is broken here (NumPy 2.4 vs numba's NumPy<=2.3 requirement) —
never import it.

Model load is ~15.7s of a ~25s run, so the model loads ONCE and every requested
file is transcribed in that same process.

Usage: python feeders/audio/transcribe.py <file> [<file> ...]
Output: one JSON object on stdout, nothing else on stdout —
  {"model": "small", "files": {"<path>": {"duration": <s>, "language": "en",
   "segments": [{"start": <s>, "end": <s>, "text": "..."}],
   "words": [{"w": "...", "start": <s>, "end": <s>}]}}}

Exit codes: 1 on bad usage or a file that fails to transcribe; 2 when
faster_whisper or its model is unavailable — the judge degrades to
levels-and-picture rather than dying, per the spec's exit-code contract.
"""

import json
import sys


def main() -> None:
    files = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not files:
        print("usage: transcribe.py <file> [<file> ...]", file=sys.stderr)
        sys.exit(1)

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # pragma: no cover - environment-dependent
        print(f"transcribe.py: faster_whisper unavailable: {exc}", file=sys.stderr)
        sys.exit(2)

    try:
        model = WhisperModel("small", device="cpu", compute_type="int8")
    except Exception as exc:  # pragma: no cover - environment-dependent
        print(f"transcribe.py: model load failed: {exc}", file=sys.stderr)
        sys.exit(2)

    result = {"model": "small", "files": {}}
    for path in files:
        try:
            segments, info = model.transcribe(path, word_timestamps=True)
            seg_list = []
            word_list = []
            for seg in segments:
                seg_list.append(
                    {"start": seg.start, "end": seg.end, "text": seg.text.strip()}
                )
                for w in seg.words or []:
                    word_list.append(
                        {"w": w.word.strip(), "start": w.start, "end": w.end}
                    )
            result["files"][path] = {
                "duration": info.duration,
                "language": info.language,
                "segments": seg_list,
                "words": word_list,
            }
        except Exception as exc:
            print(f"transcribe.py: failed to transcribe {path}: {exc}", file=sys.stderr)
            sys.exit(1)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
