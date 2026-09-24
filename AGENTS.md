# AGENTS.md

Guidance for AI agents. Two audiences: agents **using the running app** to produce storyboards, and agents **working on this codebase**.

## Using the app (as a client)

This engine is built FOR you — no API keys needed. You write the artwork as SVG; the engine renders it. Full workflow + API reference in [README.md](README.md); working sample in [examples/](examples/).

The essentials:

1. `POST /api/projects` → `POST /api/script/import` (TSV: `STT | Shot Type | Description`).
2. Design the character/props ONCE: `PATCH /api/projects/:id` with `{artworkDefs}` — inner `<defs>` content: `<symbol id="…">`, gradients. This is your consistency mechanism: every frame that `<use href="#id">`s a symbol renders it pixel-identically.
3. For complex or 3D artwork, don't hand-write paths — `POST /api/construct` with a geometric-construction spec (full vocabulary in README): 2D/3D primitives, bezier booleans, **volumetric `csg` solids** (subtract a sphere from a box; cut faces inherit the cutter's color), **`groups` FK frames**, **`parts`** (articulated `figure` with named-joint pose, `wheel`, `tree`, `cloud`, `arrow`), `shadow` layer, `light.mode: gradient`, and `depthSort: exact` (default — interpenetrating solids render correctly). Stateless: response carries `svg`, `stats`, `warnings`, and (with `preview`) a `previewPng` data URI — look at it, tune, re-POST, then paste `svg` into defs or a frame. Spec errors are `422 CONSTRUCTION_INVALID` with a hint. Gradient ids `cg-*` and part-segment ids `partId:segment` are engine-reserved.
4. To make it look FINISHED, apply **The Softness Principle** (README section): vector is hard-edged by nature — softness is faked by stacking layers with gradient-feathered edges. Per-solid `effects` (`formShadow/highlight/rim/coreAccent/specular/glow/contact` — all from one boolean rule on the silhouette), author `gradients[]` (fill via `url(#id)`, preview-safe), `atmosphere` (`depthFade` + `vignette`), 2D `layer:"foreground"` for mist/haze, or one-touch `finish:"soft"|"premium"`. Shadows never `#000` (defaults bake lightness −25% + hue toward cool). Blur budget: 6 filters/fragment — prefer `glow:"halo"` and `contact` (pure gradients, free). Hero example: `examples/construct-lamp.json`.
5. Per frame: `PUT /api/frames/:id/artwork` with `{svg}` — the scene body (no `<svg>` root). Renders synchronously; response carries `imageUrl`. A render failure still saves your SVG (`status:"failed"` + `errorMsg` hint) — fix and re-PUT.
6. **Make a frame MOVE** (construct v4): `POST /api/motion` with `{motion:{version:1, fps, duration, scene:<construct spec>, tracks, rigs}}` → **look at `contactSheetPng`** (evenly sampled frames + time bars), tune, then `PUT /api/frames/:id/motion {motion}` (PNG sequence + WebP; `poster` time becomes the still). Tracks target dotted paths by id (`parts.hero.pose.kneeL`, `camera.orbit.azimuth`, `solids.ball.at.1`, `solids.x.fill`); `ease` belongs to the segment ARRIVING at a key (default `inOut`). Reach for rigs before hand-keying: `walk` (no-slip gait along `path:[[x,z]…]`), `shot` (`dollyIn/pan/orbit/crane/tilt/shake`, or `auto` from Shot Type), `roll`, `follow` (lagged follow-through), `wiggle` (seeded noise). 12 fps is the animation standard; `holdFrames: 2` = on twos. Errors name the frame time (`At t=0.5s …`).
7. **Film layer** (details in README "The film pipeline"): `ik` rig (`{part, limb, target:[x,y,z]|{solid}}` — hands/feet land exactly, even on moving solids) and `figure.face: {}` + `lipsync` rig; `PUT /api/frames/:id/dialogue {text, tts:{voice:"vi"}|wav}` (subtitle + voice + lip-sync); `PUT /api/projects/:id/soundtrack {wav}` (ducked music); `PATCH /api/frames/:id {scene, transition:"dissolve"…}`; `POST /api/frames/:id/passes` (depth/segmentation/normal/OpenPose for AI video); `GET /api/projects/:id/lint` before exporting.
8. Changed the defs or canvas settings? `POST /api/render` re-renders everything (motion frames re-render their clips).
9. `GET /api/export/zip?projectId=` → `FNN.png` + `clips/FNN/%04d.png` + `storyboard.json` (timeline `startSec/durationSec`, all SVG + motion sources) + `captions.srt`/`subtitles.srt` + `audio/mix.wav` + `edit/film.{edl,otio}` + `passes/` + `assemble.sh` (**`sh assemble.sh` → film.mp4** via ffmpeg) + `gltf/FNN.gltf`. For path-traced 3D: `POST /api/export/gltf {motion|spec}` → `blender -b -P scripts/blender_render.py -- shot.gltf out/ --engine CYCLES`.
10. **Theatrical DCP**: author at `aspectRatio: "1.85:1"` (Flat, logical 1998×1080) or `"2.39:1"` (Scope, 2048×858), `resolution: "2K"` or `"4K"`, export, unzip, then `npm run master:dcp -- <dir> --out DCP --title "…" --kind short` (needs ffmpeg + opj_compress). Validate with ClairMeta. The same `--date` reproduces the DCP byte-for-byte.

Authoring rules (memorize these — violations return `422 ARTWORK_INVALID` with a hint):

