/**
 * master-dcp — đóng gói gói export Storyboard Studio thành DCP SMPTE chiếu
 * rạp (không mã hoá): JPEG 2000 X′Y′Z′ 12-bit + PCM 24-bit 48 kHz 5.1 trong
 * MXF SMPTE, CPL/PKL/ASSETMAP/VOLINDEX.
 *
 *   npx tsx scripts/master-dcp.ts <thư-mục-export-đã-giải-nén> [--out DCP]
 *       [--title "Tên phim"] [--kind short|feature|trailer|test]
 *       [--container flat|scope] [--4k] [--mbps 80] [--jobs N] [--issuer "…"]
 *       [--lang EN-XX] [--territory US-PG13] [--studio ABC] [--facility XYZ]
 *       [--date 2026-09-24T00:00:00Z] [--cinema-lufs -24 | --cinema-lufs off]
 *
 * Âm thanh: mix export (chuẩn web −16 LUFS) được đo lại bằng ffmpeg ebur128
 * (stream, O(1) bộ nhớ) rồi chỉnh gain tĩnh về mức rạp (mặc định −24 LUFS
 * tích phân, trần true-peak −1 dBTP). Rạp hiệu chuẩn loa ở 85 dBC/kênh —
 * mix web phát nguyên sẽ quá to. Đây là điểm khởi đầu, không thay phòng dub.
 *
 * UUID của mọi tài sản suy ra tất định từ (project, tiêu đề, container, độ
 * phân giải, ngày phát hành): cùng --date → DCP byte-giống-hệt; master lại
 * ngày khác → UUID mới (máy chủ rạp không nhầm là tài sản đã ingest).
 *
 * Cần: ffmpeg (dựng khung + chuyển cảnh) và opj_compress (OpenJPEG ≥ 2.3,
 * `apt install libopenjp2-tools`). Mọi thứ còn lại (XYZ, MXF, XML, SHA-1)
 * là TypeScript thuần trong src/lib/services/dcp/. Kiểm chứng DCP bằng
 * ClairMeta (`python -m clairmeta.cli check -type dcp DCP/`) hoặc DCP-o-matic.
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { MxfFileWriter } from "@/lib/services/dcp/mxfWriter";
import { parseJ2kHeader } from "@/lib/services/dcp/mxf";
import { rgb24ToXyzPpm } from "@/lib/services/dcp/color";
import { buildPictureArgs, containerSize, j2kEncodeArgs, setDciProfile, type DcpShot, type DciContainer } from "@/lib/services/dcp/picture";
import { buildAssetMap, buildCpl, buildPkl, dcncName, VOLINDEX, type PackagedFile } from "@/lib/services/dcp/packaging";
import { uuidBytes } from "@/lib/services/dcp/uuid";

interface Args {
  src: string;
  out: string;
  title?: string;
  kind: "short" | "feature" | "trailer" | "test";
  container?: DciContainer;
  is4K: boolean;
  jobs: number;
  issuer: string;
  language?: string;
  territory?: string;
  studio?: string;
  facility?: string;
  date?: Date;
  cinemaLufs: number | null;
  mbps?: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { src: "", out: "DCP", kind: "short", is4K: false, jobs: Math.max(1, cpus().length), issuer: "Storyboard Studio", cinemaLufs: -24 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--out") a.out = v();
    else if (k === "--title") a.title = v();
    else if (k === "--kind") a.kind = v() as Args["kind"];
    else if (k === "--container") a.container = v() as DciContainer;
    else if (k === "--4k") a.is4K = true;
    else if (k === "--mbps") a.mbps = Number(v());
    else if (k === "--jobs") a.jobs = Math.max(1, Number(v()));
    else if (k === "--issuer") a.issuer = v();
    else if (k === "--lang") a.language = v();
    else if (k === "--territory") a.territory = v();
    else if (k === "--studio") a.studio = v();
    else if (k === "--facility") a.facility = v();
    else if (k === "--cinema-lufs") {
      const x = v();
      a.cinemaLufs = x === "off" ? null : Number(x);
      if (a.cinemaLufs !== null && !(a.cinemaLufs >= -40 && a.cinemaLufs <= -10)) throw new Error("--cinema-lufs must be in [-40, -10] or 'off'");
    } else if (k === "--date") {
      const d = new Date(v());
      if (Number.isNaN(d.getTime())) throw new Error("--date must be an ISO 8601 timestamp");
      a.date = d;
    }
    else if (!a.src) a.src = k;
  }
  if (!a.src) throw new Error("usage: master-dcp <export-dir> [--out DCP] [--title …] [--container flat|scope] [--4k]");
  return a;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (c: Buffer) => (err += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`))));
  });
}

/** Đo loudness tích phân + true peak bằng ffmpeg ebur128 (stream). */
function measureWithFfmpeg(file: string): Promise<{ lufs: number; truePeak: number }> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    p.stderr.on("data", (c: Buffer) => (err += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      const summary = err.slice(err.lastIndexOf("Summary:"));
      const lufs = Number(/I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary)?.[1]);
      const tp = Number(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1]);
      if (code !== 0) reject(new Error(`ffmpeg (ebur128) exited ${code}`));
      else resolve({ lufs: Number.isFinite(lufs) ? lufs : -70, truePeak: Number.isFinite(tp) ? tp : -70 });
    });
  });
}

