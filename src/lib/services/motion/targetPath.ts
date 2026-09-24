import { AppError } from "@/lib/services/apiError";
import { levenshtein } from "@/lib/services/construct/resolve2d";
import { CAMERA_PRESETS } from "@/lib/services/construct/camera";
import type { ConstructSpec } from "@/lib/validation/constructSchema";

/**
 * targetPath — địa chỉ hoá MỘT giá trị số/vector/màu trong construct spec
 * bằng đường dẫn chấm: root.(id.)field(.field|.index)*.
 *   camera.orbit.azimuth · camera.zoom · light.direction · place.at.0
 *   solids.ball.at · solids.ball.at.1 · solids.lamp.fill
 *   parts.hero.pose.kneeL · parts.hero.at · groups.arm.rotate.2
 *   gradients.sky.stops.0.color · atmosphere.vignette.strength
 * An toàn: chỉ đi qua own-property của object/array thuần, cấm
 * __proto__/constructor/prototype (không thể prototype-pollute).
 */

export type PathValue = number | number[] | string;

function err(message: string, hint: string): never {
  throw new AppError("CONSTRUCTION_INVALID", message, hint);
}

const ID_ROOTS = ["shapes", "solids", "parts", "groups", "gradients"] as const;
const OBJECT_ROOTS = ["camera", "light", "place", "shadow", "atmosphere"] as const;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/** Field chấp nhận broadcast số → vector khi track là vector. */
const BROADCAST: Record<string, (s: number, n: number) => number[]> = {
  // scale đều s → [s,s,s]
  scale: (s, n) => Array.from({ length: n }, () => s),
};
/** Pose joint scalar = gập trục z → [0,0,z]. */
const poseBroadcast = (s: number, n: number) => (n === 3 ? [0, 0, s] : Array.from({ length: n }, () => s));

function suggest(ref: string, known: readonly string[]): string {
  const nearest = [...known].sort((a, b) => levenshtein(ref, a) - levenshtein(ref, b))[0];
  return nearest && levenshtein(ref, nearest) <= 3 ? `Did you mean "${nearest}"? ` : "";
}

export function valueKindOf(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return "number";
  if (typeof v === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) return "color";
  if (Array.isArray(v) && v.length >= 2 && v.length <= 4 && v.every((x) => typeof x === "number")) {
    return `vec${v.length}`;
  }
  return null;
}

interface Located {
  readonly container: Record<string, unknown> | unknown[];
  readonly key: string | number;
  /** true khi target là pose joint (vắng = 0). */
  readonly isPoseJoint: boolean;
  readonly field: string;
}

function isPlainContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  return typeof v === "object" && v !== null;
}

