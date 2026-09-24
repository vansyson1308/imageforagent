import type { TimelineEntry } from "@/lib/services/timeline";
import { CAMERA_PRESETS } from "@/lib/services/construct/camera";

/**
 * storyboardLint — "biên tập viên" tự động: soát storyboard theo luật nghề
 * dựng trước khi render dài/đóng gói rạp. Pure. Mỗi finding có mã, mức độ,
 * frame và hint sửa — agent tự sửa được vòng lặp.
 *   NO_ARTWORK · RENDER_FAILED · SHOT_TOO_SHORT · STILL_TOO_LONG ·
 *   READING_SPEED (> 17 ký tự/giây — chuẩn phụ đề phổ biến cho người lớn) ·
 *   VOICE_OVERRUN · LINE_CROSS_180 · JUMP_CUT · TRANSITION_CLAMPED
 */

export type LintSeverity = "error" | "warning" | "info";

export interface LintFinding {
  readonly frameIndex: number;
  readonly severity: LintSeverity;
  readonly code: string;
  readonly message: string;
  readonly hint: string;
}

export interface LintFrame {
  readonly index: number;
  readonly status: string;
  readonly shotType: string;
  readonly scene: string | null;
  readonly dialogue: string | null;
  readonly voiceDuration: number | null;
  readonly voiceOffset: number;
  readonly clipDuration: number | null;
  readonly transition: string;
  readonly transitionDuration: number;
  /** Camera của shot motion tại t=0 (null với frame tĩnh không có spec). */
  readonly camera: { readonly azimuth: number; readonly zoom: number } | null;
}

export const READING_SPEED_CPS = 17;

/** Camera đầu shot từ motion spec JSON (orbit hoặc preset). */
export function cameraOfMotionSpec(json: string | null): LintFrame["camera"] {
  if (!json) return null;
  try {
    const m = JSON.parse(json) as { scene?: { camera?: { orbit?: { azimuth?: number }; preset?: string; zoom?: number } } };
    const cam = m.scene?.camera ?? {};
    const az = cam.orbit?.azimuth ?? CAMERA_PRESETS[cam.preset ?? "isometric"]?.azimuth ?? 45;
    return { azimuth: az, zoom: cam.zoom ?? 1 };
  } catch {
    return null;
  }
}

const angleDiff = (a: number, b: number) => {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
};

export function lintStoryboard(frames: readonly LintFrame[], timeline: readonly TimelineEntry[]): LintFinding[] {
  const out: LintFinding[] = [];
  const byIndex = new Map(timeline.map((e) => [e.index, e]));
  const ordered = frames.slice().sort((a, b) => a.index - b.index);
  ordered.forEach((f, k) => {
    const add = (severity: LintSeverity, code: string, message: string, hint: string) =>
      out.push({ frameIndex: f.index, severity, code, message, hint });
    const t = byIndex.get(f.index);
    if (f.status === "failed") add("error", "RENDER_FAILED", `F${f.index} failed to render.`, "Fix the artwork/motion (see errorMsg) and re-PUT.");
    else if (f.status !== "done") add("error", "NO_ARTWORK", `F${f.index} has no rendered artwork.`, "PUT /api/frames/:id/artwork or /motion.");
    if (!t) return;
    if (t.durationSec < 0.5) add("warning", "SHOT_TOO_SHORT", `F${f.index} lasts ${t.durationSec}s.`, "Shots under ~0.5 s read as flashes — lengthen or merge.");
    if (t.kind === "still" && t.durationSec > 8) {
      add("info", "STILL_TOO_LONG", `F${f.index} is a still held ${t.durationSec}s.`, 'Add motion (a "shot" rig such as dollyIn or pan) so long holds stay alive.');
    }
    if (f.dialogue) {
      const secs = f.voiceDuration ?? t.durationSec;
      const cps = f.dialogue.replace(/\s+/g, " ").trim().length / Math.max(0.1, secs);
      if (cps > READING_SPEED_CPS) {
        add("warning", "READING_SPEED", `F${f.index} subtitle needs ${cps.toFixed(1)} chars/s (max ${READING_SPEED_CPS}).`, "Shorten the line or give it more screen time.");
      }
    }
    if (f.clipDuration && f.voiceDuration && f.voiceOffset + f.voiceDuration > f.clipDuration + 1e-6) {
      add("warning", "VOICE_OVERRUN", `F${f.index} voice ends at ${(f.voiceOffset + f.voiceDuration).toFixed(2)}s, the shot at ${f.clipDuration}s.`, "Lengthen the motion duration, lower voiceOffset, or speed the voice up.");
    }
    if (f.transition !== "cut" && t.transitionIn && t.transitionIn.duration + 1e-6 < f.transitionDuration) {
      add("info", "TRANSITION_CLAMPED", `F${f.index} ${f.transition} shortened to ${t.transitionIn.duration}s (≤ half of each adjacent shot).`, "Lengthen the adjacent shots or shorten the transition.");
    }
    const prev = ordered[k - 1];
    if (!prev || !prev.scene || prev.scene !== f.scene || !prev.camera || !f.camera) return;
    const d = angleDiff(prev.camera.azimuth, f.camera.azimuth);
    if (d > 150) {
      add("warning", "LINE_CROSS_180", `F${prev.index}→F${f.index} (scene "${f.scene}"): camera swings ${d.toFixed(0)}° — likely crosses the 180° line.`, "Keep consecutive shots of a scene on one side of the action line, or insert a neutral/establishing shot.");
    }
    const zoomRatio = Math.max(prev.camera.zoom, f.camera.zoom) / Math.min(prev.camera.zoom, f.camera.zoom);
    if (f.transition === "cut" && d < 20 && zoomRatio < 1.2 && prev.shotType.trim().toLowerCase() === f.shotType.trim().toLowerCase()) {
      add("warning", "JUMP_CUT", `F${prev.index}→F${f.index}: same framing (Δ${d.toFixed(0)}°, zoom ×${zoomRatio.toFixed(2)}) cut together — reads as a jump cut.`, "Change the angle ≥ 30° or the size (zoom ≥ ×1.25), or use a dissolve.");
    }
  });
  return out;
}
