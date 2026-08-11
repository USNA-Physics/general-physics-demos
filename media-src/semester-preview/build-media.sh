#!/usr/bin/env bash
# build-media.sh — regenerate the Semester Preview web-ready media.
#
# Downloads the public-domain / open-access sources (Wikimedia Commons + GWOSC),
# trims and normalizes them with ffmpeg into public/media/semester-preview/.
# Fully reproducible: no raw source binaries are committed, only this script and
# the normalized MP4/WAV the app ships. Run from anywhere:  bash build-media.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"                 # demos repo root
OUT="$root/public/media/semester-preview"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
command -v ffmpeg >/dev/null || { echo "ffmpeg required: brew install ffmpeg"; exit 1; }

commons_url () { # $1 = "File:Title.ext" -> direct upload URL
  curl -s --max-time 30 "https://commons.wikimedia.org/w/api.php?action=query&titles=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$1")&prop=imageinfo&iiprop=url&format=json" \
    | python3 -c 'import sys,json;print(list(json.load(sys.stdin)["query"]["pages"].values())[0]["imageinfo"][0]["url"])'
}

# vid <File title> <out.mp4> <ss> <dur> <height> <crf> [keepaudio]
vid () {
  local u; u="$(commons_url "$1")"
  curl -fsSL -A "usna-edu-download" -o "$TMP/in" "$u"
  local a=(-an)
  [ "${7:-}" = "audio" ] && a=(-c:a aac -b:a 96k)
  ffmpeg -y -loglevel error -ss "$3" -i "$TMP/in" -t "$4" -vf "scale=-2:$5" \
    -c:v libx264 -crf "$6" -preset slow -pix_fmt yuv420p "${a[@]}" -movflags +faststart "$2"
  echo "  built $(basename "$2")"
}

echo "Building Semester Preview media -> $OUT"
# Unit I-a: US Marine sniper, 31st MEU (bullet drop is projectile motion, wind is drag)
vid "File:31st MEU - U S Marines conduct aerial sniper training - B-Roll 8-8 (1011621).webm" "$OUT/sniper-marine.mp4"   3 12 720 24
# Act I-b: Apollo 15 hammer & feather — the actual drop (0:58–1:02), muted loop.
# NASA Apollo 15 footage (public domain); this YouTube transfer is clearer than the
# Commons OGV. Needs yt-dlp (brew install yt-dlp).
if command -v yt-dlp >/dev/null; then
  yt-dlp -q -f "bv*[height<=720]+ba/b[height<=720]/b" -o "$TMP/apollo.%(ext)s" "https://www.youtube.com/watch?v=KDp1tiUsZw8"
  ffmpeg -y -loglevel error -ss 57.5 -t 5 -i "$TMP"/apollo.* -vf "scale=-2:480" \
    -c:v libx264 -crf 24 -preset slow -pix_fmt yuv420p -an -movflags +faststart "$OUT/apollo15-hammer-feather.mp4"
  echo "  built apollo15-hammer-feather.mp4"
else
  echo "  SKIP apollo15-hammer-feather.mp4 (needs yt-dlp: brew install yt-dlp)"
fi
# Unit II-a: sea mine detonation (EOD / mine warfare, impulse and energy)
vid "File:What a sea mine explosion looks like.webm"                                 "$OUT/eod-seamine.mp4"              0 10 720 24
# Act II-b: gravity-assist flyby (NASA Lucy)
vid "File:Lucy Earth Gravity Assist One- Animations (SVS20372 - Lucy EGA Shot6 2160p30).webm" "$OUT/lucy-gravity-assist.mp4" 2 16 720 24
# Act III-a: spinning millisecond pulsar (NASA)
vid "File:Millisecond pulsar and accretion disk - NASA animation (hi-res).ogv"       "$OUT/pulsar-spin.mp4"              6 12 720 24
# Act III-b: Earth from low orbit (ISS)
vid "File:Down the American West Coast.ogv"                                           "$OUT/earth-orbit.mp4"              0 15 720 24
# Act IV-a: SM-2 air-defense missile launch (US Navy, USS Porter)
vid "File:230520-N-NQ285-2004 - USS Porter SM-2 launch Formidable Shield 2023.webm"  "$OUT/ddg-sm2-launch.mp4"           5 10 720 24
# Act IV-b: binary black hole merger (NASA), trimmed to the inspiral + merger
vid "File:Spinning binary black holes merging.webm"                                  "$OUT/bbh-merger.mp4"              33 16 720 24
# Unit I-c: Blue Angels banking turn (US Navy) — circular motion / g-loading
vid "File:Blue Angels US Navy 2025.webm"                                             "$OUT/blueangels-turn.mp4"         85 10 720 24
# Unit II-c: submarine-launched Trident II ballistic missile — kinetic <-> potential energy
vid "File:Trident II UGM-133A D5LE Missile from USS Wyoming, 2021.webm"              "$OUT/slbm-launch.mp4"            14 12 720 24
# Unit III-c: USS Pittsburgh emergency main-ballast blow (breach) — buoyancy control.
# US Navy footage (public domain), mirrored on YouTube; needs yt-dlp (brew install yt-dlp).
# SD 4:3 source, cropped to 16:9 from the top so the full bow stays in frame.
if command -v yt-dlp >/dev/null; then
  yt-dlp -q -f "bv*+ba/b" -o "$TMP/pitt.%(ext)s" "https://www.youtube.com/watch?v=rujJqZpexBU"
  ffmpeg -y -loglevel error -ss 5.5 -i "$TMP"/pitt.* -t 11 -vf "crop=640:360:0:0,scale=1280:720" \
    -c:v libx264 -crf 22 -preset slow -pix_fmt yuv420p -an -movflags +faststart "$OUT/submarine-breach.mp4"
  echo "  built submarine-breach.mp4"
else
  echo "  SKIP submarine-breach.mp4 (needs yt-dlp: brew install yt-dlp)"
fi
# Unit IV-c: US Navy destroyer (USS Dewey, DDG-105) rolling in heavy seas, seen from a
# carrier alongside (ship roll = mass on a spring, natural period). US Navy footage
# (public domain), mirrored on YouTube; needs yt-dlp. SD-safe 3:2 source cropped to 16:9.
if command -v yt-dlp >/dev/null; then
  yt-dlp -q -f "bv*+ba/b" -o "$TMP/dewey.%(ext)s" "https://www.youtube.com/watch?v=Zvzld04Q5XI"
  ffmpeg -y -loglevel error -ss 17 -i "$TMP"/dewey.* -t 11 -vf "scale=1280:854,crop=1280:720" \
    -c:v libx264 -crf 23 -preset slow -pix_fmt yuv420p -an -movflags +faststart "$OUT/oscillation-shiproll.mp4"
  echo "  built oscillation-shiproll.mp4"
else
  echo "  SKIP oscillation-shiproll.mp4 (needs yt-dlp: brew install yt-dlp)"
fi

# Act IV-b audio: LIGO GW150914 chirp (GWOSC open data)
curl -fsSL -o "$OUT/gw150914-chirp.wav" "https://gwosc.org/GW150914data/GW150914_H1_shifted.wav"
echo "  built gw150914-chirp.wav"
echo "Done."
