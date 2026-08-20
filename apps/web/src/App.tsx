import { useEffect, useRef, useState } from 'react';

import {
  decodeEmbeddedMeshTextures,
  finalizeMesh,
  importGlb,
  importObj,
  type PackedTriangleMesh,
} from '@mesh-to-copycats/mesh';
import { encodeCreateSchematic, type StructureCell } from '@mesh-to-copycats/minecraft-nbt';

import { EditorScene } from './EditorScene.js';
import type {
  CompleteResponse,
  QualityName,
  WorkerRequest,
  WorkerResponse,
} from './worker-types.js';

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

export function App() {
  const [mesh, setMesh] = useState<PackedTriangleMesh>(() => demoMesh());
  const [filename, setFilename] = useState('demo-taper.glb');
  const [quality, setQuality] = useState<QualityName>('BALANCED');
  const [scale, setScale] = useState(1);
  const [view, setView] = useState<'optimized' | 'original' | 'split'>('original');
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [status, setStatus] = useState<'idle' | 'running' | 'complete' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<CompleteResponse>();
  const worker = useRef<Worker | undefined>(undefined);
  const request = useRef(0);

  useEffect(() => {
    const instance = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });
    worker.current = instance;
    instance.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.requestId !== request.current) return;
      if (response.type === 'progress') {
        setProgress({ completed: response.completed, total: response.total });
      } else if (response.type === 'complete') {
        setResult(response);
        setProgress({ completed: response.cellX.length, total: response.cellX.length });
        setStatus('complete');
        setView('split');
      } else {
        setError(response.message);
        setStatus('error');
      }
    });
    return () => {
      instance.terminate();
    };
  }, []);

  const importFile = async (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const imported = extension === 'obj'
      ? importObj(await file.text())
      : extension === 'glb'
        ? decodeEmbeddedMeshTextures(importGlb(await file.arrayBuffer()))
        : undefined;
    if (imported === undefined) throw new Error('Choose an .obj or .glb file');
    setMesh(imported);
    setFilename(file.name);
    setResult(undefined);
    setStatus('idle');
    setView('original');
  };

  const optimize = () => {
    if (worker.current === undefined) return;
    if (status === 'running') {
      worker.current.postMessage({ requestId: request.current, type: 'cancel' } satisfies WorkerRequest);
    }
    request.current++;
    setError('');
    setProgress({ completed: 0, total: 0 });
    setStatus('running');
    const workerMesh: PackedTriangleMesh = {
      bounds: mesh.bounds.slice(),
      indices: mesh.indices.slice(),
      ...(mesh.materialBaseColorsLinear === undefined
        ? {}
        : { materialBaseColorsLinear: mesh.materialBaseColorsLinear.slice() }),
      materialNames: [...mesh.materialNames],
      ...(mesh.materialTextureIndexes === undefined
        ? {}
        : { materialTextureIndexes: mesh.materialTextureIndexes.slice() }),
      positions: mesh.positions.slice(),
      triangleMaterials: mesh.triangleMaterials.slice(),
      ...(mesh.textureAtlas === undefined ? {} : {
        textureAtlas: {
          heights: mesh.textureAtlas.heights.slice(),
          offsets: mesh.textureAtlas.offsets.slice(),
          rgbaSrgb: mesh.textureAtlas.rgbaSrgb.slice(),
          widths: mesh.textureAtlas.widths.slice(),
          wrapS: mesh.textureAtlas.wrapS.slice(),
          wrapT: mesh.textureAtlas.wrapT.slice(),
        },
      }),
      ...(mesh.texcoords === undefined ? {} : { texcoords: mesh.texcoords.slice() }),
      vertexCount: mesh.vertexCount,
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
      mesh: workerMesh,
      quality,
      requestId: request.current,
      scale,
      type: 'optimize',
    } satisfies WorkerRequest, transferables);
  };

  const exportNbt = () => {
    if (result === undefined) return;
    if (result.invalidMaterialCells > 0) {
      setError('Resolve every material before exporting a schematic.');
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
      anchor.download = `${filename.replace(/\.(?:glb|obj)$/iu, '') || 'formwork'}.nbt`;
      anchor.click();
      URL.revokeObjectURL(url);
      setError('');
    } catch (reason) {
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
          <span>{status === 'running' ? 'Fitting geometry + materials' : status === 'complete' ? 'Ready to inspect' : 'Local workspace'}</span>
          <button className="export-button" type="button" disabled={result === undefined || result.invalidMaterialCells > 0} onClick={exportNbt}>EXPORT NBT</button>
        </div>
      </header>

      <aside className="sidebar">
        <section>
          <span className="section-index">01 / INPUT</span>
          <label className="dropzone">
            <input
              type="file"
              accept=".obj,.glb,model/obj,model/gltf-binary"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file !== undefined) void importFile(file).catch((reason: unknown) => {
                  setError(reason instanceof Error ? reason.message : String(reason));
                  setStatus('error');
                });
              }}
            />
            <span className="drop-icon">＋</span>
            <strong>Drop OBJ or GLB</strong>
            <span>or click to browse</span>
          </label>
          <div className="file-meta">
            <span>{formatNumber(mesh.indices.length / 3)} triangles</span>
            <span>{formatNumber(mesh.positions.length / 3)} vertices</span>
          </div>
        </section>

        <section>
          <span className="section-index">02 / GEOMETRY</span>
          <label className="field-label" htmlFor="scale">Minecraft scale <b>{scale.toFixed(2)}×</b></label>
          <input id="scale" className="range" type="range" min="0.25" max="4" step="0.25" value={scale} onChange={(event) => {
            setScale(Number(event.currentTarget.value));
          }} />
          <span className="field-label">Fit quality</span>
          <div className="segmented">
            {(['FAST', 'BALANCED', 'QUALITY'] as const).map((name) => (
              <button type="button" className={quality === name ? 'active' : ''} onClick={() => {
                setQuality(name);
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

        <section className="stats-section">
          <span className="section-index">03 / REPORT</span>
          <dl>
            <div><dt>Surface cells</dt><dd>{result === undefined ? '—' : formatNumber(result.cellX.length)}</dd></div>
            <div><dt>Mean geometry error</dt><dd>{result === undefined ? '—' : averageError.toFixed(4)}</dd></div>
            <div><dt>Materials</dt><dd>{result === undefined ? '—' : materialCount}</dd></div>
            <div><dt>Unresolved cells</dt><dd>{result === undefined ? '—' : result.invalidMaterialCells}</dd></div>
            <div><dt>Compute time</dt><dd>{result === undefined ? '—' : `${formatNumber(result.timingsMs.total)} ms`}</dd></div>
            <div><dt>Catalog</dt><dd>{result?.catalog ?? '—'}</dd></div>
          </dl>
          {result !== undefined && materialUsage.length > 0 && <div className="material-list">
            {materialUsage.map((paletteIndex) => <div key={result.paletteItemIds[paletteIndex]}>
              <i style={{ background: `rgb(${Math.round((result.paletteSrgb[paletteIndex * 3] ?? 0.5) * 255)} ${(Math.round((result.paletteSrgb[paletteIndex * 3 + 1] ?? 0.5) * 255))} ${(Math.round((result.paletteSrgb[paletteIndex * 3 + 2] ?? 0.5) * 255))})` }} />
              <span>{(result.paletteItemIds[paletteIndex] ?? '').replace('minecraft:', '')}</span>
            </div>)}
          </div>}
          {result?.previewTruncated === true && <p className="notice">Preview capped at 250k microvoxels.</p>}
        </section>
      </aside>

      <section className="viewport">
        <EditorScene mesh={mesh} optimizedColors={result?.previewColors} optimizedPositions={result?.previewPositions} view={view} />
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
