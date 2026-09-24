import { createHash } from "node:crypto";
import { urnUuid } from "@/lib/services/dcp/uuid";

/**
 * packaging — XML đóng gói DCP SMPTE: CPL (ST 429-7), PKL (ST 429-8),
 * ASSETMAP + VOLINDEX (ST 429-9). Pure. Không mã hoá (không KDM) — định
 * dạng chuẩn cho festival / phát hành độc lập; CPL không ký (hợp lệ khi
 * không mã hoá).
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const sha1Base64 = (data: Buffer) => createHash("sha1").update(data).digest("base64");

/** ISO 8601 có offset, không mili giây (định dạng DCP phổ biến). */
export const dcpDate = (d: Date) => `${d.toISOString().slice(0, 19)}+00:00`;

export interface ReelAssets {
  readonly reelId: Buffer;
  readonly picture: { readonly id: Buffer; readonly duration: number; readonly hash: string; readonly width: number; readonly height: number };
  readonly sound?: { readonly id: Buffer; readonly duration: number; readonly hash: string };
}

export interface CplParams {
  readonly id: Buffer;
  readonly title: string;
  /** Tên chuẩn DCNC, vd "MyFilm_SHR_F_EN-XX_51_2K_20260924_SMPTE_OV". */
  readonly contentTitle: string;
  readonly kind: "feature" | "short" | "trailer" | "test" | "teaser" | "advertisement";
  readonly issuer: string;
  readonly creator: string;
  readonly date: Date;
  readonly editRate: number;
  readonly reels: readonly ReelAssets[];
  readonly versionId: Buffer;
}

