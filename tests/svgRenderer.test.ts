import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  LOGICAL_CANVAS,
  composeSvgDocument,
  renderArtwork,
  renderTarget,
  sanitizeSvg,
} from "@/lib/services/svgRenderer";
import { AppError } from "@/lib/services/apiError";
import { MAX_SVG_BYTES } from "@/lib/config/limits";

function expectReject(fragment: string, kind: "defs" | "frame" = "frame"): AppError {
  try {
    sanitizeSvg(fragment, kind);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("ARTWORK_INVALID");
    return err as AppError;
  }
  throw new Error(`Expected rejection for: ${fragment.slice(0, 60)}`);
}

describe("sanitizeSvg — reject vectors (bypass tricks)", () => {
  it("rejects DOCTYPE (mọi biến thể case)", () => {
    expectReject('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><rect/>');
    expectReject("<!doctype svg><rect/>");
  });

  it("rejects ENTITY (billion laughs entry point)", () => {
    expectReject('<!ENTITY a "aaaa"><rect/>');
  });

  it("rejects <script> kể cả trong comment/CDATA (over-broad chấp nhận được)", () => {
    expectReject('<rect/><script>alert(1)</script>');
    expectReject("<rect/><ScRiPt href='#x'>x</ScRiPt>");
    expectReject("<!-- <script> --><rect/>");
  });

  it("rejects foreignObject", () => {
    expectReject('<foreignObject><div>html</div></foreignObject>');
    expectReject("<FOREIGNOBJECT/>");
  });

  it("rejects HTML embedding elements", () => {
    expectReject('<iframe href="#x"/>');
    expectReject("<embed/>");
    expectReject("<object/>");
    expectReject('<link rel="stylesheet"/>');
    expectReject("<meta/>");
  });

  it("rejects event handlers với khoảng trắng/case tricks", () => {
    expectReject('<rect onclick="evil()"/>');
    expectReject('<rect ONLOAD = "evil()"/>');
    expectReject("<circle onmouseover\t=\t'x'/>");
  });

  it("rejects href ngoài — http/file/relative/javascript/data:text", () => {
    expectReject('<use href="http://evil.com/x.svg#f"/>');
    expectReject("<use xlink:href='HTTPS://evil.com'/>");
    expectReject('<image href="file:///C:/secret.png"/>');
    expectReject('<image href="../other.png"/>');
    expectReject('<a href="javascript:alert(1)"><rect/></a>');
    expectReject('<image href="data:text/html;base64,PHNjcmlwdD4="/>');
    expectReject('<image href="data:image/svg+xml;base64,AAAA"/>');
    expectReject("<use href=http://unquoted.evil/x#f />");
  });

  it("rejects src attribute", () => {
    expectReject('<image src="x.png"/>');
  });

  it("rejects url() không phải #fragment", () => {
    expectReject('<rect style="fill:url(http://evil.com/p.svg)"/>');
    expectReject('<rect fill="url(\'https://evil\')"/>');
  });

  it("rejects @import và processing instructions", () => {
    expectReject('<style>@import url(#x);</style>');
    expectReject('<?xml version="1.0"?><rect/>');
    expectReject('<?xml-stylesheet href="#s"?><rect/>');
  });

  it("rejects <svg> root lồng trong fragment", () => {
    expectReject('<svg width="9999" height="9999"><rect/></svg>');
    expectReject("</svg><svg>");
  });

  it("rejects fragment vượt MAX_SVG_BYTES", () => {
    const big = "<g>" + "x".repeat(MAX_SVG_BYTES) + "</g>";
    const err = expectReject(big);
    expect(err.message).toContain("KB limit");
  });
});

