#!/usr/bin/env sh
# Build demo/video/director_demo.mp4 (1920×1080, ≤ 3:00) from the recording +
# generated cards + narration. Needs ffmpeg, ffprobe, espeak-ng, node.
#   sh demo/video/build.sh              # final (needs _work/live.mp4|webm, film.mp4, showcase.mp4|webm + eval chart)
#   sh demo/video/build.sh --dry-run    # pipeline test → _work/director_demo.DRYRUN.mp4 (never upload)
set -e
cd "$(dirname "$0")/../.."
W=demo/video/_work
DRY=""
OUT=demo/video/director_demo.mp4
if [ "$1" = "--dry-run" ]; then DRY="--dry-run"; OUT=$W/director_demo.DRYRUN.mp4; fi
for t in ffmpeg ffprobe espeak-ng node; do command -v $t >/dev/null || { echo "missing: $t"; exit 1; }; done
[ -f "$W/live.mp4" ] || [ -f "$W/live.webm" ] || { echo "missing $W/live.mp4: run demo/video/record-smooth.ts first"; exit 1; }
[ -f "$W/showcase.mp4" ] || [ -f "$W/showcase.webm" ] || { echo "missing $W/showcase.mp4: run demo/video/record-smooth.ts first"; exit 1; }

npx tsx demo/video/prepare.ts $DRY || [ $? -eq 2 ]

dur() { node -e "const p=require('./$W/plan.json');console.log(p.scenes.filter(s=>s.scene==='$1').reduce((a,s)=>a+s.duration,0))"; }
len() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
V="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0d0d0f,fps=30,format=yuv420p,setsar=1"
ENC="-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -an"

X=0.5   # crossfade between scenes (each segment gets X extra seconds; xfade overlaps them)
ext() { node -e "console.log(($1)+$X)"; }

card() { # name seconds: smooth push-in. zoompan rounds x/y to whole input pixels, so zoom on a 4× upscale
  N=$(node -e "console.log(Math.round(($2+$X)*30))")
  ffmpeg -loglevel error -y -i "$W/cards/$1.png" \
    -vf "scale=7680:4320:flags=lanczos,zoompan=z='1+0.05*(1-cos(PI*on/$N))/2':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=$N:s=1920x1080:fps=30,format=yuv420p,setsar=1" \
    -frames:v "$N" $ENC "$W/seg-$1.mp4"
}
fit() { # in out seconds: play a smooth capture at the speed that fills exactly N seconds (+X tail)
  L=$(len "$1"); F=$(node -e "console.log(($3/$L).toFixed(6))")
  ffmpeg -loglevel error -y -i "$1" -vf "setpts=$F*PTS,fps=30,$V,tpad=stop_mode=clone:stop_duration=2" -t "$(ext $3)" $ENC "$2"
}
stretch() { # legacy: time-lapse a recordVideo webm to exactly N seconds (+X tail)
  L=$(len "$1"); F=$(node -e "console.log(($3/$L).toFixed(6))")
  ffmpeg -loglevel error -y -i "$1" -vf "setpts=$F*PTS,$V,tpad=stop_mode=clone:stop_duration=2" -t "$(ext $3)" $ENC "$2"
}

card title "$(dur title)"
if [ -f "$W/live.mp4" ] && [ -f "$W/live.json" ]; then
  # record-smooth.ts: A (typing) and C (result tour) at 1×, B (the run) time-lapsed into the rest
  eval "$(node -e "const j=require('./$W/live.json'),D=$(dur live),a=j.a/j.fps,b=j.b/j.fps,c=j.c/j.fps;console.log('LA='+a+' LAB='+(a+b)+' LF='+(Math.max(1,D-a-c)/b).toFixed(6))")"
  ffmpeg -loglevel error -y -i "$W/live.mp4" -filter_complex \
    "[0:v]trim=0:$LA,setpts=PTS-STARTPTS[a];[0:v]trim=$LA:$LAB,setpts=(PTS-STARTPTS)*$LF,framerate=fps=30:interp_start=0:interp_end=255[b];[0:v]trim=start=$LAB,setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1:a=0,$V,tpad=stop_mode=clone:stop_duration=2[v]" \
    -map "[v]" -t "$(ext $(dur live))" $ENC "$W/seg-live.mp4"
else
  stretch "$W/live.webm" "$W/seg-live.mp4" "$(dur live)"
fi
if [ -f "$W/film.mp4" ]; then
  ffmpeg -loglevel error -y -i "$W/film.mp4" -vf "fps=30,$V,tpad=stop_mode=clone:stop_duration=2" -t "$(ext $(dur film))" $ENC "$W/seg-film.mp4"
else
  L=$(len "$W/live.webm"); S=$(node -e "console.log(Math.max(0,$L-$(dur film)))")
  ffmpeg -loglevel error -y -ss "$S" -i "$W/live.webm" -vf "$V,tpad=stop_mode=clone:stop_duration=2" -t "$(ext $(dur film))" $ENC "$W/seg-film.mp4"
fi
card arch "$(dur arch)"
card eval "$(dur eval)"
if [ -f "$W/showcase.mp4" ]; then fit "$W/showcase.mp4" "$W/seg-showcase.mp4" "$(dur showcase)"; else stretch "$W/showcase.webm" "$W/seg-showcase.mp4" "$(dur showcase)"; fi
card end "$(dur end)"

# Crossfade chain: segment i starts fading into i+1 at the scene boundary, so narration timing is kept
SEGS="title live film arch eval showcase end"
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
node -e "process.exit($D <= 180 ? 0 : 1)" || { echo "✘ longer than 3:00"; exit 1; }
echo "✔ ≤ 3:00 · subtitles: demo/video/director_demo.en.srt"
