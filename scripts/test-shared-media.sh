#!/usr/bin/env bash
set -euo pipefail
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
shared_fixture_dir=$(mktemp -d)
trap 'rm -rf "$shared_fixture_dir"' EXIT
ffmpeg -v error -f lavfi -i color=red:size=160x120:duration=3:rate=5 -f lavfi -i color=blue:size=160x120:duration=3:rate=5 -filter_complex '[0:v]drawbox=x=15:y=20:w=90:h=30:color=white:t=fill[a];[1:v]drawbox=x=60:y=60:w=90:h=30:color=yellow:t=fill[b];[a][b]concat=n=2:v=1:a=0[out]' -map '[out]' -c:v libx264 -pix_fmt yuv420p "$shared_fixture_dir/visual.mp4"
ffmpeg -v error -i "$shared_fixture_dir/visual.mp4" -f lavfi -i sine=frequency=440:duration=6 -c:v copy -c:a aac -shortest "$shared_fixture_dir/audio.mp4"
ffmpeg -v error -f lavfi -i color=black:size=32x32:duration=181:rate=1 -c:v libx264 -pix_fmt yuv420p "$shared_fixture_dir/long.mp4"
RYANOS_SHARED_MEDIA_FIXTURES="$shared_fixture_dir" pnpm --filter @ryanos/api exec vitest run test/shared-media.test.ts
