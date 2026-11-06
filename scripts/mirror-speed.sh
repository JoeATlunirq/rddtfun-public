#!/bin/bash
# Mirror (horizontal flip) and speed up every video in a folder, at visually lossless quality.
#
# Usage: scripts/mirror-speed.sh <input-folder> [speed=1.5] [output-folder]
# Output defaults to "<input-folder> (mirrored <speed>x)". Originals are never modified, and clips
# that already exist in the output folder are skipped, so the script can be stopped and re-run.
#
# Mirroring and re-timing can't be stream-copied, so video is re-encoded with x264 CRF 18
# (visually lossless) at the source frame rate; audio keeps its pitch (atempo).
set -euo pipefail

IN="${1:?Usage: $0 <input-folder> [speed=1.5] [output-folder]}"
SPEED="${2:-1.5}"
OUT="${3:-${IN%/} (mirrored ${SPEED}x)}"
CRF="${CRF:-18}"
PRESET="${PRESET:-slow}"

mkdir -p "$OUT"
shopt -s nullglob nocaseglob
files=("$IN"/*.mp4 "$IN"/*.mov "$IN"/*.mkv "$IN"/*.webm)
total=${#files[@]}
done_count=0

for src in "${files[@]}"; do
    name="$(basename "${src%.*}").mp4"
    dst="$OUT/$name"
    done_count=$((done_count + 1))
    if [ -s "$dst" ]; then
        echo "[$done_count/$total] skip (exists): $name"
        continue
    fi
    fps="$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$src")"
    has_audio="$(ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "$src")"
    audio_args=(-an)
    [ -n "$has_audio" ] && audio_args=(-af "atempo=$SPEED" -c:a aac -b:a 192k)

    echo "[$done_count/$total] $name"
    # Write to a temp file first so an interrupted encode is never mistaken for a finished one
    ffmpeg -v error -stats -y -i "$src" \
        -vf "hflip,setpts=PTS/$SPEED,fps=$fps" \
        -c:v libx264 -preset "$PRESET" -crf "$CRF" -pix_fmt yuv420p \
        -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
        "${audio_args[@]}" -movflags +faststart \
        "$dst.part.mp4"
    mv "$dst.part.mp4" "$dst"
done

echo "Done: $OUT"
