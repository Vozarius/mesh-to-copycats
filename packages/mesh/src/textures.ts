import { unzlibSync } from 'fflate';

import type {
  EmbeddedMeshTexture,
  PackedTextureAtlas,
  PackedTriangleMesh,
  TextureWrapMode,
} from './types.js';

interface DecodedImage {
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly width: number;
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw new Error('PNG chunk is truncated');
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const cornerDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= cornerDistance
    ? left
    : aboveDistance <= cornerDistance ? above : upperLeft;
}

export function decodePng(bytes: Uint8Array): DecodedImage {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((value, index) => bytes[index] !== value)) throw new Error('Texture is not a PNG image');
  let cursor = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const compressed: Uint8Array[] = [];
  while (cursor < bytes.length) {
    const length = readU32(bytes, cursor);
    const type = new TextDecoder().decode(bytes.subarray(cursor + 4, cursor + 8));
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error(`PNG ${type} chunk is truncated`);
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('PNG IHDR length is invalid');
      width = readU32(bytes, dataStart);
      height = readU32(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8] ?? 0;
      colorType = bytes[dataStart + 9] ?? -1;
      const supportedDepth = colorType === 3 || colorType === 0
        ? [1, 2, 4, 8].includes(bitDepth)
        : bitDepth === 8;
      if (!supportedDepth || ![0, 2, 3, 4, 6].includes(colorType)) {
        throw new Error(`PNG bit depth ${bitDepth} / color type ${colorType} is unsupported`);
      }
      if ((bytes[dataStart + 10] ?? -1) !== 0 || (bytes[dataStart + 11] ?? -1) !== 0) {
        throw new Error('PNG compression or filter method is unsupported');
      }
      if ((bytes[dataStart + 12] ?? -1) !== 0) throw new Error('Interlaced PNG textures are unsupported');
    } else if (type === 'PLTE') {
      if (length === 0 || length % 3 !== 0 || length > 768) throw new Error('PNG PLTE chunk is invalid');
      palette = bytes.slice(dataStart, dataEnd);
    } else if (type === 'tRNS') {
      transparency = bytes.slice(dataStart, dataEnd);
    } else if (type === 'IDAT') {
      compressed.push(bytes.slice(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    cursor = dataEnd + 4;
  }
  if (width < 1 || height < 1 || width > 0xffff || height > 0xffff) {
    throw new RangeError('PNG dimensions must be in 1..65535');
  }
  if (compressed.length === 0) throw new Error('PNG contains no IDAT data');
  if (colorType === 3 && palette === undefined) throw new Error('Indexed PNG contains no PLTE chunk');
  const packed = new Uint8Array(compressed.reduce((sum, chunk) => sum + chunk.length, 0));
  let packedOffset = 0;
  for (const chunk of compressed) {
    packed.set(chunk, packedOffset);
    packedOffset += chunk.length;
  }
  const channels = colorType === 0 || colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const bitsPerPixel = channels * bitDepth;
  const stride = Math.ceil(width * bitsPerPixel / 8);
  const filterBytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const inflated = unzlibSync(packed);
  if (inflated.length !== height * (stride + 1)) throw new Error('PNG scanline payload length is invalid');
  const scanlines = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * (stride + 1)] ?? -1;
    if (filter < 0 || filter > 4) throw new Error(`PNG filter ${filter} is unsupported`);
    for (let x = 0; x < stride; x += 1) {
      const source = inflated[y * (stride + 1) + x + 1] ?? 0;
      const left = x >= filterBytesPerPixel ? scanlines[y * stride + x - filterBytesPerPixel] ?? 0 : 0;
      const above = y > 0 ? scanlines[(y - 1) * stride + x] ?? 0 : 0;
      const upperLeft = y > 0 && x >= filterBytesPerPixel
        ? scanlines[(y - 1) * stride + x - filterBytesPerPixel] ?? 0
        : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : paeth(left, above, upperLeft);
      scanlines[y * stride + x] = (source + predictor) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  const packedSample = (pixel: number): number => {
    if (bitDepth === 8) return scanlines[pixel] ?? 0;
    const row = Math.floor(pixel / width);
    const column = pixel - row * width;
    const bit = column * bitDepth;
    const byte = scanlines[row * stride + (bit >>> 3)] ?? 0;
    const shift = 8 - bitDepth - (bit & 7);
    return (byte >>> shift) & ((1 << bitDepth) - 1);
  };
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = colorType === 0 || colorType === 3 ? pixel : pixel * channels;
    const target = pixel * 4;
    if (colorType === 3) {
      const index = packedSample(pixel);
      rgba[target] = palette?.[index * 3] ?? 0;
      rgba[target + 1] = palette?.[index * 3 + 1] ?? 0;
      rgba[target + 2] = palette?.[index * 3 + 2] ?? 0;
      rgba[target + 3] = transparency?.[index] ?? 255;
    } else if (colorType === 0 || colorType === 4) {
      const gray = colorType === 0
        ? Math.round(packedSample(pixel) * 255 / ((1 << bitDepth) - 1))
        : scanlines[source] ?? 0;
      rgba[target] = gray;
      rgba[target + 1] = gray;
      rgba[target + 2] = gray;
      rgba[target + 3] = colorType === 4 ? scanlines[source + 1] ?? 255 : 255;
    } else {
      rgba[target] = scanlines[source] ?? 0;
      rgba[target + 1] = scanlines[source + 1] ?? 0;
      rgba[target + 2] = scanlines[source + 2] ?? 0;
      rgba[target + 3] = colorType === 6 ? scanlines[source + 3] ?? 255 : 255;
    }
  }
  return { height, rgba, width };
}

