import { createAlphaMaskedPlaneMesh, type PackedTriangleMesh, type PackedTextureAtlas } from '@mesh-to-copycats/mesh';

export async function importImageAsPlane(file: File, alphaThreshold = 1): Promise<PackedTriangleMesh> {
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
    const atlas: PackedTextureAtlas = {
      heights: Uint16Array.of(bitmap.height),
      offsets: Uint32Array.of(0, pixels.length),
      rgbaSrgb: Uint8Array.from(pixels),
      widths: Uint16Array.of(bitmap.width),
      wrapS: Uint32Array.of(33071),
      wrapT: Uint32Array.of(33071),
    };
    const maximumExtent = 4;
    const landscape = bitmap.width >= bitmap.height;
    return createAlphaMaskedPlaneMesh({
      alphaThreshold,
      height: landscape ? maximumExtent * bitmap.height / bitmap.width : maximumExtent,
      textureAtlas: atlas,
      width: landscape ? maximumExtent : maximumExtent * bitmap.width / bitmap.height,
    });
  } finally {
    bitmap.close();
  }
}