async function sha1File(file: string): Promise<string> {
  const h = createHash("sha1");
  await new Promise<void>((resolve, reject) => {
    createReadStream(file).on("data", (c) => h.update(c)).on("end", resolve).on("error", reject);
  });
  return h.digest("base64");
}

interface StoryboardJson {
  project: { id: string; name: string; aspectRatio: string; resolution?: string };
  frames: {
    index: number;
    file: string | null;
    startSec: number | null;
    durationSec: number | null;
    transitionIn?: { kind: string; duration: number } | null;
    motion: { fps: number; frames: string } | null;
  }[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const src = path.resolve(args.src);
  const sb = JSON.parse(readFileSync(path.join(src, "storyboard.json"), "utf8")) as StoryboardJson;
  const title = args.title ?? sb.project.name;
  const container: DciContainer = args.container ?? (sb.project.aspectRatio === "2.39:1" ? "scope" : "flat");
  const size = containerSize(container, args.is4K);
  const date = new Date(Math.floor((args.date ?? new Date()).getTime() / 1000) * 1000);
  const seed = `${sb.project.id}|${title}|${container}|${args.is4K ? "4K" : "2K"}|${date.toISOString()}`;
  const contentTitle = dcncName({
    title,
    kind: args.kind,
    aspect: container === "flat" ? "F" : "S",
    language: args.language,
    territory: args.territory,
    is4K: args.is4K,
    studio: args.studio,
    date,
    facility: args.facility,
  });
  const baseName = contentTitle.replace(/_SMPTE_OV$/, "");
  const U = (label: string) => uuidBytes(seed, label);

  const shots: DcpShot[] = sb.frames
    .filter((f) => f.file && f.startSec !== null && f.durationSec !== null)
    .sort((a, b) => a.index - b.index)
    .map((f) => ({
      index: f.index,
      startSec: f.startSec!,
      durationSec: f.durationSec!,
      transitionIn: f.transitionIn ?? null,
      ...(f.motion
        ? { clip: { pattern: path.join(src, f.motion.frames), fps: f.motion.fps } }
        : { still: path.join(src, f.file!) }),
    }));
  if (shots.length === 0) throw new Error("storyboard.json has no exported frames.");
  const { args: ffArgs, frames } = buildPictureArgs(shots, size);
  const outDir = path.resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const work = path.join(tmpdir(), `dcp-${process.pid}`);
  mkdirSync(work, { recursive: true });
  console.log(`▶ ${title}: ${frames} frames @24 fps, container ${container} ${size.w}×${size.h}, ${args.jobs} J2K workers`);
  const native = (container === "flat" ? "1.85:1" : "2.39:1") === sb.project.aspectRatio;
  const nativeRes = args.is4K ? sb.project.resolution === "4K" : sb.project.resolution === "2K" || sb.project.resolution === "4K";
  if (!native || !nativeRes) {
    console.warn(
      `  ⚠ source is ${sb.project.aspectRatio} @ ${sb.project.resolution ?? "?"} — it will be ${native ? "rescaled" : "letterboxed/pillarboxed"} into the DCI container.` +
        ` For a pixel-exact master, author the project at ${container === "flat" ? "1.85:1" : "2.39:1"} / ${args.is4K ? "4K" : "2K"}.`,
    );
  }

  // ---------- Picture: ffmpeg rgb24 → X′Y′Z′ → J2K (pool) → MXF (thứ tự) ----------
  const picFile = `${baseName}_pic.mxf`;
  const identity = (kind: string) => ({
    assetUuid: U(`${kind}.asset`),
    uuid: (l: string) => U(`${kind}.${l}`),
    date,
    companyName: "Storyboard Studio",
    productName: "master-dcp",
    versionString: "1.0.0",
  });
  const frameBytes = size.w * size.h * 3;
  const encode = async (i: number, rgb: Buffer): Promise<Buffer> => {
    const ppm = path.join(work, `f${i}.ppm`);
    const j2c = path.join(work, `f${i}.j2c`);
    await writeFile(ppm, rgb24ToXyzPpm(rgb, size.w, size.h));
    await run("opj_compress", j2kEncodeArgs(ppm, j2c, { is4K: args.is4K, mbps: args.mbps, w: size.w, h: size.h }));
    const cs = await readFile(j2c);
    if (args.mbps !== undefined) setDciProfile(cs, args.is4K);
    await rm(ppm, { force: true });
    await rm(j2c, { force: true });
    return cs;
  };
  let writer: MxfFileWriter | null = null;
  const pending = new Map<number, Promise<Buffer>>();
  let nextWrite = 0;
  let received = 0;
  let frameBuf = Buffer.alloc(frameBytes);
  let filled = 0;
  const t0 = Date.now();
  const drain = async (all: boolean) => {
    while (pending.has(nextWrite) && (all || pending.size >= args.jobs)) {
      const cs = await pending.get(nextWrite)!;
      pending.delete(nextWrite);
      if (!writer) {
        writer = await MxfFileWriter.create(path.join(outDir, picFile), identity("picture"), {
          kind: "picture",
          editRate: 24,
          j2k: parseJ2kHeader(cs),
          is4K: args.is4K,
        });
      }
      await writer.writeUnit(cs);
      nextWrite++;
      if (nextWrite % 24 === 0 || nextWrite === frames) {
        process.stdout.write(`\r  picture ${nextWrite}/${frames} (${((nextWrite / ((Date.now() - t0) / 1000)) || 0).toFixed(1)} fps)`);
      }
    }
  };
  await new Promise<void>((resolve, reject) => {
    const ff = spawn("ffmpeg", ffArgs, { cwd: src, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    ff.stderr.on("data", (c: Buffer) => (err += c.toString()));
    ff.on("error", reject);
    ff.stdout.on("data", (chunk: Buffer) => {
      let off = 0;
      while (off < chunk.length) {
        const n = Math.min(frameBytes - filled, chunk.length - off);
        chunk.copy(frameBuf, filled, off, off + n);
        filled += n;
        off += n;
        if (filled === frameBytes) {
          pending.set(received, encode(received, frameBuf));
          received++;
          frameBuf = Buffer.alloc(frameBytes);
          filled = 0;
        }
      }
      if (pending.size >= args.jobs * 2) {
        ff.stdout.pause();
        void drain(false).then(() => ff.stdout.resume(), reject);
      }
    });
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-600)}`))));
  });
  await drain(true);
  if (!writer || nextWrite !== frames) throw new Error(`picture: got ${nextWrite} of ${frames} frames`);
  await (writer as MxfFileWriter).close();
  process.stdout.write("\n");

  // ---------- Sound: mix stereo → 5.1 PCM 24-bit 48 kHz (L/R), 2000 mẫu/frame ----------
  // ffmpeg stream thẳng s24le 6 kênh (resample + pan + pad/cắt đúng độ dài
  // hình) — bộ nhớ O(1) theo độ dài phim, phim 2 giờ cũng không nạp cả mix.
  const sndFile = `${baseName}_snd.mxf`;
  const unitBytes = (48000 / 24) * 6 * 3;
  const mixPath = path.join(src, "audio/mix.wav");
  const hasMix = existsSync(mixPath);
  const snd = await MxfFileWriter.create(path.join(outDir, sndFile), identity("sound"), {
    kind: "sound",
    editRate: 24,
    sampleRate: 48000,
    channels: 6,
    bits: 24,
  });
  const silent = Buffer.alloc(unitBytes);
  let units = 0;
  let gainDb = 0;
  let loudNote = "";
  if (hasMix && args.cinemaLufs !== null) {
    const m = await measureWithFfmpeg(mixPath);
    if (m.lufs > -70) {
      gainDb = Math.min(args.cinemaLufs - m.lufs, -1 - m.truePeak);
      loudNote = `, ${m.lufs.toFixed(1)} → ${(m.lufs + gainDb).toFixed(1)} LUFS (gain ${gainDb.toFixed(2)} dB)`;
    }
  }
  if (hasMix) {
    const ffa = spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", mixPath, "-af", `aresample=48000,volume=${gainDb.toFixed(3)}dB,pan=5.1|FL=c0|FR=c1,apad`,
        "-t", String(frames / 24), "-f", "s24le", "-acodec", "pcm_s24le", "pipe:1"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let err = "";
    ffa.stderr.on("data", (c: Buffer) => (err += c.toString()));
    const done = new Promise<void>((resolve, reject) => {
      ffa.on("error", reject);
      ffa.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg (audio) exited ${code}: ${err.slice(-400)}`))));
    });
    let unit = Buffer.alloc(unitBytes);
    let filledA = 0;
    for await (const chunk of ffa.stdout as AsyncIterable<Buffer>) {
      let off = 0;
      while (off < chunk.length && units < frames) {
        const n = Math.min(unitBytes - filledA, chunk.length - off);
        chunk.copy(unit, filledA, off, off + n);
        filledA += n;
        off += n;
        if (filledA === unitBytes) {
          await snd.writeUnit(unit);
          units++;
          unit = Buffer.alloc(unitBytes);
          filledA = 0;
        }
      }
    }
    await done;
    if (filledA > 0 && units < frames) {
      await snd.writeUnit(unit);
      units++;
    }
  }
  while (units < frames) {
    await snd.writeUnit(silent);
    units++;
  }
  await snd.close();
  console.log(`  sound ${frames} frames (${hasMix ? `stereo mix → L/R of 5.1${loudNote}` : "silence — no audio/mix.wav"})`);

  // ---------- CPL / PKL / ASSETMAP / VOLINDEX ----------
  const picPath = path.join(outDir, picFile);
  const sndPath = path.join(outDir, sndFile);
  const [picHash, sndHash] = await Promise.all([sha1File(picPath), sha1File(sndPath)]);
  const cplId = U("cpl");
  const cpl = buildCpl({
    id: cplId,
    title: contentTitle,
    contentTitle,
    kind: args.kind,
    issuer: args.issuer,
    creator: "Storyboard Studio master-dcp 1.0",
    date,
    editRate: 24,
    versionId: U("contentVersion"),
    reels: [
      {
        reelId: U("reel.1"),
        picture: { id: U("picture.asset"), duration: frames, hash: picHash, width: size.w, height: size.h },
        sound: { id: U("sound.asset"), duration: frames, hash: sndHash },
      },
    ],
  });
  const cplFile = `CPL_${contentTitle}.xml`;
  writeFileSync(path.join(outDir, cplFile), cpl);
  const cplBuf = readFileSync(path.join(outDir, cplFile));
  const assets: PackagedFile[] = [
    { id: cplId, file: cplFile, size: cplBuf.length, hash: createHash("sha1").update(cplBuf).digest("base64"), type: "text/xml", annotation: contentTitle },
    { id: U("picture.asset"), file: picFile, size: statSync(picPath).size, hash: picHash, type: "application/mxf", annotation: `${contentTitle} picture` },
    { id: U("sound.asset"), file: sndFile, size: statSync(sndPath).size, hash: sndHash, type: "application/mxf", annotation: `${contentTitle} sound` },
  ];
  const pklId = U("pkl");
  const pkl = buildPkl({ id: pklId, title: contentTitle, issuer: args.issuer, creator: "Storyboard Studio master-dcp 1.0", date, assets });
  const pklFile = `PKL_${contentTitle}.xml`;
  writeFileSync(path.join(outDir, pklFile), pkl);
  writeFileSync(
    path.join(outDir, "ASSETMAP.xml"),
    buildAssetMap({
      id: U("assetmap"),
      title: contentTitle,
      issuer: args.issuer,
      creator: "Storyboard Studio master-dcp 1.0",
      date,
      pkl: { id: pklId, file: pklFile, size: Buffer.byteLength(pkl) },
      assets: assets.map((a) => ({ id: a.id, file: a.file, size: a.size })),
    }),
  );
  writeFileSync(path.join(outDir, "VOLINDEX.xml"), VOLINDEX);
  await rm(work, { recursive: true, force: true });
  console.log(`✓ DCP ready: ${outDir}\n  ${contentTitle} — ${frames} frames (${(frames / 24).toFixed(2)} s)`);
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
