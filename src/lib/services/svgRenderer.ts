import sharp from "sharp";
import { AppError } from "@/lib/services/apiError";
import { MAX_SVG_BYTES } from "@/lib/config/limits";

/**
 * svgRenderer — the security-critical core of the zero-key engine.
 * Agents WRITE artwork as SVG code; this module sanitizes, composes and
 * renders it deterministically with sharp (librsvg). Pure + unit-tested.
 *
 * Sanitization is REJECT-not-strip, intentionally over-broad. Soundness:
 * banning <!DOCTYPE closes the only XML mechanism that can construct new
 * markup from escaped text (internal DTD entities), which makes plain
 * pattern screening on the raw text sound. librsvg itself executes no
 * scripts and performs no network/file I/O for Buffer input (verified),
 * and only rendered PNGs are ever served to a browser — the sanitizer is
 * defense-in-depth on top of that.
 */

// ---------- Logical canvas (the coordinate contract with agents) ----------

export interface CanvasSize {
  readonly w: number;
  readonly h: number;
}

export const LOGICAL_CANVAS: Record<string, CanvasSize> = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
  "4:5": { w: 1080, h: 1350 },
};

/** Render size: long edge = 1024 (1K) / 2048 (2K), short edge rounded. */
export function renderTarget(aspectRatio: string, resolution: string): CanvasSize {
  const logical = LOGICAL_CANVAS[aspectRatio] ?? LOGICAL_CANVAS["16:9"];
  const longEdge = resolution === "2K" ? 2048 : 1024;
  if (logical.w >= logical.h) {
    return { w: longEdge, h: Math.round((longEdge * logical.h) / logical.w) };
  }
  return { w: Math.round((longEdge * logical.w) / logical.h), h: longEdge };
}

// ---------- Sanitizer ----------

export type SvgKind = "defs" | "frame";

interface RejectRule {
  readonly pattern: RegExp;
  readonly reason: string;
  readonly hint: string;
}

