/**
 * The eval judges (SPEC v2 WP7, D36). Shared by the benchmark (scripts/eval)
 * and the operator-only judge route, which judges on the server so the
 * provider key never leaves it (D48).
 */

/** The v1 judge. v2 keeps it (comparability) and adds a second VLM. */
export const V1_JUDGE = "google/gemma-3-27b-it";
/** Second judge candidates, in order: served VLMs that are NOT the critic's eyes (MiniCPM, D33). Probed live with an image. */
export const SECOND_JUDGE_CANDIDATES = ["Qwen/Qwen3.5-397B-A17B", "moonshotai/Kimi-K3", "moonshotai/Kimi-K2.6"] as const;
/** Models the crew's critic may use (D33): never a judge. */
export const CRITIC_MODELS = ["openbmb/MiniCPM-V-4_5"] as const;
/** Every model the judge route will call: nothing else (never a crew or critic model). */
export const JUDGE_MODELS = [V1_JUDGE, ...SECOND_JUDGE_CANDIDATES] as const;
