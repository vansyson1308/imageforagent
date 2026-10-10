import { OWNER_VOICE } from "./fixedNarration";
import { VOICE_CREDIT } from "./ownerPackage";

/**
 * The end-credits card of a published film (owner plan 2026-10-10, item 2):
 * built from what the film's run actually used, read from its trace steps.
 *
 * - The owner's AivisSpeech narration → the voice credit, verbatim from the
 *   package's `qa/voice_credit.txt` (first line), else VOICE_CREDIT.
 * - A Vietnamese Piper voice → the VAIS-1000 attribution its CC BY 4.0
 *   licence asks for.
 * - Always: "Made with NVIDIA Nemotron on Nebius Token Factory".
 * - Tavily, when a search returned references.
 */

export interface CreditBlock {
  readonly main: string;
  readonly detail?: string;
}

export interface CreditStep {
  readonly role: string;
  readonly action: string;
  readonly model: string;
  readonly error?: string | null;
  readonly output?: string | null;
}

export const STUDIO_LINE = "Storyboard Studio Director";
export const NEMOTRON_LINE = "Made with NVIDIA Nemotron on Nebius Token Factory";
export const VAIS_CREDIT: CreditBlock = { main: "Vietnamese voice: Piper vi_VN-vais1000-medium", detail: "trained on the VAIS-1000 dataset (CC BY 4.0)" };
export const TAVILY_LINE = "Research: Tavily";

/** The owner's credit text: the first non-empty line of qa/voice_credit.txt, or the decided text. */
export function voiceCreditLine(fileText: string | null | undefined): string {
  return fileText?.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? VOICE_CREDIT;
}

/** 「音声合成：…（ボイス提供：…）」 → the name, then the parenthesised detail in smaller type. */
function splitCredit(line: string): CreditBlock {
  const i = line.indexOf("（");
  return i > 0 ? { main: line.slice(0, i), detail: line.slice(i) } : { main: line };
}

/** A Tavily search that returned at least one result (its output is the [{title, url}] list). */
function foundReferences(s: CreditStep): boolean {
  if (s.role !== "researcher" || s.model !== "tavily/search" || s.error) return false;
  try {
    const r: unknown = JSON.parse(s.output ?? "[]");
    return Array.isArray(r) && r.length > 0;
  } catch {
    return false;
  }
}

export function filmCredits(steps: readonly CreditStep[], opts: { voiceCredit?: string | null } = {}): CreditBlock[] {
  const voices = steps.filter((s) => s.role === "dialogue" && s.action === "voice").map((s) => s.model);
  const blocks: CreditBlock[] = [];
  if (voices.includes(OWNER_VOICE)) blocks.push(splitCredit(voiceCreditLine(opts.voiceCredit)));
  if (voices.some((m) => m.startsWith("piper:vi_VN-vais1000"))) blocks.push(VAIS_CREDIT);
  blocks.push({ main: NEMOTRON_LINE });
  if (steps.some(foundReferences)) blocks.push({ main: TAVILY_LINE });
  return blocks;
}
