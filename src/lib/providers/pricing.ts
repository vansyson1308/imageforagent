/**
 * Token pricing (USD per 1M tokens, [input, output]) used for per-step cost
 * accounting and budget enforcement.
 *
 * The defaults are ESTIMATES from public price listings, matched by model
 * family. They have not been checked against a Token Factory invoice (see
 * docs/hackathon/STATUS.md "Unverified"). Override exact ids with
 * `NEBIUS_PRICES_JSON='{"model-id":[in,out],…}'`. Unknown models fall back
 * to the most expensive family, so budgets stay conservative.
 */

export type PricePair = readonly [number, number];

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
  return overrides[model] ?? FAMILY_PRICES.find((f) => f.pattern.test(model))?.price ?? FALLBACK;
}

export function costOf(model: string, promptTokens: number, completionTokens: number, overrides?: Record<string, PricePair>): number {
  const [pin, pout] = priceOf(model, overrides);
  return Math.round(((promptTokens * pin + completionTokens * pout) / 1e6) * 1e8) / 1e8;
}