describe("sanitizeSvg — PASS vectors (artwork hợp lệ)", () => {
  it("cho phép use #fragment, gradient url(#id), data:image raster", () => {
    expect(() =>
      sanitizeSvg(
        `<rect width="1920" height="1080" fill="url(#bg)"/>
         <use href="#mascot" x="700" y="300"/>
         <use xlink:href="#prop-cup" transform="scale(1.2)"/>
         <image href="data:image/png;base64,iVBORw0KGgo=" width="64" height="64"/>`,
        "frame",
      ),
    ).not.toThrow();
  });

  it("cho phép defs kitchen-sink: symbol/gradient/clipPath/mask/filter/text/transform", () => {
    expect(() =>
      sanitizeSvg(
        `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0" stop-color="#1a1a2e"/><stop offset="1" stop-color="#16213e"/>
         </linearGradient>
         <symbol id="mascot" viewBox="0 0 200 300">
           <path d="M100 20 C 140 20 160 60 160 100 L 160 220 C 160 260 140 280 100 280 C 60 280 40 260 40 220 L 40 100 C 40 60 60 20 100 20 Z" fill="#f97316"/>
           <circle cx="80" cy="90" r="10" fill="#1c1917"/>
           <circle cx="120" cy="90" r="10" fill="#1c1917"/>
         </symbol>
         <clipPath id="round"><rect rx="24" width="400" height="300"/></clipPath>
         <filter id="soft"><feGaussianBlur stdDeviation="4"/></filter>`,
        "defs",
      ),
    ).not.toThrow();
  });

  it("không false-positive với từ chứa 'on' (position=, stop-color…)", () => {
    expect(() =>
      sanitizeSvg('<rect x="0" transform="translate(1,2)" stop-color="#fff"/>', "frame"),
    ).not.toThrow();
  });

  it("cho phép url('#id') CÓ dấu nháy (regression backtracking)", () => {
    expect(() =>
      sanitizeSvg(`<rect fill="url('#grad')"/><circle fill='url("#grad2")'/>`, "frame"),
    ).not.toThrow();
  });

  it("vẫn chặn href ngoài dù có/không dấu nháy (regression backtracking)", () => {
    expectReject('<use href = "http://e.vil/#x"/>');
    expectReject("<use href= 'https://e.vil'/>");
  });
});

describe("renderTarget — bảng 8 combo", () => {
  it.each([
    ["16:9", "1K", 1024, 576],
    ["16:9", "2K", 2048, 1152],
    ["9:16", "1K", 576, 1024],
    ["9:16", "2K", 1152, 2048],
    ["1:1", "1K", 1024, 1024],
    ["1:1", "2K", 2048, 2048],
    ["4:5", "1K", 819, 1024],
    ["4:5", "2K", 1638, 2048],
  ])("%s %s → %i×%i", (ratio, res, w, h) => {
    expect(renderTarget(ratio, res)).toEqual({ w, h });
  });

  it("logical canvas đúng hợp đồng", () => {
    expect(LOGICAL_CANVAS["16:9"]).toEqual({ w: 1920, h: 1080 });
    expect(LOGICAL_CANVAS["4:5"]).toEqual({ w: 1080, h: 1350 });
  });
});

describe("composeSvgDocument", () => {
  it("snapshot (hợp đồng wrapper đóng băng)", () => {
    expect(
      composeSvgDocument('<symbol id="m"/>', '<use href="#m"/>', "16:9", "1K"),
    ).toMatchSnapshot();
  });

  it("defs null → <defs> rỗng", () => {
    const doc = composeSvgDocument(null, "<rect/>", "1:1", "2K");
    expect(doc).toContain("<defs></defs>");
    expect(doc).toContain('width="2048" height="2048"');
    expect(doc).toContain('viewBox="0 0 1080 1080"');
  });
});

describe("renderArtwork — render thật qua sharp", () => {
  const DEFS = `<symbol id="mascot" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="40" fill="#ff6600"/>
  </symbol>`;

  it("render đúng kích thước pixel + <use> kéo được symbol từ defs", async () => {
    const png = await renderArtwork(
      DEFS,
      `<rect width="1920" height="1080" fill="#112233"/>
       <use href="#mascot" x="860" y="440" width="200" height="200"/>`,
      "16:9",
      "1K",
    );
    const img = sharp(png);
    const meta = await img.metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(576);

    // Pixel giữa canvas phải là màu cam của symbol (#ff6600)
    const raw = await img.raw().toBuffer({ resolveWithObject: true });
    const cx = 512, cy = 288;
    const idx = (cy * raw.info.width + cx) * raw.info.channels;
    expect(raw.data[idx]).toBeGreaterThan(200); // R
    expect(raw.data[idx + 1]).toBeGreaterThan(70); // G
    expect(raw.data[idx + 2]).toBeLessThan(60); // B
  });

  it("đổi màu trong defs → pixel đổi theo (re-render semantics)", async () => {
    const blueDefs = DEFS.replace("#ff6600", "#0066ff");
    const frame = `<use href="#mascot" x="0" y="0" width="1080" height="1080"/>`;
    const orange = await renderArtwork(DEFS, frame, "1:1", "1K");
    const blue = await renderArtwork(blueDefs, frame, "1:1", "1K");
    expect(Buffer.compare(orange, blue)).not.toBe(0);
  });

  it("XML hỏng → ARTWORK_INVALID kèm chi tiết", async () => {
    await expect(
      renderArtwork(null, "<rect width=1080", "1:1", "1K"),
    ).rejects.toMatchObject({ code: "ARTWORK_INVALID" });
  });
});
