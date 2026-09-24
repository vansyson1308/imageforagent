/** Serializers dùng chung cho API response — thêm imageUrl tính từ imagePath. */

interface FrameLike {
  readonly id: string;
  readonly imagePath: string | null;
  readonly generatedAt: Date | null;
  readonly clipPath?: string | null;
  readonly voicePath?: string | null;
}

export function frameImageUrl(frame: FrameLike): string | null {
  if (!frame.imagePath) return null;
  const version = frame.generatedAt ? frame.generatedAt.getTime() : 0;
  return `/api/files/${frame.imagePath}?v=${version}`;
}

/** Animated WebP của shot motion (null với frame tĩnh). */
export function frameClipUrl(frame: FrameLike): string | null {
  if (!frame.clipPath) return null;
  const version = frame.generatedAt ? frame.generatedAt.getTime() : 0;
  return `/api/files/${frame.clipPath}?v=${version}`;
}

export function withImageUrl<T extends FrameLike>(
  frame: T,
): T & { imageUrl: string | null; clipUrl: string | null; voiceUrl: string | null } {
  return {
    ...frame,
    imageUrl: frameImageUrl(frame),
    clipUrl: frameClipUrl(frame),
    voiceUrl: frame.voicePath ? `/api/files/${frame.voicePath}` : null,
  };
}

interface AssetLike {
  readonly filePath: string;
}

export function withAssetUrl<T extends AssetLike>(asset: T): T & { url: string } {
  return { ...asset, url: `/api/files/${asset.filePath}` };
}
