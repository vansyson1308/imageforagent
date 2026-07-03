import { describe, expect, it } from "vitest";
import { parseTsv } from "@/lib/services/tsvParser";

const T = "\t";

describe("parseTsv", () => {
  // Case 1: định dạng chuẩn 3 cột có header
  it("parses standard 3-column TSV with header", () => {
    const text = [
      `STT${T}Shot Type${T}Description`,
      `1${T}Static shot${T}The mascot pops in from the bottom`,
      `2${T}Wide static shot${T}A spotlight glows on a large ramen bowl`,
    ].join("\n");
    const result = parseTsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]).toEqual({
      index: 1,
      shotType: "Static shot",
      description: "The mascot pops in from the bottom",
    });
    expect(result.frames[1].index).toBe(2);
  });

  // Case 2: BOM ở đầu file
  it("strips BOM before parsing", () => {
    const text = `﻿STT${T}Shot Type${T}Description\n1${T}Close-up${T}Mascot smiles`;
    const result = parseTsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames[0].shotType).toBe("Close-up");
  });

  // Case 3: CRLF line endings
  it("handles CRLF line endings", () => {
    const text = `STT${T}Shot Type${T}Description\r\n1${T}Pan${T}Camera sweeps the izakaya\r\n2${T}Static shot${T}Mascot waves`;
    const result = parseTsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames).toHaveLength(2);
    expect(result.frames[1].description).toBe("Mascot waves");
  });

  // Case 4: ô có ngoặc kép chứa xuống dòng
  it("parses quoted cell containing embedded newline", () => {
    const text = `STT${T}Shot Type${T}Description\n1${T}Static shot${T}"Line one\nline two of the same cell"`;
    const result = parseTsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0].description).toBe("Line one\nline two of the same cell");
  });

  // Case 5: header tiếng Việt
  it("accepts Vietnamese header", () => {
    const text = `STT${T}Loại cảnh${T}Mô tả\n1${T}Cận cảnh${T}Mascot cười tươi bên tô mì`;
    const result = parseTsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames[0].shotType).toBe("Cận cảnh");
    expect(result.frames[0].description).toBe("Mascot cười tươi bên tô mì");
  });

  // Case 6: STT bỏ trống → tự đánh số liên tục
  it("auto-numbers when STT column is empty", () => {
    const text = [
      `STT${T}Shot Type${T}Description`,
      `${T}Static shot${T}First scene`,
      `${T}Wide shot${T}Second scene`,
    ].join("\n");
    const result = parseTsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames.map((f) => f.index)).toEqual([1, 2]);
  });

  // Case 7: thiếu Description → báo lỗi kèm số dòng
  it("reports missing description with line number", () => {
    const text = [
      `STT${T}Shot Type${T}Description`,
      `1${T}Static shot${T}Valid scene`,
      `2${T}Close-up${T}`,
    ].join("\n");
    const result = parseTsv(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].line).toBe(3);
    expect(result.errors[0].message).toContain("Dòng 3");
  });

  // Case 8: dòng trống bị bỏ qua
  it("skips empty lines between rows", () => {
    const text = [
      `STT${T}Shot Type${T}Description`,
      ``,
      `1${T}Static shot${T}Scene A`,
      `   `,
      `2${T}Pan${T}Scene B`,
      ``,
    ].join("\n");
    const result = parseTsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames).toHaveLength(2);
  });

  // Case 9: shot type trống → mặc định Static shot
  it("defaults empty shot type to Static shot", () => {
    const text = `STT${T}Shot Type${T}Description\n1${T}${T}A scene with no shot type`;
    const result = parseTsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames[0].shotType).toBe("Static shot");
  });

  // Case 10: 2 cột (không có STT) → shotType + description
  it("parses 2-column rows as shotType + description", () => {
    const text = `Shot Type${T}Description\nWide shot${T}The whole restaurant from outside`;
    const result = parseTsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames[0].shotType).toBe("Wide shot");
    expect(result.frames[0].description).toBe("The whole restaurant from outside");
  });

  // Case 11: nội dung trống hoàn toàn
  it("rejects empty input", () => {
    const result = parseTsv("   \n  ");
    expect(result.ok).toBe(false);
  });

  // Case 12: chỉ có header
  it("rejects header-only input", () => {
    const result = parseTsv(`STT${T}Shot Type${T}Description`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain("header");
  });

  // Case 13: ô có khoảng trắng thừa quanh tab → trim
  it("trims whitespace around cells", () => {
    const text = `STT${T}Shot Type${T}Description\n1${T}  Static shot  ${T}  Padded description  `;
    const result = parseTsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames[0].shotType).toBe("Static shot");
    expect(result.frames[0].description).toBe("Padded description");
  });

  // Case 14: escape "" trong ô quote
  it("unescapes doubled quotes inside quoted cell", () => {
    const text = `STT${T}Shot Type${T}Description\n1${T}Static shot${T}"He said ""hello"" loudly"`;
    const result = parseTsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames[0].description).toBe('He said "hello" loudly');
  });

  // Case 15 (regression audit): dòng dữ liệu đầu chứa từ khoá header trong văn xuôi
  // KHÔNG được bị nhầm là header và bị vứt bỏ
  it("does not misdetect a data row containing header-like words as header", () => {
    const text = `1${T}Wide shot${T}A frame shows the hero running through the shot location`;
    const result = parseTsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0].description).toContain("hero running");
  });

  // Case 16: header thật vẫn được nhận diện đúng sau khi siết heuristic
  it("still detects a real header row with exact column names", () => {
    const text = `Frame${T}Shot${T}Desc\n1${T}Close-up${T}Mascot smiles warmly`;
    const result = parseTsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0].description).toBe("Mascot smiles warmly");
  });
});
