/**
 * Hard per-run limits, enforced server-side BEFORE every model call (SPEC §4.2).
 * Exceeding one stops the run cleanly with status "budget_exceeded" and
 * keeps everything already rendered.
 */

export interface DirectorBudget {
  readonly maxShots: number;
  /** prompt + completion tokens for the whole run. */
  readonly maxTokens: number;
  readonly maxUsd: number;
  /** Repair attempts per shot after the first draw (SPEC: 3). */
  readonly maxRepairs: number;
  /** Critic → revise rounds per shot (SPEC: 2). */
  readonly maxCriticRounds: number;
  readonly maxWallMs: number;
}

export const DEFAULT_BUDGET: DirectorBudget = {
  maxShots: 12,
  maxTokens: 600_000,
  maxUsd: 1.5,
  maxRepairs: 3,
  maxCriticRounds: 2,
  maxWallMs: 20 * 60_000,
};

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : d;
};

/** Env caps (server-side ceiling): a request can lower them, never raise them. */
export function budgetFromEnv(env: NodeJS.ProcessEnv = process.env): DirectorBudget {
  return {
    ...DEFAULT_BUDGET,
    maxShots: Math.floor(num(env.DIRECTOR_MAX_SHOTS, DEFAULT_BUDGET.maxShots)),
    maxTokens: Math.floor(num(env.DIRECTOR_MAX_TOKENS_PER_RUN, DEFAULT_BUDGET.maxTokens)),
    maxUsd: num(env.DIRECTOR_MAX_USD_PER_RUN, DEFAULT_BUDGET.maxUsd),
    maxWallMs: Math.floor(num(env.DIRECTOR_MAX_WALL_SECONDS, DEFAULT_BUDGET.maxWallMs / 1000) * 1000),
  };
}

export function clampBudget(ceiling: DirectorBudget, requested: Partial<DirectorBudget> = {}): DirectorBudget {
  const pick = (k: keyof DirectorBudget) => Math.min(ceiling[k], requested[k] ?? ceiling[k]);
  return {
    maxShots: pick("maxShots"),
    maxTokens: pick("maxTokens"),
    maxUsd: pick("maxUsd"),
    maxRepairs: pick("maxRepairs"),
    maxCriticRounds: pick("maxCriticRounds"),
    maxWallMs: pick("maxWallMs"),
  };
}

export class BudgetExceededError extends Error {
  readonly limit: "tokens" | "usd" | "wall" | "daily";
  constructor(limit: BudgetExceededError["limit"], message: string) {
    super(message);
    this.name = "BudgetExceededError";
    this.limit = limit;
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Run cancelled.");
    this.name = "CancelledError";
  }
}

export class BudgetTracker {
  tokensIn = 0;
  tokensOut = 0;
  costUsd = 0;
  readonly startedAt: number;

  constructor(
    readonly budget: DirectorBudget,
    private readonly now: () => number = Date.now,
    /** Extra gate (demo mode's global daily token budget). Throws BudgetExceededError. */
    private readonly externalGate?: () => void,
  ) {
    this.startedAt = now();
  }

  get tokens(): number {
    return this.tokensIn + this.tokensOut;
  }

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  /** Called before each model call and before each expensive render. */
  check(): void {
    if (this.tokens >= this.budget.maxTokens) {
      throw new BudgetExceededError("tokens", `Token budget reached (${this.tokens} ≥ ${this.budget.maxTokens}).`);
    }
    if (this.costUsd >= this.budget.maxUsd) {
      throw new BudgetExceededError("usd", `Cost budget reached ($${this.costUsd.toFixed(4)} ≥ $${this.budget.maxUsd}).`);
    }
    if (this.elapsedMs() >= this.budget.maxWallMs) {
      throw new BudgetExceededError("wall", `Wall-time budget reached (${Math.round(this.elapsedMs() / 1000)} s).`);
    }
    this.externalGate?.();
  }

  add(tokensIn: number, tokensOut: number, costUsd: number): void {
    this.tokensIn += tokensIn;
    this.tokensOut += tokensOut;
    this.costUsd = Math.round((this.costUsd + costUsd) * 1e8) / 1e8;
  }
}
