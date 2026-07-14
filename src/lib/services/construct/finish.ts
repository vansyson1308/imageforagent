import type { ConstructSpec, Solid, SolidEffects } from "@/lib/validation/constructSchema";

/**
 * finish — preset làm mềm một-chạm, rewrite THUẦN chạy SAU expandParts
 * (part-solids cũng hưởng preset) và TRƯỚC mọi stage compile. Nguyên tắc
 * bất khả xâm phạm: CHỈ điền field VẮNG — solid đã khai "effects" (kể cả
 * {} = opt-out) giữ nguyên; light/shadow/place không bao giờ bị đụng.
 */

const EFFECTS_OFF: SolidEffects = {
  formShadow: false,
  highlight: false,
  rim: false,
  coreAccent: false,
  specular: false,
  glow: false,
  contact: false,
};

/** Solid trơn (silhouette + gradient) — ứng viên specular của premium. */
function isSmooth(s: Solid): boolean {
  return (
    (s.type === "sphere" || s.type === "cylinder" || s.type === "cone") &&
    (s.shading === "auto" || s.shading === "smooth")
  );
}

export function applyFinish(spec: ConstructSpec): ConstructSpec {
  if (spec.finish === "flat") return spec;
  const premium = spec.finish === "premium";

  const solids = spec.solids.map((s): Solid => {
    if (s.effects !== undefined) return s; // author đã chạm — không đụng
    const effects: SolidEffects = {
      ...EFFECTS_OFF,
      formShadow: true,
      highlight: true,
      contact: true,
      ...(premium ? { rim: true } : {}),
      ...(premium && isSmooth(s) ? { specular: true } : {}),
    };
    return { ...s, effects };
  });

  // Premium thêm vignette NHẸ — chỉ khi author chưa khai atmosphere
  const atmosphere =
    premium && spec.atmosphere === undefined
      ? {
          vignette: {
            color: "#101528",
            strength: 0.25,
            start: 0.55,
            size: [1920, 1080] as [number, number],
          },
        }
      : spec.atmosphere;

  return { ...spec, solids, atmosphere };
}