const COMMON_RULES: readonly RejectRule[] = [
  {
    pattern: /<!DOCTYPE/i,
    reason: "DOCTYPE declarations are not allowed",
    hint: "Remove the <!DOCTYPE …> declaration — submit a plain SVG fragment.",
  },
  {
    pattern: /<!ENTITY/i,
    reason: "XML entity definitions are not allowed",
    hint: "Remove <!ENTITY …> definitions.",
  },
  {
    pattern: /<script/i,
    reason: "<script> is not allowed",
    hint: "SVG artwork must be purely declarative — remove all <script> elements.",
  },
  {
    pattern: /<foreignObject/i,
    reason: "<foreignObject> is not supported by the renderer",
    hint: "librsvg renders <foreignObject> as blank — use native SVG shapes instead.",
  },
  {
    pattern: /<(iframe|embed|object|link|meta)\b/i,
    reason: "HTML embedding elements are not allowed",
    hint: "Remove <iframe>/<embed>/<object>/<link>/<meta> elements.",
  },
  {
    pattern: /\bon[a-z]+\s*=/i,
    reason: "Event handler attributes are not allowed",
    hint: "Remove on*= attributes (onclick, onload, …) — SVG artwork is static.",
  },
  {
    // Lookahead chứa TOÀN BỘ dạng được phép (kể cả dấu nháy tuỳ chọn) —
    // không consume ký tự nào sau "=" để backtracking không lách được rule.
    pattern: /\b(?:xlink:)?href\s*=\s*(?!["']?\s*(?:#|data:image\/(?:png|jpe?g|webp);))/i,
    reason: "href may only reference a local #id or a raster data: URI",
    hint: 'Use href="#symbolId" for <use>, or data:image/png;base64,… for embedded rasters. External URLs are not allowed.',
  },
  {
    pattern: /\bsrc\s*=/i,
    reason: "src attributes are not allowed",
    hint: "SVG has no src attribute — remove it.",
  },
  {
    pattern: /url\s*\(\s*(?!["']?\s*#)/i,
    reason: "CSS url() may only reference a local #id",
    hint: 'Use fill="url(#gradientId)" style references only — no external URLs.',
  },
  {
    pattern: /@import/i,
    reason: "@import is not allowed",
    hint: "Inline all styles — external stylesheets are not supported.",
  },
  {
    // Defense-in-depth: xml:base có thể đổi origin phân giải cho URI tương
    // đối của các thuộc tính tương lai chưa nằm trong reject-list
    pattern: /\bxml:base\s*=/i,
    reason: "xml:base is not allowed",
    hint: "Remove xml:base — all references must be local #ids or raster data: URIs.",
  },
  {
    pattern: /<\?/,
    reason: "XML processing instructions are not allowed",
    hint: "Remove <?xml …?> / <?xml-stylesheet …?> — submit a bare SVG fragment; the engine owns the document wrapper.",
  },
];

const FRAGMENT_RULES: readonly RejectRule[] = [
  {
    pattern: /<\/?svg\b/i,
    reason: "Fragments must not contain an <svg> root element",
    hint: "Submit only the inner content — the engine wraps it in <svg viewBox…>. Use <g transform=…> for grouping/scaling.",
  },
];

/**
 * Validate an SVG fragment (project defs library or frame scene body).
 * Throws AppError("ARTWORK_INVALID") on the first violated rule.
 */
export function sanitizeSvg(fragment: string, kind: SvgKind): void {
  // Đo BYTE thật (UTF-8) — .length là UTF-16 code units, ký tự đa byte
  // (tiếng Việt…) sẽ lách được trần nếu đo bằng length
  const bytes = Buffer.byteLength(fragment, "utf8");
  if (bytes > MAX_SVG_BYTES) {
    throw new AppError(
      "ARTWORK_INVALID",
      `SVG ${kind} exceeds the ${Math.round(MAX_SVG_BYTES / 1024)}KB limit (${Math.round(bytes / 1024)}KB).`,
      "Simplify paths or split artwork across frames.",
    );
  }

  for (const rule of [...COMMON_RULES, ...FRAGMENT_RULES]) {
    if (rule.pattern.test(fragment)) {
      throw new AppError(
        "ARTWORK_INVALID",
        `SVG ${kind} rejected: ${rule.reason}.`,
        rule.hint,
      );
    }
  }
}

// ---------- Composer ----------

const SVG_XMLNS =
  'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

/**
 * Compose the full SVG document: fixed logical viewBox (agent contract)
 * + exact pixel width/height (render target) + project defs + frame body.
 * Pure — snapshot-tested.
 */
export function composeSvgDocument(
  defs: string | null,
  frameSvg: string,
  aspectRatio: string,
  resolution: string,
): string {
  const logical = LOGICAL_CANVAS[aspectRatio] ?? LOGICAL_CANVAS["16:9"];
  const target = renderTarget(aspectRatio, resolution);
  return [
    `<svg ${SVG_XMLNS} viewBox="0 0 ${logical.w} ${logical.h}" width="${target.w}" height="${target.h}">`,
    `<defs>${defs ?? ""}</defs>`,
    frameSvg,
    `</svg>`,
  ].join("\n");
}

// ---------- Renderer ----------

/** Extract the useful detail out of sharp/librsvg XML errors. */
function extractRenderErrorDetail(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const xmlDetail = message.match(/XML parse error:\s*(.+)$/i)?.[1];
  if (xmlDetail) return xmlDetail.trim();
  return message.replace(/^Input buffer has corrupt header:\s*/i, "").trim();
}

/**
 * Render frame artwork → PNG buffer at the project's exact target size.
 * Inputs must already be sanitized (routes call sanitizeSvg on write).
 */
export async function renderArtwork(
  defs: string | null,
  frameSvg: string,
  aspectRatio: string,
  resolution: string,
): Promise<Buffer> {
  const doc = composeSvgDocument(defs, frameSvg, aspectRatio, resolution);
  try {
    return await sharp(Buffer.from(doc)).png().toBuffer();
  } catch (err: unknown) {
    throw new AppError(
      "ARTWORK_INVALID",
      `SVG failed to render: ${extractRenderErrorDetail(err)}`,
      "Check the SVG syntax — every tag must be well-formed XML and properly closed.",
    );
  }
}
