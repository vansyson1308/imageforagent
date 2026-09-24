/**
 * Shot grammar for the screenplay: a compact, declarative shot description →
 * a validated motion spec (the exact JSON the API receives).
 *
 * The builder adds the craft a human animator would: eased camera moves that
 * keep the subject locked on screen (sampled through the engine's own
 * projection), a camera that tracks a walking actor (positions read back from
 * the engine's evaluator, so framing is exact), idle breathing, blinks, and a
 * sky whose mountains always sit on the ground's horizon.
 */
import { motionSpecSchema, type MotionSpec } from "@/lib/validation/motionSchema";
import { evaluateMotionAt, prepareMotion } from "@/lib/services/motion/evaluate";
import {
  CAST,
  PALETTES,
  character,
  horizonFor,
  placeFor,
  r1,
  r3,
  rand,
  scene,
  sky,
  starLantern,
  type CastMember,
  type CastName,
  type Json,
  type Palette,
  type PaletteName,
  type SetPiece,
  type SkyOptions,
  type Vec2,
  type Vec3,
} from "./kit";

export interface CamKey {
  az: number;
  el: number;
  zoom: number;
  /** World point held at `screen`. */
  focus: Vec3;
  /** Screen position of the focus (default: a little below centre). */
  screen?: Vec2;
}

export interface Key {
  t: number;
  v: number | number[] | string;
  ease?: string;
}

export interface Actor {
  who: CastName;
  /** Override the cast member's look (extra villagers / children). */
  look?: Partial<Pick<CastMember, "fills" | "hair" | "hat" | "height">>;
  /** Part id (default = cast id) — lets a shot hold two of the same villager. */
  id?: string;
  at: Vec3;
  /** Yaw in degrees (0 = facing the +z camera side). */
  yaw?: number;
  pose?: Record<string, number | Vec3>;
  walk?: { path: Vec2[]; start?: number; end: number; cadence?: number; armSwing?: number; lean?: number; bounce?: number };
  /** Tracks relative to the actor: target "pose.elbowR", "at.1", "face.mouthOpen", "rotate.1"… */
  tracks?: { target: string; keys: Key[]; blend?: "set" | "add" }[];
  /** Carries the star lantern in the right hand. */
  lantern?: "dark" | "lit" | "torn";
  /** Speaks this shot's line (lip-sync from the frame's voice). */
  talks?: boolean;
  hero?: boolean;
  /** Disable idle breathing (e.g. when fully keyed). */
  still?: boolean;
  /** Eyes closed (sleeping). */
  asleep?: boolean;
}

export interface Line {
  text: string;
  /** Narrator (off-screen) or an actor id (lip-sync). */
  by: "narrator" | CastName;
  offset?: number;
}

export interface ShotDef {
  /** "3.07" = chapter 3, shot 7. */
  id: string;
  scene: string;
  shotType: string;
  /** Storyboard description (Vietnamese). */
  desc: string;
  dur: number;
  pal: PaletteName;
  set: (p: Palette) => SetPiece;
  cam: CamKey;
  camTo?: CamKey;
  /** Ease of the camera move; "inOut" default. */
  camEase?: "inOut" | "linear" | "in" | "out";
  /** Actor id the camera tracks (focus = actor + followOffset). */
  follow?: string;
  followOffset?: Vec3;
  actors?: Actor[];
  props?: (p: Palette) => Partial<SetPiece>;
  /** Raw tracks (absolute targets). */
  tracks?: Json[];
  rigs?: Json[];
  sky?: SkyOptions;
  /** Static SVG over the scene (titles, credits). */
  overlay?: string;
  transition?: [kind: string, duration: number];
  line?: Line;
  depthFade?: number;
  shadow?: boolean;
}

export interface BuiltShot {
  def: ShotDef;
  motion: MotionSpec;
  /** JSON sent to PUT /api/frames/:id/motion. */
  json: Json;
}

/** espeak-ng voices per speaker (local TTS, no key). */
export const VOICES: Record<Line["by"], { voice: string; speed: number }> = {
  narrator: { voice: "vi", speed: 138 },
  ti: { voice: "vi+f3", speed: 150 },
  ba: { voice: "vi+f4", speed: 130 },
  lan: { voice: "vi+f2", speed: 150 },
  bo: { voice: "vi+m3", speed: 140 },
};

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const ease = (u: number, kind: ShotDef["camEase"] = "inOut") =>
  kind === "linear" ? u : kind === "in" ? u * u * u : kind === "out" ? 1 - (1 - u) ** 3 : u * u * (3 - 2 * u);

const DEFAULT_SCREEN: Vec2 = [999, 640];

function relTracks(id: string, tracks: Actor["tracks"] = []): Json[] {
  return tracks.map((tr) => ({ target: `parts.${id}.${tr.target}`, keys: tr.keys, ...(tr.blend ? { blend: tr.blend } : {}) }));
}

