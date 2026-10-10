# Director benchmark v2: results

**Not measured yet.** The v2 benchmark runs once, on **one frozen eval commit** (target 2026-10-14), after the quality sprint and the showcase re-shoots (owner QC, 2026-10-10). Until then there are no v2 results; the v1 results are in [EVAL_RESULTS_V1.md](EVAL_RESULTS_V1.md) (crew v1, gemma-3-27b-it judge: **5.49**).

How it will be reported:

- Same 10 prompts and the same judge prompt as v1; configs super-only v2, crew v2, crew v2+tavily (only with a Tavily key).
- **Headline: the v1 judge alone (`google/gemma-3-27b-it`)**, compared with v1's 5.49 like for like. The second judge (`moonshotai/Kimi-K3`, probed live, D49) is reported in its own column and its own paired table.
- Every row records the server commit; the bench refuses to start on, or continue after a change to, any other commit (`--eval-commit`).
- Critic uplift is judged by both judges on pre- vs post-revision snapshots of the same shot.

Earlier partial runs are kept as evidence only, not results: [bench-v2-prefix-2026-10-10.jsonl](evidence/bench-v2-prefix-2026-10-10.jsonl) (before D50) and [bench-v2-day1-54403f5.jsonl](evidence/bench-v2-day1-54403f5.jsonl) (one prompt, before the ambient-key fix; stopped at the daily budget).
