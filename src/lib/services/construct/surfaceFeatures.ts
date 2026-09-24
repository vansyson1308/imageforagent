import type { Mat4, Mesh } from "@/lib/services/construct/types";
import type { Solid } from "@/lib/validation/constructSchema";
import type { DrawEntry } from "@/lib/services/construct/resolve2d";
import { centroid3, transformPoint } from "@/lib/services/construct/math3d";

/**
 * surfaceFeatures — solid có `decalOf` (mắt/miệng trên đầu, cúc áo…) KHÔNG
 * tham gia thứ tự vẽ độc lập: mọi entry của nó dời xuống NGAY SAU entry cuối
 * của solid cha (giữ thứ tự nội bộ). Chữa đúng giới hạn "silhouette smooth
 * thế chỗ mặt cuối" (ADR-012): chi tiết lồi trên mặt cầu không còn bị
 * silhouette của cha vẽ đè. Cull lưng: vector tâm cha → tâm chi tiết có
 * z_view < 0 (quay khỏi camera) ⇒ bỏ hẳn (cha lồi che nó). Pure.
 */
export function attachSurfaceFeatures(
  entries: readonly DrawEntry[],
  features: readonly Solid[],
  worldMeshById: ReadonlyMap<string, { mesh: Mesh }>,
  view: Mat4,
  warnings: string[],
): DrawEntry[] {
  const featureIds = new Set(features.map((s) => s.id));
  const byParent = new Map<string, DrawEntry[]>();
  const hidden = new Set<string>();
  for (const f of features) {
    const parent = worldMeshById.get(f.decalOf!);
    const own = worldMeshById.get(f.id);
    if (!parent || !own) {
      if (!parent) warnings.push(`Surface feature "${f.id}": decalOf "${f.decalOf}" is not a visible solid — drawn in normal depth order.`);
      featureIds.delete(f.id);
      continue;
    }
    const pc = transformPoint(view, centroid3(parent.mesh.vertices));
    const fc = transformPoint(view, centroid3(own.mesh.vertices));
    if (fc[2] - pc[2] < 0) hidden.add(f.id);
  }
  const lastIndex = new Map<string, number>();
  entries.forEach((e, i) => lastIndex.set(e.face.solidId, i));
  for (const e of entries) {
    const id = e.face.solidId;
    if (!featureIds.has(id) || hidden.has(id)) continue;
    const parent = features.find((f) => f.id === id)!.decalOf!;
    if (!lastIndex.has(parent)) continue; // cha bị cull toàn bộ → chi tiết cũng ẩn
    const list = byParent.get(parent) ?? [];
    list.push(e);
    byParent.set(parent, list);
  }
  const out: DrawEntry[] = [];
  entries.forEach((e, i) => {
    if (featureIds.has(e.face.solidId)) return;
    out.push(e);
    if (lastIndex.get(e.face.solidId) === i) out.push(...(byParent.get(e.face.solidId) ?? []));
  });
  return out;
}
