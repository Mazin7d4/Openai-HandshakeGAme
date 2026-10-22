#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."

echo "Building kit..."
~/.local/bin/blender -b --factory-startup --python tools/blender/kit/build_kit.py -- ${SHEET:+--sheet "$SHEET"} > /tmp/kitbuild.log 2>&1 || {
  tail -40 /tmp/kitbuild.log
  exit 1
}

if ! grep -q "KIT_COMPLETE" /tmp/kitbuild.log; then
  tail -40 /tmp/kitbuild.log
  echo "KIT_COMPLETE missing in /tmp/kitbuild.log" >&2
  exit 1
fi

grep "KIT_COMPLETE" /tmp/kitbuild.log

for f in public/assets/kit/*.glb; do
  echo "Compressing $f with meshopt..."
  npx --yes @gltf-transform/cli@4 meshopt "$f" "$f" --level medium
done

echo "Kit GLB sizes:"
ls -lh public/assets/kit/*.glb
