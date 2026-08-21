import { finalizeMesh, type PackedTextureAtlas, type PackedTriangleMesh } from './types.js';

export function createPlaneMesh(options: {
  readonly height?: number;
  readonly materialColorLinear?: readonly [number, number, number, number];
  readonly textureAtlas?: PackedTextureAtlas;
  readonly width?: number;
} = {}): PackedTriangleMesh {
  const width = options.width ?? 1;
  const height = options.height ?? 1;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Plane dimensions must be positive and finite');
  }
  return finalizeMesh({
    indices: [0, 1, 2, 0, 2, 3],
    materialBaseColorsLinear: [...(options.materialColorLinear ?? [1, 1, 1, 1])],
    materialNames: ['plane'],
    ...(options.textureAtlas === undefined
      ? {}
      : { materialTextureIndexes: [0], textureAtlas: options.textureAtlas }),
    positions: [
      -width / 2, -height / 2, 0,
      width / 2, -height / 2, 0,
      width / 2, height / 2, 0,
      -width / 2, height / 2, 0,
    ],
    texcoords: [0, 1, 1, 1, 1, 0, 0, 0],
    triangleMaterials: [0, 0],
  });
}

export function createAlphaMaskedPlaneMesh(options: {
  readonly alphaThreshold?: number;
  readonly height: number;
  readonly textureAtlas: PackedTextureAtlas;
  readonly textureIndex?: number;
  readonly width: number;
}): PackedTriangleMesh {
  const textureIndex = options.textureIndex ?? 0;
  const alphaThreshold = options.alphaThreshold ?? 1;
  if (!Number.isFinite(options.width) || !Number.isFinite(options.height) ||
    options.width <= 0 || options.height <= 0) {
    throw new RangeError('Plane dimensions must be positive and finite');
  }
  if (!Number.isInteger(alphaThreshold) || alphaThreshold < 0 || alphaThreshold > 255) {
    throw new RangeError('Alpha threshold must be an integer in 0..255');
  }
  if (!Number.isInteger(textureIndex) || textureIndex < 0 || textureIndex >= options.textureAtlas.widths.length) {
    throw new RangeError(`Texture index ${textureIndex} is out of range`);
  }
  const pixelWidth = options.textureAtlas.widths[textureIndex] ?? 0;
  const pixelHeight = options.textureAtlas.heights[textureIndex] ?? 0;
  const pixelCount = pixelWidth * pixelHeight;
  if (pixelWidth < 1 || pixelHeight < 1 || pixelCount > 16_777_216) {
    throw new RangeError('Alpha-masked texture dimensions must contain 1..16777216 pixels');
  }
  const textureOffset = options.textureAtlas.offsets[textureIndex] ?? 0;
  const textureEnd = options.textureAtlas.offsets[textureIndex + 1] ?? textureOffset;
  if (textureEnd - textureOffset !== pixelCount * 4) throw new Error('Texture RGBA payload length is invalid');
  const visited = new Uint8Array(pixelCount);
  const positions: number[] = [];
  const texcoords: number[] = [];
  const indices: number[] = [];
  const opaque = (x: number, y: number) => {
    const pixel = x + pixelWidth * y;
    return visited[pixel] === 0 &&
      (options.textureAtlas.rgbaSrgb[textureOffset + pixel * 4 + 3] ?? 0) >= alphaThreshold;
  };
  for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) {
      if (!opaque(x, y)) continue;
      let xEnd = x + 1;
      while (xEnd < pixelWidth && opaque(xEnd, y)) xEnd += 1;
      let yEnd = y + 1;
      while (yEnd < pixelHeight) {
        let clear = true;
        for (let scanX = x; scanX < xEnd; scanX += 1) clear &&= opaque(scanX, yEnd);
        if (!clear) break;
        yEnd += 1;
      }
      for (let markY = y; markY < yEnd; markY += 1) {
        visited.fill(1, x + pixelWidth * markY, xEnd + pixelWidth * markY);
      }
      const left = -options.width / 2 + x / pixelWidth * options.width;
      const right = -options.width / 2 + xEnd / pixelWidth * options.width;
      const top = options.height / 2 - y / pixelHeight * options.height;
      const bottom = options.height / 2 - yEnd / pixelHeight * options.height;
      const vertex = positions.length / 3;
      positions.push(left, bottom, 0, right, bottom, 0, right, top, 0, left, top, 0);
      texcoords.push(
        x / pixelWidth, yEnd / pixelHeight,
        xEnd / pixelWidth, yEnd / pixelHeight,
        xEnd / pixelWidth, y / pixelHeight,
        x / pixelWidth, y / pixelHeight,
      );
      indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
    }
  }
  if (indices.length === 0) throw new Error('Image contains no pixels above the alpha threshold');
  return finalizeMesh({
    indices,
    materialBaseColorsLinear: [1, 1, 1, 1],
    materialNames: ['image'],
    materialTextureIndexes: [textureIndex],
    positions,
    texcoords,
    textureAtlas: options.textureAtlas,
    triangleMaterials: Array.from({ length: indices.length / 3 }, () => 0),
  });
}

