import type { CanvasSize } from "@/lib/services/svgRenderer";

/**
 * camera — turns an Artist's painted still into an animated SHOT using only
 * the existing engine contracts (no engine change). This module is pure.
 *
 * - The painting goes into the project defs as a `<pattern>` whose tile is
 *   the whole logical canvas, offset by −canvas/2. The motion spec's scene is
 *   one canvas-sized rect filled with `url(#art-fN)`, centred on the group
 *   origin. Tracks on `place.at` / `place.scale` then move the group, and
 *   the pattern (in the group's user space) moves with it. The result is a
 *   real dolly/pan/tilt over vector art, rendered at full resolution every
 *   frame (verified with a contact sheet, docs/hackathon/DECISIONS.md D8).
 * - The Artist's optional AMBIENT layer (2D construct shapes + tracks, in
 *   canvas coordinates) is shifted into the same camera space, so it rides
 *   the camera move together with the painting.
 * - Ids inside each painting are namespaced per shot (`f3-sky`). All shots
 *   share one defs document, so a duplicate id would otherwise let shot 3
 *   pick up shot 1's gradient.
 */

export const artPatternId = (index: number) => `art-f${index}`;

/** Prefix every id DECLARED in the fragment and rewrite its local references. */
export function namespaceIds(svg: string, prefix: string): string {
  const declared = new Set<string>();
  for (const m of svg.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) declared.add(m[1]);
  if (declared.size === 0) return svg;
  const map = (id: string) => (declared.has(id) ? `${prefix}${id}` : id);
  return svg
    .replace(/\bid\s*=\s*(["'])([^"']+)\1/g, (_, q: string, id: string) => `id=${q}${map(id)}${q}`)
    .replace(/(\b(?:xlink:)?href\s*=\s*)(["'])#([^"']+)\2/g, (_, a: string, q: string, id: string) => `${a}${q}#${map(id)}${q}`)
    .replace(/url\(\s*(["']?)#([^"')\s]+)\1\s*\)/g, (_, q: string, id: string) => `url(${q}#${map(id)}${q})`);
}

/** The painting as a defs pattern aligned to a canvas-sized rect centred on the origin. */
export function artPattern(index: number, svg: string, canvas: CanvasSize): string {
  return (
    `<pattern id="${artPatternId(index)}" patternUnits="userSpaceOnUse" x="${-canvas.w / 2}" y="${-canvas.h / 2}" width="${canvas.w}" height="${canvas.h}">\n` +
    `${namespaceIds(svg, `f${index}-`)}\n</pattern>`
  );
}

export type CameraMove = "dollyIn" | "dollyOut" | "panLeft" | "panRight" | "tiltUp" | "tiltDown" | "drift";

/** Storyboard shot type → camera move (EN + VI keywords), deterministic by shot index. */
export function cameraMoveFor(shotType: string, index: number): CameraMove {
  const s = shotType.toLowerCase();
  if (/zoom[- ]?out|dolly[- ]?out|pull[- ]?(back|out)|lùi|thu nhỏ|zoom ra|reveal/.test(s)) return "dollyOut";
  if (/close|cận|zoom|dolly|push|insert|detail|chi tiết/.test(s)) return "dollyIn";
  if (/pan|track|truck|lia|travel/.test(s)) return index % 2 === 0 ? "panLeft" : "panRight";
  if (/tilt|crane|high|low|ngước|từ trên|từ dưới/.test(s)) return /up|low|ngước|dưới/.test(s) ? "tiltUp" : "tiltDown";
  if (/wide|establish|toàn|rộng|long/.test(s)) return index % 2 === 0 ? "dollyIn" : "panRight";
  return "drift";
}

interface Key {
  t: number;
  v: number | number[];
  ease?: string;
}

/**
 * Keyframes for `place.scale` / `place.at`. Every offset stays inside the
 * margin that the zoom opens up (|dx| ≤ w/2·(s−1)), so the canvas never shows
 * past the painting's edge.
 */
export function cameraTracks(move: CameraMove, duration: number, canvas: CanvasSize): Array<{ target: string; keys: Key[] }> {
  const cx = canvas.w / 2;
  const cy = canvas.h / 2;
  const T = Math.max(0.1, duration);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const zoom = (a: number, b: number) => ({ target: "place.scale", keys: [{ t: 0, v: a }, { t: r3(T), v: b }] });
  const at = (a: [number, number], b: [number, number]) => ({ target: "place.at", keys: [{ t: 0, v: a }, { t: r3(T), v: b }] });
  const s = 1.12;
  const mx = Math.floor(cx * (s - 1) * 0.8);
  const my = Math.floor(cy * (s - 1) * 0.8);
  switch (move) {
    case "dollyIn":
      return [zoom(1.0, 1.14)];
    case "dollyOut":
      return [zoom(1.14, 1.0)];
    case "panLeft":
      return [zoom(s, s), at([cx + mx, cy], [cx - mx, cy])];
    case "panRight":
      return [zoom(s, s), at([cx - mx, cy], [cx + mx, cy])];
    case "tiltUp":
      return [zoom(s, s), at([cx, cy - my], [cx, cy + my])];
    case "tiltDown":
      return [zoom(s, s), at([cx, cy + my], [cx, cy - my])];
    case "drift":
    default:
      return [zoom(1.02, 1.07)];
  }
}

export interface AmbientLayer {
  readonly shapes: ReadonlyArray<Record<string, unknown>>;
  readonly tracks: ReadonlyArray<{ target: string; keys: ReadonlyArray<{ t: number; v: unknown; ease?: unknown }>; blend?: string }>;
}

function shiftVec(v: unknown, dx: number, dy: number): unknown {
  return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number") ? [v[0] - dx, v[1] - dy] : v;
}

/**
 * Canvas-space ambient shapes → camera space (origin at canvas centre).
 * Only `at` moves. Raw `path` d / polygon points ride on `at` (their local
 * coords are relative to it), so a path drawn in canvas coords with at=[0,0]
 * becomes at=[−cx,−cy] and lands exactly where it was drawn.
 */
export function toCameraSpace(layer: AmbientLayer, canvas: CanvasSize): AmbientLayer {
  const cx = canvas.w / 2;
  const cy = canvas.h / 2;
  const shapes = layer.shapes.map((sh) => ({ ...sh, at: shiftVec(sh.at ?? [0, 0], cx, cy) }));
  const tracks = layer.tracks.map((tr) => {
    if ((tr.blend ?? "set") !== "set") return tr;
    const m = tr.target.match(/^shapes\.[\w-]+\.at(?:\.(0|1))?$/);
    if (!m) return tr;
    const comp = m[1];
    const keys = tr.keys.map((k) => ({
      ...k,
      v:
        comp === undefined
          ? shiftVec(k.v, cx, cy)
          : typeof k.v === "number"
            ? k.v - (comp === "0" ? cx : cy)
            : k.v,
    }));
    return { ...tr, keys };
  });
  return { shapes, tracks };
}

/** Raw motion spec (validated downstream by motionSpecSchema) for one shot. */
export function buildShotMotion(opts: {
  readonly index: number;
  readonly shotType: string;
  readonly duration: number;
  readonly fps: number;
  readonly canvas: CanvasSize;
  readonly background: string;
  readonly ambient?: AmbientLayer | null;
  readonly move?: CameraMove;
}): Record<string, unknown> {
  const { canvas } = opts;
  const move = opts.move ?? cameraMoveFor(opts.shotType, opts.index);
  const ambient = opts.ambient ? toCameraSpace(opts.ambient, canvas) : { shapes: [], tracks: [] };
  const duration = Math.round(opts.duration * 1000) / 1000;
  return {
    version: 1,
    fps: opts.fps,
    duration,
    background: opts.background,
    poster: Math.round(duration * 0.5 * 1000) / 1000,
    scene: {
      version: 1,
      shapes: [{ id: "art", type: "rect", w: canvas.w, h: canvas.h, fill: `url(#${artPatternId(opts.index)})` }, ...ambient.shapes],
    },
    tracks: [...cameraTracks(move, duration, canvas), ...ambient.tracks],
  };
}