function decodeTexture(texture: EmbeddedMeshTexture): DecodedImage {
  if (texture.mimeType !== 'image/png') {
    throw new Error(`Embedded texture MIME type ${texture.mimeType} is unsupported; use PNG`);
  }
  return decodePng(texture.bytes);
}

export function decodeEmbeddedMeshTextures(mesh: PackedTriangleMesh): PackedTriangleMesh {
  if (mesh.embeddedTextures === undefined || mesh.embeddedTextures.length === 0) return mesh;
  const images = mesh.embeddedTextures.map(decodeTexture);
  const offsets = new Uint32Array(images.length + 1);
  const widths = new Uint16Array(images.length);
  const heights = new Uint16Array(images.length);
  const wrapS = new Uint32Array(images.length);
  const wrapT = new Uint32Array(images.length);
  let byteLength = 0;
  for (let index = 0; index < images.length; index += 1) {
    offsets[index] = byteLength;
    byteLength += images[index]!.rgba.length;
    widths[index] = images[index]!.width;
    heights[index] = images[index]!.height;
    wrapS[index] = mesh.embeddedTextures[index]!.wrapS;
    wrapT[index] = mesh.embeddedTextures[index]!.wrapT;
  }
  offsets[images.length] = byteLength;
  const rgbaSrgb = new Uint8Array(byteLength);
  for (let index = 0; index < images.length; index += 1) rgbaSrgb.set(images[index]!.rgba, offsets[index]);
  const textureAtlas: PackedTextureAtlas = { heights, offsets, rgbaSrgb, widths, wrapS, wrapT };
  return { ...mesh, textureAtlas };
}

function wrapped(value: number, mode: TextureWrapMode): number {
  if (mode === 33071) return Math.min(1, Math.max(0, value));
  if (mode === 33648) {
    const period = ((value % 2) + 2) % 2;
    return period <= 1 ? period : 2 - period;
  }
  return ((value % 1) + 1) % 1;
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function sampleMeshMaterialLinear(
  mesh: PackedTriangleMesh,
  materialId: number,
  u: number,
  v: number,
): readonly [number, number, number] {
  const factor = mesh.materialBaseColorsLinear;
  const base = [
    factor?.[materialId * 4] ?? 0.5,
    factor?.[materialId * 4 + 1] ?? 0.5,
    factor?.[materialId * 4 + 2] ?? 0.5,
  ] as const;
  const textureIndex = mesh.materialTextureIndexes?.[materialId] ?? -1;
  const atlas = mesh.textureAtlas;
  if (atlas === undefined || textureIndex < 0 || !Number.isFinite(u) || !Number.isFinite(v)) return base;
  const width = atlas.widths[textureIndex] ?? 0;
  const height = atlas.heights[textureIndex] ?? 0;
  if (width === 0 || height === 0) return base;
  const wrappedU = wrapped(u, (atlas.wrapS[textureIndex] ?? 10497) as TextureWrapMode);
  const wrappedV = wrapped(v, (atlas.wrapT[textureIndex] ?? 10497) as TextureWrapMode);
  const x = Math.min(width - 1, Math.floor(wrappedU * width));
  const y = Math.min(height - 1, Math.floor(wrappedV * height));
  const offset = (atlas.offsets[textureIndex] ?? 0) + (y * width + x) * 4;
  return [
    base[0] * srgbToLinear((atlas.rgbaSrgb[offset] ?? 0) / 255),
    base[1] * srgbToLinear((atlas.rgbaSrgb[offset + 1] ?? 0) / 255),
    base[2] * srgbToLinear((atlas.rgbaSrgb[offset + 2] ?? 0) / 255),
  ];
}
