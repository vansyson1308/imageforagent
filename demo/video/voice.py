"""
Neural voice-over for the demo video (replaces espeak-ng's robotic formant voice).

Writes demo/video/voice/<segment-id>.wav for every segment of narration.json with
Piper (MIT, offline, CPU). prepare.ts picks these files up as per-segment overrides.

  pip install piper-tts
  curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/high/en_US-lessac-high.onnx
  curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/high/en_US-lessac-high.onnx.json
  python3 demo/video/voice.py --model en_US-lessac-high.onnx [--length-scale 1.0]
"""
import argparse
import json
import subprocess
import sys
import wave
from pathlib import Path

DIR = Path(__file__).resolve().parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--length-scale", default="1.0")
    args = ap.parse_args()
    narration = json.loads((DIR / "narration.json").read_text(encoding="utf-8"))
    out_dir = DIR / "voice"
    out_dir.mkdir(exist_ok=True)
    over = False
    for seg in narration["segments"]:
        out = out_dir / f"{seg['id']}.wav"
        # argv only, text on stdin: never a shell
        subprocess.run(
            [sys.executable, "-m", "piper", "-m", args.model, "-f", str(out), "--length-scale", args.length_scale, "--sentence-silence", "0.25"],
            input=seg["text"].encode("utf-8"),
            check=True,
            capture_output=True,
        )
        with wave.open(str(out)) as w:
            dur = w.getnframes() / w.getframerate()
        room = seg["end"] - seg["start"] - 0.3
        flag = "  ⚠ OVERRUNS" if dur > room else ""
        over = over or dur > room
        print(f"{seg['id']}: {dur:.1f}s of {room:.1f}s{flag}")
    return 2 if over else 0


if __name__ == "__main__":
    sys.exit(main())
