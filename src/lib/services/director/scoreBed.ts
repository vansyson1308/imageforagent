import { encodeWav } from "@/lib/services/audio/wav";
import { renderScore, type Cue, type Mood } from "@/lib/services/audio/score";
import type { TimelineEntry } from "@/lib/services/timeline";
import type { Plan, ShotPlan } from "@/lib/services/director/schemas";

/**
 * Score bed (SPEC v2 WP4.6): an ORIGINAL score from the engine's own
 * deterministic synth (no third-party music), laid under the film by mood.
 * Consecutive shots with the same mood share one cue; cues crossfade. The
 * film assembler ducks it under dialogue and masters the mix. Pure given the
 * plan + timeline; the seed is the film title, so a film always gets the
 * same music.
 */

const KEYWORDS: Array<[RegExp, Mood]> = [
  [/\b(night|midnight|moon|stars?)\b|đêm|trăng|夜|月/i, "night"],
  [/\b(dawn|sunrise|morning)\b|bình minh|sáng sớm|朝|夜明け/i, "dawn"],
  [/\b(festival|parade|celebrat\w*|lantern)\b|lễ hội|rước|祭/i, "festival"],
  [/\b(cr(y|ies|ied)|tears?|sad|alone|miss(es|ed)?|grief)\b|khóc|buồn|nhớ|泣|寂し|悲し/i, "sad"],
  [/\b(laugh\w*|play\w*|run\w*|chase|giggl\w*)\b|cười|chơi|笑|遊/i, "playful"],
  [/\b(magic|wonder|glow\w*|sparkl\w*|spirit)\b|kỳ diệu|phép|不思議|光/i, "wonder"],
  [/\b(storm|danger|fear|scared|wind)\b|bão|sợ|gió|嵐|怖|風/i, "wind"],
  [/\b(hug|together|smile\w*|gentle|grandm\w+|grandp\w+)\b|ôm|bà|ông|おばあ|おじい/i, "tender"],
];

export function shotMood(shot: Pick<ShotPlan, "mood" | "description" | "dialogue">): Mood {
  if (shot.mood) return shot.mood;
  const text = `${shot.description} ${shot.dialogue ?? ""}`;
  return KEYWORDS.find(([re]) => re.test(text))?.[1] ?? "day";
}

/** One cue per run of same-mood shots, on the film's real timeline. */
export function scoreCues(plan: Plan, timeline: readonly TimelineEntry[]): Cue[] {
  const cues: Cue[] = [];
  for (const e of timeline) {
    const shot = plan.shots[e.index - 1];
    if (!shot) continue;
    const mood = shotMood(shot);
    const last = cues.at(-1);
    const end = e.startSec + e.durationSec;
    if (last && last.mood === mood) last.end = end;
    else cues.push({ start: e.startSec, end, mood, fadeIn: cues.length ? 1.2 : 0.6, fadeOut: 1.2 });
  }
  if (cues.length) cues[cues.length - 1].fadeOut = 2;
  return cues;
}

export function renderScoreBed(plan: Plan, timeline: readonly TimelineEntry[], totalSec: number): { wav: Buffer; cues: Cue[] } {
  const cues = scoreCues(plan, timeline);
  const audio = renderScore(cues, Math.max(1, totalSec + 0.5), { sampleRate: 24000, seed: plan.title });
  return { wav: encodeWav(audio, 16), cues };
}
