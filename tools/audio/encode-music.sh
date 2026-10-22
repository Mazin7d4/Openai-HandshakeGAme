#!/usr/bin/env bash
# Encodes rendered music loops (tools/audio/render-music.mjs) to public/audio as OGG Vorbis + AAC (m4a, Safari fallback).
set -euo pipefail
src=${1:-../sprint/audio-build}
for name in music-calm music-escape; do
  ffmpeg -v error -y -i "$src/$name.wav" -c:a libvorbis -q:a 2 "public/audio/$name.ogg"
  ffmpeg -v error -y -i "$src/$name.wav" -c:a aac -b:a 80k -movflags +faststart "public/audio/$name.m4a"
done