/** Tìm container + key của target (không đọc giá trị). */
function locate(spec: ConstructSpec, path: string): Located {
  const segs = path.split(".");
  for (const s of segs) {
    if (FORBIDDEN.has(s)) err(`Target "${path}" uses the forbidden segment "${s}".`, "Use a plain field path.");
  }
  const root = segs[0];
  let node: unknown;
  let rest: string[];
  let item: Record<string, unknown> | undefined;
  if ((ID_ROOTS as readonly string[]).includes(root)) {
    const list = (spec as unknown as Record<string, { id: string }[]>)[root];
    const id = segs[1];
    const found = list.find((x) => x.id === id);
    if (!found) {
      const known = list.map((x) => x.id);
      err(
        `Target "${path}": no ${root.slice(0, -1)} with id "${id}" in the scene.`,
        `${suggest(id, known)}Defined ${root}: ${known.join(", ") || "(none)"}.`,
      );
    }
    item = found as unknown as Record<string, unknown>;
    node = found;
    rest = segs.slice(2);
  } else if ((OBJECT_ROOTS as readonly string[]).includes(root)) {
    node = (spec as unknown as Record<string, unknown>)[root];
    if (node === undefined) {
      err(
        `Target "${path}": scene.${root} is not set.`,
        `Declare "${root}" in the scene so the track has a base value to animate from.`,
      );
    }
    rest = segs.slice(1);
  } else {
    err(
      `Target "${path}" has unknown root "${root}".`,
      `${suggest(root, [...ID_ROOTS, ...OBJECT_ROOTS])}Roots: ${[...OBJECT_ROOTS, ...ID_ROOTS].join(", ")}.`,
    );
  }
  if (rest.length === 0) {
    err(`Target "${path}" points at a whole object.`, 'Point at a value field, e.g. "solids.box.at" or "solids.box.rotate.1".');
  }

  // Pose joint: parts.<id>.pose.<joint> — record có thể thiếu joint
  const isPoseJoint = item !== undefined && root === "parts" && rest.length === 2 && rest[0] === "pose";

  for (let i = 0; i < rest.length - 1; i++) {
    const seg = rest[i];
    if (!isPlainContainer(node)) {
      err(`Target "${path}": "${rest.slice(0, i).join(".")}" is not an object.`, "Check the path against the scene structure.");
    }
    let next: unknown;
    if (Array.isArray(node)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) {
        err(`Target "${path}": index "${seg}" out of range (length ${node.length}).`, "Use a 0-based index into the array.");
      }
      next = node[idx];
    } else {
      next = Object.prototype.hasOwnProperty.call(node, seg) ? node[seg] : undefined;
    }
    if (next === undefined) {
      const known = Array.isArray(node) ? [] : Object.keys(node);
      err(
        `Target "${path}": field "${seg}" is not set in the scene.`,
        `${suggest(seg, known)}Declare it in the scene first so it has a base value${known.length ? ` (present: ${known.join(", ")})` : ""}.`,
      );
    }
    node = next;
  }

  const lastSeg = rest[rest.length - 1];
  if (!isPlainContainer(node)) {
    err(`Target "${path}": parent of "${lastSeg}" is not an object.`, "Check the path against the scene structure.");
  }
  let key: string | number = lastSeg;
  if (Array.isArray(node)) {
    const idx = Number(lastSeg);
    if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) {
      err(`Target "${path}": index "${lastSeg}" out of range (length ${node.length}).`, "Use a 0-based index (e.g. at.1 = y).");
    }
    key = idx;
  }
  return { container: node, key, isPoseJoint, field: isPoseJoint ? "pose" : String(rest[rest.length === 1 ? 0 : rest.length - 1]) };
}

function rawGet(loc: Located): unknown {
  const c = loc.container as Record<string | number, unknown>;
  if (Array.isArray(loc.container)) return c[loc.key];
  return Object.prototype.hasOwnProperty.call(c, loc.key) ? c[loc.key] : undefined;
}

/**
 * Đọc giá trị target, ép về `wantKind` khi broadcast hợp lệ (scale số →
 * vec, pose scalar → [0,0,z], pose vắng → 0). Lỗi kiểu kèm hint.
 */
export function readTarget(spec: ConstructSpec, path: string, wantKind?: string): PathValue {
  const loc = locate(spec, path);
  let value = rawGet(loc);
  if (value === undefined && loc.isPoseJoint) value = 0;
  const kind = valueKindOf(value);
  if (kind === null) {
    if (value === undefined) {
      err(`Target "${path}" is not set in the scene.`, "Declare it in the scene first so the track has a base value to animate from.");
    }
    err(
      `Target "${path}" holds a non-animatable value (${JSON.stringify(value)?.slice(0, 40)}).`,
      "Only numbers, number vectors and #hex colors animate — url(#…) fills and enums do not.",
    );
  }
  if (wantKind === undefined || wantKind === kind) return value as PathValue;
  if (kind === "number" && wantKind.startsWith("vec")) {
    const n = Number(wantKind.slice(3));
    if (loc.isPoseJoint) return poseBroadcast(value as number, n);
    const b = BROADCAST[String(loc.key)];
    if (b) return b(value as number, n);
  }
  err(
    `Target "${path}" is a ${kind} but the track/rig provides a ${wantKind}.`,
    kind.startsWith("vec")
      ? `Give ${kind.slice(3)}-component vectors, or animate one component with "${path}.<index>".`
      : `Give ${kind} values.`,
  );
}

export function writeTarget(spec: ConstructSpec, path: string, value: PathValue): void {
  const loc = locate(spec, path);
  (loc.container as Record<string | number, unknown>)[loc.key] = value;
}

/** Nếu có target camera.orbit.* mà scene dùng preset → hiện thực hoá orbit từ preset. */
export function materializeOrbit(spec: ConstructSpec): void {
  if (spec.camera.orbit) return;
  const preset = CAMERA_PRESETS[spec.camera.preset ?? "isometric"];
  spec.camera.orbit = { azimuth: preset.azimuth, elevation: preset.elevation, roll: preset.roll };
}
