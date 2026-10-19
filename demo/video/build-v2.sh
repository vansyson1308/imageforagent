#!/usr/bin/env sh
# Build demo/video/out/director_demo_v2.mp4 (1920×1080) from narration.v2.json + cut.v2.json:
#   kite    a story-order highlight of the published kite film (cut.v2.json "hook": shots 1, 2, 5, 7, 9, 10)
#   replay  the kite's real run replayed from its trace (record-smooth.ts --only replay → _work/replay.mp4 + replay.json):
#           the run time-fitted, then the move to the finished card and a 3 s hold at 1×
#   films   bánh chưng (16:9) and tegami (9:16) side by side, their strongest shots (cut.v2.json "films")
#   arch    the v2 architecture (docs/media/director-architecture-v2.svg), slow push-in
#   eval    the results card, revealed line by line with the narration (_work/eval-stages.json), slow push-in
#   end     the end card
# No live run and no model call: every picture is a published film, a replay of a stored trace, or a card.
#   sh demo/video/build-v2.sh              # final (refuses while narration.v2.json has a {{PENDING}} slot)
#   sh demo/video/build-v2.sh --dry-run    # pipeline test → _work/director_demo_v2.DRYRUN.mp4 (never upload)
set -e
cd "$(dirname "$0")/../.."
W=demo/video/_work
CUT=demo/video/cut.v2.json
DRY=""
OUT=demo/video/out/director_demo_v2.mp4
if [ "$1" = "--dry-run" ]; then DRY="--dry-run"; OUT=$W/director_demo_v2.DRYRUN.mp4; fi
mkdir -p demo/video/out
for t in ffmpeg ffprobe node; do command -v $t >/dev/null || { echo "missing: $t"; exit 1; }; done
[ -f "$W/replay.mp4" ] && [ -f "$W/replay.json" ] || { echo "missing $W/replay.mp4|json: npx tsx demo/video/record-smooth.ts --only replay"; exit 1; }

npx tsx demo/video/prepare.ts --narration narration.v2.json --arch docs/media/director-architecture-v2.svg --eval-card demo/video/eval-card.v2.json $DRY || [ $? -eq 2 ]

dur() { node -e "const p=require('./$W/plan.json');console.log(p.scenes.filter(s=>s.scene==='$1').reduce((a,s)=>a+s.duration,0))"; }
js() { node -e "const c=require('./$CUT');console.log($1)"; }
V="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0d0d0f,fps=30,format=yuv420p,setsar=1"
ENC="-c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an"
X=0.5   # crossfade between scenes (each segment gets X extra seconds; xfade overlaps them)
ext() { node -e "console.log(($1)+$X)"; }

# cards: a slow push-in on a 4× upscale (zoompan rounds to whole pixels). card NAME SECONDS ZOOM [FROM_FRAME TOTAL_FRAMES]
card() {
  N=$(node -e "console.log(Math.round(($2)*30))")
  OFF=${4:-0}; TOT=${5:-$N}
  ffmpeg -loglevel error -y -i "$W/cards/$1.png" \
    -vf "scale=7680:4320:flags=lanczos,zoompan=z='1+$3*(1-cos(PI*(on+$OFF)/$TOT))/2':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=$N:s=1920x1080:fps=30,format=yuv420p,setsar=1" \
    -frames:v "$N" $ENC "$W/seg-$1.mp4"
}

# kite: the hook highlight, in story order, joined with short crossfades
KF=$(js "c.hook.film"); KX=$(js "c.hook.xfade"); NK=$(js "c.hook.clips.length")
I=0; IN=""; CH=""; PREV="0:v"; OFF=0
while [ $I -lt $NK ]; do
  A=$(js "c.hook.clips[$I].from"); B=$(js "c.hook.clips[$I].to")
  ffmpeg -loglevel error -y -ss "$A" -to "$B" -i "$KF" -vf "scale=1920:1080:flags=lanczos,fps=30,format=yuv420p,setsar=1" $ENC "$W/hook-$I.mp4"
  IN="$IN -i $W/hook-$I.mp4"
  if [ $I -gt 0 ]; then CH="$CH[$PREV][$I:v]xfade=transition=fade:duration=$KX:offset=$OFF[h$I];"; PREV="h$I"; fi
  OFF=$(node -e "console.log(($OFF)+($B-$A)-$KX)")
  I=$((I+1))
