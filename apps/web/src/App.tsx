import { useEffect, useMemo, useRef, useState } from 'react';

import {
  applyTextureToMeshMaterial,
  decodeEmbeddedMeshTextures,
  createCircleMesh,
  createPlaneMesh,
  createSphereMesh,
  finalizeMesh,
  importGlb,
  importObj,
  transformMesh,
  type PackedTriangleMesh,
} from '@mesh-to-copycats/mesh';
import { encodeCreateSchematic, type StructureCell } from '@mesh-to-copycats/minecraft-nbt';

import { EditorScene } from './EditorScene.js';
import { decodeBrowserImageTexture, importImageAsPlane } from './image-mesh.js';
import type {
  CompleteResponse,
  QualityName,
  WorkerRequest,
  WorkerResponse,
} from './worker-types.js';

interface MaterialLibrary {
  readonly itemIds: readonly string[];
  readonly srgb: Float32Array;
  readonly textureHeights: Uint16Array;
  readonly textureOffsets: Uint32Array;
  readonly textureRgbaSrgb: Uint8Array;
  readonly textureWidths: Uint16Array;
}

function MaterialTexture({ index, library }: { readonly index: number; readonly library: MaterialLibrary }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = canvas.current;
    if (target === null) return;
    const width = library.textureWidths[index] ?? 0;
    const height = library.textureHeights[index] ?? 0;
    const start = library.textureOffsets[index] ?? 0;
    const end = library.textureOffsets[index + 1] ?? start;
    const context = target.getContext('2d');
    if (context === null || width === 0 || height === 0 || end - start !== width * height * 4) return;
    target.width = width;
    target.height = height;
    const pixels = new Uint8ClampedArray(end - start);
    pixels.set(library.textureRgbaSrgb.subarray(start, end));
    context.putImageData(new ImageData(pixels, width, height), 0, 0);
  }, [index, library]);
  const red = Math.round((library.srgb[index * 3] ?? 0.5) * 255);
  const green = Math.round((library.srgb[index * 3 + 1] ?? 0.5) * 255);
  const blue = Math.round((library.srgb[index * 3 + 2] ?? 0.5) * 255);
  return <canvas ref={canvas} style={{ backgroundColor: `rgb(${red} ${green} ${blue})` }} />;
}

