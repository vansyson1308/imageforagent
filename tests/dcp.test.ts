import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rgb24ToXyzPpm, srgbToDciXyz } from "@/lib/services/dcp/color";
import {
  BODY_SID,
  ESSENCE_START,
  HEADER_REGION,
  INDEX_SID,
  parseJ2kHeader,
  type MxfIdentity,
} from "@/lib/services/dcp/mxf";
import { MxfFileWriter } from "@/lib/services/dcp/mxfWriter";
import { buildAssetMap, buildCpl, buildPkl, dcncName, sha1Base64 } from "@/lib/services/dcp/packaging";
import { buildPictureArgs, containerSize, DCI_MAX_MBPS, j2kEncodeArgs, setDciProfile } from "@/lib/services/dcp/picture";
import { uuidBytes, uuidString } from "@/lib/services/dcp/uuid";

const has = (cmd: string) => {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

// ---------- Codestream J2K tổng hợp (main header đủ SIZ/COD/QCD) ----------

function syntheticJ2k(w: number, h: number, payload: number): Buffer {
  const siz = Buffer.alloc(2 + 36 + 9);
  siz.writeUInt16BE(siz.length, 0);
  siz.writeUInt16BE(3, 2); // Rsiz: cinema 2K
  siz.writeUInt32BE(w, 4);
  siz.writeUInt32BE(h, 8);
  siz.writeUInt32BE(w, 20);
  siz.writeUInt32BE(h, 24);
  siz.writeUInt16BE(3, 36);
  for (let c = 0; c < 3; c++) siz.set([11, 1, 1], 38 + c * 3);
  const cod = Buffer.from([0x00, 18, 0x01, 0x04, 0x00, 0x01, 0x01, 0x05, 0x03, 0x03, 0x00, 0x00, 0x77, 0x88, 0x88, 0x88, 0x88, 0x88]);
  const qcd = Buffer.from([0x00, 5, 0x22, 0x40, 0x00]);
  return Buffer.concat([
    Buffer.from([0xff, 0x4f]),
    Buffer.from([0xff, 0x51]), siz,
    Buffer.from([0xff, 0x52]), cod,
    Buffer.from([0xff, 0x5c]), qcd,
    Buffer.from([0xff, 0x90, 0x00, 0x0a]), Buffer.alloc(8),
    Buffer.alloc(payload, 0xab),
    Buffer.from([0xff, 0xd9]),
  ]);
}

const identity = (kind: string): MxfIdentity => ({
  assetUuid: uuidBytes("test", `${kind}.asset`),
  uuid: (l) => uuidBytes("test", `${kind}.${l}`),
  date: new Date("2026-09-24T00:00:00Z"),
  companyName: "Storyboard Studio",
  productName: "master-dcp",
  versionString: "1.0.0",
});

/** Đi KLV: trả [offset, keyHex, valueOffset, valueLength]. */
function walkKlv(buf: Buffer, from = 0, to = buf.length) {
  const out: { at: number; key: string; vo: number; vl: number }[] = [];
  let o = from;
  while (o < to) {
    const key = buf.subarray(o, o + 16).toString("hex");
    const b = buf[o + 16];
    let len: number;
    let lo: number;
    if (b < 0x80) {
      len = b;
      lo = 1;
    } else {
      const n = b & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + buf[o + 17 + i];
      lo = 1 + n;
    }
    out.push({ at: o, key, vo: o + 16 + lo, vl: len });
    o += 16 + lo + len;
  }
  return out;
}

describe("color — sRGB → X′Y′Z′ DCI 12-bit", () => {
  it("trắng sRGB → giá trị kinh điển 48 cd/m² (Y′ = 3960)", () => {
    const [x, y, z] = srgbToDciXyz(255, 255, 255);
    expect(y).toBe(3960);
    expect(Math.abs(x - 3883)).toBeLessThanOrEqual(1);
    expect(Math.abs(z - 4092)).toBeLessThanOrEqual(1);
  });

  it("đen → 0, đơn điệu theo xám", () => {
    expect(srgbToDciXyz(0, 0, 0)).toEqual([0, 0, 0]);
    let prev = -1;
    for (let v = 0; v <= 255; v += 5) {
      const y = srgbToDciXyz(v, v, v)[1];
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
  });

  it("PPM P6 16-bit big-endian maxval 4095, đúng kích thước", () => {
    const rgb = Buffer.from([255, 255, 255, 0, 0, 0]);
    const ppm = rgb24ToXyzPpm(rgb, 2, 1);
    const header = "P6\n2 1\n4095\n";
    expect(ppm.subarray(0, header.length).toString("ascii")).toBe(header);
    expect(ppm.length).toBe(header.length + 2 * 1 * 6);
    expect(ppm.readUInt16BE(header.length + 2)).toBe(3960);
    expect(ppm.readUInt16BE(header.length + 8)).toBe(0);
  });
});

describe("uuid — tất định, dạng RFC 4122", () => {
  it("cùng seed+nhãn → cùng UUID; khác nhãn → khác", () => {
    expect(uuidBytes("s", "a").equals(uuidBytes("s", "a"))).toBe(true);
    expect(uuidBytes("s", "a").equals(uuidBytes("s", "b"))).toBe(false);
    expect(uuidBytes("s1", "a").equals(uuidBytes("s2", "a"))).toBe(false);
  });

  it("version 5 + variant RFC 4122", () => {
    const s = uuidString(uuidBytes("seed", "label"));
    expect(s).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("dcncName — ISDCF 9.6 đủ 12 trường", () => {
  const date = new Date("2026-09-24T00:00:00Z");

  it("12 trường, đúng thứ tự, SMPTE OV", () => {
    const n = dcncName({ title: "Chú Mèo Đi Học", kind: "feature", aspect: "S", language: "vi-en", territory: "vn-13", is4K: true, studio: "abc", date, facility: "xyz" });
    expect(n).toBe("ChuMeoDiHoc_FTR_S_VI-EN_VN-13_51_4K_ABC_20260924_XYZ_SMPTE_OV");
    expect(n.split("_")).toHaveLength(12);
  });

  it("trường không hợp lệ rơi về mặc định an toàn, tiêu đề ≤ 14 ký tự", () => {
    const n = dcncName({ title: "A very long film title!!", kind: "short", aspect: "F", language: "english", studio: "TOOLONG", is4K: false, date, facility: "!" });
    const parts = n.split("_");
    expect(parts[0]).toBe("Averylongfilmt");
    expect(parts.slice(1)).toEqual(["SHR", "F", "XX-XX", "INT", "51", "2K", "SBS", "20260924", "SBS", "SMPTE", "OV"]);
  });

  it("tiêu đề rỗng sau chuẩn hoá → Untitled", () => {
    expect(dcncName({ title: "!!!", kind: "test", aspect: "F", is4K: false, date }).split("_")[0]).toBe("Untitled");
  });
});

describe("picture — lệnh ffmpeg container DCI", () => {
  it("container Flat/Scope 2K/4K", () => {
    expect(containerSize("flat", false)).toEqual({ w: 1998, h: 1080 });
    expect(containerSize("scope", false)).toEqual({ w: 2048, h: 858 });
    expect(containerSize("flat", true)).toEqual({ w: 3996, h: 2160 });
    expect(containerSize("scope", true)).toEqual({ w: 4096, h: 1716 });
  });

  it("letterbox giữ tỉ lệ, cut = concat, dissolve = xfade tại startSec, tổng frame đúng timeline", () => {
    const { args, frames } = buildPictureArgs(
      [
        { index: 1, startSec: 0, durationSec: 2, still: "F01.png" },
        { index: 2, startSec: 2, durationSec: 3, clip: { pattern: "clips/F02/%04d.png", fps: 12 }, transitionIn: null },
        { index: 3, startSec: 4.5, durationSec: 2, still: "F03.png", transitionIn: { kind: "dissolve", duration: 0.5 } },
      ],
      { w: 1998, h: 1080 },
    );
    expect(frames).toBe(Math.round(6.5 * 24));
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("force_original_aspect_ratio=decrease");
    expect(graph).toContain("pad=1998:1080:(ow-iw)/2:(oh-ih)/2:color=black");
    expect(graph).toContain("[v0][v1]concat=n=2:v=1:a=0,settb=1/24[x1]");
    expect(graph).toContain("[x1][v2]xfade=transition=fade:duration=0.5:offset=4.5[x2]");
    expect(args.slice(-4)).toEqual(["rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
    expect(args).toContain("-framerate");
    // không shell: mọi đường dẫn là một phần tử argv riêng
    expect(args).toContain("clips/F02/%04d.png");
  });
});

/** Main-header markers of a codestream, in order (up to the first SOT). */
function mainMarkers(cs: Buffer): number[] {
  const out: number[] = [];
  for (let o = 2; o + 4 <= cs.length; ) {
    const m = cs.readUInt16BE(o);
    if (m === 0xff90) break;
    out.push(m);
    o += 2 + cs.readUInt16BE(o + 2);
  }
  return out;
}

describe("picture — J2K bitrate dưới trần DCI", () => {
  it("không --mbps → -cinema2K/-cinema4K của OpenJPEG", () => {
    expect(j2kEncodeArgs("a.ppm", "a.j2c", { is4K: false, w: 1998, h: 1080 })).toEqual(["-i", "a.ppm", "-o", "a.j2c", "-cinema2K", "24"]);
    expect(j2kEncodeArgs("a.ppm", "a.j2c", { is4K: true, w: 3996, h: 2160 })).toContain("-cinema4K");
  });

  it("--mbps → tham số cinema 2K tường minh, tỉ lệ nén từ kích thước 12-bit thô", () => {
    const a = j2kEncodeArgs("a.ppm", "a.j2c", { is4K: false, mbps: 80, w: 1998, h: 1080 });
    const raw = (1998 * 1080 * 3 * 12) / 8;
    expect(Number(a[a.indexOf("-r") + 1])).toBeCloseTo(raw / (80e6 / 24 / 8), 2);
    for (const f of ["-I", "-TLM", "CPRL"]) expect(a).toContain(f);
    expect(a[a.indexOf("-TP") + 1]).toBe("C");
    expect(a[a.indexOf("-n") + 1]).toBe("6");
    expect(() => j2kEncodeArgs("a", "b", { is4K: false, mbps: DCI_MAX_MBPS + 1, w: 1998, h: 1080 })).toThrow(/mbps/);
    expect(() => j2kEncodeArgs("a", "b", { is4K: true, mbps: 80, w: 3996, h: 2160 })).toThrow(/2K/);
  });

  it("setDciProfile ghi Rsiz ngay sau SOC+SIZ, từ chối thứ không phải J2K", () => {
    const cs = syntheticJ2k(1998, 1080, 16);
    cs.writeUInt16BE(0, 6);
    expect(parseJ2kHeader(setDciProfile(cs, false)).rsize).toBe(3);
    expect(parseJ2kHeader(setDciProfile(cs, true)).rsize).toBe(4);
    expect(() => setDciProfile(Buffer.from("not a codestream"), false)).toThrow(/JPEG 2000/);
  });

  it.skipIf(!has("opj_compress"))("opj thật: --mbps cho cùng cấu trúc với -cinema2K (SIZ/COD/QCD/TLM), Rsiz=3, dưới đích", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "j2k-"));
    try {
      const w = 666, h = 360; // small keeps it fast; the coding parameters do not depend on size
      const rgb = Buffer.alloc(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        rgb[i] = (x * 255) / w; rgb[i + 1] = (y * 255) / h; rgb[i + 2] = ((x ^ y) & 0xff);
      }
      writeFileSync(path.join(dir, "f.ppm"), rgb24ToXyzPpm(rgb, w, h));
      const enc = (out: string, mbps?: number) => {
        execFileSync("opj_compress", j2kEncodeArgs(path.join(dir, "f.ppm"), path.join(dir, out), { is4K: false, mbps, w, h }), { stdio: "ignore" });
        return readFileSync(path.join(dir, out));
      };
      const cinema = enc("c.j2c");
      const low = setDciProfile(enc("l.j2c", 60), false);
      const hc = parseJ2kHeader(cinema), hl = parseJ2kHeader(low);
      expect(hl.rsize).toBe(3);
      expect(hl.rsize).toBe(hc.rsize);
      expect(hl.cod.equals(hc.cod)).toBe(true);
      expect(hl.qcd.equals(hc.qcd)).toBe(true);
      expect(mainMarkers(low)).toEqual(mainMarkers(cinema));
      expect(low.length).toBeLessThanOrEqual(Math.ceil(60e6 / 24 / 8) + 64);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("mxf — cấu trúc OP-Atom SMPTE (header 16384, body, index, RIP)", () => {
  const w = 1998;
  const h = 1080;

  it("parseJ2kHeader đọc SIZ/COD/QCD", () => {
    const j = parseJ2kHeader(syntheticJ2k(w, h, 100));
    expect(j.rsize).toBe(3);
    expect([j.xsize, j.ysize]).toEqual([w, h]);
    expect(j.components).toHaveLength(3);
    expect(j.components[0]).toEqual({ ssiz: 11, xrsiz: 1, yrsiz: 1 });
    expect(j.cod.length).toBe(16);
    expect(() => parseJ2kHeader(Buffer.from([0, 1, 2, 3]))).toThrow(/SOC/);
  });

  async function writePicture(dir: string, n: number) {
    const file = path.join(dir, `pic-${n}.mxf`);
    const frames = Array.from({ length: n }, (_, i) => syntheticJ2k(w, h, 1000 + i * 37));
    const wr = await MxfFileWriter.create(file, identity("picture"), { kind: "picture", editRate: 24, j2k: parseJ2kHeader(frames[0]), is4K: false });
    for (const f of frames) await wr.writeUnit(f);
    await wr.close();
    return { file, frames };
  }

  it("layout: header partition → fill tới 16384 → body partition → essence → footer → RIP", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mxf-"));
    try {
      const { file, frames } = await writePicture(dir, 3);
      const buf = readFileSync(file);
      const header = walkKlv(buf, 0, HEADER_REGION);
      // Header partition pack (Closed Complete) đầu tiên, fill cuối cùng chạm đúng 16384
      expect(header[0].key.startsWith("060e2b34020501010d01020101020400")).toBe(true);
      const last = header[header.length - 1];
      expect(last.vo + last.vl).toBe(HEADER_REGION);
      // Body partition ngay tại 16384, essence element picture đầu tiên tại ESSENCE_START
      const body = walkKlv(buf, HEADER_REGION);
      expect(body[0].at).toBe(HEADER_REGION);
      expect(body[0].key.startsWith("060e2b34020501010d0102010103")).toBe(true);
      expect(body[0].vo + body[0].vl).toBe(ESSENCE_START);
      const essence = body.filter((k) => k.key === "060e2b34010201010d01030115010801");
      expect(essence.map((e) => e.vl)).toEqual(frames.map((f) => f.length));
      expect(buf.subarray(essence[1].vo, essence[1].vo + essence[1].vl).equals(frames[1])).toBe(true);
      // RIP: cuối file, 3 partition (header 0, body @16384 SID 1, footer)
      const rip = body[body.length - 1];
      expect(rip.key).toBe("060e2b34020501010d01020101110100");
      expect(rip.vo + rip.vl).toBe(buf.length);
      expect(buf.readUInt32BE(buf.length - 4)).toBe(buf.length - rip.at);
      const footerAt = Number(buf.readBigUInt64BE(rip.vo + 12 * 2 + 4));
      expect(buf.readUInt32BE(rip.vo + 12)).toBe(BODY_SID);
      expect(Number(buf.readBigUInt64BE(rip.vo + 16))).toBe(HEADER_REGION);
      expect(buf.subarray(footerAt, footerAt + 14).toString("hex")).toBe("060e2b34020501010d0102010104");
      // Index table segment trong footer mang IndexSID 129
      expect(body.some((k) => k.key === "060e2b34025301010d01020101100100")).toBe(true);
      expect(INDEX_SID).toBe(129);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tất định: ghi hai lần → byte giống hệt", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mxf-"));
    try {
      const a = await writePicture(dir, 2);
      const bufA = readFileSync(a.file);
      const b = await writePicture(dir, 2);
      expect(readFileSync(b.file).equals(bufA)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sound CBR: unit khác kích thước bị từ chối", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mxf-"));
    try {
      const wr = await MxfFileWriter.create(path.join(dir, "snd.mxf"), identity("sound"), { kind: "sound", editRate: 24, sampleRate: 48000, channels: 6, bits: 24 });
      await wr.writeUnit(Buffer.alloc(36000));
      await wr.writeUnit(Buffer.alloc(100));
      await expect(wr.close()).rejects.toThrow(/CBR/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!has("asdcp-info"))("asdcplib (tham chiếu) đọc được picture + sound", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mxf-"));
    try {
      const { file } = await writePicture(dir, 3);
      expect(execFileSync("asdcp-info", ["-i", file]).toString()).toMatch(/SMPTE 429 file essence type is JPEG 2000 pictures, \(3 edit units\)/);
      const snd = path.join(dir, "snd.mxf");
      const wr = await MxfFileWriter.create(snd, identity("sound"), { kind: "sound", editRate: 24, sampleRate: 48000, channels: 6, bits: 24 });
      for (let i = 0; i < 4; i++) await wr.writeUnit(Buffer.alloc(2000 * 6 * 3, i));
      await wr.close();
      const info = execFileSync("asdcp-info", ["-i", "-d", snd]).toString();
      expect(info).toMatch(/PCM audio, \(4 edit units\)/);
      expect(info).toMatch(/ChannelCount: 6/);
      expect(info).toMatch(/QuantizationBits: 24/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("packaging — CPL / PKL / ASSETMAP", () => {
  const date = new Date("2026-09-24T00:00:00Z");
  const U = (l: string) => uuidBytes("pkg", l);
  const cpl = buildCpl({
    id: U("cpl"),
    title: "T_SHR_F_XX-XX_INT_51_2K_SBS_20260924_SBS_SMPTE_OV",
    contentTitle: "T_SHR_F_XX-XX_INT_51_2K_SBS_20260924_SBS_SMPTE_OV",
    kind: "short",
    issuer: "A & B <Studio>",
    creator: "master-dcp",
    date,
    editRate: 24,
    versionId: U("v"),
    reels: [{ reelId: U("r"), picture: { id: U("p"), duration: 120, hash: "aGFzaA==", width: 1998, height: 1080 }, sound: { id: U("s"), duration: 120, hash: "c25k" } }],
  });

  it("CPL SMPTE 429-7: namespace, reel picture+sound, XML-escape", () => {
    expect(cpl).toContain('xmlns="http://www.smpte-ra.org/schemas/429-7/2006/CPL"');
    expect(cpl).toContain("<ScreenAspectRatio>1998 1080</ScreenAspectRatio>");
    expect(cpl).toContain("<FrameRate>24 1</FrameRate>");
    expect(cpl).toMatch(/<MainSound>[\s\S]*<Duration>120<\/Duration>/);
    expect(cpl).toContain("<Issuer>A &amp; B &lt;Studio&gt;</Issuer>");
    expect(cpl).toContain("<IssueDate>2026-09-24T00:00:00+00:00</IssueDate>");
  });

  it("PKL + ASSETMAP tham chiếu cùng UUID, hash SHA-1 base64", () => {
    const data = Buffer.from(cpl);
    const asset = { id: U("cpl"), file: "CPL.xml", size: data.length, hash: sha1Base64(data), type: "text/xml" as const, annotation: "cpl" };
    expect(asset.hash).toMatch(/^[A-Za-z0-9+/]{27}=$/);
    const pkl = buildPkl({ id: U("pkl"), title: "t", issuer: "i", creator: "c", date, assets: [asset] });
    expect(pkl).toContain('xmlns="http://www.smpte-ra.org/schemas/429-8/2007/PKL"');
    expect(pkl).toContain(`<Hash>${asset.hash}</Hash>`);
    const am = buildAssetMap({ id: U("am"), title: "t", issuer: "i", creator: "c", date, pkl: { id: U("pkl"), file: "PKL.xml", size: pkl.length }, assets: [asset] });
    expect(am).toContain("<PackingList>true</PackingList>");
    expect(am).toContain(`<Id>urn:uuid:${uuidString(U("cpl"))}</Id>`);
    expect(am).toContain("<Path>CPL.xml</Path>");
  });
});
