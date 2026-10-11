import type { RunSummary } from "@/lib/services/director/context";
import { publishVerdict, spokenLines } from "@/lib/services/director/pilotPolicy";

/**
 * The showcase publish gate (owner QC 2026-10-10, revised by the owner 2026-10-11).
 * BLOCKING, measured: every shot drawn; zero gate failures (prop size D53, edge crop,
 * night readability, empty frame and the other measured gates); no shot off-plan in its
 * time of day or place; no shot without a set; 45–90 s long. CRITIC: the film's mean
 * score ≥ 5.5 and no shot below 4. The critic's "action" verdict is not a gate: it goes to
 * the by-eye checklist. Then a person ticks the checklist (crops, darkness, hero object,
 * story beat, key action). A by-eye approval may override the critic's scores, never a
 * measured gate. Pure: the showcase script does the I/O.
 */

export const SHOWCASE_MIN_SEC = 45;
export const SHOWCASE_MAX_SEC = 90;
/** The film's mean critic score must reach this. */
export const SHOWCASE_MIN_MEAN = 5.5;
/** No shot may score below this. */
export const SHOWCASE_MIN_SHOT = 4;

/** Measured problems: no person can approve these away. */
export function measuredProblems(status: string, s: Partial<RunSummary>): string[] {
  const out: string[] = [];
  if (status !== "done") out.push(`run status is "${status}"`);
  if ((s.rendered ?? 0) !== (s.shots ?? -1)) out.push(`${s.rendered ?? 0}/${s.shots ?? 0} shots rendered`);
  if ((s.gateFailures ?? 0) > 0) out.push(`${s.gateFailures} shot(s) still fail a measured gate`);
  if (s.offPlan?.length) out.push(`wrong time of day or place in shot(s): ${s.offPlan.join(", ")}`);
  if (s.setless?.length) out.push(`shot(s) without a set: ${s.setless.join(", ")}`);
  const d = s.durationSec ?? 0;
  if (d < SHOWCASE_MIN_SEC || d > SHOWCASE_MAX_SEC) out.push(`film is ${d.toFixed(1)} s (a showcase film runs ${SHOWCASE_MIN_SEC}–${SHOWCASE_MAX_SEC} s)`);
  return out;
}

/** Critic-score problems: the owner and QC may approve a film past these by eye (never past a measured one). */
export function criticProblems(s: Partial<RunSummary>): string[] {
  if (!s.shotScores) return ["no per-shot critic scores in the summary (run the critic)"];
  const entries = Object.entries(s.shotScores);
  const out: string[] = [];
  const unscored = entries.filter(([, v]) => v === null || v === undefined);
  if (unscored.length) out.push(`shot(s) not scored: ${unscored.map(([i]) => i).join(", ")}`);
  const scores = entries.map(([, v]) => v).filter((v): v is number => typeof v === "number");
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  if (mean < SHOWCASE_MIN_MEAN) out.push(`mean critic score ${mean.toFixed(2)} < ${SHOWCASE_MIN_MEAN}`);
  const low = entries.filter(([, v]) => typeof v === "number" && v < SHOWCASE_MIN_SHOT);
  if (low.length) out.push(`shot(s) scored below ${SHOWCASE_MIN_SHOT}: ${low.map(([i, v]) => `${i} (${v})`).join(", ")}`);
  return out;
}

/** What blocks publishing, from the run summary alone (empty = the automatic gate passes). */
export function publishProblems(status: string, s: Partial<RunSummary>): string[] {
  return [...measuredProblems(status, s), ...criticProblems(s)];
}

/**
 * Owner decision A1 (2026-10-10): no published or showcase film may carry a
 * line in a non-commercial voice (Piper JA). Read from the run's voice steps.
 */
export function voiceProblems(steps: ReadonlyArray<{ role: string; action: string; shotIndex: number | null; model: string; error?: string | null }>): string[] {
  return publishVerdict(spokenLines(steps), new Set()).blocking.map((l) => `shot ${l.shot} is spoken by ${l.voice}, a non-commercial voice: the line needs the owner's recording`);
}

export const BY_EYE_CHECKS = ["no character cropped", "readable (not too dark)", "hero object visible", "story beat present", "key action reads"] as const;

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
export function checklistTemplate(opts: { slug: string; projectId: string; runId: string; commit: string; hero: string | null; shots: readonly ChecklistShot[]; critic?: readonly string[] }): string {
  const head = [
    `# By-eye checklist · ${opts.slug}`,
    "",
    `Project \`${opts.projectId}\` · run \`${opts.runId}\` · server commit \`${opts.commit}\`. Hero object: ${opts.hero ? `#${opts.hero}` : "none planned"}.`,
    "",
    "Look at every frame at full size. Tick each box `[x]` when it holds, or mark it `[!]` and say why on the shot's note line. The film is published only when every box is `[x]` and the verdict is PASS.",
    "",
    ...(opts.critic?.length
      ? [
          "## Critic scores (not a measured gate)",
          "",
          ...opts.critic.map((c) => `- ${c}`),
          "",
          "The owner and QC may approve the film past these by eye (owner decision 2026-10-11): replace `none` with `APPROVED by owner <name> and QC <name>`. A by-eye approval never overrides a measured gate.",
          "",
          "Critic override: none",
          "",
        ]
      : []),
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

/** True when the checklist carries the owner's and QC's by-eye approval past the critic's scores. */
export function criticOverride(md: string): boolean {
  // real names for both (QC of #30): the template's "<name>" placeholders are refused
  const line = md.match(/^Critic override: (.+)$/m)?.[1]?.trim() ?? "";
  return /^APPROVED by owner (?!<)\S.* and QC (?!<)\S/.test(line);
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
