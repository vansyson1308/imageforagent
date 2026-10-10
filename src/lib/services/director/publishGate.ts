import type { RunSummary } from "@/lib/services/director/context";
import { publishVerdict, spokenLines } from "@/lib/services/director/pilotPolicy";

/**
 * The showcase publish gate (owner QC 2026-10-10, sprint e). A film is
 * published only when (1) the run's own measurements pass: every shot drawn,
 * zero gate failures, zero off-plan shots, zero shots scored below 6, no shot
 * without a set, 45–90 s long; and (2) a person has looked at every shot and
 * ticked the by-eye checklist stored in evidence (crops, darkness, hero object
 * visible, story beat present). Pure: the showcase script does the I/O.
 */

export const SHOWCASE_MIN_SEC = 45;
export const SHOWCASE_MAX_SEC = 90;
export const SHOWCASE_MIN_SCORE = 6;

/** What blocks publishing, from the run summary alone (empty = the automatic gate passes). */
export function publishProblems(status: string, s: Partial<RunSummary>): string[] {
  const out: string[] = [];
  if (status !== "done") out.push(`run status is "${status}"`);
  if ((s.rendered ?? 0) !== (s.shots ?? -1)) out.push(`${s.rendered ?? 0}/${s.shots ?? 0} shots rendered`);
  if ((s.gateFailures ?? 0) > 0) out.push(`${s.gateFailures} shot(s) still fail a measured gate`);
  if (s.offPlan?.length) out.push(`off-plan shot(s): ${s.offPlan.join(", ")}`);
  if (s.setless?.length) out.push(`shot(s) without a set: ${s.setless.join(", ")}`);
  if (!s.shotScores) out.push("no per-shot critic scores in the summary (run the critic)");
  else {
    const low = Object.entries(s.shotScores).filter(([, v]) => v === null || v < SHOWCASE_MIN_SCORE);
    if (low.length) out.push(`shot(s) scored below ${SHOWCASE_MIN_SCORE} or not scored: ${low.map(([i, v]) => `${i} (${v ?? "n/a"})`).join(", ")}`);
  }
  const d = s.durationSec ?? 0;
  if (d < SHOWCASE_MIN_SEC || d > SHOWCASE_MAX_SEC) out.push(`film is ${d.toFixed(1)} s (a showcase film runs ${SHOWCASE_MIN_SEC}–${SHOWCASE_MAX_SEC} s)`);
  return out;
}

/**
 * Owner decision A1 (2026-10-10): no published or showcase film may carry a
 * line in a non-commercial voice (Piper JA). Read from the run's voice steps.
 */
export function voiceProblems(steps: ReadonlyArray<{ role: string; action: string; shotIndex: number | null; model: string; error?: string | null }>): string[] {
  return publishVerdict(spokenLines(steps), new Set()).blocking.map((l) => `shot ${l.shot} is spoken by ${l.voice}, a non-commercial voice: the line needs the owner's recording`);
}

export const BY_EYE_CHECKS = ["no character cropped", "readable (not too dark)", "hero object visible", "story beat present"] as const;

export interface ChecklistShot {
  readonly index: number;
  /** the narration line or plan description this shot must show */
  readonly beat: string;
  readonly image: string;
  /** measured facts, for the reviewer (score, light, props) */
  readonly measured: string;
}

/**
 * The by-eye checklist, prefilled with what the engine measured. The reviewer
 * replaces each `[ ]` with `[x]` (pass) or `[!]` (fail) after looking at the
 * frame, and signs the verdict line. Unticked boxes block publishing.
 */
export function checklistTemplate(opts: { slug: string; projectId: string; runId: string; commit: string; hero: string | null; shots: readonly ChecklistShot[] }): string {
  const head = [
    `# By-eye checklist · ${opts.slug}`,
    "",
    `Project \`${opts.projectId}\` · run \`${opts.runId}\` · server commit \`${opts.commit}\`. Hero object: ${opts.hero ? `#${opts.hero}` : "none planned"}.`,
    "",
    "Look at every frame at full size. Tick each box `[x]` when it holds, or mark it `[!]` and say why on the shot's note line. The film is published only when every box is `[x]` and the verdict is PASS.",
    "",
  ];
  const rows = opts.shots.flatMap((s) => [
    `## Shot ${s.index}`,
    "",
    `![shot ${s.index}](${s.image})`,
    "",
    `Beat: ${s.beat}`,
    "",
    `Measured: ${s.measured}`,
    "",
    ...BY_EYE_CHECKS.map((c) => `- [ ] ${c}`),
    "",
    "Note: ",
    "",
  ]);
  return [...head, ...rows, "## Verdict", "", "Reviewer: ", "", "Verdict: PENDING (write PASS or FAIL)", ""].join("\n");
}

/** What keeps a filled checklist from passing (empty = publish). */
export function checklistProblems(md: string, shots: number): string[] {
  const out: string[] = [];
  const sections = md.split(/^## Shot (\d+)\s*$/m);
  const seen = new Set<number>();
  for (let i = 1; i < sections.length; i += 2) {
    const idx = Number(sections[i]);
    seen.add(idx);
    const body = sections[i + 1];
    for (const c of BY_EYE_CHECKS) {
      const m = body.match(new RegExp(`^- \\[(.)\\] ${c.replace(/[()]/g, "\\$&")}`, "m"));
      if (!m) out.push(`shot ${idx}: "${c}" missing`);
      else if (m[1] === "!") out.push(`shot ${idx}: ${c} FAILED`);
      else if (m[1] !== "x") out.push(`shot ${idx}: "${c}" not checked`);
    }
  }
  for (let i = 1; i <= shots; i++) if (!seen.has(i)) out.push(`shot ${i} has no checklist section`);
  if (!/^Reviewer: \S/m.test(md)) out.push("no reviewer named");
  const verdict = md.match(/^Verdict: (\w+)/m)?.[1];
  if (verdict !== "PASS") out.push(`verdict is ${verdict ?? "missing"}, not PASS`);
  return out;
}