done
ffmpeg -loglevel error -y $IN -filter_complex "${CH}[$PREV]tpad=stop_mode=clone:stop_duration=2[v]" -map "[v]" -t "$(ext $(dur kite))" $ENC "$W/seg-kite.mp4"

# replay: A (the run) fitted to the scene minus the tail; B (beat, move, 3 s hold on the finished card) at 1×
eval "$(node -e "const j=require('./$W/replay.json'),D=$(dur replay)+$X,tail=j.tail/j.fps,run=j.run/j.fps;console.log('RF='+j.run+' RS='+((D-tail)/run).toFixed(6))")"
ffmpeg -loglevel error -y -i "$W/replay.mp4" -filter_complex \
  "[0:v]trim=start_frame=0:end_frame=$RF,setpts=(PTS-STARTPTS)*$RS,fps=30[a];[0:v]trim=start_frame=$RF,setpts=PTS-STARTPTS,fps=30[b];[a][b]concat=n=2:v=1:a=0,$V,tpad=stop_mode=clone:stop_duration=2[v]" \
  -map "[v]" -t "$(ext $(dur replay))" $ENC "$W/seg-replay.mp4"

# films: each side plays its chosen shots back to back (hard cuts on the films' own shot changes)
side() { # side-name out-w out-h
  F=$(js "c.films.$1.film"); NC=$(js "c.films.$1.clips.length"); J=0; L=""
  while [ $J -lt $NC ]; do
    A=$(js "c.films.$1.clips[$J][0]"); B=$(js "c.films.$1.clips[$J][1]")
    ffmpeg -loglevel error -y -ss "$A" -to "$B" -i "$F" -vf "scale=$2:$3:flags=lanczos,fps=30,format=yuv420p,setsar=1" $ENC "$W/$1-$J.mp4"
    L="$L$W/$1-$J.mp4|"; echo "file '$(pwd)/$W/$1-$J.mp4'" >> "$W/$1.txt"
    J=$((J+1))
  done
}
rm -f "$W/left.txt" "$W/right.txt"
side left 1280 720
side right 608 1080
ffmpeg -loglevel error -y -f concat -safe 0 -i "$W/left.txt" -c copy "$W/left.mp4"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$W/right.txt" -c copy "$W/right.mp4"
ffmpeg -loglevel error -y -i "$W/left.mp4" -i "$W/right.mp4" -filter_complex \
  "color=c=0x0d0d0f:s=1920x1080:r=30[bg];[0:v]tpad=stop_mode=clone:stop_duration=3[a];[1:v]tpad=stop_mode=clone:stop_duration=3[b];[bg][a]overlay=0:180:shortest=0[t];[t][b]overlay=1312:0,format=yuv420p,setsar=1[v]" \
  -map "[v]" -t "$(ext $(dur films))" $ENC "$W/seg-films.mp4"

# arch: a slow, visible push-in
card arch "$(ext $(dur arch))" 0.12

# eval: one still per reveal stage, the push-in continuous across them
ED=$(ext $(dur eval)); ETOT=$(node -e "console.log(Math.round($ED*30))")
NS=$(node -e "console.log(require('./$W/eval-stages.json').starts.length)")
K=0; : > "$W/eval.txt"
while [ $K -lt $NS ]; do
  S0=$(node -e "console.log(require('./$W/eval-stages.json').starts[$K])")
  S1=$(node -e "const s=require('./$W/eval-stages.json').starts;console.log($K+1<s.length?s[$K+1]:$ED)")
  NAME=$([ $((K+1)) -eq $NS ] && echo eval || echo "eval-$K")
  F0=$(node -e "console.log(Math.round($S0*30))")
  card "$NAME" "$(node -e "console.log($S1-$S0)")" 0.08 "$F0" "$ETOT"
  mv "$W/seg-$NAME.mp4" "$W/evalpart-$K.mp4"; echo "file '$(pwd)/$W/evalpart-$K.mp4'" >> "$W/eval.txt"
  K=$((K+1))
done
ffmpeg -loglevel error -y -f concat -safe 0 -i "$W/eval.txt" -c copy "$W/seg-eval.mp4"

card end "$(ext $(dur end))" 0.04

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

D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")
echo "built $OUT: ${D}s $(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUT")"
node -e "process.exit($D <= 175 ? 0 : 1)" || { echo "✘ longer than 2:55"; exit 1; }
echo "✔ ≤ 2:55 · subtitles: demo/video/out/director_demo_v2.en.srt"