/** Blinks every 2.5–4.5 s (seeded by shot + actor), 0.15 s each. */
function blinkTrack(shotId: string, id: string, dur: number): Json | null {
  const keys: Key[] = [];
  let t = 0.6 + rand(`${shotId}${id}b`, 0) * 1.5;
  let i = 1;
  while (t + 0.2 < dur && keys.length < 60) {
    keys.push({ t: r3(t), v: 0 }, { t: r3(t + 0.07), v: 1, ease: "linear" }, { t: r3(t + 0.16), v: 0, ease: "linear" });
    t += 2.5 + rand(`${shotId}${id}b`, i++) * 2;
  }
  return keys.length ? { target: `parts.${id}.face.blink`, keys } : null;
}

export function buildShot(def: ShotDef): BuiltShot {
  const pal = PALETTES[def.pal];
  const set = def.set(pal);
  const props = def.props?.(pal) ?? {};
  const extraParts: Json[] = [];
  const extraSolids: Json[] = [];
  const extraShapes: Json[] = [];
  const rigs: Json[] = [];
  const tracks: Json[] = [];

  for (const a of def.actors ?? []) {
    const id = a.id ?? a.who;
    const member: CastMember = { ...CAST[a.who], ...(a.look ?? {}) } as CastMember;
    const c = character(member, { at: a.at, rotate: [0, a.yaw ?? 0, 0], pose: a.pose, hero: a.hero, face: { blink: a.asleep ? 1 : 0 } }, pal, id);
    extraParts.push(c.part);
    extraSolids.push(...c.solids);
    if (a.lantern) {
      const sh = a.pose?.shoulderR;
      const grip = Array.isArray(sh) && sh[2] < -90 ? "raised" : "fist";
      const l = starLantern(`${id}Den`, id, pal, { lit: a.lantern === "lit", torn: a.lantern === "torn", grip });
      extraSolids.push(...l.solids);
      extraShapes.push(...l.shapes);
    }
    if (a.walk) {
      rigs.push({
        type: "walk",
        part: id,
        path: a.walk.path,
        start: a.walk.start ?? 0,
        end: a.walk.end,
        cadence: a.walk.cadence ?? 2,
        armSwing: a.lantern ? 10 : (a.walk.armSwing ?? 22),
        ...(a.walk.lean !== undefined ? { lean: a.walk.lean } : {}),
        ...(a.walk.bounce !== undefined ? { bounce: a.walk.bounce } : {}),
      });
    }
    if (a.talks) rigs.push({ type: "lipsync", part: id });
    if (!a.still && !a.walk && !a.asleep) {
      rigs.push({ type: "wiggle", target: `parts.${id}.pose.spine`, amplitude: [1.5, 2.5, 1], frequency: 0.35, seed: Math.floor(rand(def.id + id) * 1e5) });
      rigs.push({ type: "wiggle", target: `parts.${id}.pose.neck`, amplitude: [2, 5, 1.5], frequency: 0.45, seed: Math.floor(rand(def.id + id, 1) * 1e5) });
    }
    tracks.push(...relTracks(id, a.tracks));
    if (!a.asleep && !(a.tracks ?? []).some((tr) => tr.target === "face.blink")) {
      const b = blinkTrack(def.id, id, def.dur);
      if (b) tracks.push(b);
    }
  }
  tracks.push(...(def.tracks ?? []));
  rigs.push(...(def.rigs ?? []));

  const cam0 = def.cam;
  const screen0 = cam0.screen ?? DEFAULT_SCREEN;
  const place0 = placeFor(cam0, cam0.focus, screen0);
  const baseScene = scene({
    palette: pal,
    cam: cam0,
    place: place0,
    set: { ...set, shapes: [...set.shapes, ...(props.shapes ?? [])], solids: [...set.solids, ...(props.solids ?? [])], parts: [...set.parts, ...(props.parts ?? [])], groups: [...set.groups, ...(props.groups ?? [])] },
    extraParts,
    extraSolids,
    extraShapes,
    depthFade: def.depthFade,
    shadow: def.shadow,
  });

  // ---------- Camera: eased move and/or tracking, sampled so framing stays exact ----------
  const horizons: number[] = [horizonFor(cam0, place0)];
  if (def.camTo || def.follow) {
    const provisional = motionSpecSchema.parse({ version: 1, fps: 12, duration: def.dur, scene: baseScene, tracks, rigs });
    const prep = def.follow ? prepareMotion(provisional) : null;
    const n = Math.max(2, Math.ceil(def.dur / 0.75) + 1);
    const keysAz: Key[] = [];
    const keysEl: Key[] = [];
    const keysZoom: Key[] = [];
    const keysPlace: Key[] = [];
    for (let k = 0; k < n; k++) {
      const t = (def.dur * k) / (n - 1);
      const u = def.camTo ? ease(t / def.dur, def.camEase) : 0;
      const to = def.camTo ?? cam0;
      const cam = { az: lerp(cam0.az, to.az, u), el: lerp(cam0.el, to.el, u), zoom: lerp(cam0.zoom, to.zoom, u) };
      let focus = lerp3(cam0.focus, to.focus, u);
      if (prep && def.follow) {
        const at = (evaluateMotionAt(prep, Math.min(t, def.dur - 1e-6)).parts.find((p) => p.id === def.follow) as { at: Vec3 } | undefined)?.at;
        if (!at) throw new Error(`shot ${def.id}: follow target "${def.follow}" not found`);
        const off = def.followOffset ?? [0, 60, 0];
        // follow height on hills/bridges, but not the walk bounce (at.y ≤ 0 on flat ground)
        focus = [at[0] + off[0], Math.max(0, at[1]) + off[1], at[2] + off[2]];
      }
      const screen: Vec2 = [lerp(screen0[0], (to.screen ?? DEFAULT_SCREEN)[0], u), lerp(screen0[1], (to.screen ?? DEFAULT_SCREEN)[1], u)];
      const place = placeFor(cam, focus, screen);
      horizons.push(horizonFor(cam, place));
      const e = k === 0 ? {} : { ease: "linear" };
      keysAz.push({ t: r3(t), v: r3(cam.az), ...e });
      keysEl.push({ t: r3(t), v: r3(cam.el), ...e });
      keysZoom.push({ t: r3(t), v: r3(cam.zoom), ...e });
      keysPlace.push({ t: r3(t), v: [r1(place[0]), r1(place[1])], ...e });
    }
    const varies = (ks: Key[]) => ks.some((k) => JSON.stringify(k.v) !== JSON.stringify(ks[0].v));
    if (varies(keysAz)) tracks.push({ target: "camera.orbit.azimuth", keys: keysAz });
    if (varies(keysEl)) tracks.push({ target: "camera.orbit.elevation", keys: keysEl });
    if (varies(keysZoom)) tracks.push({ target: "camera.zoom", keys: keysZoom });
    if (varies(keysPlace)) tracks.push({ target: "place.at", keys: keysPlace });
  }

  // Mountains sit on the HIGHEST horizon the camera reaches in this shot
  const horizon = Math.min(...horizons);
  const json: Json = {
    version: 1,
    fps: 12,
    duration: def.dur,
    background: pal.sky[2],
    backdrop: sky(pal, { horizon: horizon + 36, ...def.sky }),
    ...(def.overlay ? { overlay: def.overlay } : {}),
    scene: baseScene,
    tracks,
    rigs,
    poster: r3(def.dur * 0.5),
  };
  let motion: MotionSpec;
  try {
    motion = motionSpecSchema.parse(json);
  } catch (e) {
    throw new Error(`shot ${def.id}: invalid motion — ${e instanceof Error ? e.message : String(e)}`);
  }
  return { def, motion, json };
}

