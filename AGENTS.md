# AGENTS.md

Guidance for AI agents. Two audiences: agents **using the running app** to produce storyboards, and agents **working on this codebase**.

## Using the app (as a client)

This engine is built FOR you — no API keys needed. You write the artwork as SVG; the engine renders it. Full workflow + API reference in [README.md](README.md); working sample in [examples/](examples/).

The essentials:

1. `POST /api/projects` → `POST /api/script/import` (TSV: `STT | Shot Type | Description`).
2. Design the character/props ONCE: `PATCH /api/projects/:id` with `{artworkDefs}` — inner `<defs>` content: `<symbol id="…">`, gradients. This is your consistency mechanism: every frame that `<use href="#id">`s a symbol renders it pixel-identically.
3. For complex or 3D-looking artwork, don't hand-write paths — `POST /api/construct` with a geometric-construction spec (primitives + booleans + 3D solids + camera + light; full vocabulary in README). Stateless: response carries the compiled `svg` fragment, `stats`, `warnings`, and (if you send `preview`) a `previewPng` data URI — look at it, tune the spec, re-POST (~20ms), then paste `svg` into defs or a frame. Spec errors are `422 CONSTRUCTION_INVALID` with a hint. No volumetric CSG: drill holes with profile booleans before `extrude`, or `cutouts` after projection. Gradient ids `cg-*` are reserved.
4. Per frame: `PUT /api/frames/:id/artwork` with `{svg}` — the scene body (no `<svg>` root). Renders synchronously; response carries `imageUrl`. A render failure still saves your SVG (`status:"failed"` + `errorMsg` hint) — fix and re-PUT.
5. Changed the defs or canvas settings? `POST /api/render` re-renders everything.
6. `GET /api/export/zip?projectId=` → `FNN.png` + `storyboard.json` (includes all SVG sources) + `captions.srt`. Build the video yourself (e.g. Remotion): `playbackSpeed` = seconds/frame, `shotType` = camera motion per frame.

Authoring rules (memorize these — violations return `422 ARTWORK_INVALID` with a hint):

- Draw in the **logical canvas**: 16:9→1920×1080, 9:16→1080×1920, 1:1→1080², 4:5→1080×1350 (canvas table in README).
- Fragments only — never an `<svg>` tag, **not even in comments** (the sanitizer rejects over-broadly by design).
- Only `href="#id"`, `url(#id)`, and `data:image/png|jpeg|webp` references. No external URLs, no scripts, no DOCTYPE, no event handlers, no `xml:base`, ≤500KB (UTF-8 bytes) per fragment.
- Start frames with a full-bleed background rect. Prefer paths/shapes over `<text>` (font metrics vary per OS).

## Working on the codebase

<!-- BEGIN:nextjs-agent-rules -->
### This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

Notably: route-handler `params` is a **Promise** (`const { id } = await ctx.params`); design tokens live in `globals.css` `@theme` (Tailwind v4).

### Commands

```bash
npm run dev      # dev server (Turbopack), http://localhost:3000
npm test         # vitest — MUST stay green (includes the sanitizer bypass-vector suite)
npm run build    # production build — must be clean
npm run lint     # eslint (includes React Compiler rules)
npx tsc --noEmit # strict typecheck
npx prisma migrate deploy && npx prisma generate   # DB setup after clone
```

### Conventions

- **`src/lib/services/svgRenderer.ts` is security-critical.** Its sanitizer is a reject-not-strip pattern list whose soundness rests on banning `<!DOCTYPE` (closes XML's only markup-construction channel). Any change there requires new bypass-vector tests in `tests/svgRenderer.test.ts`. Beware regex backtracking: allowed-forms belong INSIDE lookaheads, never consumed before them (see the href rule).
- **Pure core, thin edges**: `svgRenderer`, `tsvParser`, `frameService`, `srtBuilder` are pure, unit-tested functions. Routes stay thin: `handleRoute` + Zod `parseBody` + `enforceRateLimit` + service calls.
- **`src/lib/services/construct/` is pure and deterministic** — no I/O, no randomness, one `fmt()` number formatter, stable sort tie-breaks; output is snapshot-tested and double-compile must be byte-identical. Its output MUST pass `sanitizeSvg` (runtime assert in `compile.ts` + emitter allowlist test). Dependency policy: `path-bool` is the only geometry dep — 3D math stays hand-written (`math3d.ts` must not import gl-matrix). Examples in `examples/construct-*.{json,svg}` are test-enforced (`REGEN_EXAMPLES=1 npx vitest run tests/construct/examples.test.ts` to regenerate). No volumetric CSG / no BSP by design (ADR-011).
- Rendering is **synchronous** (sharp, ~20–50ms/frame) — there are deliberately no job queues/polling. Don't reintroduce them.
- **Storage paths** are relative POSIX (`projectId/frames/x.png`) resolved via `resolveStoragePath` (traversal-guarded). Never store absolute or `\`-separated paths.
- **Prisma 7**, Rust-free client generated into `src/generated/prisma` (gitignored), SQLite via `@prisma/adapter-better-sqlite3`, config in `prisma.config.ts` (CLI reads `.env` only).
- Errors: `AppError(code, message, hint?)` — codes in `src/lib/services/apiError.ts`. UI strings Vietnamese; agent-facing artwork errors English.
- Commits: conventional (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).

### History & decisions

[docs/ADR.md](docs/ADR.md) — including ADR-010 (why zero-key SVG replaced AI image generation, librsvg capability findings, sanitizer soundness argument), ADR-011 (the construct engine: stateless compiler design, why path-bool + hand-written 3D math, honest limitations), and preserved findings from the removed Gemini/Veo phases in case anyone revisits AI generation.
