#!/usr/bin/env sh
# Build demo/video/out/director_demo_v2.mp4 (1920×1080, ≤ 2:55) from narration.v2.json:
#   kite    the published kite film from 0 s (public/showcase/v2-kite/film.mp4) — the kite in the first seconds
#   replay  the kite's real run replayed from its trace (record-smooth.ts --only replay → _work/replay.mp4)
#   films   bánh chưng (16:9) and tegami (9:16) side by side, as published
#   arch / eval / end   cards from prepare.ts
# No live run and no model call: every picture is a published film, a replay of a stored trace, or a card.
#   sh demo/video/build-v2.sh              # final (refuses while narration.v2.json has a {{PENDING}} slot)
#   sh demo/video/build-v2.sh --dry-run    # pipeline test → _work/director_demo_v2.DRYRUN.mp4 (never upload)
set -e
cd "$(dirname "$0")/../.."
W=demo/video/_work
S=public/showcase
DRY=""
OUT=demo/video/out/director_demo_v2.mp4
if [ "$1" = "--dry-run" ]; then DRY="--dry-run"; OUT=$W/director_demo_v2.DRYRUN.mp4; fi
mkdir -p demo/video/out
for t in ffmpeg ffprobe node; do command -v $t >/dev/null || { echo "missing: $t"; exit 1; }; done
[ -f "$W/replay.mp4" ] || { echo "missing $W/replay.mp4: npx tsx demo/video/record-smooth.ts --only replay"; exit 1; }
for f in v2-kite v2-banh-chung v2-tegami; do [ -f "$S/$f/film.mp4" ] || { echo "missing $S/$f/film.mp4"; exit 1; }; done

npx tsx demo/video/prepare.ts --narration narration.v2.json --chart docs/hackathon/eval/v2/chart.png $DRY || [ $? -eq 2 ]

dur() { node -e "const p=require('./$W/plan.json');console.log(p.scenes.filter(s=>s.scene==='$1').reduce((a,s)=>a+s.duration,0))"; }
len() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
V="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0d0d0f,fps=30,format=yuv420p,setsar=1"
ENC="-c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an"
X=0.5   # crossfade between scenes (each segment gets X extra seconds; xfade overlaps them)
ext() { node -e "console.log(($1)+$X)"; }

card() { # name seconds: smooth push-in on a 4× upscale (zoompan rounds to whole pixels)
  N=$(node -e "console.log(Math.round(($2+$X)*30))")
  ffmpeg -loglevel error -y -i "$W/cards/$1.png" \
    -vf "scale=7680:4320:flags=lanczos,zoompan=z='1+0.05*(1-cos(PI*on/$N))/2':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=$N:s=1920x1080:fps=30,format=yuv420p,setsar=1" \
    -frames:v "$N" $ENC "$W/seg-$1.mp4"
}
fit() { # in out seconds: play a capture at the speed that fills exactly N seconds (+X tail)
  L=$(len "$1"); F=$(node -e "console.log(($3/$L).toFixed(6))")
  ffmpeg -loglevel error -y -i "$1" -vf "setpts=$F*PTS,fps=30,$V,tpad=stop_mode=clone:stop_duration=2" -t "$(ext $3)" $ENC "$2"
}

# kite: the film itself from its first frame, at 1× (its own sound is left out under the voice-over)
ffmpeg -loglevel error -y -i "$S/v2-kite/film.mp4" -vf "scale=1920:1080:flags=lanczos,fps=30,format=yuv420p,setsar=1,tpad=stop_mode=clone:stop_duration=2" -t "$(ext $(dur kite))" $ENC "$W/seg-kite.mp4"
fit "$W/replay.mp4" "$W/seg-replay.mp4" "$(dur replay)"
# films: bánh chưng 1280×720 on the left, tegami 608×1080 on the right, both at 1× from a few seconds in
ffmpeg -loglevel error -y -ss 6 -i "$S/v2-banh-chung/film.mp4" -ss 3 -i "$S/v2-tegami/film.mp4" -filter_complex \
  "color=c=0x0d0d0f:s=1920x1080:r=30[bg];[0:v]scale=1280:720:flags=lanczos,fps=30[a];[1:v]scale=608:1080:flags=lanczos,fps=30[b];[bg][a]overlay=0:180:shortest=0[t];[t][b]overlay=1312:0,format=yuv420p,setsar=1[v]" \
  -map "[v]" -t "$(ext $(dur films))" $ENC "$W/seg-films.mp4"
card arch "$(dur arch)"
card eval "$(dur eval)"
card end "$(dur end)"

# Crossfade chain: segment i fades into i+1 at the scene boundary, so narration timing is kept
SEGS="kite replay films arch eval end"
INPUTS=""; CHAIN=""; PREV="0:v"; OFF=0; I=0
for s in $SEGS; do INPUTS="$INPUTS -i $W/seg-$s.mp4"; done
for s in $SEGS; do
  if [ $I -gt 0 ]; then
    CHAIN="$CHAIN[$PREV][$I:v]xfade=transition=fade:duration=$X:offset=$OFF[x$I];"
    PREV="x$I"
  fi
  OFF=$(node -e "console.log(($OFF)+$(dur $s))")
  I=$((I+1))
done
TOTAL=$(node -e "console.log(require('./$W/plan.json').total)")
ffmpeg -loglevel error -y $INPUTS -filter_complex "${CHAIN%;}" -map "[$PREV]" -t "$TOTAL" $ENC "$W/picture.mp4"
ffmpeg -loglevel error -y -i "$W/picture.mp4" -i "$W/narration.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT"

D=$(len "$OUT")
echo "built $OUT: ${D}s $(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUT")"
node -e "process.exit($D <= 175 ? 0 : 1)" || { echo "✘ longer than 2:55"; exit 1; }
echo "✔ ≤ 2:55 · subtitles: demo/video/out/director_demo_v2.en.srt"
