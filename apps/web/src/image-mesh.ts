import { createAlphaMaskedPlaneMesh, type PackedTriangleMesh, type PackedTextureAtlas } from '@mesh-to-copycats/mesh';

export async function decodeBrowserImageTexture(file: File): Promise<PackedTextureAtlas> {
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 0xffff || bitmap.height > 0xffff) {
      throw new RangeError('Image dimensions must be in 1..65535 pixels');
    }
    if (bitmap.width * bitmap.height > 16_777_216) {
      throw new RangeError('Image import is limited to 16777216 pixels');
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('2D canvas is unavailable');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    return {
      heights: Uint16Array.of(bitmap.height),
      offsets: Uint32Array.of(0, pixels.length),
      rgbaSrgb: Uint8Array.from(pixels),
      widths: Uint16Array.of(bitmap.width),
      wrapS: Uint32Array.of(33071),
      wrapT: Uint32Array.of(33071),
    };
  } finally {
    bitmap.close();
  }
}

export async function importImageAsPlane(file: File, alphaThreshold = 1): Promise<PackedTriangleMesh> {
  const atlas = await decodeBrowserImageTexture(file);
  const width = atlas.widths[0] ?? 1;
  const height = atlas.heights[0] ?? 1;
  const maximumExtent = 4;
  const landscape = width >= height;
  return createAlphaMaskedPlaneMesh({
    alphaThreshold,
    // Keep the plane inside one block-depth rather than exactly on a cell boundary.
    // Geometry fitting preserves this thin surface instead of inflating it to Byte octants.
    depth: 0.25,
    height: landscape ? maximumExtent * height / width : maximumExtent,
    textureAtlas: atlas,
    width: landscape ? maximumExtent : maximumExtent * width / height,
  });
}
