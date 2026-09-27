import { prisma } from "@/lib/db";
import { ttsAvailable } from "@/lib/services/tts";
import { writeFrameDialogue } from "@/lib/services/frameWrites";
import { buildTimeline, timelineDuration, timelineInputOf } from "@/lib/services/timeline";
import { cameraOfMotionSpec, lintStoryboard, type LintFinding } from "@/lib/services/storyboardLint";
import { callJson, recordStep, ReplyInvalidError, throwIfCancelled, type DirectorContext } from "@/lib/services/director/context";
import { continuitySystem, editorSystem, editorUser } from "@/lib/services/director/prompts";
import { continuitySchema, editorReplySchema, type Plan } from "@/lib/services/director/schemas";
import { LlmError } from "@/lib/providers/types";
import type { Frame } from "@/generated/prisma/client";

/** Film language → espeak-ng voice id (validated again by tts.ts). */
export const TTS_VOICES: Record<string, string> = {
  en: "en-us",
  vi: "vi",
  ja: "ja",
  zh: "cmn",
  ko: "ko",
  fr: "fr-fr",
  es: "es",
  de: "de",
  id: "id",
  th: "th",
};

export function voiceFor(language: string): string {
  return TTS_VOICES[language] ?? (/^[a-z]{2,3}$/.test(language) ? language : "en-us");
}

/** The editor only acts on findings it can fix with its edit vocabulary. */
export const FIXABLE = new Set(["READING_SPEED", "VOICE_OVERRUN", "JUMP_CUT"]);

/**
 * Dialogue pass: every planned line becomes the frame's subtitle + a local
 * TTS voice (espeak-ng, offline, via resolveVoice). Runs BEFORE drawing, so
 * each shot can be timed to hold its line. No TTS → subtitle only (recorded).
 */
