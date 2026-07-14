import type { Mat4 } from "@/lib/services/construct/types";
import { composePlacement4, IDENTITY_4, mul4 } from "@/lib/services/construct/math3d";
import { AppError } from "@/lib/services/apiError";
import { CONSTRUCT_LIMITS } from "@/lib/config/limits";
import type { ConstructSpec, Group, Shape2D, Solid } from "@/lib/validation/constructSchema";
import {
  buildArrow,
  buildCloud,
  buildTree,
  buildWheel,
  type PartBuild,
} from "@/lib/services/construct/partWheel";
import { buildFigure } from "@/lib/services/construct/partFigure";

/**
 * partsExpand — Layer 5: spec → spec rewrite TRƯỚC compile.
 * - groups[]: khung FK cha-con → ma trận world memo (mul4 chuỗi cha).
 * - solid có `group`: world = M(group) · SRT(solid) — schema solid KHÔNG
 *   đổi, compile dùng worldMatrixById override.
 * - parts[]: macro expand thành shapes/solids id "partId:segment".
 */

function err(message: string, hint: string): never {
  throw new AppError("CONSTRUCTION_INVALID", message, hint);
}

export interface ExpandedSpec {
  readonly shapes: Shape2D[];
  readonly solids: Solid[];
  /** Ma trận world override cho solid gắn group / solid sinh từ part. */
  readonly worldMatrixById: Map<string, Mat4>;
  readonly warnings: string[];
  readonly partsExpanded: number;
}

/** Resolve ma trận world của mọi group (memo + cycle + depth guard). */
function resolveGroupMatrices(groups: readonly Group[]): Map<string, Mat4> {
  const byId = new Map(groups.map((g) => [g.id, g]));
  if (byId.size !== groups.length) {
    const seen = new Set<string>();
    for (const g of groups) {
      if (seen.has(g.id)) err(`Duplicate group id "${g.id}".`, "Group ids must be unique.");
      seen.add(g.id);
    }
  }
  const matrices = new Map<string, Mat4>();
  const resolving = new Set<string>();

  function resolve(id: string, depth: number): Mat4 {
    const cached = matrices.get(id);
    if (cached) return cached;
    const group = byId.get(id);
    if (!group) {
      err(
        `Group "${id}" not found.`,
        `Defined groups: ${[...byId.keys()].join(", ") || "(none)"}.`,
      );
    }
    if (depth > CONSTRUCT_LIMITS.maxGroupDepth) {
      err(
        `Group chain deeper than ${CONSTRUCT_LIMITS.maxGroupDepth} at "${id}".`,
        "Flatten the hierarchy.",
      );
    }
    if (resolving.has(id)) {
      err(
        `Group "${id}" is part of a parent cycle: ${[...resolving, id].join(" → ")}.`,
        "Groups must form a tree — remove the back-reference.",
      );
    }
    resolving.add(id);
    const parentM = group.parent ? resolve(group.parent, depth + 1) : IDENTITY_4;
    resolving.delete(id);
    const m = mul4(parentM, composePlacement4(group.at, group.rotate, group.scale));
    matrices.set(id, m);
    return m;
  }

  for (const g of groups) resolve(g.id, 0);
  return matrices;
}

function buildPart(part: ConstructSpec["parts"][number]): PartBuild {
  switch (part.type) {
    case "figure":
      return buildFigure(part);
    case "wheel":
      return buildWheel(part);
    case "tree":
      return buildTree(part);
    case "cloud":
      return buildCloud(part);
    case "arrow":
      return buildArrow(part);
  }
}

export function expandParts(spec: ConstructSpec): ExpandedSpec {
  const warnings: string[] = [];
  const groupM = resolveGroupMatrices(spec.groups);

  // Trùng id giữa user shapes/solids/groups/parts (namespace phẳng)
  const userIds = new Set<string>();
  const claim = (id: string, kind: string) => {
    if (userIds.has(id)) {
      err(`Duplicate id "${id}" (${kind}).`, "Ids are global across shapes, solids, groups, and parts — rename one.");
    }
    userIds.add(id);
  };
  for (const s of spec.shapes) claim(s.id, "shape");
  for (const s of spec.solids) claim(s.id, "solid");
  for (const g of spec.groups) claim(g.id, "group");
  for (const p of spec.parts) claim(p.id, "part");

  const shapes: Shape2D[] = [...spec.shapes];
  const solids: Solid[] = [...spec.solids];
  const worldMatrixById = new Map<string, Mat4>();

  // Solid user gắn group
  for (const solid of spec.solids) {
    if (!solid.group) continue;
    const m = groupM.get(solid.group);
    if (!m) {
      err(
        `Solid "${solid.id}" references unknown group "${solid.group}".`,
        `Defined groups: ${[...groupM.keys()].join(", ") || "(none)"}.`,
      );
    }
    worldMatrixById.set(
      solid.id,
      mul4(m, composePlacement4(solid.at, solid.rotate, solid.scale)),
    );
  }

  // Parts
  for (const part of spec.parts) {
    const build = buildPart(part);
    // Macro 2D (không solids): shapes tự mang placement — không cần ma trận
    shapes.push(...build.shapes);
    if (build.solids.length === 0) continue;

    const has3dPlacement = "at" in part && Array.isArray(part.at) && part.at.length === 3;
    const groupRef = "group" in part ? part.group : undefined;
    let partM = IDENTITY_4;
    if (groupRef) {
      const m = groupM.get(groupRef);
      if (!m) {
        err(
          `Part "${part.id}" references unknown group "${groupRef}".`,
          `Defined groups: ${[...groupM.keys()].join(", ") || "(none)"}.`,
        );
      }
      partM = m;
    }
    if (has3dPlacement) {
      const p3 = part as Extract<typeof part, { rotate: readonly [number, number, number] }>;
      partM = mul4(partM, composePlacement4(p3.at, p3.rotate, p3.scale));
    }
    const partEffects = "effects" in part ? part.effects : undefined;
    for (const gen of build.solids) {
      // Passthrough effects của part xuống mọi solid sinh ra (trước finish
      // preset — part đã khai effects thì preset không đụng nữa)
      solids.push(partEffects !== undefined ? { ...gen.solid, effects: partEffects } : gen.solid);
      worldMatrixById.set(gen.solid.id, mul4(partM, gen.localM));
    }
  }

  // Node cap sau expansion
  const total = shapes.length + solids.length + spec.cutouts.length;
  if (total > CONSTRUCT_LIMITS.maxNodes) {
    err(
      `Spec expands to ${total} nodes (max ${CONSTRUCT_LIMITS.maxNodes}).`,
      "Reduce parts/spokes/lobes or split into multiple constructions.",
    );
  }

  return { shapes, solids, worldMatrixById, warnings, partsExpanded: spec.parts.length };
}