export function buildCpl(p: CplParams): string {
  const reels = p.reels
    .map((r) => {
      const pic = `      <MainPicture>
        <Id>${urnUuid(r.picture.id)}</Id>
        <EditRate>${p.editRate} 1</EditRate>
        <IntrinsicDuration>${r.picture.duration}</IntrinsicDuration>
        <EntryPoint>0</EntryPoint>
        <Duration>${r.picture.duration}</Duration>
        <Hash>${r.picture.hash}</Hash>
        <FrameRate>${p.editRate} 1</FrameRate>
        <ScreenAspectRatio>${r.picture.width} ${r.picture.height}</ScreenAspectRatio>
      </MainPicture>`;
      const snd = r.sound
        ? `
      <MainSound>
        <Id>${urnUuid(r.sound.id)}</Id>
        <EditRate>${p.editRate} 1</EditRate>
        <IntrinsicDuration>${r.sound.duration}</IntrinsicDuration>
        <EntryPoint>0</EntryPoint>
        <Duration>${r.sound.duration}</Duration>
        <Hash>${r.sound.hash}</Hash>
      </MainSound>`
        : "";
      return `    <Reel>
      <Id>${urnUuid(r.reelId)}</Id>
      <AssetList>
${pic}${snd}
      </AssetList>
    </Reel>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<CompositionPlaylist xmlns="http://www.smpte-ra.org/schemas/429-7/2006/CPL">
  <Id>${urnUuid(p.id)}</Id>
  <AnnotationText>${esc(p.title)}</AnnotationText>
  <IssueDate>${dcpDate(p.date)}</IssueDate>
  <Issuer>${esc(p.issuer)}</Issuer>
  <Creator>${esc(p.creator)}</Creator>
  <ContentTitleText>${esc(p.contentTitle)}</ContentTitleText>
  <ContentKind>${p.kind}</ContentKind>
  <ContentVersion>
    <Id>${urnUuid(p.versionId)}_${dcpDate(p.date).slice(0, 10)}</Id>
    <LabelText>${esc(p.contentTitle)}</LabelText>
  </ContentVersion>
  <RatingList/>
  <ReelList>
${reels}
  </ReelList>
</CompositionPlaylist>
`;
}

export interface PackagedFile {
  readonly id: Buffer;
  readonly file: string;
  readonly size: number;
  readonly hash: string;
  readonly type: "application/mxf" | "text/xml";
  readonly annotation: string;
}

export function buildPkl(p: { id: Buffer; title: string; issuer: string; creator: string; date: Date; assets: readonly PackagedFile[] }): string {
  const assets = p.assets
    .map(
      (a) => `    <Asset>
      <Id>${urnUuid(a.id)}</Id>
      <AnnotationText>${esc(a.annotation)}</AnnotationText>
      <Hash>${a.hash}</Hash>
      <Size>${a.size}</Size>
      <Type>${a.type}</Type>
      <OriginalFileName>${esc(a.file)}</OriginalFileName>
    </Asset>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<PackingList xmlns="http://www.smpte-ra.org/schemas/429-8/2007/PKL">
  <Id>${urnUuid(p.id)}</Id>
  <AnnotationText>${esc(p.title)}</AnnotationText>
  <IssueDate>${dcpDate(p.date)}</IssueDate>
  <Issuer>${esc(p.issuer)}</Issuer>
  <Creator>${esc(p.creator)}</Creator>
  <AssetList>
${assets}
  </AssetList>
</PackingList>
`;
}

export function buildAssetMap(p: {
  id: Buffer;
  title: string;
  issuer: string;
  creator: string;
  date: Date;
  pkl: { id: Buffer; file: string; size: number };
  assets: readonly { id: Buffer; file: string; size: number }[];
}): string {
  const entry = (a: { id: Buffer; file: string; size: number }, isPkl: boolean) => `    <Asset>
      <Id>${urnUuid(a.id)}</Id>${isPkl ? "\n      <PackingList>true</PackingList>" : ""}
      <ChunkList>
        <Chunk>
          <Path>${esc(a.file)}</Path>
          <VolumeIndex>1</VolumeIndex>
          <Offset>0</Offset>
          <Length>${a.size}</Length>
        </Chunk>
      </ChunkList>
    </Asset>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<AssetMap xmlns="http://www.smpte-ra.org/schemas/429-9/2007/AM">
  <Id>${urnUuid(p.id)}</Id>
  <AnnotationText>${esc(p.title)}</AnnotationText>
  <Creator>${esc(p.creator)}</Creator>
  <VolumeCount>1</VolumeCount>
  <IssueDate>${dcpDate(p.date)}</IssueDate>
  <Issuer>${esc(p.issuer)}</Issuer>
  <AssetList>
${[entry(p.pkl, true), ...p.assets.map((a) => entry(a, false))].join("\n")}
  </AssetList>
</AssetMap>
`;
}

export const VOLINDEX = `<?xml version="1.0" encoding="UTF-8"?>
<VolumeIndex xmlns="http://www.smpte-ra.org/schemas/429-9/2007/AM">
  <Index>1</Index>
</VolumeIndex>
`;

export interface DcncFields {
  readonly title: string;
  readonly kind: CplParams["kind"];
  /** F = Flat 1.85, S = Scope 2.39. */
  readonly aspect: "F" | "S";
  /** Ngôn ngữ thoại – phụ đề, vd "EN-XX" (XX = không có). */
  readonly language?: string;
  /** Lãnh thổ – phân loại, vd "US-PG13"; mặc định "INT" (quốc tế). */
  readonly territory?: string;
  readonly audio?: "10" | "20" | "51" | "71";
  readonly is4K: boolean;
  /** Mã studio 2–4 ký tự. */
  readonly studio?: string;
  readonly date: Date;
  /** Mã cơ sở mastering 2–3 ký tự. */
  readonly facility?: string;
}

const code = (s: string | undefined, fallback: string, re: RegExp) => {
  const v = (s ?? "").toUpperCase();
  return re.test(v) ? v : fallback;
};

/**
 * Tên CPL theo ISDCF Digital Cinema Naming Convention 9.6, đủ 12 trường:
 * FilmTitle_ContentType_Aspect_Language_TerritoryRating_Audio_Resolution_
 * Studio_Date_Facility_Standard_PackageType. Trường không hợp lệ rơi về mặc
 * định an toàn thay vì sinh tên sai chuẩn.
 */
export function dcncName(f: DcncFields): string {
  const t =
    f.title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .replace(/[^A-Za-z0-9]+/g, "")
      .slice(0, 14) || "Untitled";
  const k = { feature: "FTR", short: "SHR", trailer: "TLR", test: "TST", teaser: "TSR", advertisement: "ADV" }[f.kind];
  const d = f.date.toISOString().slice(0, 10).replace(/-/g, "");
  return [
    t,
    k,
    f.aspect,
    code(f.language, "XX-XX", /^[A-Z]{2,3}-[A-Z]{2,3}$/),
    code(f.territory, "INT", /^[A-Z]{2,3}(-[A-Z0-9+]{1,3})?$/),
    f.audio ?? "51",
    f.is4K ? "4K" : "2K",
    code(f.studio, "SBS", /^[A-Z0-9]{2,4}$/),
    d,
    code(f.facility, "SBS", /^[A-Z0-9]{2,3}$/),
    "SMPTE",
    "OV",
  ].join("_");
}
