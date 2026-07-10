import type { ProjectedFace, Vec2 } from "@/lib/services/construct/types";
import { fmt } from "@/lib/services/construct/geometry2d";
import type { GradientDescriptor } from "@/lib/services/construct/shading";

/**
 * svgEmitter — kết quả pipeline → SVG fragment deterministic.
 * CHỈ emit các element: g / path / linearGradient / radialGradient / stop.
 * Gradient nhúng inline đầu fragment (sanitizer cho phép — SVG resolve
 * gradient theo id bất kể vị trí, gradient element không tự render).
 */

export interface PathItem {
  readonly d: string;
  readonly fill: string;
  readonly fillRule?: "nonzero" | "evenodd";
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly strokeLinejoin?: "round" | "miter";
  readonly opacity?: number;
}

export interface EmitPlace {
  readonly at: Vec2;
  readonly scale: number;
  readonly rotate: number;
}

/** Mặt đã chiếu → path data (polygon + hole subpaths). */
export function faceToPathData(face: ProjectedFace, precision: number): string {
  const ringToD = (ring: readonly Vec2[]) =>
    ring
      .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${fmt(x, precision)} ${fmt(y, precision)}`)
      .join(" ") + " Z";
  const parts = [ringToD(face.points)];
  if (face.holes) {
    for (const hole of face.holes) parts.push(ringToD(hole));
  }
  return parts.join(" ");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function gradientToSvg(g: GradientDescriptor): string {
  const attrs = Object.entries(g.attrs)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(" ");
  const stops = g.stops
    .map((s) => {
      const opacity = s.opacity !== undefined ? ` stop-opacity="${fmt(s.opacity, 3)}"` : "";
      return `<stop offset="${fmt(s.offset, 3)}" stop-color="${escapeAttr(s.color)}"${opacity}/>`;
    })
    .join("");
  return `<${g.kind} id="${escapeAttr(g.id)}" ${attrs}>${stops}</${g.kind}>`;
}

function pathToSvg(p: PathItem, precision: number): string {
  const attrs: string[] = [`d="${p.d}"`, `fill="${escapeAttr(p.fill)}"`];
  if (p.fillRule) attrs.push(`fill-rule="${p.fillRule}"`);
  if (p.stroke && p.strokeWidth) {
    attrs.push(
      `stroke="${escapeAttr(p.stroke)}"`,
      `stroke-width="${fmt(p.strokeWidth, precision)}"`,
      `stroke-linejoin="${p.strokeLinejoin ?? "round"}"`,
    );
  }
  if (p.opacity !== undefined && p.opacity < 1) {
    attrs.push(`opacity="${fmt(p.opacity, 3)}"`);
  }
  return `<path ${attrs.join(" ")}/>`;
}

/**
 * Ghép fragment hoàn chỉnh: <g transform="translate(at) rotate scale">
 * chứa gradient defs inline + paths theo đúng thứ tự vẽ.
 */
export function emitFragment(
  gradients: readonly GradientDescriptor[],
  paths: readonly PathItem[],
  place: EmitPlace,
  precision: number,
): string {
  const transforms: string[] = [];
  if (place.at[0] !== 0 || place.at[1] !== 0) {
    transforms.push(`translate(${fmt(place.at[0], precision)} ${fmt(place.at[1], precision)})`);
  }
  if (place.rotate) transforms.push(`rotate(${fmt(place.rotate, precision)})`);
  if (place.scale !== 1) transforms.push(`scale(${fmt(place.scale, 4)})`);
  const transformAttr = transforms.length > 0 ? ` transform="${transforms.join(" ")}"` : "";

  const body = [
    ...gradients.map(gradientToSvg),
    ...paths.map((p) => pathToSvg(p, precision)),
  ].join("\n");

  return `<g${transformAttr}>\n${body}\n</g>`;
}

/** Đếm lệnh path trong fragment — enforce maxPathCommandsOut. */
export function countFragmentPathCommands(fragment: string): number {
  return fragment.match(/[MLCQAZ](?=[\s"])/g)?.length ?? 0;
}
