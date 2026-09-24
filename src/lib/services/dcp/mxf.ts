/**
 * mxf — writer MXF SMPTE cho DCP, thuần TS (không dependency):
 *   picture  SMPTE ST 429-4  JPEG 2000 frame-wrapped, OP-Atom (ST 390)
 *   sound    SMPTE ST 429-3 / ST 382  WAVE PCM frame-wrapped
 * Bố cục byte-khớp tham chiếu asdcplib (bộ thư viện mà DCP-o-matic dựa vào):
 *   [0, 16384)  header partition + primer + header metadata + KLV fill
 *   16384       body partition (BodySID 1) → essence KLV mỗi edit unit
 *   footer      footer partition + index table segment(s) (IndexSID 129) + RIP
 * Header được ghi CUỐI (cần footer offset + duration) vào vùng 16384 byte
 * cố định. Pure: chỉ dựng Buffer; I/O ở caller.
 */

export type EssenceKind = "picture" | "sound";

export const HEADER_REGION = 16384;
export const BODY_PARTITION_LEN = 140;
export const ESSENCE_START = HEADER_REGION + BODY_PARTITION_LEN;
export const INDEX_SID = 129;
export const BODY_SID = 1;
const MAX_INDEX_ENTRIES_PER_SEGMENT = 4000;

const ul = (hex: string) => Buffer.from(hex, "hex");

// ---------- ULs (SMPTE registry — khớp asdcplib, label set SMPTE) ----------

const UL = {
  partitionHeader: "060e2b34020501010d01020101020400",
  partitionBody: "060e2b34020501010d01020101030400",
  partitionFooter: "060e2b34020501010d01020101040400",
  primer: "060e2b34020501010d01020101050100",
  fill: "060e2b34010101020301021001000000",
  rip: "060e2b34020501010d01020101110100",
  indexSegment: "060e2b34025301010d01020101100100",
  preface: "060e2b34025301010d01010101012f00",
  identification: "060e2b34025301010d01010101013000",
  contentStorage: "060e2b34025301010d01010101011800",
  essenceContainerData: "060e2b34025301010d01010101012300",
  materialPackage: "060e2b34025301010d01010101013600",
  sourcePackage: "060e2b34025301010d01010101013700",
  track: "060e2b34025301010d01010101013b00",
  sequence: "060e2b34025301010d01010101010f00",
  sourceClip: "060e2b34025301010d01010101011100",
  timecodeComponent: "060e2b34025301010d01010101011400",
  rgbaDescriptor: "060e2b34025301010d01010101012900",
  jpeg2000SubDescriptor: "060e2b34025301010d01010101015a00",
  waveDescriptor: "060e2b34025301010d01010101014800",
  opAtom: "060e2b34040101020d01020110000000",
  genericContainer: "060e2b34040101030d010301027f0100",
  jp2kFrameWrapped: "060e2b34040101070d010301020c0100",
  waveFrameWrapped: "060e2b34040101010d01030102060100",
  ddTimecode: "060e2b34040101010103020101000000",
  ddPicture: "060e2b34040101010103020201000000",
  ddSound: "060e2b34040101010103020202000000",
  /** PictureEssenceCoding: JPEG 2000 DCI 2K / 4K profile. */
  jp2k2K: "060e2b34040101090401020203010103",
  jp2k4K: "060e2b34040101090401020203010104",
  pictureElement: "060e2b34010201010d01030115010801",
  soundElement: "060e2b34010201010d01030116010101",
} as const;

export const PICTURE_TRACK_NUMBER = 0x15010801;
export const SOUND_TRACK_NUMBER = 0x16010101;

