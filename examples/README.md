# Example artwork — "Pip" the robot

A complete working sample showing how an agent authors storyboard artwork as SVG code.

| File | What it teaches |
|---|---|
| `defs.svg` | The **project artwork library** (`Project.artworkDefs`): the mascot defined ONCE as `<symbol id="pip">`, a variant pose (`#pip-wave`), a prop (`#prop-flag`), and palette gradients. Every frame reuses these via `<use href="#id">` → the character is pixel-identical across all frames, by construction. |
| `frame-01.svg` | Wide establishing shot — full-bleed background rect, scenery from primitives, mascot placed with `<use ... x y width height>`. |
| `frame-02.svg` | Close-up — the **same symbol drawn larger** (and slightly rotated with `<g transform>`); no redrawing, no drift. |
| `frame-03.svg` | Scene continuity — same composition at night: swap the background gradient, keep everything else. |

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

## Authoring rules (the agent contract)

- **Logical canvas** (the `viewBox` you draw in): 16:9 → `1920×1080`, 9:16 → `1080×1920`, 1:1 → `1080×1080`, 4:5 → `1080×1350`. Output PNG: long edge 1024px (1K) or 2048px (2K).
- Submit **fragments only** — no `<svg>` root tag anywhere (not even in comments: the sanitizer is reject-over-broad by design).
- Start each frame with a full-bleed background rect; unpainted areas become transparent.
- Allowed references: `href="#id"`, `fill="url(#id)"`, `data:image/png|jpeg|webp` URIs. Everything external is rejected.
- **Prefer paths/shapes over `<text>`** — text renders, but font metrics vary between operating systems; paths are pixel-identical everywhere.
- Forbidden (422 `ARTWORK_INVALID` with a hint): DOCTYPE, entities, script, foreignObject, event handlers, external href/src/url(), `@import`, processing instructions, nested svg roots, fragments > 500KB.