function demoMesh(): PackedTriangleMesh {
  return finalizeMesh({
    indices: [
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1,
      1, 5, 6, 1, 6, 2,
      2, 6, 7, 2, 7, 3,
      3, 7, 4, 3, 4, 0,
    ],
    materialNames: ['demo'],
    positions: [
      -2, 0, -2, 2, 0, -2, 2, 0, 2, -2, 0, 2,
      -1.2, 3.5, -1.2, 1.2, 3.5, -1.2, 1.2, 3.5, 1.2, -1.2, 3.5, 1.2,
    ],
    triangleMaterials: Array.from({ length: 12 }, () => 0),
  });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

interface MaterialNamespaceGroup {
  readonly indexes: readonly number[];
  readonly namespace: string;
}

function groupMaterialIndexes(
  itemIds: readonly string[],
  filter: string,
): readonly MaterialNamespaceGroup[] {
  const normalized = filter.trim().toLowerCase();
  const groups = new Map<string, number[]>();
  for (let index = 0; index < itemIds.length; index += 1) {
    const itemId = itemIds[index] ?? '';
    if (!itemId.toLowerCase().includes(normalized)) continue;
    const separator = itemId.indexOf(':');
    const namespace = separator < 0 ? 'minecraft' : itemId.slice(0, separator);
    const indexes = groups.get(namespace) ?? [];
    indexes.push(index);
    groups.set(namespace, indexes);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([namespace, indexes]) => ({ indexes, namespace }));
}

interface ModelTransformState {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly offsetZ: number;
  readonly rotateX: number;
  readonly rotateY: number;
  readonly rotateZ: number;
}

const IDENTITY_TRANSFORM: ModelTransformState = {
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
};

export function App() {
  const [mesh, setMesh] = useState<PackedTriangleMesh>(() => demoMesh());
  const [imagePlane, setImagePlane] = useState(false);
  const [filename, setFilename] = useState('demo-taper.glb');
  const [quality, setQuality] = useState<QualityName>('QUALITY');
  const [scale, setScale] = useState(1);
  const [view, setView] = useState<'optimized' | 'original' | 'split'>('original');
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [status, setStatus] = useState<'idle' | 'running' | 'complete' | 'error'>('idle');
  const [error, setError] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const [result, setResult] = useState<CompleteResponse>();
  const [materialOverrides, setMaterialOverrides] = useState<readonly string[]>(['']);
  const [selectedMaterialSlot, setSelectedMaterialSlot] = useState(0);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [modelTransform, setModelTransform] = useState<ModelTransformState>(IDENTITY_TRANSFORM);
  const [imageAlphaThreshold, setImageAlphaThreshold] = useState(16);
  const [cameraClipEnd, setCameraClipEnd] = useState(1_000_000);
  const [includedMaterials, setIncludedMaterials] = useState<ReadonlySet<string>>();
  const [materialFilter, setMaterialFilter] = useState('');
  const [materialLibrary, setMaterialLibrary] = useState<MaterialLibrary>();
  const overrideUndo = useRef<readonly string[][]>([]);
  const overrideRedo = useRef<readonly string[][]>([]);
  const worker = useRef<Worker | undefined>(undefined);
  const request = useRef(0);
  const transformedMesh = useMemo(() => transformMesh(mesh, {
    rotationDegrees: [modelTransform.rotateX, modelTransform.rotateY, modelTransform.rotateZ],
    translation: [modelTransform.offsetX, modelTransform.offsetY, modelTransform.offsetZ],
    uniformScale: scale,
  }), [mesh, modelTransform, scale]);

  useEffect(() => {
    const instance = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });
    worker.current = instance;
    instance.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.type === 'palette') {
        setMaterialLibrary(response);
        setIncludedMaterials((current) => current ?? new Set(response.itemIds));
        return;
      }
      if (response.type === 'error' && response.requestId === -1) {
        setError(`Could not load material library: ${response.message}`);
        setStatus('error');
        return;
      }
      if (response.type === 'error' && response.requestId === -1) {
        setError(`Could not load material library: ${response.message}`);
        setStatus('error');
        return;
      }
      if (response.requestId !== request.current) return;
      if (response.type === 'progress') {
        setProgress({ completed: response.completed, total: response.total });
      } else if (response.type === 'complete') {
        setResult(response);
        setSettingsDirty(false);
        setProgress({ completed: response.cellX.length, total: response.cellX.length });
        setStatus('complete');
        setError(response.invalidMaterialCells === 0
          ? ''
          : `${response.invalidMaterialCells} cells have no compatible included material; ` +
            'they cannot be exported until the include/alpha/Copycats constraints are resolved.');
        setView('split');
      } else {
        setError(response.message);
        setStatus('error');
      }
    });
    instance.postMessage({ requestId: -1, type: 'load-palette' } satisfies WorkerRequest);
    return () => {
      instance.terminate();
    };
  }, []);

  const selectMesh = (nextMesh: PackedTriangleMesh, name: string, isImagePlane = false) => {
    if (status === 'running' && worker.current !== undefined) {
      worker.current.postMessage({ requestId: request.current, type: 'cancel' } satisfies WorkerRequest);
      request.current += 1;
    }
    setMesh(nextMesh);
    setImagePlane(isImagePlane);
    setFilename(name);
    setResult(undefined);
    setStatus('idle');
    setView('original');
    setError('');
    setExportNotice('');
    setMaterialOverrides(Array.from({ length: nextMesh.materialNames.length }, () => ''));
    setSelectedMaterialSlot(0);
    overrideUndo.current = [];
    overrideRedo.current = [];
    setSettingsDirty(false);
    setModelTransform(IDENTITY_TRANSFORM);
  };

  const updateTransform = (key: keyof ModelTransformState, value: number) => {
    if (!Number.isFinite(value)) return;
    setModelTransform((current) => ({ ...current, [key]: value }));
    setSettingsDirty(true);
  };

  const centerAndGround = () => {
    const rotated = transformMesh(mesh, {
      rotationDegrees: [modelTransform.rotateX, modelTransform.rotateY, modelTransform.rotateZ],
      uniformScale: scale,
    });
    setModelTransform((current) => ({
      ...current,
      offsetX: -((rotated.bounds[0] ?? 0) + (rotated.bounds[3] ?? 0)) / 2,
      offsetY: -(rotated.bounds[1] ?? 0),
      offsetZ: -((rotated.bounds[2] ?? 0) + (rotated.bounds[5] ?? 0)) / 2,
    }));
    setSettingsDirty(true);
  };

  const commitMaterialOverrides = (next: readonly string[]) => {
    overrideUndo.current = [...overrideUndo.current, [...materialOverrides]];
    overrideRedo.current = [];
    setMaterialOverrides([...next]);
    setSettingsDirty(true);
  };

  const undoMaterialOverride = () => {
    const previous = overrideUndo.current.at(-1);
    if (previous === undefined) return;
    overrideUndo.current = overrideUndo.current.slice(0, -1);
    overrideRedo.current = [...overrideRedo.current, [...materialOverrides]];
    setMaterialOverrides(previous);
    setSettingsDirty(true);
  };

  const redoMaterialOverride = () => {
    const next = overrideRedo.current.at(-1);
    if (next === undefined) return;
    overrideRedo.current = overrideRedo.current.slice(0, -1);
    overrideUndo.current = [...overrideUndo.current, [...materialOverrides]];
    setMaterialOverrides(next);
    setSettingsDirty(true);
  };

  const importFile = async (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const imported = extension === 'obj'
      ? importObj(await file.text())
      : extension === 'glb'
        ? decodeEmbeddedMeshTextures(importGlb(await file.arrayBuffer()))
        : file.type.startsWith('image/')
          ? await importImageAsPlane(file, imageAlphaThreshold)
          : undefined;
    if (imported === undefined) throw new Error('Choose an OBJ, GLB or image file');
    selectMesh(imported, file.name, file.type.startsWith('image/'));
  };

  const importUvTexture = async (file: File) => {
    const materialSlot = selectedMaterialSlot;
    const texture = await decodeBrowserImageTexture(file);
    setMesh((current) => applyTextureToMeshMaterial(current, texture, materialSlot));
    setResult(undefined);
    setStatus('idle');
    setView('original');
    setError('');
    setExportNotice(`UV texture ${file.name} applied to material ${materialSlot}.`);
  };

  const optimize = () => {
    if (worker.current === undefined) return;
    if (includedMaterials?.size === 0) {
      setError('Select at least one included material before building geometry.');
      return;
    }
    if (status === 'running') {
      worker.current.postMessage({ requestId: request.current, type: 'cancel' } satisfies WorkerRequest);
    }
    request.current++;
    setError('');
    setExportNotice('');
    setProgress({ completed: 0, total: 0 });
    setStatus('running');
    const workerMesh: PackedTriangleMesh = {
      bounds: transformedMesh.bounds.slice(),
      indices: transformedMesh.indices.slice(),
      ...(transformedMesh.materialBaseColorsLinear === undefined
        ? {}
        : { materialBaseColorsLinear: transformedMesh.materialBaseColorsLinear.slice() }),
      materialNames: [...transformedMesh.materialNames],
      ...(transformedMesh.materialTextureIndexes === undefined
        ? {}
        : { materialTextureIndexes: transformedMesh.materialTextureIndexes.slice() }),
      positions: transformedMesh.positions.slice(),
      triangleMaterials: transformedMesh.triangleMaterials.slice(),
      ...(transformedMesh.textureAtlas === undefined ? {} : {
        textureAtlas: {
          heights: transformedMesh.textureAtlas.heights.slice(),
          offsets: transformedMesh.textureAtlas.offsets.slice(),
          rgbaSrgb: transformedMesh.textureAtlas.rgbaSrgb.slice(),
          widths: transformedMesh.textureAtlas.widths.slice(),
          wrapS: transformedMesh.textureAtlas.wrapS.slice(),
          wrapT: transformedMesh.textureAtlas.wrapT.slice(),
        },
      }),
      ...(transformedMesh.texcoords === undefined ? {} : { texcoords: transformedMesh.texcoords.slice() }),
      vertexCount: transformedMesh.vertexCount,
    };
    const transferables: Transferable[] = [
      workerMesh.bounds.buffer,
      workerMesh.indices.buffer,
      workerMesh.positions.buffer,
      workerMesh.triangleMaterials.buffer,
    ];
    if (workerMesh.texcoords !== undefined) transferables.push(workerMesh.texcoords.buffer);
    if (workerMesh.materialBaseColorsLinear !== undefined) {
      transferables.push(workerMesh.materialBaseColorsLinear.buffer);
    }
    if (workerMesh.materialTextureIndexes !== undefined) {
      transferables.push(workerMesh.materialTextureIndexes.buffer);
    }
    if (workerMesh.textureAtlas !== undefined) {
      transferables.push(
        workerMesh.textureAtlas.heights.buffer,
        workerMesh.textureAtlas.offsets.buffer,
        workerMesh.textureAtlas.rgbaSrgb.buffer,
        workerMesh.textureAtlas.widths.buffer,
        workerMesh.textureAtlas.wrapS.buffer,
        workerMesh.textureAtlas.wrapT.buffer,
      );
    }
    worker.current.postMessage({
      ...(includedMaterials === undefined
        ? {}
        : { includedMaterialItemIds: [...includedMaterials].sort() }),
      highDetailImagePlane: imagePlane,
      materialOverrides,
      mesh: workerMesh,
      quality,
      requestId: request.current,
      scale: 1,
      type: 'optimize',
    } satisfies WorkerRequest, transferables);
  };

  const exportNbt = () => {
    if (result === undefined) return;
    if (settingsDirty) {
      setError('Rebuild after changing geometry or material settings before export.');
      return;
    }
    if (result.invalidMaterialCells > 0) {
      const coordinates = result.unresolvedMaterialCellCoordinates.join('; ');
      setError(
        `${result.invalidMaterialCells} cells have no compatible included material. ` +
        'Check namespace selection, texture alpha and Copycats acceptance, then rebuild.' +
        (coordinates.length === 0 ? '' : ` First cells: ${coordinates}.`),
      );
      return;
    }
    try {
      const cells: StructureCell[] = Array.from(result.shapeIds, (_shapeId, cell) => {
        const blockId = result.shapeBlockIds[cell] ?? 'minecraft:air';
        const copycat = blockId.startsWith('copycats:') || blockId.includes(':copycat_');
        const start = result.cellPartOffsets[cell] ?? 0;
        const end = result.cellPartOffsets[cell + 1] ?? start;
        return {
          blockId,
          ...(copycat ? {
            parts: Array.from({ length: end - start }, (_value, localPart) => {
              const assignment = start + localPart;
              const paletteIndex = result.paletteIndexes[assignment] ?? 0xffff_ffff;
              return {
                blockId: result.acceptedMaterialBlockIds[assignment] ?? '',
                itemId: result.paletteItemIds[paletteIndex] ?? '',
                key: result.partKeys[assignment] ?? 'material',
                state: result.acceptedMaterialStates[assignment] ?? '',
              };
            }),
          } : {}),
          state: result.shapeStates[cell] ?? '',
          x: result.cellX[cell] ?? 0,
          y: result.cellY[cell] ?? 0,
          z: result.cellZ[cell] ?? 0,
        };
      });
      const schematic = encodeCreateSchematic({ cells });
      const blob = new Blob([schematic.bytes.slice().buffer], { type: 'application/gzip' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${filename.replace(/\.[^.]+$/u, '') || 'formwork'}.nbt`;
      anchor.style.display = 'none';
      document.body.append(anchor);
      anchor.click();
      window.setTimeout(() => {
        anchor.remove();
        URL.revokeObjectURL(url);
      }, 0);
      setError('');
      setExportNotice(
        `Downloaded ${anchor.download}: ${schematic.blockCount} blocks, ` +
        `${schematic.paletteSize} states.`,
      );
    } catch (reason) {
      setExportNotice('');
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const completion = progress.total === 0 ? 0 : progress.completed / progress.total;
  const averageError = result === undefined || result.errors.length === 0
    ? 0
    : result.errors.reduce((sum, value) => sum + value, 0) / result.errors.length;
  const materialUsage = result === undefined
    ? []
    : [...new Set(Array.from(result.paletteIndexes))]
        .filter((index) => index < result.paletteItemIds.length)
        .slice(0, 6);
  const materialCount = result === undefined
    ? 0
    : new Set(Array.from(result.paletteIndexes)
        .filter((index) => index < result.paletteItemIds.length)).size;
  const materialGroups = materialLibrary === undefined
    ? []
    : groupMaterialIndexes(materialLibrary.itemIds, materialFilter);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Formwork home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>FORMWORK</span>
        </a>
        <div className="project-name">
          <span className="eyebrow">ACTIVE MODEL</span>
          <strong>{filename}</strong>
        </div>
        <div className="top-actions">
          <span className={`status-dot ${status}`} />
          <span>{status === 'running' ? 'Fitting geometry + materials' : settingsDirty ? 'Changes need rebuild' : status === 'complete' ? 'Ready to inspect' : 'Local workspace'}</span>
          <button className="export-button" type="button" disabled={result === undefined || status === 'running'} onClick={exportNbt}>EXPORT NBT</button>
        </div>
      </header>

      <aside className="sidebar">
        <section>
          <span className="section-index">01 / INPUT</span>
          <label className="dropzone">
            <input
              type="file"
              accept=".obj,.glb,image/*,model/obj,model/gltf-binary"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file !== undefined) void importFile(file).catch((reason: unknown) => {
                  setError(reason instanceof Error ? reason.message : String(reason));
                  setStatus('error');
                });
              }}
            />
            <span className="drop-icon">＋</span>
            <strong>Drop OBJ, GLB or image</strong>
            <span>or click to browse</span>
          </label>
          <div className="file-meta">
            <span>{formatNumber(mesh.indices.length / 3)} triangles</span>
            <span>{formatNumber(mesh.positions.length / 3)} vertices</span>
          </div>
          <label className="field-label" htmlFor="alpha-threshold">Next image alpha cutoff <b>{imageAlphaThreshold}</b></label>
          <input id="alpha-threshold" className="range" type="range" min="1" max="255" step="1" value={imageAlphaThreshold} onChange={(event) => {
            setImageAlphaThreshold(Number(event.currentTarget.value));
          }} />
          <span className="field-label">Primitives</span>
          <div className="primitive-grid">
            <button type="button" onClick={() => { selectMesh(createPlaneMesh({ width: 4, height: 4 }), 'plane'); }}>PLANE</button>
            <button type="button" onClick={() => { selectMesh(createCircleMesh({ radius: 2 }), 'circle'); }}>CIRCLE</button>
            <button type="button" onClick={() => { selectMesh(createSphereMesh({ radius: 2 }), 'sphere'); }}>SPHERE</button>
          </div>
        </section>

        <section>
          <span className="section-index">02 / GEOMETRY</span>
          <label className="field-label" htmlFor="scale">Minecraft scale <b>{formatNumber(scale)}×</b></label>
          <input id="scale" className="material-select" type="number" min="0.001" step="0.25" value={scale} onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (!Number.isFinite(next) || next <= 0) return;
            setScale(next);
            setSettingsDirty(true);
          }} />
          <label className="field-label" htmlFor="clip-end">Camera clip end</label>
          <input id="clip-end" className="material-select" type="number" min="10" step="1000" value={cameraClipEnd} onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (Number.isFinite(next) && next >= 10) setCameraClipEnd(next);
          }} />
          <span className="field-label">Rotation XYZ (degrees)</span>
          <div className="transform-grid">
            {(['rotateX', 'rotateY', 'rotateZ'] as const).map((key, axis) => <label key={key}>
              <span>{'XYZ'[axis]}</span>
              <input type="number" step="15" value={modelTransform[key]} onChange={(event) => {
                updateTransform(key, Number(event.currentTarget.value));
              }} />
            </label>)}
          </div>
          <span className="field-label">Offset XYZ (blocks)</span>
          <div className="transform-grid">
            {(['offsetX', 'offsetY', 'offsetZ'] as const).map((key, axis) => <label key={key}>
              <span>{'XYZ'[axis]}</span>
              <input type="number" step="0.25" value={modelTransform[key]} onChange={(event) => {
                updateTransform(key, Number(event.currentTarget.value));
              }} />
            </label>)}
          </div>
          <div className="transform-actions">
            <button type="button" onClick={centerAndGround}>CENTER + GROUND</button>
            <button type="button" onClick={() => { setModelTransform(IDENTITY_TRANSFORM); setSettingsDirty(true); }}>RESET</button>
          </div>
          <span className="field-label">Fit quality</span>
          <div className="segmented">
            {(['FAST', 'BALANCED', 'QUALITY'] as const).map((name) => (
              <button type="button" className={quality === name ? 'active' : ''} onClick={() => {
                setQuality(name);
                setSettingsDirty(true);
              }} key={name}>{name}</button>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={optimize}>
            {status === 'running' ? 'RESTART FIT' : 'BUILD GEOMETRY'}
          </button>
          {status === 'running' && (
            <div className="progress" aria-label="Geometry optimization progress">
              <i style={{ width: `${completion * 100}%` }} />
              <span>{progress.total === 0 ? 'Loading catalog…' : `${progress.completed} / ${progress.total} cells`}</span>
            </div>
          )}
          {error.length > 0 && <p className="error">{error}</p>}
        </section>

        <section>
          <span className="section-index">03 / MATERIALS</span>
          <label className="field-label" htmlFor="source-material">Source material slot</label>
          <select id="source-material" className="material-select" value={selectedMaterialSlot} onChange={(event) => {
            setSelectedMaterialSlot(Number(event.currentTarget.value));
          }}>
            {mesh.materialNames.map((name, index) => <option value={index} key={`${index}:${name}`}>{index}: {name || 'unnamed'}</option>)}
          </select>
          <label className={`texture-import ${mesh.texcoords === undefined ? 'disabled' : ''}`}>
            <input
              type="file"
              accept="image/*"
              disabled={mesh.texcoords === undefined}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file !== undefined) void importUvTexture(file).catch((reason: unknown) => {
                  setExportNotice('');
                  setError(reason instanceof Error ? reason.message : String(reason));
                  setStatus('error');
                });
              }}
            />
            <strong>IMPORT UV TEXTURE</strong>
            <span>{mesh.texcoords === undefined ? 'Mesh has no UV coordinates' : 'Apply image to selected source slot'}</span>
          </label>
          <label className="field-label" htmlFor="minecraft-material">Minecraft material lock</label>
          <div className="include-materials">
            <div className="include-heading">
              <span>Include materials</span>
              <b>{includedMaterials?.size ?? 0} / {materialLibrary?.itemIds.length ?? 0}</b>
            </div>
            <input
              className="material-select"
              type="search"
              placeholder="Search blocks…"
              value={materialFilter}
              onChange={(event) => { setMaterialFilter(event.currentTarget.value); }}
            />
            <div className="include-actions">
              <button type="button" disabled={materialLibrary === undefined} onClick={() => {
                if (materialLibrary === undefined) return;
                setIncludedMaterials(new Set(materialLibrary.itemIds));
                setSettingsDirty(true);
              }}>SELECT ALL</button>
              <button type="button" disabled={materialLibrary === undefined} onClick={() => {
                setIncludedMaterials(new Set());
                setMaterialOverrides((current) => current.map(() => ''));
                overrideUndo.current = [];
                overrideRedo.current = [];
                setSettingsDirty(true);
              }}>DESELECT ALL</button>
            </div>
            <div className="include-groups">
              {materialLibrary === undefined && <p className="notice">Loading block textures...</p>}
              {materialGroups.map((group) => {
                const namespaceItems = group.indexes.map((index) =>
                  materialLibrary!.itemIds[index] ?? '');
                const selectedCount = namespaceItems.reduce(
                  (count, itemId) => count + (includedMaterials?.has(itemId) === true ? 1 : 0),
                  0,
                );
                const setGroupSelected = (selected: boolean) => {
                  const namespaceSet = new Set(namespaceItems);
                  setIncludedMaterials((current) => {
                    const next = new Set(current);
                    for (const itemId of namespaceItems) {
                      if (selected) next.add(itemId);
                      else next.delete(itemId);
                    }
                    return next;
                  });
                  if (!selected) setMaterialOverrides((current) =>
                    current.map((locked) => namespaceSet.has(locked) ? '' : locked));
                  setSettingsDirty(true);
                };
                return <div className="material-namespace" key={group.namespace}>
                  <div className="namespace-heading">
                    <strong>{group.namespace}</strong>
                    <span>{selectedCount} / {group.indexes.length}</span>
                    <button type="button" onClick={() => { setGroupSelected(true); }}>ALL</button>
                    <button type="button" onClick={() => { setGroupSelected(false); }}>NONE</button>
                  </div>
                  <div className="include-grid">
                    {group.indexes.map((paletteIndex) => {
                      const itemId = materialLibrary!.itemIds[paletteIndex] ?? '';
                      const selected = includedMaterials?.has(itemId) === true;
                      return <label className={selected ? 'selected' : ''} key={itemId} title={itemId}>
                        <input type="checkbox" checked={selected} onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setIncludedMaterials((current) => {
                            const next = new Set(current);
                            if (checked) next.add(itemId);
                            else next.delete(itemId);
                            return next;
                          });
                          if (!checked) setMaterialOverrides((current) =>
                            current.map((locked) => locked === itemId ? '' : locked));
                          setSettingsDirty(true);
                        }} />
                        <MaterialTexture index={paletteIndex} library={materialLibrary!} />
                        <span>{itemId.replace(/^[^:]+:/u, '')}</span>
                      </label>;
                    })}
                  </div>
                </div>;
              })}
            </div>
          </div>
          <select
            id="minecraft-material"
            className="material-select"
            disabled={result === undefined}
            value={materialOverrides[selectedMaterialSlot] ?? ''}
            onChange={(event) => {
              const next = [...materialOverrides];
              next[selectedMaterialSlot] = event.currentTarget.value;
              commitMaterialOverrides(next);
            }}
          >
            <option value="">AUTO — closest compatible</option>
            {materialLibrary?.itemIds
              .filter((itemId) => includedMaterials?.has(itemId) === true)
              .map((itemId) => <option value={itemId} key={itemId}>{itemId}</option>)}
          </select>
          <div className="history-buttons">
            <button type="button" disabled={overrideUndo.current.length === 0} onClick={undoMaterialOverride}>UNDO</button>
            <button type="button" disabled={overrideRedo.current.length === 0} onClick={redoMaterialOverride}>REDO</button>
          </div>
          {materialOverrides.some((itemId) => itemId.length > 0) && <p className="notice">Material locks changed. Rebuild to validate and apply.</p>}
          {exportNotice.length > 0 && <p className="success-notice">{exportNotice}</p>}
        </section>

        <section className="stats-section">
          <span className="section-index">04 / REPORT</span>
          <dl>
            <div><dt>Surface cells</dt><dd>{result === undefined ? '—' : formatNumber(result.cellX.length)}</dd></div>
            <div><dt>Mean geometry error</dt><dd>{result === undefined ? '—' : averageError.toFixed(4)}</dd></div>
            <div><dt>Materials</dt><dd>{result === undefined ? '—' : materialCount}</dd></div>
            <div><dt>Unresolved cells</dt><dd>{result === undefined ? '—' : result.invalidMaterialCells}</dd></div>
            <div><dt>Neighbour changes</dt><dd>{result === undefined ? '—' : result.neighborChangedCells}</dd></div>
            <div><dt>Compute time</dt><dd>{result === undefined ? '—' : `${formatNumber(result.timingsMs.total)} ms`}</dd></div>
            <div><dt>Catalog</dt><dd>{result?.catalog ?? '—'}</dd></div>
          </dl>
          {result !== undefined && materialUsage.length > 0 && <div className="material-list">
            {materialUsage.map((paletteIndex) => <div key={result.paletteItemIds[paletteIndex]}>
              <i style={{ background: `rgb(${Math.round((result.paletteSrgb[paletteIndex * 3] ?? 0.5) * 255)} ${(Math.round((result.paletteSrgb[paletteIndex * 3 + 1] ?? 0.5) * 255))} ${(Math.round((result.paletteSrgb[paletteIndex * 3 + 2] ?? 0.5) * 255))})` }} />
              <span>{(result.paletteItemIds[paletteIndex] ?? '').replace('minecraft:', '')}</span>
            </div>)}
          </div>}
          {result?.previewTruncated === true && <p className="notice">Preview capped at 250k exact boxes.</p>}
        </section>
      </aside>

      <section className="viewport">
        <EditorScene
          cameraClipEnd={cameraClipEnd}
          mesh={transformedMesh}
          optimizedColors={result?.previewColors}
          optimizedPaletteIndexes={result?.previewPaletteIndexes}
          optimizedPositions={result?.previewPositions}
          optimizedScales={result?.previewScales}
          paletteTextureHeights={result?.paletteTextureHeights}
          paletteTextureOffsets={result?.paletteTextureOffsets}
          paletteTextureRgbaSrgb={result?.paletteTextureRgbaSrgb}
          paletteTextureWidths={result?.paletteTextureWidths}
          view={view}
        />
        <div className="view-tabs" role="group" aria-label="Preview layer">
          {(['original', 'split', 'optimized'] as const).map((mode) => (
            <button key={mode} type="button" className={view === mode ? 'active' : ''} disabled={mode !== 'original' && result === undefined} onClick={() => {
              setView(mode);
            }}>{mode}</button>
          ))}
        </div>
        <div className="viewport-note">
          <span>DRAG TO ORBIT</span><span>SCROLL TO ZOOM</span><span>RIGHT DRAG TO PAN</span>
        </div>
        <div className="axis-cube"><b>Y</b><span>X</span><i>Z</i></div>
      </section>
    </main>
  );
}
