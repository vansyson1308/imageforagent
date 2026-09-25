# Director benchmark: results

**Status: NOT RUN YET.** No numbers are reported here until they come from real Nemotron runs.

The bench is `scripts/eval/director_bench.ts` (10 fixed stories: EN ×4, VI ×3, JA ×3, 4–12 shots). It runs three configs (super-only, full crew, full crew + Tavily) through the public API and rewrites this file with the tables, `eval/runs.csv`, `eval/runs.jsonl` and `eval/chart.png`.

It could not run from the build session: that session's network policy blocks `api.tokenfactory.nebius.com` and the hosted demo (see `BLOCKERS.md` B3). To produce the results:

```bash
npm run director:bench -- --base https://studio-production-049c.up.railway.app --passcode "$DEMO_PASSCODE"
# cheaper first pass: --limit 4 --configs A,B
```

The pipeline was dry-run against the scripted mock crew (outputs stamped "MOCK, NOT RESULTS", not committed).