export function createCircleMesh(options: {
  readonly materialColorLinear?: readonly [number, number, number, number];
  readonly radius?: number;
  readonly segments?: number;
} = {}): PackedTriangleMesh {
  const radius = options.radius ?? 1;
  const segments = options.segments ?? 64;
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Circle radius must be positive');
  if (!Number.isSafeInteger(segments) || segments < 8 || segments > 4096) {
    throw new RangeError('Circle segments must be an integer in 8..4096');
  }
  const positions = [0, 0, 0];
  const texcoords = [0.5, 0.5];
  for (let segment = 0; segment < segments; segment += 1) {
    const angle = segment / segments * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    positions.push(x, y, 0);
    texcoords.push(x / radius / 2 + 0.5, 0.5 - y / radius / 2);
  }
  const indices: number[] = [];
  for (let segment = 0; segment < segments; segment += 1) {
    indices.push(0, segment + 1, (segment + 1) % segments + 1);
  }
  return finalizeMesh({
    indices,
    materialBaseColorsLinear: [...(options.materialColorLinear ?? [0.5, 0.5, 0.5, 1])],
    materialNames: ['circle'],
    positions,
    texcoords,
    triangleMaterials: Array.from({ length: segments }, () => 0),
  });
}

export function createSphereMesh(options: {
  readonly latitudeSegments?: number;
  readonly longitudeSegments?: number;
  readonly materialColorLinear?: readonly [number, number, number, number];
  readonly radius?: number;
} = {}): PackedTriangleMesh {
  const radius = options.radius ?? 1;
  const latitude = options.latitudeSegments ?? 24;
  const longitude = options.longitudeSegments ?? 32;
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Sphere radius must be positive');
  if (!Number.isSafeInteger(latitude) || latitude < 3 || latitude > 512 ||
    !Number.isSafeInteger(longitude) || longitude < 3 || longitude > 512) {
    throw new RangeError('Sphere segment counts must be integers in 3..512');
  }
  const positions: number[] = [];
  const texcoords: number[] = [];
  for (let y = 0; y <= latitude; y += 1) {
    const v = y / latitude;
    const polar = v * Math.PI;
    for (let x = 0; x <= longitude; x += 1) {
      const u = x / longitude;
      const azimuth = u * Math.PI * 2;
      positions.push(
        Math.sin(polar) * Math.cos(azimuth) * radius,
        Math.cos(polar) * radius,
        Math.sin(polar) * Math.sin(azimuth) * radius,
      );
      texcoords.push(u, v);
    }
  }
  const indices: number[] = [];
  for (let y = 0; y < latitude; y += 1) {
    for (let x = 0; x < longitude; x += 1) {
      const current = y * (longitude + 1) + x;
      const below = current + longitude + 1;
      if (y > 0) indices.push(current, below, current + 1);
      if (y + 1 < latitude) indices.push(current + 1, below, below + 1);
    }
  }
  return finalizeMesh({
    indices,
    materialBaseColorsLinear: [...(options.materialColorLinear ?? [0.5, 0.5, 0.5, 1])],
    materialNames: ['sphere'],
    positions,
    texcoords,
    triangleMaterials: Array.from({ length: indices.length / 3 }, () => 0),
  });
}