/** Local tag → UL (primer) — chỉ các tag writer này dùng. */
const PRIMER: Record<string, string> = {
  "0201": "060e2b34010101020407010000000000",
  "0202": "060e2b34010101020702020101030000",
  "1001": "060e2b34010101020601010406090000",
  "1101": "060e2b34010101020601010301000000",
  "1102": "060e2b34010101020601010302000000",
  "1201": "060e2b34010101020702010301040000",
  "1501": "060e2b34010101020702010301050000",
  "1502": "060e2b34010101020404010102060000",
  "1503": "060e2b34010101010404010105000000",
  "1901": "060e2b34010101020601010405010000",
  "1902": "060e2b34010101020601010405020000",
  "2701": "060e2b34010101020601010601000000",
  "3001": "060e2b34010101010406010100000000",
  "3002": "060e2b34010101010406010200000000",
  "3004": "060e2b34010101020601010401020000",
  "3006": "060e2b34010101050601010305000000",
  "3201": "060e2b34010101020401060100000000",
  "3202": "060e2b34010101010401050201000000",
  "3203": "060e2b34010101010401050202000000",
  "320c": "060e2b34010101010401030104000000",
  "320e": "060e2b34010101010401010101000000",
  "3401": "060e2b34010101020401050306000000",
  "3406": "060e2b3401010105040105030b000000",
  "3407": "060e2b3401010105040105030c000000",
  "3b02": "060e2b34010101020702011002040000",
  "3b03": "060e2b34010101020601010402010000",
  "3b05": "060e2b34010101020301020105000000",
  "3b06": "060e2b34010101020601010406040000",
  "3b07": "060e2b34010101020301020104000000",
  "3b08": "060e2b34010101040601010401080000",
  "3b09": "060e2b34010101050102020300000000",
  "3b0a": "060e2b34010101050102021002010000",
  "3b0b": "060e2b34010101050102021002020000",
  "3c01": "060e2b34010101020520070102010000",
  "3c02": "060e2b34010101020520070103010000",
  "3c03": "060e2b34010101020520070104000000",
  "3c04": "060e2b34010101020520070105010000",
  "3c05": "060e2b34010101020520070107000000",
  "3c06": "060e2b34010101020702011002030000",
  "3c07": "060e2b3401010102052007010a000000",
  "3c08": "060e2b34010101020520070106010000",
  "3c09": "060e2b34010101020520070101000000",
  "3c0a": "060e2b34010101010101150200000000",
  "3d01": "060e2b34010101040402030304000000",
  "3d02": "060e2b34010101040402030104000000",
  "3d03": "060e2b34010101050402030101010000",
  "3d07": "060e2b34010101050402010104000000",
  "3d09": "060e2b34010101050402030305000000",
  "3d0a": "060e2b34010101050402030201000000",
  "3f05": "060e2b34010101040406020100000000",
  "3f06": "060e2b34010101040103040500000000",
  "3f07": "060e2b34010101040103040400000000",
  "3f08": "060e2b34010101040404040101000000",
  "3f09": "060e2b34010101050404040106000000",
  "3f0a": "060e2b34010101050404040205000000",
  "3f0b": "060e2b34010101050530040600000000",
  "3f0c": "060e2b340101010507020103010a0000",
  "3f0d": "060e2b34010101050702020101020000",
  "3f0e": "060e2b34010101050404040107000000",
  "4401": "060e2b34010101010101151000000000",
  "4402": "060e2b34010101010103030201000000",
  "4403": "060e2b34010101020601010406050000",
  "4404": "060e2b34010101020702011002050000",
  "4405": "060e2b34010101020702011001030000",
  "4701": "060e2b34010101020601010402030000",
  "4801": "060e2b34010101020107010100000000",
  "4802": "060e2b34010101020107010201000000",
  "4803": "060e2b34010101020601010402040000",
  "4804": "060e2b34010101020104010300000000",
  "4b01": "060e2b34010101020530040500000000",
  "4b02": "060e2b34010101020702010301030000",
  fff2: "060e2b340101010a040106030d000000",
  fff3: "060e2b340101010a040106030c000000",
  fff4: "060e2b340101010a040106030b000000",
  fff5: "060e2b340101010a040106030a000000",
  fff6: "060e2b340101010a0401060309000000",
  fff7: "060e2b340101010a0401060308000000",
  fff8: "060e2b340101010a0401060307000000",
  fff9: "060e2b340101010a0401060306000000",
  fffa: "060e2b340101010a0401060305000000",
  fffb: "060e2b340101010a0401060304000000",
  fffc: "060e2b340101010a0401060303000000",
  fffd: "060e2b340101010a0401060302000000",
  fffe: "060e2b340101010a0401060301000000",
  ffff: "060e2b34010101090601010406100000",
};

