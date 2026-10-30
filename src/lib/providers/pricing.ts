/**
 * Token pricing (USD per 1M tokens, [input, output]) used for per-step cost
 * accounting and budget enforcement.
 *
 * Lookup order: `NEBIUS_PRICES_JSON='{"model-id":[in,out],…}'` overrides →
 * `EXACT_PRICES` (ids read off the Token Factory catalog) → family ESTIMATES
 * from public price listings. None of them has been checked against a Token
 * Factory invoice (see docs/hackathon/STATUS.md "Unverified"). Unknown models
 * fall back to the most expensive family, so budgets stay conservative.
 */

export type PricePair = readonly [number, number];

/**
 * Exact catalog prices (non-cached input, output), read off the Token Factory
 * model catalog pages on 2026-10-30 (capture: docs/hackathon/evidence/
 * catalog-successors-2026-10-30.txt, D96):
 *   https://tokenfactory.nebius.com/models/catalog/image2text/nvidia%2FNemotron-3.5-Super-VL
 *   https://tokenfactory.nebius.com/models/catalog/text2text/nvidia%2FNemotron-3_5-Lightning
 * Cached input ($0.06 / $0.03) is not modelled: costs stay an upper bound.
 */
export const EXACT_PRICES: Readonly<Record<string, PricePair>> = {
  "nvidia/Nemotron-3.5-Super-VL": [0.3, 0.9],
  "nvidia/Nemotron-3_5-Lightning": [0.06, 0.24],
};

/** Family estimates, first match wins (order matters: "omni" before "nano"). */
export const FAMILY_PRICES: ReadonlyArray<{ readonly pattern: RegExp; readonly price: PricePair }> = [
  { pattern: /^mock/i, price: [0, 0] },
  { pattern: /ultra/i, price: [0.6, 2.4] },
  { pattern: /super/i, price: [0.3, 0.9] },
  { pattern: /omni|vl\b|vision/i, price: [0.1, 0.4] },
  { pattern: /nano|lightning/i, price: [0.06, 0.24] },
];

const FALLBACK: PricePair = [0.6, 2.4];

export function priceOverrides(env: NodeJS.ProcessEnv = process.env): Record<string, PricePair> {
  const out: Record<string, PricePair> = {};
  const raw = env.NEBIUS_PRICES_JSON;
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [model, v] of Object.entries(parsed)) {
      if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && x >= 0 && Number.isFinite(x))) {
        out[model] = [v[0] as number, v[1] as number];
      }
    }
  } catch {
    // malformed override → keep defaults
  }
  return out;
}

export function priceOf(model: string, overrides: Record<string, PricePair> = priceOverrides()): PricePair {
  return overrides[model] ?? EXACT_PRICES[model] ?? FAMILY_PRICES.find((f) => f.pattern.test(model))?.price ?? FALLBACK;
}

export function costOf(model: string, promptTokens: number, completionTokens: number, overrides?: Record<string, PricePair>): number {
  const [pin, pout] = priceOf(model, overrides);
  return Math.round(((promptTokens * pin + completionTokens * pout) / 1e6) * 1e8) / 1e8;
}