- Draw in the **logical canvas**: 16:9→1920×1080, 9:16→1080×1920, 1:1→1080², 4:5→1080×1350, 1.85:1→1998×1080, 2.39:1→2048×858 (canvas table in README).
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
- **`src/lib/services/construct/` is pure and deterministic** — no I/O, no randomness, one `fmt()` number formatter, stable sort tie-breaks; output is snapshot-tested and double-compile must be byte-identical. Its output MUST pass `sanitizeSvg` (runtime assert in `compile.ts` + emitter allowlist test: g/path/gradients/stop/filter/feGaussianBlur only). Dependency policy: `path-bool` is the only geometry dep — ALL 3D math is hand-written (`math3d.ts` must not import gl-matrix), including the layered v2 kernel: `plane3` (split-by-plane) → `csg` (BSP volumetric booleans, csg.js algorithm) + `depthOrder` (Newell–Newell–Sancha exact sort, lazy splits) → `meshRepair` (coplanar re-merge) → `shadow`/`faceGradient` (light layers) → `partsExpand`/`partFigure`/`partWheel` (FK + parametric parts) → v3 softness: `silhouette` (screen outline) → `effects` (crescent overlays, One Boolean Rule) + `atmosphere` (depthFade/vignette) + `finish` (presets, fill-only rewrite) → `emitScene` (paint-order assembly). Design rationale + honest limits in ADR-011/012/013. Examples in `examples/construct-*.{json,svg}` are test-enforced (`REGEN_EXAMPLES=1 npx vitest run tests/construct/examples.test.ts` to regenerate).
- **`src/lib/services/motion/` is pure and deterministic too** (construct v4, ADR-014): `evaluate.ts` turns (motion spec, t) into a static construct spec — fixed order generators(walk, shot) → tracks → dependents(roll, follow) → wiggle, then re-validates with `constructSpecSchema`. Noise is seeded hashing, never `Math.random`. `targetPath.ts` walks own-properties only and bans `__proto__/constructor/prototype` — keep it that way. The walk rig's no-slip property is test-enforced (`tests/motion/walk.test.ts`) — change gait math only with that test green. `motionRenderer.ts` (sharp edge) sanitizes every composed frame body, since `backdrop`/`overlay` are agent input.
- **`construct/gltf.ts`** (ADR-015) exports the SAME meshes the SVG path draws (`sceneMeshes.ts` is the single mesh source — don't fork mesh building). Its camera is test-enforced to project world points onto the same canvas pixel as the SVG renderer, and every example must pass the Khronos `gltf-validator` (devDependency, tests only) with 0 errors.
- **Timeline**: `timeline.ts` is the one timing source for `storyboard.json`, `captions.srt` and `assemble.sh`; never compute shot timing elsewhere. Frame motion fields (`motionSpec`, `clip*`) live on `Frame`; a still `PUT …/artwork` on a motion frame reverts it to a still.
- **Film layer is pure too** (ADR-016): `motion/ik.ts` (analytic 2-bone IK, exact — test the solver with *reachable* targets), `construct/passes.ts` + `pose2d.ts` (control passes reuse the beauty geometry; never fork the mesh path — `sceneMeshes.ts` is the single source for SVG, glTF and passes), `audio/*` (WAV codec, BS.1770-4 loudness cross-checked against ffmpeg `ebur128`, mixer; keep it streaming/lean — whole-film buffers are Float32), `timeline.ts` (24 fps frame-quantized; EDL/OTIO/SRT/assemble.sh/DCP all read it — never compute timing elsewhere), `dcp/*` (X′Y′Z′, SMPTE MXF muxer, CPL/PKL). MXF layout changes must keep `tests/dcp.test.ts` green, including the asdcplib check when `asdcp-info` is installed. `tts.ts` spawns espeak-ng with an argv array and text on stdin — never a shell.
- **DCP mastering is a CLI** (`scripts/master-dcp.ts`, `npm run master:dcp`), not a route: it runs minutes–hours and shells out to ffmpeg/opj_compress. It must stay streaming (O(1) memory in film length) and deterministic for a given `--date`.
- Rendering is **synchronous** (sharp, ~20–50ms/frame; a 36-frame shot ~3s) — there are deliberately no job queues/polling. Don't reintroduce them; the clip renderer yields the event loop between frames instead.
- **Storage paths** are relative POSIX (`projectId/frames/x.png`) resolved via `resolveStoragePath` (traversal-guarded). Never store absolute or `\`-separated paths.
- **Prisma 7**, Rust-free client generated into `src/generated/prisma` (gitignored), SQLite via `@prisma/adapter-better-sqlite3`, config in `prisma.config.ts` (CLI reads `.env` only).
- Errors: `AppError(code, message, hint?)` — codes in `src/lib/services/apiError.ts`. UI strings Vietnamese; agent-facing artwork errors English.
- Commits: conventional (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).

### History & decisions

[docs/ADR.md](docs/ADR.md) — including ADR-016 (film layer N1–N5: rig/IK, control passes, audio, editorial, DCP mastering — what each was verified against and its honest limits), ADR-014 (motion: time as a pure function of the spec, no-slip walk, evaluation order), ADR-015 (glTF bridge + honest film roadmap, see [docs/FILM-ROADMAP.md](docs/FILM-ROADMAP.md)), ADR-010 (why zero-key SVG replaced AI image generation, librsvg capability findings, sanitizer soundness argument), ADR-011 (the construct engine: stateless compiler design, why path-bool + hand-written 3D math, honest limitations), ADR-012 (v2 layer architecture), ADR-013 (the Softness layer: One Boolean Rule, per-solid overlay semantics, filter budget), and preserved findings from the removed Gemini/Veo phases in case anyone revisits AI generation.