// ---------- Mã hoá nguyên thuỷ ----------

const u8 = (v: number) => Buffer.from([v & 0xff]);
const u16 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v);
  return b;
};
const u32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v >>> 0);
  return b;
};
const u64 = (v: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(v));
  return b;
};
const rational = (n: number, d: number) => Buffer.concat([u32(n), u32(d)]);
const utf16 = (s: string) => Buffer.from(s, "utf16le").swap16();
/** Timestamp MXF: năm(2) tháng ngày giờ phút giây ms/4 — UTC. */
function timestamp(d: Date): Buffer {
  return Buffer.concat([
    u16(d.getUTCFullYear()),
    u8(d.getUTCMonth() + 1),
    u8(d.getUTCDate()),
    u8(d.getUTCHours()),
    u8(d.getUTCMinutes()),
    u8(d.getUTCSeconds()),
    u8(Math.floor(d.getUTCMilliseconds() / 4)),
  ]);
}
const batch = (items: readonly Buffer[], itemSize: number) => Buffer.concat([u32(items.length), u32(itemSize), ...items]);

/** BER long-form 4 byte (0x83 + 3 byte) — như asdcplib. */
export function ber4(len: number): Buffer {
  if (len > 0xffffff) throw new RangeError(`KLV value too large for 4-byte BER: ${len}`);
  return Buffer.from([0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

export function klv(keyHex: string, value: Buffer): Buffer {
  return Buffer.concat([ul(keyHex), ber4(value.length), value]);
}

type Item = [tag: string, value: Buffer];

function localSet(keyHex: string, items: readonly Item[], usedTags: Set<string>): Buffer {
  const parts: Buffer[] = [];
  for (const [tag, v] of items) {
    if (v.length > 0xffff) throw new RangeError(`local tag ${tag} value too large (${v.length})`);
    usedTags.add(tag);
    parts.push(Buffer.from(tag, "hex"), u16(v.length), v);
  }
  return klv(keyHex, Buffer.concat(parts));
}

/** UMID SMPTE 330 (32 byte) với material number = asset UUID. */
export function umid(uuid: Buffer): Buffer {
  return Buffer.concat([ul("060a2b340101010501010f20"), Buffer.from([0x13, 0, 0, 0]), uuid]);
}

// ---------- Thông số ----------

export interface J2kInfo {
  readonly rsize: number;
  readonly xsize: number;
  readonly ysize: number;
  readonly xosize: number;
  readonly yosize: number;
  readonly xtsize: number;
  readonly ytsize: number;
  readonly xtosize: number;
  readonly ytosize: number;
  readonly components: readonly { ssiz: number; xrsiz: number; yrsiz: number }[];
  /** Nội dung marker COD / QCD (không gồm marker + length). */
  readonly cod: Buffer;
  readonly qcd: Buffer;
}

/** Đọc SIZ/COD/QCD từ main header của một codestream J2K. */
export function parseJ2kHeader(cs: Buffer): J2kInfo {
  if (cs.readUInt16BE(0) !== 0xff4f) throw new Error("Not a JPEG 2000 codestream (no SOC).");
  let o = 2;
  let siz: Buffer | null = null;
  let cod: Buffer | null = null;
  let qcd: Buffer | null = null;
  while (o + 4 <= cs.length) {
    const marker = cs.readUInt16BE(o);
    if (marker === 0xff90) break; // SOT — hết main header
    const len = cs.readUInt16BE(o + 2);
    const body = cs.subarray(o + 4, o + 2 + len);
    if (marker === 0xff51) siz = body;
    else if (marker === 0xff52) cod = body;
    else if (marker === 0xff5c) qcd = body;
    o += 2 + len;
  }
  if (!siz || !cod || !qcd) throw new Error("J2K main header is missing SIZ/COD/QCD.");
  const csiz = siz.readUInt16BE(34);
  return {
    rsize: siz.readUInt16BE(0),
    xsize: siz.readUInt32BE(2),
    ysize: siz.readUInt32BE(6),
    xosize: siz.readUInt32BE(10),
    yosize: siz.readUInt32BE(14),
    xtsize: siz.readUInt32BE(18),
    ytsize: siz.readUInt32BE(22),
    xtosize: siz.readUInt32BE(26),
    ytosize: siz.readUInt32BE(30),
    components: Array.from({ length: csiz }, (_, i) => ({
      ssiz: siz![36 + i * 3],
      xrsiz: siz![37 + i * 3],
      yrsiz: siz![38 + i * 3],
    })),
    cod: Buffer.from(cod),
    qcd: Buffer.from(qcd),
  };
}

export interface MxfIdentity {
  /** 16 byte — AssetUUID mà CPL tham chiếu. */
  readonly assetUuid: Buffer;
  /** Sinh UUID phụ (instance/package) tất định. */
  readonly uuid: (label: string) => Buffer;
  readonly date: Date;
  readonly companyName: string;
  readonly productName: string;
  readonly versionString: string;
}

export interface PictureDescriptor {
  readonly kind: "picture";
  readonly editRate: number;
  readonly j2k: J2kInfo;
  /** true = JPEG 2000 profile 4K. */
  readonly is4K: boolean;
}

export interface SoundDescriptor {
  readonly kind: "sound";
  readonly editRate: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bits: number;
}

export type MxfDescriptor = PictureDescriptor | SoundDescriptor;

const containersOf = (d: MxfDescriptor) =>
  d.kind === "picture" ? [UL.genericContainer, UL.jp2kFrameWrapped] : [UL.waveFrameWrapped, UL.genericContainer];

function partitionPack(
  keyHex: string,
  d: MxfDescriptor,
  p: {
    thisPartition: number;
    previous: number;
    footer: number;
    headerByteCount: number;
    indexByteCount: number;
    indexSid: number;
    bodySid: number;
  },
): Buffer {
  const conts = containersOf(d).map(ul);
  return klv(
    keyHex,
    Buffer.concat([
      u16(1),
      u16(2),
      u32(1), // KAGSize
      u64(p.thisPartition),
      u64(p.previous),
      u64(p.footer),
      u64(p.headerByteCount),
      u64(p.indexByteCount),
      u32(p.indexSid),
      u64(0), // BodyOffset
      u32(p.bodySid),
      ul(UL.opAtom),
      batch(conts, 16),
    ]),
  );
}

/** Vùng header 16384 byte (partition + primer + metadata + fill). */
export function buildHeader(id: MxfIdentity, d: MxfDescriptor, duration: number, footerOffset: number): Buffer {
  const used = new Set<string>();
  const U = (label: string) => id.uuid(label);
  const inst = {
    preface: U("preface"),
    ident: U("identification"),
    storage: U("contentStorage"),
    ecd: U("essenceContainerData"),
    mp: U("materialPackage"),
    fp: U("filePackage"),
    mpTcTrack: U("mp.tc.track"),
    mpTcSeq: U("mp.tc.seq"),
    mpTc: U("mp.tc"),
    mpTrack: U("mp.track"),
    mpSeq: U("mp.seq"),
    mpClip: U("mp.clip"),
    fpTcTrack: U("fp.tc.track"),
    fpTcSeq: U("fp.tc.seq"),
    fpTc: U("fp.tc"),
    fpTrack: U("fp.track"),
    fpSeq: U("fp.seq"),
    fpClip: U("fp.clip"),
    descriptor: U("descriptor"),
    sub: U("subDescriptor"),
  };
  const mpUmid = umid(U("materialPackage.umid"));
  const fpUmid = umid(id.assetUuid);
  const now = timestamp(id.date);
  const rate = rational(d.editRate, 1);
  const dd = d.kind === "picture" ? UL.ddPicture : UL.ddSound;
  const trackName = d.kind === "picture" ? "Picture Track" : "Sound Track";
  const sets: Buffer[] = [];

  sets.push(
    localSet(UL.preface, [
      ["3c0a", inst.preface],
      ["3b02", now],
      ["3b05", u16(0x0102)],
      ["3b07", u32(1)],
      ["3b08", inst.fp],
      ["3b06", batch([inst.ident], 16)],
      ["3b03", inst.storage],
      ["3b09", ul(UL.opAtom)],
      ["3b0a", batch(containersOf(d).map(ul), 16)],
      ["3b0b", batch([], 16)],
    ], used),
  );
  sets.push(
    localSet(UL.identification, [
      ["3c0a", inst.ident],
      ["3c09", U("generation")],
      ["3c01", utf16(id.companyName)],
      ["3c02", utf16(id.productName)],
      ["3c03", Buffer.alloc(10)],
      ["3c04", utf16(id.versionString)],
      ["3c05", U("product")],
      ["3c06", now],
      ["3c07", Buffer.alloc(10)],
      ["3c08", utf16("unix")],
    ], used),
  );
  sets.push(
    localSet(UL.contentStorage, [
      ["3c0a", inst.storage],
      ["1901", batch([inst.fp, inst.mp], 16)],
      ["1902", batch([inst.ecd], 16)],
    ], used),
  );
  sets.push(
    localSet(UL.essenceContainerData, [
      ["3c0a", inst.ecd],
      ["2701", fpUmid],
      ["3f06", u32(INDEX_SID)],
      ["3f07", u32(BODY_SID)],
    ], used),
  );
  const packageSets = (pk: "mp" | "fp") => {
    const isFp = pk === "fp";
    const out: Buffer[] = [];
    const tcTrack = isFp ? inst.fpTcTrack : inst.mpTcTrack;
    const tcSeq = isFp ? inst.fpTcSeq : inst.mpTcSeq;
    const tc = isFp ? inst.fpTc : inst.mpTc;
    const track = isFp ? inst.fpTrack : inst.mpTrack;
    const seq = isFp ? inst.fpSeq : inst.mpSeq;
    const clip = isFp ? inst.fpClip : inst.mpClip;
    const pkgItems: Item[] = [
      ["3c0a", isFp ? inst.fp : inst.mp],
      ["4401", isFp ? fpUmid : mpUmid],
      [
        "4402",
        utf16(
          isFp
            ? d.kind === "picture"
              ? "File Package: SMPTE 429-4 frame wrapping of JPEG 2000 codestreams"
              : "File Package: SMPTE 382M frame wrapping of wave audio"
            : "Material Package",
        ),
      ],
      ["4405", now],
      ["4404", now],
      ["4403", batch([tcTrack, track], 16)],
    ];
    if (isFp) pkgItems.push(["4701", inst.descriptor]);
    out.push(localSet(isFp ? UL.sourcePackage : UL.materialPackage, pkgItems, used));
    out.push(
      localSet(UL.track, [
        ["3c0a", tcTrack],
        ["4801", u32(1)],
        ["4804", u32(0)],
        ["4802", utf16("Timecode Track")],
        ["4803", tcSeq],
        ["4b01", rate],
        ["4b02", u64(0)],
      ], used),
    );
    out.push(
      localSet(UL.sequence, [
        ["3c0a", tcSeq],
        ["0201", ul(UL.ddTimecode)],
        ["0202", u64(duration)],
        ["1001", batch([tc], 16)],
      ], used),
    );
    out.push(
      localSet(UL.timecodeComponent, [
        ["3c0a", tc],
        ["0201", ul(UL.ddTimecode)],
        ["0202", u64(duration)],
        ["1502", u16(d.editRate)],
        ["1501", u64(0)],
        ["1503", u8(0)],
      ], used),
    );
    out.push(
      localSet(UL.track, [
        ["3c0a", track],
        ["4801", u32(2)],
        ["4804", u32(isFp ? (d.kind === "picture" ? PICTURE_TRACK_NUMBER : SOUND_TRACK_NUMBER) : 0)],
        ["4802", utf16(trackName)],
        ["4803", seq],
        ["4b01", rate],
        ["4b02", u64(0)],
      ], used),
    );
    out.push(
      localSet(UL.sequence, [
        ["3c0a", seq],
        ["0201", ul(dd)],
        ["0202", u64(duration)],
        ["1001", batch([clip], 16)],
      ], used),
    );
    out.push(
      localSet(UL.sourceClip, [
        ["3c0a", clip],
        ["0201", ul(dd)],
        ["0202", u64(duration)],
        ["1201", u64(0)],
        ["1101", isFp ? Buffer.alloc(32) : fpUmid],
        ["1102", u32(isFp ? 0 : 2)],
      ], used),
    );
    return out;
  };
  sets.push(...packageSets("mp"), ...packageSets("fp"));

  if (d.kind === "picture") {
    const j = d.j2k;
    sets.push(
      localSet(UL.rgbaDescriptor, [
        ["3c0a", inst.descriptor],
        ["ffff", batch([inst.sub], 16)],
        ["3006", u32(2)],
        ["3001", rate],
        ["3002", u64(duration)],
        ["3004", ul(UL.jp2kFrameWrapped)],
        ["320c", u8(0)],
        ["3203", u32(j.xsize)],
        ["3202", u32(j.ysize)],
        ["320e", rational(j.xsize, j.ysize)],
        ["3201", ul(d.is4K ? UL.jp2k4K : UL.jp2k2K)],
        ["3406", u32(4095)],
        ["3407", u32(0)],
        ["3401", Buffer.alloc(16)],
      ], used),
    );
    sets.push(
      localSet(UL.jpeg2000SubDescriptor, [
        ["3c0a", inst.sub],
        ["fffe", u16(j.rsize)],
        ["fffd", u32(j.xsize)],
        ["fffc", u32(j.ysize)],
        ["fffb", u32(j.xosize)],
        ["fffa", u32(j.yosize)],
        ["fff9", u32(j.xtsize)],
        ["fff8", u32(j.ytsize)],
        ["fff7", u32(j.xtosize)],
        ["fff6", u32(j.ytosize)],
        ["fff5", u16(j.components.length)],
        ["fff4", batch(j.components.map((c) => Buffer.from([c.ssiz, c.xrsiz, c.yrsiz])), 3)],
        ["fff3", j.cod],
        ["fff2", j.qcd],
      ], used),
    );
  } else {
    const blockAlign = (d.channels * d.bits) / 8;
    sets.push(
      localSet(UL.waveDescriptor, [
        ["3c0a", inst.descriptor],
        ["3006", u32(2)],
        ["3001", rate],
        ["3002", u64(duration)],
        ["3004", ul(UL.waveFrameWrapped)],
        ["3d03", rational(d.sampleRate, 1)],
        ["3d02", u8(0)],
        ["3d07", u32(d.channels)],
        ["3d01", u32(d.bits)],
        ["3d0a", u16(blockAlign)],
        ["3d09", u32(blockAlign * d.sampleRate)],
      ], used),
    );
  }

  // Primer: mọi tag đã dùng, tăng dần
  const tags = [...used].sort();
  const primer = klv(
    UL.primer,
    batch(
      tags.map((t) => Buffer.concat([Buffer.from(t, "hex"), ul(PRIMER[t] ?? (() => { throw new Error(`primer missing tag ${t}`); })())])),
      18,
    ),
  );
  const metadata = Buffer.concat([primer, ...sets]);
  const headerByteCount = HEADER_REGION - BODY_PARTITION_LEN;
  const fillLen = headerByteCount - metadata.length - 20;
  if (fillLen < 0) throw new Error("MXF header metadata exceeds the fixed header region.");
  const header = Buffer.concat([
    partitionPack(UL.partitionHeader, d, {
      thisPartition: 0,
      previous: 0,
      footer: footerOffset,
      headerByteCount,
      indexByteCount: 0,
      indexSid: 0,
      bodySid: 0,
    }),
    metadata,
    klv(UL.fill, Buffer.alloc(fillLen)),
  ]);
  if (header.length !== HEADER_REGION) throw new Error(`MXF header region is ${header.length} bytes, expected ${HEADER_REGION}.`);
  return header;
}

export function buildBodyPartition(d: MxfDescriptor): Buffer {
  return partitionPack(UL.partitionBody, d, {
    thisPartition: HEADER_REGION,
    previous: 0,
    footer: 0,
    headerByteCount: 0,
    indexByteCount: 0,
    indexSid: 0,
    bodySid: BODY_SID,
  });
}

/** 20 byte đầu KLV của một edit unit essence. */
export function essenceKlvHeader(d: MxfDescriptor, len: number): Buffer {
  return Buffer.concat([ul(d.kind === "picture" ? UL.pictureElement : UL.soundElement), ber4(len)]);
}

function indexSegments(id: MxfIdentity, d: MxfDescriptor, sizes: readonly number[] | null, duration: number, cbrUnit: number): Buffer[] {
  const used = new Set<string>();
  const rate = rational(d.editRate, 1);
  if (sizes === null) {
    // CBR (sound): EditUnitByteCount, không cần bảng entry
    return [
      localSet(UL.indexSegment, [
        ["3c0a", id.uuid("index.0")],
        ["3f0b", rate],
        ["3f0c", u64(0)],
        ["3f0d", u64(duration)],
        ["3f05", u32(cbrUnit)],
        ["3f06", u32(INDEX_SID)],
        ["3f07", u32(BODY_SID)],
        ["3f08", u8(0)],
        ["3f0e", u8(0)],
        ["3f0a", batch([], 11)],
      ], used),
    ];
  }
  // VBR (picture): StreamOffset tương đối đầu essence, cờ 0x80 (random access)
  const offsets: number[] = [];
  let acc = 0;
  for (const s of sizes) {
    offsets.push(acc);
    acc += 20 + s;
  }
  const out: Buffer[] = [];
  for (let start = 0, seg = 0; start < sizes.length; start += MAX_INDEX_ENTRIES_PER_SEGMENT, seg++) {
    const n = Math.min(MAX_INDEX_ENTRIES_PER_SEGMENT, sizes.length - start);
    const entries = Array.from({ length: n }, (_, k) => Buffer.concat([u8(0), u8(0), u8(0x80), u64(offsets[start + k])]));
    out.push(
      localSet(UL.indexSegment, [
        ["3c0a", id.uuid(`index.${seg}`)],
        ["3f0b", rate],
        ["3f0c", u64(start)],
        ["3f0d", u64(n)],
        ["3f05", u32(0)],
        ["3f06", u32(INDEX_SID)],
        ["3f07", u32(BODY_SID)],
        ["3f08", u8(0)],
        ["3f0e", u8(0)],
        ["3f09", batch([Buffer.from([0, 0, 0, 0, 0, 0])], 6)],
        ["3f0a", batch(entries, 11)],
      ], used),
    );
  }
  return out;
}

/**
 * Footer: partition + index segment(s) + Random Index Pack.
 * @param sizes kích thước codestream từng frame (picture, VBR) — null = CBR sound
 */
export function buildFooter(
  id: MxfIdentity,
  d: MxfDescriptor,
  footerOffset: number,
  duration: number,
  sizes: readonly number[] | null,
  cbrBytesPerUnit = 0,
): Buffer {
  const index = Buffer.concat(indexSegments(id, d, sizes, duration, cbrBytesPerUnit + 20));
  const footer = partitionPack(UL.partitionFooter, d, {
    thisPartition: footerOffset,
    previous: HEADER_REGION,
    footer: footerOffset,
    headerByteCount: 0,
    indexByteCount: index.length,
    indexSid: INDEX_SID,
    bodySid: 0,
  });
  const ripBody = Buffer.concat([u32(0), u64(0), u32(BODY_SID), u64(HEADER_REGION), u32(0), u64(footerOffset)]);
  const ripLen = 16 + 4 + ripBody.length + 4;
  const rip = klv(UL.rip, Buffer.concat([ripBody, u32(ripLen)]));
  return Buffer.concat([footer, index, rip]);
}
