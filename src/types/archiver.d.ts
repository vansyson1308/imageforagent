/**
 * Type declaration tối thiểu cho archiver v8 (package chưa ship types).
 * Chỉ khai báo phần API mà app dùng.
 */
declare module "archiver" {
  import { Transform } from "node:stream";

  interface ZipArchiveOptions {
    zlib?: { level?: number };
    forceLocalTime?: boolean;
    comment?: string;
  }

  interface EntryData {
    name: string;
    prefix?: string;
    date?: Date;
  }

  export class ZipArchive extends Transform {
    constructor(options?: ZipArchiveOptions);
    append(source: string | Buffer | NodeJS.ReadableStream, data: EntryData): this;
    file(filepath: string, data: EntryData): this;
    directory(dirpath: string, destpath: string | false): this;
    finalize(): Promise<void>;
    pointer(): number;
  }

  export class TarArchive extends Transform {
    constructor(options?: Record<string, unknown>);
  }
}
