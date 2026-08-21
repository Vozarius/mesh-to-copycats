import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { PackedTriangleMesh } from '@mesh-to-copycats/mesh';

export interface EditorSceneProps {
  readonly cameraClipEnd: number;
  readonly mesh: PackedTriangleMesh;
  readonly optimizedColors?: Float32Array;
  readonly optimizedPaletteIndexes?: Uint32Array;
  readonly optimizedPositions?: Float32Array;
  readonly optimizedScales?: Float32Array;
  readonly paletteTextureHeights?: Uint16Array;
  readonly paletteTextureOffsets?: Uint32Array;
  readonly paletteTextureRgbaSrgb?: Uint8Array;
  readonly paletteTextureWidths?: Uint16Array;
  readonly view: 'optimized' | 'original' | 'split';
}

export function EditorScene({
  cameraClipEnd,
  mesh,
  optimizedColors,
  optimizedPaletteIndexes,
  optimizedPositions,
  optimizedScales,
  paletteTextureHeights,
  paletteTextureOffsets,
  paletteTextureRgbaSrgb,
  paletteTextureWidths,
  view,
}: EditorSceneProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = container.current;
    if (host === null) return undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0e0c');
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, cameraClipEnd);
    camera.position.set(7, 6, 8);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(
      (mesh.bounds[0] + mesh.bounds[3]) / 2,
      (mesh.bounds[1] + mesh.bounds[4]) / 2,
      (mesh.bounds[2] + mesh.bounds[5]) / 2,
    );

    scene.add(new THREE.HemisphereLight('#dce8d2', '#1f291f', 2.2));
    const key = new THREE.DirectionalLight('#fff4d2', 3.6);
    key.position.set(8, 13, 7);
    scene.add(key);
    const grid = new THREE.GridHelper(80, 80, '#516055', '#28312b');
    grid.position.y = Math.floor(mesh.bounds[1] ?? 0);
    scene.add(grid);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    if (mesh.texcoords !== undefined) geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.texcoords, 2));
    const groupedIndices: number[] = [];
    for (let material = 0; material < mesh.materialNames.length; material += 1) {
      const start = groupedIndices.length;
      for (let triangle = 0; triangle < mesh.triangleMaterials.length; triangle += 1) {
        if ((mesh.triangleMaterials[triangle] ?? 0) !== material) continue;
        groupedIndices.push(
          mesh.indices[triangle * 3] ?? 0,
          mesh.indices[triangle * 3 + 1] ?? 0,
          mesh.indices[triangle * 3 + 2] ?? 0,
        );
      }
      if (groupedIndices.length > start) geometry.addGroup(start, groupedIndices.length - start, material);
    }
    geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(groupedIndices), 1));
    geometry.computeVertexNormals();
    const atlas = mesh.textureAtlas;
    const wrapMode = (mode: number) => mode === 10497
      ? THREE.RepeatWrapping
      : mode === 33648 ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping;
    const originalTextures: THREE.DataTexture[] = atlas === undefined
      ? []
      : Array.from({ length: atlas.widths.length }, (_value, textureIndex) => {
          const offset = atlas.offsets[textureIndex] ?? 0;
          const end = atlas.offsets[textureIndex + 1] ?? offset;
          const texture = new THREE.DataTexture(
            atlas.rgbaSrgb.slice(offset, end),
            atlas.widths[textureIndex] ?? 1,
            atlas.heights[textureIndex] ?? 1,
            THREE.RGBAFormat,
          );
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = false;
          texture.wrapS = wrapMode(atlas.wrapS[textureIndex] ?? 33071);
          texture.wrapT = wrapMode(atlas.wrapT[textureIndex] ?? 33071);
          texture.needsUpdate = true;
          return texture;
        });
    const originalMaterials = mesh.materialNames.map((_name, materialIndex) => {
      const color = new THREE.Color('#c9d2c1');
      const colorOffset = materialIndex * 4;
      if (mesh.materialBaseColorsLinear !== undefined) {
        color.setRGB(
          mesh.materialBaseColorsLinear[colorOffset] ?? 1,
          mesh.materialBaseColorsLinear[colorOffset + 1] ?? 1,
          mesh.materialBaseColorsLinear[colorOffset + 2] ?? 1,
          THREE.LinearSRGBColorSpace,
        );
      }
      const alpha = mesh.materialBaseColorsLinear?.[colorOffset + 3] ?? 1;
      const textureIndex = mesh.materialTextureIndexes?.[materialIndex] ?? -1;
      return new THREE.MeshStandardMaterial({
        color,
        map: textureIndex >= 0 ? originalTextures[textureIndex] : undefined,
        metalness: 0.05,
        opacity: alpha * (view === 'split' ? 0.24 : 0.88),
        roughness: 0.72,
        side: THREE.DoubleSide,
        transparent: view === 'split' || alpha < 1,
        wireframe: view === 'split',
      });
    });
    const original = new THREE.Mesh(
      geometry,
      originalMaterials,
    );
    original.visible = view !== 'optimized';
    scene.add(original);

    const optimizedMeshes: THREE.InstancedMesh[] = [];
    const optimizedTextures: THREE.DataTexture[] = [];
    if (optimizedPositions !== undefined && optimizedPositions.length > 0) {
      const groups = new Map<number, number[]>();
      for (let instance = 0; instance < optimizedPositions.length / 3; instance += 1) {
        const paletteIndex = optimizedPaletteIndexes?.[instance] ?? 0xffff_ffff;
        const group = groups.get(paletteIndex) ?? [];
        group.push(instance);
        groups.set(paletteIndex, group);
      }
      for (const [paletteIndex, instances] of groups) {
        const textureOffset = paletteTextureOffsets?.[paletteIndex];
        const textureEnd = paletteTextureOffsets?.[paletteIndex + 1];
        const textureWidth = paletteTextureWidths?.[paletteIndex] ?? 0;
        const textureHeight = paletteTextureHeights?.[paletteIndex] ?? 0;
        let texture: THREE.DataTexture | undefined;
        if (
          paletteTextureRgbaSrgb !== undefined && textureOffset !== undefined &&
          textureEnd !== undefined && textureEnd - textureOffset === textureWidth * textureHeight * 4
        ) {
          texture = new THREE.DataTexture(
            paletteTextureRgbaSrgb.slice(textureOffset, textureEnd),
            textureWidth,
            textureHeight,
            THREE.RGBAFormat,
          );
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.magFilter = THREE.NearestFilter;
          texture.minFilter = THREE.NearestFilter;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.needsUpdate = true;
          optimizedTextures.push(texture);
        }
        const cube = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({
          color: texture === undefined ? '#d5a843' : '#ffffff',
          map: texture,
          metalness: 0.02,
          roughness: 0.58,
          vertexColors: texture === undefined,
        });
        const optimized = new THREE.InstancedMesh(cube, material, instances.length);
        const matrix = new THREE.Matrix4();
        for (let localInstance = 0; localInstance < instances.length; localInstance += 1) {
          const instance = instances[localInstance] ?? 0;
          matrix.makeScale(
            optimizedScales?.[instance * 3] ?? 0.25,
            optimizedScales?.[instance * 3 + 1] ?? 0.25,
            optimizedScales?.[instance * 3 + 2] ?? 0.25,
          );
          matrix.setPosition(
            optimizedPositions[instance * 3] ?? 0,
            optimizedPositions[instance * 3 + 1] ?? 0,
            optimizedPositions[instance * 3 + 2] ?? 0,
          );
          optimized.setMatrixAt(localInstance, matrix);
          if (texture === undefined && optimizedColors !== undefined) {
            optimized.setColorAt(localInstance, new THREE.Color(
              optimizedColors[instance * 3] ?? 0.5,
              optimizedColors[instance * 3 + 1] ?? 0.5,
              optimizedColors[instance * 3 + 2] ?? 0.5,
            ));
          }
        }
        optimized.instanceMatrix.needsUpdate = true;
        if (optimized.instanceColor !== null) optimized.instanceColor.needsUpdate = true;
        optimized.visible = view !== 'original';
        optimizedMeshes.push(optimized);
        scene.add(optimized);
      }
    }

    const extent = Math.max(
      (mesh.bounds[3] ?? 1) - (mesh.bounds[0] ?? 0),
      (mesh.bounds[4] ?? 1) - (mesh.bounds[1] ?? 0),
      (mesh.bounds[5] ?? 1) - (mesh.bounds[2] ?? 0),
      1,
    );
    camera.position.copy(controls.target).add(new THREE.Vector3(extent * 1.4, extent, extent * 1.6));
    controls.update();

    const resize = new ResizeObserver(() => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    });
    resize.observe(host);
    let frame = 0;
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      geometry.dispose();
      for (const texture of originalTextures) texture.dispose();
      for (const material of originalMaterials) material.dispose();
      for (const texture of optimizedTextures) texture.dispose();
      for (const optimized of optimizedMeshes) {
        optimized.geometry.dispose();
        (optimized.material as THREE.Material).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [
    cameraClipEnd,
    mesh,
    optimizedColors,
    optimizedPaletteIndexes,
    optimizedPositions,
    optimizedScales,
    paletteTextureHeights,
    paletteTextureOffsets,
    paletteTextureRgbaSrgb,
    paletteTextureWidths,
    view,
  ]);

  return <div className="scene" ref={container} aria-label="Interactive 3D model preview" />;
}
