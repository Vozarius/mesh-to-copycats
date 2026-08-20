import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { PackedTriangleMesh } from '@mesh-to-copycats/mesh';

export interface EditorSceneProps {
  readonly mesh: PackedTriangleMesh;
  readonly optimizedColors?: Float32Array;
  readonly optimizedPositions?: Float32Array;
  readonly view: 'optimized' | 'original' | 'split';
}

export function EditorScene({ mesh, optimizedColors, optimizedPositions, view }: EditorSceneProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = container.current;
    if (host === null) return undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0e0c');
    scene.fog = new THREE.Fog('#0b0e0c', 28, 85);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 500);
    camera.position.set(7, 6, 8);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
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
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeVertexNormals();
    const original = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: '#c9d2c1',
        metalness: 0.05,
        opacity: view === 'split' ? 0.24 : 0.88,
        roughness: 0.72,
        side: THREE.DoubleSide,
        transparent: view === 'split',
        wireframe: view === 'split',
      }),
    );
    original.visible = view !== 'optimized';
    scene.add(original);

    let optimized: THREE.InstancedMesh | undefined;
    if (optimizedPositions !== undefined && optimizedPositions.length > 0) {
      const cube = new THREE.BoxGeometry(0.235, 0.235, 0.235);
      const material = new THREE.MeshStandardMaterial({
        color: '#d5a843',
        metalness: 0.02,
        roughness: 0.58,
        vertexColors: true,
      });
      optimized = new THREE.InstancedMesh(cube, material, optimizedPositions.length / 3);
      const matrix = new THREE.Matrix4();
      for (let instance = 0; instance < optimized.count; instance += 1) {
        matrix.makeTranslation(
          optimizedPositions[instance * 3] ?? 0,
          optimizedPositions[instance * 3 + 1] ?? 0,
          optimizedPositions[instance * 3 + 2] ?? 0,
        );
        optimized.setMatrixAt(instance, matrix);
        if (optimizedColors !== undefined) {
          optimized.setColorAt(instance, new THREE.Color(
            optimizedColors[instance * 3] ?? 0.5,
            optimizedColors[instance * 3 + 1] ?? 0.5,
            optimizedColors[instance * 3 + 2] ?? 0.5,
          ));
        }
      }
      optimized.instanceMatrix.needsUpdate = true;
      if (optimized.instanceColor !== null) optimized.instanceColor.needsUpdate = true;
      optimized.visible = view !== 'original';
      scene.add(optimized);
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
      (original.material as THREE.Material).dispose();
      optimized?.geometry.dispose();
      (optimized?.material as THREE.Material | undefined)?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [mesh, optimizedColors, optimizedPositions, view]);

  return <div className="scene" ref={container} aria-label="Interactive 3D model preview" />;
}
