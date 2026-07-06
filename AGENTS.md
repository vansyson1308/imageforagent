# AGENTS.md

Guidance for AI agents. Two audiences: agents **working on this codebase**, and agents **using the running app** to produce storyboards.

## Using the app (as a client)

The entire product is driven over REST — see the **Agent workflow (API recipes)** and **Full API reference** sections in [README.md](README.md). Key facts:

- Base URL: `http://localhost:3000` (start with `npm run dev`).
- All errors: `{"error":{"code","message","hint?"}}` — `hint` usually tells you the fix.
- Generation is an async job: `POST /api/generate` → poll `GET /api/generate/:jobId/status` every ~2s until `done`.
- Regenerate a single frame by passing `frameIds` — it never touches other frames.
- `GET /api/export/zip?projectId=` gives you `FNN.png` + `storyboard.json` + `captions.srt`; build the final video yourself (e.g. with Remotion) using `playbackSpeed` for timing and `shotType` per frame for camera motion.
- Without `GEMINI_API_KEY`, images come from a free mock provider — use it to validate your pipeline before spending credits. Check `GET /api/meta` for the active provider and today's usage against `DAILY_GEN_LIMIT`.

## Working on the codebase

<!-- BEGIN:nextjs-agent-rules -->
### This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

Notably: route-handler `params` is a **Promise** (`const { id } = await ctx.params`), and design tokens live in `globals.css` `@theme` (Tailwind v4), not `tailwind.config`.

### Commands

```bash
npm run dev      # dev server (Turbopack), http://localhost:3000
npm test         # vitest — MUST stay green; tests never call paid APIs
npm run build    # production build — must be clean
npm run lint     # eslint (includes React Compiler rules)
npx tsc --noEmit # strict typecheck
npx prisma migrate deploy && npx prisma generate   # DB setup after clone
node scripts/smoke-gemini.mjs [--image]            # manual real-API smoke test (costs money with --image)
```

### Conventions

- **Never call paid APIs in automated tests.** Real-API verification lives in `scripts/smoke-*.mjs`, run manually.
- **Pure core, thin edges**: `promptComposer`, `tsvParser`, `frameService`, `srtBuilder` are pure functions with unit tests (promptComposer is snapshot-tested — prompt changes must update snapshots deliberately). Route handlers stay thin: `handleRoute` + Zod `parseBody` + `enforceRateLimit` + service calls.
- **Adapter pattern for AI**: model calls only go through `ImageProvider`/`TextProvider` (`src/lib/providers/`). New model = new adapter + factory entry; don't call SDKs from routes or UI.
- **Storage paths** are relative POSIX (`projectId/frames/x.png`) joined against `STORAGE_ROOT` at read time via `resolveStoragePath` (traversal-guarded). Never store absolute or `\`-separated paths.
- **Prisma 7** with the Rust-free client: generated into `src/generated/prisma` (gitignored), SQLite via `@prisma/adapter-better-sqlite3`, config in `prisma.config.ts` (CLI reads `.env` only).
- **Job engine**: `jobRunner.ts` is a `globalThis` singleton (survives HMR); every status transition is persisted; frames stuck mid-flight are swept to `failed` on boot. Mutation routes must call `assertNoRunningJob(projectId)` before structural frame changes.
- Errors use `AppError(code, message, hint?)` — codes enumerated in `src/lib/services/apiError.ts`. UI strings are Vietnamese; prompts sent to image models are English.
- Commit style: conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).

### Architecture decisions

See [docs/ADR.md](docs/ADR.md) — including why the image-to-video phase was removed (ADR-009) and hard-won API findings (Gemini `response_format` only accepts `image/jpeg`; Veo `referenceImages` is incompatible with image-to-video) in case anyone revisits video generation.
