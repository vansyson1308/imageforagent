/**
 * Spend ledger for LIVE scripts (smoke, showcase, bench): every paid call's
 * cost is appended to docs/hackathon/evidence/spend-ledger.jsonl (no secrets).
 * `assertSpendUnder` stops a script before it starts when cumulative spend
 * (ledger) has passed the owner's alert line (SPEND_ALERT_USD, default $15).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

export const LEDGER = "docs/hackathon/evidence/spend-ledger.jsonl";

export interface LedgerEntry {
  readonly at: string;
  readonly script: string;
  readonly label: string;
  readonly model: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
}

export function appendLedger(e: Omit<LedgerEntry, "at">): void {
  mkdirSync("docs/hackathon/evidence", { recursive: true });
  appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n");
}

export function cumulativeSpend(): number {
  if (!existsSync(LEDGER)) return 0;
  return readFileSync(LEDGER, "utf8")
    .split("\n")
    .filter(Boolean)
    .reduce((s, line) => s + (Number((JSON.parse(line) as LedgerEntry).costUsd) || 0), 0);
}

export function assertSpendUnder(limit = Number(process.env.SPEND_ALERT_USD ?? 15)): number {
  const spent = cumulativeSpend();
  if (spent >= limit) {
    console.error(`STOP: cumulative estimated spend $${spent.toFixed(2)} ≥ alert line $${limit}. Report to the owner before spending more.`);
    process.exit(3);
  }
  return spent;
}
