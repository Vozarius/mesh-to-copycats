/// <reference lib="dom" />

import {
  appendTextureAtlas,
  createAlphaMaskedPlaneMesh,
  type PackedTriangleMesh,
  type PackedTextureAtlas,
} from '@mesh-to-copycats/mesh';

async function decodeBrowserImageBlob(blob: Blob): Promise<PackedTextureAtlas> {
  const bitmap = await createImageBitmap(blob);
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

export function decodeBrowserImageTexture(file: File): Promise<PackedTextureAtlas> {
  return decodeBrowserImageBlob(file);
}

/** Decodes browser-supported embedded images, including JPEG and WebP textures. */
export async function decodeEmbeddedMeshTexturesBrowser(
  mesh: PackedTriangleMesh,
): Promise<PackedTriangleMesh> {
  if (mesh.embeddedTextures === undefined || mesh.embeddedTextures.length === 0) return mesh;
  let textureAtlas: PackedTextureAtlas | undefined;
  for (const texture of mesh.embeddedTextures) {
    const encoded = texture.bytes.slice().buffer;
    const decoded = await decodeBrowserImageBlob(new Blob([encoded], { type: texture.mimeType }));
    const wrapped: PackedTextureAtlas = {
      ...decoded,
      wrapS: Uint32Array.of(texture.wrapS),
      wrapT: Uint32Array.of(texture.wrapT),
    };
    textureAtlas = textureAtlas === undefined
      ? wrapped
      : appendTextureAtlas(textureAtlas, wrapped);
  }
  if (textureAtlas === undefined) return mesh;
  // The decoded atlas replaces the compressed GLB payload. Keeping both can
  // temporarily double texture memory when a second model is imported.
  const { embeddedTextures, ...decodedMesh } = mesh;
  void embeddedTextures;
  return { ...decodedMesh, textureAtlas };
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
