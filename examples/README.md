# Example artwork — "Pip" the robot

A complete working sample showing how an agent authors storyboard artwork as SVG code.

| File | What it teaches |
|---|---|
| `defs.svg` | The **project artwork library** (`Project.artworkDefs`): the mascot defined ONCE as `<symbol id="pip">`, a variant pose (`#pip-wave`), a prop (`#prop-flag`), and palette gradients. Every frame reuses these via `<use href="#id">` → the character is pixel-identical across all frames, by construction. |
| `frame-01.svg` | Wide establishing shot — full-bleed background rect, scenery from primitives, mascot placed with `<use ... x y width height>`. |
| `frame-02.svg` | Close-up — the **same symbol drawn larger** (and slightly rotated with `<g transform>`); no redrawing, no drift. |
| `frame-03.svg` | Scene continuity — same composition at night: swap the background gradient, keep everything else. |
| `construct-gear.json` | **Geometric construction, 2D**: decompose into primitives (disc + star teeth + hub), combine with booleans (`union` then `difference`) — the way human vector artists build complex marks. Each `.json` has a matching `.svg` — the exact fragment `POST /api/construct` compiles it to, for diffing. |
| `construct-house.json` | **Isometric 3D**: convex-pentagon body extruded from a 2D profile, two tilted-box roof slabs, `overlay` cutouts (door, round window) applied to a projected face, 3-tone auto shading. |
| `construct-rocket.json` | **Full free 3D**: arbitrary orbit camera (az 30°, el 15°), `smooth`-shaded cylinder/cones (silhouette + gradient), extruded fins rotated in 3D, a porthole decal on a smooth body. |
| `construct-dice.json` | **Volumetric CSG**: a white die with six spherical pips subtracted from three faces in one nested `csg` chain — cut interiors inherit the cutter's red. |
| `construct-cart.json` | **The works (hero)**: an articulated `figure` (FK pose by joint names) leaning to push a two-wheeled cart — hollowed body via `csg`, `wheel` parts with spokes and a real bore, a `tree`, exact projected `shadow`s, and `depthSort:"exact"` resolving all the interpenetrations. |
| `construct-shading.json` | **Light layers**: `light.mode:"gradient"` (per-face smooth ramps) + `shadow.style:"blob"` soft ellipses under a cube/sphere/cone trio. |

## How to run this example

```bash
BASE=http://localhost:3000
PID=$(curl -s -X POST $BASE/api/projects -H "Content-Type: application/json" \
  -d '{"name":"Pip Demo"}' | jq -r .id)

# script (3 frames)
curl -s -X POST $BASE/api/script/import -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PID\",\"source\":\"tsv\",\"tsvText\":\"1\tWide shot\tPip waves hello\n2\tClose-up\tPip smiles\n3\tWide shot\tNight: the flag\"}"

# artwork library (note: JSON-encode the file content)
jq -Rs "{artworkDefs: .}" examples/defs.svg | \
  curl -s -X PATCH $BASE/api/projects/$PID -H "Content-Type: application/json" -d @-

# per-frame artwork (repeat for each frame id from GET /api/projects/$PID)
jq -Rs "{svg: .}" examples/frame-01.svg | \
  curl -s -X PUT $BASE/api/frames/<frameId>/artwork -H "Content-Type: application/json" -d @-

# tweak the library → re-render everything in one call
curl -s -X POST $BASE/api/render -H "Content-Type: application/json" -d "{\"projectId\":\"$PID\"}"
```

## Geometric construction (3D & complex shapes)

Instead of hand-writing every path, describe artwork as **primitives + booleans + 3D solids** and let the engine compile it:

```bash
# compile a spec → SVG fragment + instant PNG preview (data URI)
jq -Rs '{spec: (. | fromjson), preview: {background: "#bfe3f2"}}' examples/construct-house.json | \
  curl -s -X POST $BASE/api/construct -H "Content-Type: application/json" -d @- > result.json

jq -r .stats result.json              # faces/bytes/compileMs — tune against limits
jq -r .warnings result.json           # e.g. overlapping solids
jq -r .previewPng result.json | sed 's/^data:image\/png;base64,//' | base64 -d > preview.png  # LOOK at it

# happy? paste the compiled fragment into a frame (compose with a background)
jq -r .svg result.json > house.svg
printf '%s%s' '<rect width="1920" height="1080" fill="#bfe3f2"/>' "$(cat house.svg)" | \
  jq -Rs '{svg: .}' | curl -s -X PUT $BASE/api/frames/<frameId>/artwork -H "Content-Type: application/json" -d @-
```

The construct endpoint is **stateless** — nothing is stored; the SVG you paste stays the single source of truth. Iterate by editing the spec and re-POSTing (compile is ~20ms). Full spec reference in the main [README](../README.md).

## Authoring rules (the agent contract)

- **Logical canvas** (the `viewBox` you draw in): 16:9 → `1920×1080`, 9:16 → `1080×1920`, 1:1 → `1080×1080`, 4:5 → `1080×1350`. Output PNG: long edge 1024px (1K) or 2048px (2K).
- Submit **fragments only** — no `<svg>` root tag anywhere (not even in comments: the sanitizer is reject-over-broad by design).
- Start each frame with a full-bleed background rect; unpainted areas become transparent.
- Allowed references: `href="#id"`, `fill="url(#id)"`, `data:image/png|jpeg|webp` URIs. Everything external is rejected.
- **Prefer paths/shapes over `<text>`** — text renders, but font metrics vary between operating systems; paths are pixel-identical everywhere.
- Forbidden (422 `ARTWORK_INVALID` with a hint): DOCTYPE, entities, script, foreignObject, event handlers, external href/src/url(), `@import`, `xml:base`, processing instructions, nested svg roots, fragments > 500KB (UTF-8 bytes).
