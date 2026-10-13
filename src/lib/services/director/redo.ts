import type { RunSummary } from "@/lib/services/director/context";

/**
 * Single-shot redo (owner + QC 2026-10-13, D84): a take that fails a measured gate in one or two
 * shots redraws ONLY those shots on the same project, with the same plan and the same cast, instead
 * of a new take. Operator only, at most 2 redo attempts per shot (the operator's rule). This module
 * is pure: the camera patterns of the shots that stay, and the take's summary with the redone
 * shots' results swapped in.
 */

/** The shots a redo may name: 1–4 distinct shot numbers. */
export const MAX_REDO_SHOTS = 4;

/**
 * Each shot's camera patterns in a project's defs (`art-fN`, and the walk layers `actN-<who>-sK`),
 * keyed by shot: the redo keeps every other shot's pattern exactly as committed. Nesting-aware
 * (a painting may hold its own `<pattern>`).
 */
export function shotPatterns(defs: string): Map<number, string> {
  const out = new Map<number, string[]>();
  const tag = /<(\/?)pattern\b[^>]*?(\/?)>/g;
  let depth = 0;
  let start = -1;
  let index: number | null = null;
  for (const m of defs.matchAll(tag)) {
    if (m[2] === "/") continue;
    if (!m[1]) {
      if (depth === 0) {
        start = m.index!;
        // `art-fN` (the painting) and the acting layers: walk steps are `actN-<who>-sK` (acting.ts); `act-fN-…` kept for safety
        const id = m[0].match(/\bid\s*=\s*["'](?:art-f|act-f|act)(\d+)(?:["']|-)/);
        index = id ? Number(id[1]) : null;
      }
      depth++;
    } else {
      depth--;
      if (depth === 0 && index !== null && start >= 0) {
        const list = out.get(index) ?? [];
        list.push(defs.slice(start, m.index! + m[0].length));
        out.set(index, list);
        index = null;
      }
    }
  }
  return new Map([...out.entries()].map(([i, ps]) => [i, ps.join("\n")]));
}

const without = (xs: readonly number[] | undefined, shots: ReadonlySet<number>) => (xs ?? []).filter((i) => !shots.has(i));
const sorted = (xs: Iterable<number>) => [...new Set(xs)].sort((a, b) => a - b);
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

/**
 * The take's summary after a redo: the redone shots' per-shot results (scores, measured gate
 * failures, off-plan, set-less, below floor, action notes) replace the take's; every other shot
 * keeps the take's. The film-level facts the redo re-measures on the whole project (shots,
 * rendered, lint, length) come from the redo; the cost is the redo's own (the ledger adds it to
 * the take's). A take from before `gateFailShots` was kept can't say which shots failed: its
 * count is kept as it was (conservative — a redo never clears a failure it can't see).
 */
export function mergeRedo(source: RunSummary, fresh: RunSummary, shots: readonly number[], sourceRunId: string): RunSummary {
  const redone = new Set(shots);
  const shotScores: Record<number, number | null> = {};
  for (const [k, v] of Object.entries(source.shotScores ?? {})) if (!redone.has(Number(k))) shotScores[Number(k)] = v;
  for (const [k, v] of Object.entries(fresh.shotScores ?? {})) shotScores[Number(k)] = v;
  const actionNotes: Record<number, string> = {};
  for (const [k, v] of Object.entries(source.actionNotes ?? {})) if (!redone.has(Number(k))) actionNotes[Number(k)] = v;
  for (const [k, v] of Object.entries(fresh.actionNotes ?? {})) actionNotes[Number(k)] = v;
  const gateFailShots = source.gateFailShots ? sorted([...without(source.gateFailShots, redone), ...(fresh.gateFailShots ?? [])]) : undefined;
  return {
    ...fresh,
    firstPassOk: source.firstPassOk,
    repairs: source.repairs + fresh.repairs,
    revisions: source.revisions + fresh.revisions,
    criticBefore: source.criticBefore,
    criticAfter: mean(Object.values(shotScores).filter((x): x is number => typeof x === "number")),
    gateFailures: gateFailShots ? gateFailShots.length : source.gateFailures,
    ...(gateFailShots && { gateFailShots }),
    offPlan: sorted([...without(source.offPlan, redone), ...(fresh.offPlan ?? [])]),
    setless: sorted([...without(source.setless, redone), ...(fresh.setless ?? [])]),
    belowFloor: sorted([...without(source.belowFloor, redone), ...(fresh.belowFloor ?? [])]),
    shotScores,
    actionNotes,
    continuity: source.continuity,
    ...(source.propRecognition && { propRecognition: source.propRecognition }),
    ...(source.castSetTimes && { castSetTimes: source.castSetTimes }),
    ...(source.research && { research: source.research }),
    redoOf: { sourceRunId, shots: sorted(shots) },
  };
}
