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
  /** Chuyển cảnh VÀO frame này (chồng lên cuối shot trước). */
  readonly transition?: { readonly kind: string; readonly duration: number } | null;
  readonly scene?: string | null;
}

export type TransitionKind = "cut" | "dissolve" | "fadeBlack" | "fadeWhite" | "wipeLeft" | "wipeRight" | "slideLeft" | "slideRight";

/** Tên transition tương ứng của bộ lọc ffmpeg xfade. */
export const XFADE_NAME: Record<Exclude<TransitionKind, "cut">, string> = {
  dissolve: "fade",
  fadeBlack: "fadeblack",
  fadeWhite: "fadewhite",
  wipeLeft: "wipeleft",
  wipeRight: "wiperight",
  slideLeft: "slideleft",
  slideRight: "slideright",
};

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
  /** Chuyển cảnh vào shot (đã kẹp theo độ dài hai shot kề) — vắng = cut. */
  readonly transitionIn?: { readonly kind: Exclude<TransitionKind, "cut">; readonly duration: number };
  readonly scene?: string | null;
}

/** Khoảng thở sau câu thoại trên frame TĨNH (giây). */
export const DIALOGUE_TAIL = 0.35;


/** Nhịp phim mặc định — timeline lượng tử hoá theo frame của nhịp này. */
export const FILM_FPS = 24;

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Timeline lượng tử hoá theo FRAME PHIM (mặc định 24 fps): mọi đầu shot,
 * thời lượng, chuyển cảnh là số nguyên frame ⇒ EDL/OTIO/DCP khớp tuyệt đối.
 * Still: ceil (câu thoại luôn vừa); chuyển cảnh: số frame CHẴN (điểm cắt
 * giữa vùng chồng rơi đúng frame), ≤ nửa shot ngắn hơn.
 */
export function buildTimeline(frames: readonly TimelineInput[], secondsPerStill: number, filmFps = FILM_FPS): TimelineEntry[] {
  const still = Math.max(0.1, secondsPerStill);
  const ordered = frames.slice().sort((a, b) => a.index - b.index);
  const toSec = (fr: number) => round6(fr / filmFps);
  let prevEndF = 0;
  let prevDurF = 0;
  return ordered.map((f, k) => {
    const durF = f.clip
      ? // Thời lượng THẬT của chuỗi frame (frameCount/fps) quy ra frame phim
        Math.max(1, Math.round((f.clip.frameCount / f.clip.fps) * filmFps))
      : // Frame tĩnh có thoại giữ tới hết câu (+ khoảng thở)
        Math.max(1, Math.ceil(Math.max(still, f.voice ? f.voice.offset + f.voice.duration + DIALOGUE_TAIL : 0) * filmFps - 1e-9));
    let transitionIn: TimelineEntry["transitionIn"];
    let tF = 0;
    if (k > 0 && f.transition && f.transition.kind !== "cut" && f.transition.kind in XFADE_NAME) {
      const want = Math.round((f.transition.duration * filmFps) / 2) * 2;
      const cap = Math.floor(Math.min(prevDurF, durF) / 4) * 2; // ≤ nửa shot, chẵn
      tF = Math.max(0, Math.min(want, cap));
      if (tF > 0) transitionIn = { kind: f.transition.kind as Exclude<TransitionKind, "cut">, duration: toSec(tF) };
    }
    const startF = prevEndF - tF;
    const startSec = toSec(startF);
    const durationSec = toSec(durF);
    const entry: TimelineEntry = {
      index: f.index,
      kind: f.clip ? "clip" : "still",
      startSec,
      durationSec,
      ...(f.clip && { fps: f.clip.fps, frameCount: f.clip.frameCount }),
      ...(f.voice && {
        voiceStart: round6(startSec + f.voice.offset),
        voiceDuration: round6(Math.max(0, Math.min(f.voice.duration, durationSec - f.voice.offset))),
      }),
      ...(transitionIn && { transitionIn }),
      ...(f.scene !== undefined && { scene: f.scene }),
    };
    prevEndF = startF + durF;
    prevDurF = durF;
    return entry;
  });
}

export function timelineDuration(entries: readonly TimelineEntry[]): number {
  const last = entries[entries.length - 1];
  return last ? round6(last.startSec + last.durationSec) : 0;
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
  const picture = audio ? "_shots/picture.mp4" : "film.mp4";
  if (shots.some((s) => s.entry.transitionIn)) {
    // Chuyển cảnh: một filter graph — xfade tại offset = startSec shot vào
    // (chuỗi trước đó dài đúng start + overlap), concat cho các cut
    const inputs = shots.map((s) => `-i _shots/${s.badge}.mp4`).join(" ");
    const parts: string[] = shots.map((_, i) => `[${i}:v]settb=AVTB,fps=$FPS,format=yuv420p[v${i}]`);
    let chain = "v0";
    shots.slice(1).forEach((s, j) => {
      const i = j + 1;
      const t = s.entry.transitionIn;
      parts.push(
        t
          ? `[${chain}][v${i}]xfade=transition=${XFADE_NAME[t.kind]}:duration=${t.duration}:offset=${s.entry.startSec}[x${i}]`
          : // concat ra timebase AV_TIME_BASE — đưa về 1/FPS để xfade kế tiếp khớp
            `[${chain}][v${i}]concat=n=2:v=1:a=0,settb=1/$FPS[x${i}]`,
      );
      chain = `x${i}`;
    });
    lines.push(
      `ffmpeg -loglevel error -y ${inputs} -filter_complex "${parts.join(";")}" -map "[${chain}]" -c:v libx264 -crf 18 -pix_fmt yuv420p ${picture}`,
    );
  } else {
    lines.push(`ffmpeg -loglevel error -y -f concat -safe 0 -i _shots/list.txt -c copy ${picture}`);
  }
  if (audio) {
    // Mix 48 kHz đã khớp timeline (engine tính sẵn) → mux AAC vào phim
    lines.push(
      `ffmpeg -loglevel error -y -i _shots/picture.mp4 -i ${audio.mix} -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest film.mp4`,
    );
  }
  lines.push(
    'echo "film.mp4 ready ($(wc -l < _shots/list.txt) shots)"',
    "",
  );
  return lines.join("\n");
}

// ---------- Frame DB → TimelineInput (một nguồn cho export + lint) ----------

export interface TimelineFrameRow {
  readonly index: number;
  readonly description: string;
  readonly clipFps: number | null;
  readonly clipFrameCount: number | null;
  readonly clipDuration: number | null;
  readonly voiceDuration: number | null;
  readonly voiceOffset: number;
  readonly transition: string;
  readonly transitionDuration: number;
  readonly scene: string | null;
}

export function timelineInputOf(
  f: TimelineFrameRow,
  has: { readonly clip: boolean; readonly voice: boolean } = { clip: true, voice: true },
): TimelineInput {
  return {
    index: f.index,
    description: f.description,
    clip:
      has.clip && f.clipFps && f.clipFrameCount
        ? { fps: f.clipFps, frameCount: f.clipFrameCount, duration: f.clipDuration ?? f.clipFrameCount / f.clipFps }
        : null,
    voice: has.voice && f.voiceDuration ? { offset: f.voiceOffset, duration: f.voiceDuration } : null,
    transition: { kind: f.transition, duration: f.transitionDuration },
    scene: f.scene,
  };
}
