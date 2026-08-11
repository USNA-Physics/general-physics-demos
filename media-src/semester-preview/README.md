# Semester Preview media

Source manifest and regeneration for the media used by the SP211 Semester Preview
deck (`src/courses/sp211/semester-preview/`). The normalized, web-ready files the
app ships live in `public/media/semester-preview/` and are committed. The raw
sources are **not** committed; `build-media.sh` re-downloads and normalizes them.

```bash
brew install ffmpeg          # once
bash media-src/semester-preview/build-media.sh
```

## Manifest

| Act | Web file | Source | License | Trim |
|---|---|---|---|---|
| I-a | `sniper-marine.mp4` | Commons: *31st MEU, US Marines conduct aerial sniper training (B-Roll 8-8)* | US Marine Corps, PD | 3–15 s |
| I-b | `apollo15-hammer-feather.mp4` | YouTube `KDp1tiUsZw8` — Apollo 15 hammer/feather drop | NASA, public domain | 57.5–62.5 s (the drop) |
| II-a | `eod-seamine.mp4` | Commons: *What a sea mine explosion looks like* | CC (Wikimedia) | 0–10 s |
| II-b | `lucy-gravity-assist.mp4` | Commons: *Lucy Earth Gravity Assist* (SVS20372) | NASA, public domain | 2–18 s |
| III-a | `pulsar-spin.mp4` | Commons: *Millisecond pulsar and accretion disk* | NASA, public domain | 6–18 s |
| III-b | `earth-orbit.mp4` | Commons: *Down the American West Coast* (ISS) | NASA, public domain | 0–15 s |
| IV-a | `ddg-sm2-launch.mp4` | Commons: *USS Porter SM-2 launch, Formidable Shield 2023* | US Navy, public domain | 5–15 s |
| IV-b | `bbh-merger.mp4` | Commons: *Spinning binary black holes merging* | NASA, public domain | 33–49 s (merger) |
| I-c | `blueangels-turn.mp4` | Commons: *Blue Angels US Navy 2025* | US Navy, public domain | 128–138 s |
| II-c | `slbm-launch.mp4` | Commons: *Trident II UGM-133A D5LE Missile from USS Wyoming, 2021* | US Navy, public domain | 14–26 s |
| III-c | `submarine-breach.mp4` | YouTube mirror *USS Pittsburgh EMBT blow* (yt-dlp) | US Navy footage, public domain | 5.5–16.5 s |
| IV-c | `oscillation-shiproll.mp4` | YouTube mirror *DDG-105 takes a nose-dive* (USS Dewey, yt-dlp) | US Navy footage, public domain | 17–28 s |
| IV-b | `gw150914-chirp.wav` | [GWOSC](https://gwosc.org/audio/) GW150914 (H1, shifted) | LIGO/Virgo open data | as-is |

All clips are H.264 MP4 (faststart), muted except Apollo. Everything is downloaded
so nothing streams during class. To refresh or re-trim a clip, edit the matching
line in `build-media.sh` and re-run it.
