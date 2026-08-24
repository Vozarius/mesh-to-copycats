/// <reference lib="dom" />

import { afterEach, describe, expect, it, vi } from 'vitest';

import { finalizeMesh } from '../../packages/mesh/src/index.js';
import { decodeEmbeddedMeshTexturesBrowser } from '../../apps/web/src/image-mesh.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser embedded texture decoder', () => {
  it('decodes embedded JPEG through the browser and preserves GLB wrapping', async () => {
    const decodedBlobs: Blob[] = [];
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', (blob: Blob) => {
      decodedBlobs.push(blob);
      return Promise.resolve({ close, height: 1, width: 1 } as unknown as ImageBitmap);
    });
    const context = {
      drawImage: vi.fn(),
      getImageData: () => ({ data: Uint8ClampedArray.of(10, 20, 30, 255) }),
    } as unknown as CanvasRenderingContext2D;
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => context,
        height: 0,
        width: 0,
      }),
    });

    const mesh = finalizeMesh({
      embeddedTextures: [{
        bytes: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9),
        mimeType: 'image/jpeg',
        wrapS: 10497,
        wrapT: 33071,
      }],
      indices: [0, 1, 2],
      materialNames: ['jpeg'],
      materialTextureIndexes: [0],
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      texcoords: [0, 0, 1, 0, 0, 1],
      triangleMaterials: [0],
    });
    const decoded = await decodeEmbeddedMeshTexturesBrowser(mesh);

    expect(decodedBlobs).toHaveLength(1);
    expect(decodedBlobs[0]?.type).toBe('image/jpeg');
    expect(Array.from(decoded.textureAtlas?.rgbaSrgb ?? [])).toEqual([10, 20, 30, 255]);
    expect(Array.from(decoded.textureAtlas?.wrapS ?? [])).toEqual([10497]);
    expect(Array.from(decoded.textureAtlas?.wrapT ?? [])).toEqual([33071]);
    expect(close).toHaveBeenCalledOnce();
  });
});