export async function runDialogue(ctx: DirectorContext, plan: Plan, frames: readonly Frame[]): Promise<Frame[]> {
  const tts = ttsAvailable();
  const voice = voiceFor(ctx.options.language);
  const out: Frame[] = [];
  for (const f of frames) {
    throwIfCancelled(ctx);
    const line = plan.shots[f.index - 1]?.dialogue?.trim();
    if (!line) {
      out.push(f);
      continue;
    }
    const t0 = Date.now();
    try {
      const r = await writeFrameDialogue(f.id, { text: line, tts: tts ? { voice, speed: 150 } : undefined, offset: 0.3 });
      out.push(r.frame);
      await recordStep(ctx, {
        role: "dialogue",
        model: tts ? `espeak-ng:${voice}` : "subtitle-only",
        action: "voice",
        shotIndex: f.index,
        latencyMs: Date.now() - t0,
        summary: r.frame.voiceDuration ? `Voiced ${r.frame.voiceDuration}s: “${line.slice(0, 80)}”` : `Subtitle only: “${line.slice(0, 80)}”`,
      });
    } catch (e) {
      // A voice failure keeps the subtitle; the film goes on
      await prisma.frame.update({ where: { id: f.id }, data: { dialogue: line, voicePath: null, voiceDuration: null } });
      out.push((await prisma.frame.findUnique({ where: { id: f.id } }))!);
      await recordStep(ctx, { role: "dialogue", model: `espeak-ng:${voice}`, action: "voice", shotIndex: f.index, summary: "TTS failed — subtitle only", error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export async function lintProject(projectId: string): Promise<{ findings: LintFinding[]; durationSec: number }> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { frames: { orderBy: { index: "asc" } } } });
  const timeline = buildTimeline(project.frames.map((f) => timelineInputOf(f)), project.playbackSpeed);
  const findings = lintStoryboard(project.frames.map((f) => ({ ...f, camera: cameraOfMotionSpec(f.motionSpec) })), timeline);
  return { findings, durationSec: timelineDuration(timeline) };
}

/**
 * Editor (Nano): lint → targeted edits → re-lint, ≤ 2 rounds. Edits are
 * limited to dialogue text, voice offset and transitions. Picture is never
 * touched here, so an edit can't break a render.
 */
export async function runEditor(ctx: DirectorContext): Promise<LintFinding[]> {
  let { findings } = await lintProject(ctx.projectId);
  await recordStep(ctx, {
    role: "editor",
    model: "storyboardLint",
    action: "lint",
    summary: `Lint: ${count(findings, "error")} errors, ${count(findings, "warning")} warnings, ${count(findings, "info")} info`,
    output: JSON.stringify(findings),
  });
  for (let round = 0; round < 2; round++) {
    const fixable = findings.filter((f) => FIXABLE.has(f.code));
    if (fixable.length === 0) break;
    throwIfCancelled(ctx);
    const frames = await prisma.frame.findMany({ where: { projectId: ctx.projectId }, orderBy: { index: "asc" } });
    const shots = frames.map((f) => `${f.index} · ${f.clipDuration ?? "still"}s · ${f.transition} · ${f.dialogue ?? "—"}`).join("\n");
    let reply;
    try {
      reply = await callJson(
        ctx,
        {
          role: "editor",
          action: "lint-fix",
          system: editorSystem(ctx.options.language),
          user: editorUser(fixable.map((f) => `F${f.frameIndex} ${f.code}: ${f.message} (${f.hint})`).join("\n"), shots),
          attempt: round,
          maxTokens: 2000,
          temperature: 0.2,
          thinking: false,
        },
        editorReplySchema,
        "editor_edits",
        1,
      );
    } catch (e) {
      if (e instanceof ReplyInvalidError || e instanceof LlmError) break;
      throw e;
    }
    const allowed = new Set(fixable.map((f) => f.frameIndex));
    let applied = 0;
    for (const edit of reply.edits) {
      const frame = frames.find((f) => f.index === edit.index);
      if (!frame || !allowed.has(edit.index)) continue;
      if (edit.transition && edit.index > 1) {
        await prisma.frame.update({ where: { id: frame.id }, data: { transition: edit.transition, transitionDuration: 0.6 } });
        applied++;
      }
      if (edit.dialogue !== undefined) {
        if (edit.dialogue === null || edit.dialogue.trim() === "") {
          await prisma.frame.update({ where: { id: frame.id }, data: { dialogue: null, voicePath: null, voiceDuration: null } });
        } else {
          const tts = ttsAvailable();
          await writeFrameDialogue(frame.id, {
            text: edit.dialogue.trim(),
            tts: tts ? { voice: voiceFor(ctx.options.language), speed: 150 } : undefined,
            offset: edit.voiceOffset ?? frame.voiceOffset,
          }).catch(() => prisma.frame.update({ where: { id: frame.id }, data: { dialogue: edit.dialogue } }));
        }
        applied++;
      } else if (edit.voiceOffset !== undefined) {
        await prisma.frame.update({ where: { id: frame.id }, data: { voiceOffset: edit.voiceOffset } });
        applied++;
      }
    }
    const before = fixable.length;
    findings = (await lintProject(ctx.projectId)).findings;
    await recordStep(ctx, {
      role: "editor",
      model: ctx.models.fast,
      action: "apply-edits",
      attempt: round,
      summary: `Applied ${applied} edit(s); fixable findings ${before} → ${findings.filter((f) => FIXABLE.has(f.code)).length}. ${reply.notes.slice(0, 160)}`,
      output: JSON.stringify(reply),
    });
    if (applied === 0) break;
  }
  return findings;
}

/** Final continuity pass (report only; never edits). */
export async function runContinuity(ctx: DirectorContext, plan: Plan): Promise<string[]> {
  const frames = await prisma.frame.findMany({ where: { projectId: ctx.projectId }, orderBy: { index: "asc" } });
  const bible = plan.cast.map((c) => `${c.id} (${c.kind}): ${c.look}`).join("\n");
  const shots = frames.map((f) => `${f.index}. [${f.scene ?? ""}] ${f.shotType}: ${f.description}${f.dialogue ? ` — “${f.dialogue}”` : ""}`).join("\n");
  try {
    const r = await callJson(
      ctx,
      { role: "editor", action: "continuity", system: continuitySystem(), user: `Bible:\n<notes>\n${bible.slice(0, 4000)}\n</notes>\n\nShots:\n<notes>\n${shots.slice(0, 8000)}\n</notes>`, maxTokens: 1500, temperature: 0.2, thinking: false },
      continuitySchema,
      "continuity",
      1,
    );
    await recordStep(ctx, { role: "editor", model: ctx.models.fast, action: "continuity:report", summary: r.ok ? "Continuity OK" : `Continuity notes: ${r.notes.join(" · ").slice(0, 400)}`, output: JSON.stringify(r) });
    return r.notes;
  } catch (e) {
    if (e instanceof ReplyInvalidError || e instanceof LlmError) return [];
    throw e;
  }
}

const count = (f: readonly LintFinding[], s: string) => f.filter((x) => x.severity === s).length;
