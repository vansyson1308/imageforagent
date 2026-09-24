/**
 * timeline — dựng dòng thời gian của phim từ storyboard: frame tĩnh giữ
 * `playbackSpeed` giây, frame motion chiếm đúng thời lượng clip. Pure,
 * unit-tested; dùng chung cho storyboard.json, captions.srt và assemble.sh
 * (một nguồn timing duy nhất — phụ đề không bao giờ lệch hình).
 */

export interface TimelineInput {
  readonly index: number;
  readonly description: string;
  /** Có ⇒ frame là shot hoạt hình. */
  readonly clip?: {
    readonly fps: number;
    readonly frameCount: number;
    readonly duration: number;
  } | null;
  /** Giọng thoại: bắt đầu `offset` giây sau đầu shot, dài `duration`. */
  readonly voice?: { readonly offset: number; readonly duration: number } | null;
}

export interface TimelineEntry {
  readonly index: number;
  readonly kind: "still" | "clip";
  readonly startSec: number;
  readonly durationSec: number;
  readonly fps?: number;
  readonly frameCount?: number;
  /** Thời điểm tuyệt đối giọng bắt đầu / thời lượng (nếu có thoại). */
  readonly voiceStart?: number;
  readonly voiceDuration?: number;
}

/** Khoảng thở sau câu thoại trên frame TĨNH (giây). */
export const DIALOGUE_TAIL = 0.35;

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function buildTimeline(frames: readonly TimelineInput[], secondsPerStill: number): TimelineEntry[] {
  const still = Math.max(0.1, secondsPerStill);
  const ordered = frames.slice().sort((a, b) => a.index - b.index);
  let cursor = 0;
  return ordered.map((f) => {
    const entry: TimelineEntry = f.clip
      ? {
          index: f.index,
          kind: "clip",
          startSec: round3(cursor),
          // Thời lượng THẬT của chuỗi frame (frameCount/fps), không phải duration khai
          durationSec: round3(f.clip.frameCount / f.clip.fps),
          fps: f.clip.fps,
          frameCount: f.clip.frameCount,
        }
      : {
          index: f.index,
          kind: "still",
          startSec: round3(cursor),
          // Frame tĩnh có thoại giữ tới hết câu (+ khoảng thở) — clip giữ nguyên độ dài
          durationSec: round3(Math.max(still, f.voice ? f.voice.offset + f.voice.duration + DIALOGUE_TAIL : 0)),
        };
    const withVoice: TimelineEntry = f.voice
      ? { ...entry, voiceStart: round3(cursor + f.voice.offset), voiceDuration: round3(Math.min(f.voice.duration, entry.durationSec - f.voice.offset)) }
      : entry;
    cursor += entry.durationSec;
    return withVoice;
  });
}

export function timelineDuration(entries: readonly TimelineEntry[]): number {
  const last = entries[entries.length - 1];
  return last ? round3(last.startSec + last.durationSec) : 0;
}

// ---------- assemble.sh ----------

export interface AssembleShot {
  readonly badge: string;
  readonly entry: TimelineEntry;
}

/**
 * Script POSIX sh dựng film.mp4 bằng ffmpeg từ gói export: mỗi shot → một
 * segment chuẩn hoá (cùng fps, kích thước chẵn, yuv420p) → concat demuxer.
 * Shot clip giữ nhịp gốc (12fps on twos… được nhân frame lên fps phim).
 */
export function buildAssembleScript(shots: readonly AssembleShot[], filmFps = 24, audio?: { readonly mix: string }): string {
  const lines = [
    "#!/usr/bin/env sh",
    "# Dựng film.mp4 từ gói export Storyboard Studio — cần ffmpeg (https://ffmpeg.org).",
    "# Chạy trong thư mục đã giải nén:  sh assemble.sh   (FPS=25 sh assemble.sh để đổi nhịp phim)",
    "# Phụ đề: ffmpeg -i film.mp4 -vf subtitles=captions.srt film-sub.mp4",
    "# Chiếu rạp (DCP): xuất PNG 24fps 1998x1080 rồi đóng gói bằng DCP-o-matic (dcpomatic2_create + dcpomatic2_cli).",
    "set -e",
    `FPS="\${FPS:-${filmFps}}"`,
    'VF="fps=$FPS,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p"',
    "mkdir -p _shots",
    ": > _shots/list.txt",
  ];
  for (const { badge, entry } of shots) {
    const out = `_shots/${badge}.mp4`;
    if (entry.kind === "clip") {
      lines.push(
        `ffmpeg -loglevel error -y -framerate ${entry.fps} -i clips/${badge}/%04d.png -vf "$VF" -c:v libx264 -crf 18 -pix_fmt yuv420p ${out}`,
      );
    } else {
      lines.push(
        `ffmpeg -loglevel error -y -loop 1 -framerate "$FPS" -t ${entry.durationSec} -i ${badge}.png -vf "$VF" -c:v libx264 -crf 18 -tune stillimage -pix_fmt yuv420p ${out}`,
      );
    }
    lines.push(`echo "file '${badge}.mp4'" >> _shots/list.txt`);
  }
  if (audio) {
    // Mix 48 kHz đã khớp timeline (engine tính sẵn) → mux AAC vào phim
    lines.push(
      "ffmpeg -loglevel error -y -f concat -safe 0 -i _shots/list.txt -c copy _shots/picture.mp4",
      `ffmpeg -loglevel error -y -i _shots/picture.mp4 -i ${audio.mix} -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest film.mp4`,
    );
  } else {
    lines.push("ffmpeg -loglevel error -y -f concat -safe 0 -i _shots/list.txt -c copy film.mp4");
  }
  lines.push(
    'echo "film.mp4 ready ($(wc -l < _shots/list.txt) shots)"',
    "",
  );
  return lines.join("\n");
}
