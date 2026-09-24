import type { TimelineEntry } from "@/lib/services/timeline";

/**
 * editorial — xuất timeline cho phần mềm dựng chuyên nghiệp (Premiere,
 * Resolve, Avid, Nuke Studio). Pure.
 *   CMX3600 EDL  chuẩn lâu đời nhất: event cut "C" / dissolve "D" + handle
 *   OpenTimelineIO  chuẩn mở (ASWF): Timeline → Stack → Track(Video, Audio),
 *                   Clip/Transition/Gap, RationalTime theo fps phim
 * Ngữ nghĩa overlap của engine (shot sau bắt đầu d giây trước khi shot trước
 * hết) được ánh xạ đúng: EDL dùng đuôi shot trước làm handle; OTIO đặt
 * điểm cắt ở GIỮA vùng chồng, transition lấy d/2 mỗi bên.
 */

export interface EditorialShot {
  readonly badge: string;
  readonly entry: TimelineEntry;
  /** Đường dẫn media của shot (segment mp4 đã chuẩn hoá). */
  readonly media: string;
  /** Giọng thoại (nếu có) cho track audio. */
  readonly voiceMedia?: string;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Timecode non-drop HH:MM:SS:FF. */
export function timecode(seconds: number, fps: number): string {
  const total = Math.round(seconds * fps);
  const ff = total % fps;
  const s = Math.floor(total / fps);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(ff)}`;
}

/** Reel ≤ 8 ký tự [A-Z0-9_]. */
const reelOf = (badge: string) => badge.toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 8).padEnd(8, " ");

export function buildEdl(title: string, shots: readonly EditorialShot[], fps = 24): string {
  const tc = (s: number) => timecode(s, fps);
  const lines = [`TITLE: ${title.replace(/[\r\n]/g, " ").slice(0, 70)}`, "FCM: NON-DROP FRAME", ""];
  let ev = 0;
  const num = () => pad(++ev, 3);
  shots.forEach((shot, k) => {
    const e = shot.entry;
    const next = shots[k + 1]?.entry;
    // Shot bị shot sau chồng ⇒ event của nó kết thúc TẠI điểm bắt đầu chuyển cảnh
    const recOut = next?.transitionIn ? next.startSec : e.startSec + e.durationSec;
    const srcOut = recOut - e.startSec;
    if (!e.transitionIn) {
      lines.push(`${num()}  ${reelOf(shot.badge)} V     C        ${tc(0)} ${tc(srcOut)} ${tc(e.startSec)} ${tc(recOut)}`);
    } else {
      const prev = shots[k - 1];
      const prevSrc = e.startSec - prev.entry.startSec;
      const n = num();
      const frames = Math.round(e.transitionIn.duration * fps);
      // Dòng C zero-length của shot đi ra + dòng D của shot đi vào (cùng số event)
      lines.push(`${n}  ${reelOf(prev.badge)} V     C        ${tc(prevSrc)} ${tc(prevSrc)} ${tc(e.startSec)} ${tc(e.startSec)}`);
      lines.push(`${n}  ${reelOf(shot.badge)} V     D    ${pad(frames, 3)} ${tc(0)} ${tc(srcOut)} ${tc(e.startSec)} ${tc(recOut)}`);
      if (e.transitionIn.kind !== "dissolve") lines.push(`* EFFECT NAME: ${e.transitionIn.kind}`);
    }
    lines.push(`* FROM CLIP NAME: ${shot.media}`);
    if (e.scene) lines.push(`* SCENE: ${e.scene}`);
    lines.push("");
  });
  return lines.join("\n");
}

// ---------- OpenTimelineIO ----------

const rt = (seconds: number, fps: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate: fps, value: Math.round(seconds * fps) });
const range = (start: number, dur: number, fps: number) => ({
  OTIO_SCHEMA: "TimeRange.1",
  start_time: rt(start, fps),
  duration: rt(dur, fps),
});

function clip(name: string, target: string, srcStart: number, srcDur: number, mediaDur: number, fps: number, metadata: Record<string, unknown> = {}) {
  return {
    OTIO_SCHEMA: "Clip.2",
    name,
    metadata,
    source_range: range(srcStart, srcDur, fps),
    media_references: {
      DEFAULT_MEDIA: {
        OTIO_SCHEMA: "ExternalReference.1",
        name: name,
        metadata: {},
        target_url: target,
        available_range: range(0, mediaDur, fps),
        available_image_bounds: null,
      },
    },
    active_media_reference_key: "DEFAULT_MEDIA",
    effects: [],
    markers: [],
    enabled: true,
  };
}

const gap = (dur: number, fps: number) => ({
  OTIO_SCHEMA: "Gap.1",
  name: "",
  metadata: {},
  source_range: range(0, dur, fps),
  effects: [],
  markers: [],
  enabled: true,
});

export function buildOtio(title: string, shots: readonly EditorialShot[], fps = 24): Record<string, unknown> {
  // Điểm cắt: giữa vùng chồng khi có transition, còn lại = đầu shot
  const cutAt = shots.map((s) => (s.entry.transitionIn ? s.entry.startSec + s.entry.transitionIn.duration / 2 : s.entry.startSec));
  const video: Record<string, unknown>[] = [];
  shots.forEach((shot, k) => {
    const e = shot.entry;
    const start = cutAt[k];
    const end = k + 1 < shots.length ? cutAt[k + 1] : e.startSec + e.durationSec;
    if (e.transitionIn) {
      const half = e.transitionIn.duration / 2;
      video.push({
        OTIO_SCHEMA: "Transition.1",
        name: e.transitionIn.kind,
        metadata: { storyboard: { xfade: e.transitionIn.kind } },
        transition_type: e.transitionIn.kind === "dissolve" ? "SMPTE_Dissolve" : "Custom_Transition",
        in_offset: rt(half, fps),
        out_offset: rt(half, fps),
      });
    }
    video.push(
      clip(shot.badge, shot.media, start - e.startSec, end - start, e.durationSec, fps, {
        storyboard: { index: e.index, kind: e.kind, scene: e.scene ?? null },
      }),
    );
  });
  // Track thoại: clip giọng đặt đúng voiceStart, Gap lấp chỗ trống
  const audio: Record<string, unknown>[] = [];
  let cursor = 0;
  for (const shot of shots) {
    const e = shot.entry;
    if (!shot.voiceMedia || e.voiceStart === undefined || !e.voiceDuration) continue;
    if (e.voiceStart > cursor + 1e-9) audio.push(gap(e.voiceStart - cursor, fps));
    audio.push(clip(`${shot.badge}-voice`, shot.voiceMedia, 0, e.voiceDuration, e.voiceDuration, fps));
    cursor = e.voiceStart + e.voiceDuration;
  }
  const track = (name: string, kind: string, children: Record<string, unknown>[]) => ({
    OTIO_SCHEMA: "Track.1",
    name,
    kind,
    metadata: {},
    source_range: null,
    effects: [],
    markers: [],
    enabled: true,
    children,
  });
  return {
    OTIO_SCHEMA: "Timeline.1",
    name: title,
    metadata: { generator: "storyboard-studio" },
    global_start_time: null,
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      metadata: {},
      source_range: null,
      effects: [],
      markers: [],
      enabled: true,
      children: [track("V1", "Video", video), ...(audio.length > 0 ? [track("A1 dialogue", "Audio", audio)] : [])],
    },
  };
}
