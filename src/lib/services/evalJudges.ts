/**
 * The eval judges (SPEC v2 WP7, D36). Shared by the benchmark (scripts/eval)
 * and the operator-only judge route, which judges on the server so the
 * provider key never leaves it (D48).
 */

/** The v1 judge. v2 keeps it (comparability) and adds a second VLM. */
export const V1_JUDGE = "google/gemma-3-27b-it";
/**
 * Second judge candidates, in order: served VLMs that are NOT the critic's eyes (MiniCPM, D33). Probed live with an image.
 * Probed 2026-10-10 through the judge route: Kimi-K3 and Kimi-K2.6 see (both answer "red", 70 and 98 completion tokens:
 * they reason first, so the probe needs room); Qwen3.5-397B-A17B was dropped (Token Factory 400 "does not support image input").
 */
export const SECOND_JUDGE_CANDIDATES = ["moonshotai/Kimi-K3", "moonshotai/Kimi-K2.6"] as const;
/** Completion budget of a judge call: reasoning judges think before the JSON (a 40-token probe cut them off). */
export const JUDGE_MAX_TOKENS = 800;
/** Models the crew's critic may use (D33): never a judge. */
export const CRITIC_MODELS = ["openbmb/MiniCPM-V-4_5"] as const;
/** Every model the judge route will call: nothing else (never a crew or critic model). */
export const JUDGE_MODELS = [V1_JUDGE, ...SECOND_JUDGE_CANDIDATES] as const;
