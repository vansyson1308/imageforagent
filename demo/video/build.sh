#!/usr/bin/env sh
# Build demo/video/director_demo.mp4 (1920×1080, ≤ 3:00) from the recording +
# generated cards + narration. Needs ffmpeg, ffprobe, espeak-ng, node.
#   sh demo/video/build.sh              # final (needs _work/live.webm, film.mp4, showcase.webm + eval chart)
#   sh demo/video/build.sh --dry-run    # pipeline test → _work/director_demo.DRYRUN.mp4 (never upload)
set -e
cd "$(dirname "$0")/../.."
W=demo/video/_work
DRY=""
OUT=demo/video/director_demo.mp4
if [ "$1" = "--dry-run" ]; then DRY="--dry-run"; OUT=$W/director_demo.DRYRUN.mp4; fi
for t in ffmpeg ffprobe espeak-ng node; do command -v $t >/dev/null || { echo "missing: $t"; exit 1; }; done
for f in live.webm showcase.webm; do [ -f "$W/$f" ] || { echo "missing $W/$f: run demo/video/record.ts first"; exit 1; }; done

npx tsx demo/video/prepare.ts $DRY || [ $? -eq 2 ]

dur() { node -e "const p=require('./$W/plan.json');console.log(p.scenes.filter(s=>s.scene==='$1').reduce((a,s)=>a+s.duration,0))"; }
len() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
V="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0d0d0f,fps=30,format=yuv420p,setsar=1"
ENC="-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -an"

card() { # name seconds  (slow push-in)
  ffmpeg -loglevel error -y -loop 1 -framerate 30 -t "$2" -i "$W/cards/$1.png" \
    -vf "scale=2112:1188,zoompan=z='min(1+0.0006*on,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30,format=yuv420p,setsar=1" $ENC "$W/seg-$1.mp4"
}
stretch() { # in out seconds  (time-lapse or slow down to exactly N seconds)
  L=$(len "$1"); F=$(node -e "console.log(($3/$L).toFixed(6))")
  ffmpeg -loglevel error -y -i "$1" -vf "setpts=$F*PTS,$V" -t "$3" $ENC "$2"
}

card title "$(dur title)"
stretch "$W/live.webm" "$W/seg-live.mp4" "$(dur live)"
if [ -f "$W/film.mp4" ]; then
  ffmpeg -loglevel error -y -i "$W/film.mp4" -t "$(dur film)" -vf "$V,tpad=stop_mode=clone:stop_duration=$(dur film)" $ENC "$W/seg-film.mp4"
else
  L=$(len "$W/live.webm"); S=$(node -e "console.log(Math.max(0,$L-$(dur film)))")
  ffmpeg -loglevel error -y -ss "$S" -i "$W/live.webm" -t "$(dur film)" -vf "$V" $ENC "$W/seg-film.mp4"
fi
card arch "$(dur arch)"
card eval "$(dur eval)"
stretch "$W/showcase.webm" "$W/seg-showcase.mp4" "$(dur showcase)"
card end "$(dur end)"

printf "file 'seg-title.mp4'\nfile 'seg-live.mp4'\nfile 'seg-film.mp4'\nfile 'seg-arch.mp4'\nfile 'seg-eval.mp4'\nfile 'seg-showcase.mp4'\nfile 'seg-end.mp4'\n" > "$W/list.txt"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$W/list.txt" -c copy "$W/picture.mp4"
ffmpeg -loglevel error -y -i "$W/picture.mp4" -i "$W/narration.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT"

D=$(len "$OUT")
echo "built $OUT: ${D}s $(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUT")"
node -e "process.exit($D <= 180 ? 0 : 1)" || { echo "✘ longer than 3:00"; exit 1; }
echo "✔ ≤ 3:00 · subtitles: demo/video/director_demo.en.srt"
