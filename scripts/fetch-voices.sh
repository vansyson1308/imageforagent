#!/bin/sh
# Piper neural voices for the Director (SPEC v2 WP4.5, DECISIONS D32), pinned to one
# revision of huggingface.co/rhasspy/piper-voices and verified by sha256.
#   sh scripts/fetch-voices.sh /opt/piper/voices
# Licences (from each MODEL_CARD): kristin + john = public domain (LibriVox),
# vais1000 = CC BY 4.0 (VAIS-1000), hi_fi_captain = CC BY-NC-SA 4.0 (NICT, non-commercial).
set -eu
DIR="${1:-/opt/piper/voices}"
REV="c10ece1aade47bb51c153c893d14e5bf8e5b7117"
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/$REV"
mkdir -p "$DIR"
fetch() { # path sha256-onnx sha256-json
  name=$(basename "$1")
  curl -fsSL --retry 4 -o "$DIR/$name.onnx" "$BASE/$1.onnx"
  curl -fsSL --retry 4 -o "$DIR/$name.onnx.json" "$BASE/$1.onnx.json"
  echo "$2  $DIR/$name.onnx" | sha256sum -c -
  echo "$3  $DIR/$name.onnx.json" | sha256sum -c -
}
fetch en/en_US/kristin/medium/en_US-kristin-medium 5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4 5681426d4aead22195de70531eeeeddb46493cfaffc5764b2ea3db73428b651c
fetch en/en_US/john/medium/en_US-john-medium 789c6c875726e627ddee93d51d8727859abe9c091c3d141591f4b83c2072e988 af60f177b6b550f3d7a302720c0fb89e7f94a82b5dca464775ef63b1c69ba09a
fetch vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium ec7c89e2c85f4d1edc24b6120c18aaf1bda614f06b511567eb9c7c0de15e2dab fafb9da1354ed4b77c31af228ed41fb41cd825c14cffa105454b25e6ae751ee0
fetch ja/ja_JP/hi_fi_captain/medium/ja_JP-hi_fi_captain-medium 5eafa1610fc7a0ff2e7fde9cbe0972d876266e23d8db331727eb2466f19460eb fe9aeda38318607ba114926d1d7ee7d56295f9af3774a99a42b36f4354cabf27
