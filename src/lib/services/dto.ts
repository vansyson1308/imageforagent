/** Serializers dùng chung cho API response — thêm imageUrl tính từ imagePath. */

interface FrameLike {
  readonly id: string;
  readonly imagePath: string | null;
  readonly generatedAt: Date | null;
}

export function frameImageUrl(frame: FrameLike): string | null {
  if (!frame.imagePath) return null;
  const version = frame.generatedAt ? frame.generatedAt.getTime() : 0;
  return `/api/files/${frame.imagePath}?v=${version}`;
}

export function withImageUrl<T extends FrameLike>(frame: T): T & { imageUrl: string | null } {
  return { ...frame, imageUrl: frameImageUrl(frame) };
}

interface AssetLike {
  readonly filePath: string;
}

export function withAssetUrl<T extends AssetLike>(asset: T): T & { url: string } {
  return { ...asset, url: `/api/files/${asset.filePath}` };
}
