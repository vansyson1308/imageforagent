import { open, type FileHandle } from "node:fs/promises";
import {
  buildBodyPartition,
  buildFooter,
  buildHeader,
  essenceKlvHeader,
  ESSENCE_START,
  HEADER_REGION,
  type MxfDescriptor,
  type MxfIdentity,
} from "@/lib/services/dcp/mxf";

/**
 * MxfFileWriter — rìa I/O của writer MXF: ghi STREAMING (không giữ essence
 * trong RAM — phim dài vẫn chạy): giữ chỗ 16384 byte header, ghi body
 * partition + từng edit unit, khi close() ghi footer rồi quay lại ghi header
 * (cần footer offset + duration).
 */
export class MxfFileWriter {
  private fh: FileHandle | null = null;
  private pos = ESSENCE_START;
  private readonly sizes: number[] = [];

  private constructor(
    private readonly path: string,
    private readonly id: MxfIdentity,
    private readonly d: MxfDescriptor,
  ) {}

  static async create(path: string, id: MxfIdentity, d: MxfDescriptor): Promise<MxfFileWriter> {
    const w = new MxfFileWriter(path, id, d);
    w.fh = await open(path, "w");
    await w.fh.write(Buffer.alloc(HEADER_REGION), 0, HEADER_REGION, 0);
    const body = buildBodyPartition(d);
    await w.fh.write(body, 0, body.length, HEADER_REGION);
    return w;
  }

  get frames(): number {
    return this.sizes.length;
  }

  async writeUnit(data: Buffer): Promise<void> {
    const head = essenceKlvHeader(this.d, data.length);
    await this.fh!.write(head, 0, head.length, this.pos);
    await this.fh!.write(data, 0, data.length, this.pos + head.length);
    this.pos += head.length + data.length;
    this.sizes.push(data.length);
  }

  /** Đóng file; trả tổng byte. CBR (sound): mọi unit phải cùng kích thước. */
  async close(): Promise<number> {
    const duration = this.sizes.length;
    const footerOffset = this.pos;
    const cbr = this.d.kind === "sound";
    if (cbr && new Set(this.sizes).size > 1) throw new Error("Sound edit units must all have the same size (CBR).");
    const footer = buildFooter(this.id, this.d, footerOffset, duration, cbr ? null : this.sizes, cbr ? (this.sizes[0] ?? 0) : 0);
    await this.fh!.write(footer, 0, footer.length, footerOffset);
    const header = buildHeader(this.id, this.d, duration, footerOffset);
    await this.fh!.write(header, 0, header.length, 0);
    await this.fh!.close();
    this.fh = null;
    return footerOffset + footer.length;
  }
}