// ---------- Overlay text (titles / credits) ----------

const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function titleCard(title: string, sub?: string, o: { y?: number; size?: number; color?: string } = {}): string {
  const y = o.y ?? 470;
  const size = o.size ?? 96;
  const color = o.color ?? "#fff4d6";
  return (
    `<g font-family="DejaVu Serif, FreeSerif, serif" text-anchor="middle">` +
    `<text x="999" y="${y}" font-size="${size}" fill="#0b0f26" opacity="0.35" dx="3" dy="4">${escXml(title)}</text>` +
    `<text x="999" y="${y}" font-size="${size}" fill="${color}" letter-spacing="6">${escXml(title)}</text>` +
    (sub ? `<text x="999" y="${y + size * 0.75}" font-size="${Math.round(size * 0.36)}" fill="${color}" opacity="0.85" letter-spacing="3">${escXml(sub)}</text>` : "") +
    `</g>`
  );
}

export function creditsCard(lines: readonly (readonly [string, string])[], heading: string): string {
  const rows = lines
    .map(([role, name], i) => {
      const y = 330 + i * 58;
      return (
        `<text x="960" y="${y}" font-size="30" fill="#e8dcc0" text-anchor="end" opacity="0.8">${escXml(role)}</text>` +
        `<text x="1000" y="${y}" font-size="30" fill="#fff4d6" text-anchor="start">${escXml(name)}</text>`
      );
    })
    .join("");
  return (
    `<g font-family="DejaVu Serif, FreeSerif, serif">` +
    `<rect x="0" y="0" width="1998" height="1080" fill="#05081a" opacity="0.55"/>` +
    `<text x="999" y="220" font-size="54" fill="#fff4d6" text-anchor="middle" letter-spacing="4">${escXml(heading)}</text>` +
    rows +
    `</g>`
  );
}
