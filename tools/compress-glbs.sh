#!/usr/bin/env bash
# Meshopt-compress the Blender exports in place (EXT_meshopt_compression).
# Run after any tools/blender/*.py re-export. Decoder is vendored at public/vendor/meshopt_decoder.js.
set -euo pipefail
for f in public/assets/drone/drone.glb public/assets/lab/robotics-hero.glb public/assets/props/office-kit.glb; do
  npx --yes @gltf-transform/cli@4 meshopt "$f" "$f" --level medium
done
