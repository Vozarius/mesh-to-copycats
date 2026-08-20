import {
  decodeGeneratedCatalog,
  parseGeneratedRuntimeMetadata,
  verifyGeneratedRuntimeMetadataArtifact,
  type GeneratedCatalogInput,
  type GeneratedMaterialAcceptanceProfileMetadata,
  type GeneratedRuntimeCatalogMetadata,
  type GeneratedRuntimePlacementProfile,
} from './generated.js';
import type { PackedShapeCatalog } from './catalog.js';

export interface WebRuntimeCatalogInput extends GeneratedCatalogInput {
  readonly runtimeMetadata: GeneratedRuntimeCatalogMetadata | string;
}

export interface RuntimeFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export type RuntimeFetch = (url: string) => Promise<RuntimeFetchResponse>;

export interface LoadWebRuntimeCatalogOptions {
  readonly baseUrl: string;
  readonly fetch?: RuntimeFetch;
}

function assertShapeId(catalog: PackedShapeCatalog, shapeId: number): void {
  if (!Number.isInteger(shapeId) || shapeId < 0 || shapeId >= catalog.shapeCount) {
    throw new RangeError(`shapeId ${shapeId} is out of range`);
  }
}

export class WebRuntimeCatalog {
  public readonly catalog: PackedShapeCatalog;
  public readonly runtime: GeneratedRuntimeCatalogMetadata;

  public constructor(
    catalog: PackedShapeCatalog,
    runtime: GeneratedRuntimeCatalogMetadata,
  ) {
    if (
      runtime.counts.shapes !== catalog.shapeCount ||
      runtime.counts.parts !== catalog.partIds.length
    ) {
      throw new Error('Runtime metadata counts do not match the generated catalog');
    }
    this.catalog = catalog;
    this.runtime = runtime;
  }

  public getPartMaterialProfile(
    shapeId: number,
    localPartIndex: number,
  ): GeneratedMaterialAcceptanceProfileMetadata {
    assertShapeId(this.catalog, shapeId);
    const start = this.catalog.shapePartOffsets[shapeId] ?? 0;
    const end = this.catalog.shapePartOffsets[shapeId + 1] ?? start;
    if (!Number.isInteger(localPartIndex) || localPartIndex < 0 || start + localPartIndex >= end) {
      throw new RangeError(`part ${localPartIndex} is out of range for shape ${shapeId}`);
    }
    const profileIndex = this.runtime.partMaterialProfileIndexes[start + localPartIndex];
    const profile = profileIndex === undefined
      ? undefined
      : this.runtime.materialAcceptanceProfiles[profileIndex];
    if (profile === undefined) throw new Error('Runtime material profile index is invalid');
    return profile;
  }

  public getPlacementProfile(shapeId: number): GeneratedRuntimePlacementProfile {
    assertShapeId(this.catalog, shapeId);
    const profileIndex = this.runtime.shapePlacementProfileIndexes[shapeId];
    const profile = profileIndex === undefined
      ? undefined
      : this.runtime.placementProfiles[profileIndex];
    if (profile === undefined) throw new Error('Runtime placement profile index is invalid');
    return profile;
  }
}

export function decodeWebRuntimeCatalog(input: WebRuntimeCatalogInput): WebRuntimeCatalog {
  if (typeof input.runtimeMetadata === 'string') {
    verifyGeneratedRuntimeMetadataArtifact(input.metadata, input.runtimeMetadata);
  }
  const catalog = decodeGeneratedCatalog(input);
  const runtime = parseGeneratedRuntimeMetadata(input.runtimeMetadata);
  return new WebRuntimeCatalog(catalog, runtime);
}

function runtimeFetchDefault(): RuntimeFetch {
  const candidate = Reflect.get(globalThis, 'fetch') as unknown;
  if (typeof candidate !== 'function') {
    throw new Error('No fetch implementation is available; pass options.fetch');
  }
  return candidate as RuntimeFetch;
}

function artifactUrl(baseUrl: string, filename: string): string {
  return `${baseUrl.replace(/\/$/u, '')}/${filename}`;
}

async function requireResponse(
  fetcher: RuntimeFetch,
  url: string,
): Promise<RuntimeFetchResponse> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  return response;
}

export async function loadWebRuntimeCatalog(
  options: LoadWebRuntimeCatalogOptions,
): Promise<WebRuntimeCatalog> {
  const fetcher = options.fetch ?? runtimeFetchDefault();
  const urls = {
    blocks: artifactUrl(options.baseUrl, 'generated-blocks.bin'),
    metadata: artifactUrl(options.baseUrl, 'metadata.json'),
    runtime: artifactUrl(options.baseUrl, 'runtime-metadata.json'),
    shapes: artifactUrl(options.baseUrl, 'generated-shapes.bin'),
  };
  const [blocksResponse, metadataResponse, runtimeResponse, shapesResponse] =
    await Promise.all([
      requireResponse(fetcher, urls.blocks),
      requireResponse(fetcher, urls.metadata),
      requireResponse(fetcher, urls.runtime),
      requireResponse(fetcher, urls.shapes),
    ]);
  const [blocks, metadata, runtimeMetadata, shapes] = await Promise.all([
    blocksResponse.arrayBuffer(),
    metadataResponse.text(),
    runtimeResponse.text(),
    shapesResponse.arrayBuffer(),
  ]);
  return decodeWebRuntimeCatalog({
    blocks: new Uint8Array(blocks),
    metadata,
    runtimeMetadata,
    shapes: new Uint8Array(shapes),
  });
}
