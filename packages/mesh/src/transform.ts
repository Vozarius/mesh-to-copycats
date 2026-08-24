import type { PackedTriangleMesh } from './types.js';

export interface MeshTransform {
  readonly rotationDegrees?: readonly [x: number, y: number, z: number];
  readonly translation?: readonly [x: number, y: number, z: number];
  readonly uniformScale?: number;
}

export function transformMesh(mesh: PackedTriangleMesh, transform: MeshTransform): PackedTriangleMesh {
  const [degreesX, degreesY, degreesZ] = transform.rotationDegrees ?? [0, 0, 0];
  const [translateX, translateY, translateZ] = transform.translation ?? [0, 0, 0];
  const uniformScale = transform.uniformScale ?? 1;
  for (const value of [degreesX, degreesY, degreesZ, translateX, translateY, translateZ, uniformScale]) {
    if (!Number.isFinite(value)) throw new RangeError('Mesh transform values must be finite');
  }
  if (uniformScale <= 0) throw new RangeError('Mesh uniform scale must be positive');
  // The editor spends most of its time at the identity transform. Returning the
  // immutable packed mesh directly avoids a complete second copy of large models.
  if (
    degreesX === 0 && degreesY === 0 && degreesZ === 0 &&
    translateX === 0 && translateY === 0 && translateZ === 0 &&
    uniformScale === 1
  ) {
    return mesh;
  }
  const radians = Math.PI / 180;
  const sinX = Math.sin(degreesX * radians);
  const cosX = Math.cos(degreesX * radians);
  const sinY = Math.sin(degreesY * radians);
  const cosY = Math.cos(degreesY * radians);
  const sinZ = Math.sin(degreesZ * radians);
  const cosZ = Math.cos(degreesZ * radians);
  const positions = new Float32Array(mesh.positions.length);
  const bounds = new Float32Array([
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]);
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    const x = (mesh.positions[vertex * 3] ?? 0) * uniformScale;
    const y = (mesh.positions[vertex * 3 + 1] ?? 0) * uniformScale;
    const z = (mesh.positions[vertex * 3 + 2] ?? 0) * uniformScale;
    const afterXy = y * cosX - z * sinX;
    const afterXz = y * sinX + z * cosX;
    const afterYx = x * cosY + afterXz * sinY;
    const afterYz = -x * sinY + afterXz * cosY;
    const transformedX = afterYx * cosZ - afterXy * sinZ + translateX;
    const transformedY = afterYx * sinZ + afterXy * cosZ + translateY;
    const transformedZ = afterYz + translateZ;
    positions[vertex * 3] = transformedX;
    positions[vertex * 3 + 1] = transformedY;
    positions[vertex * 3 + 2] = transformedZ;
    bounds[0] = Math.min(bounds[0] ?? transformedX, transformedX);
    bounds[1] = Math.min(bounds[1] ?? transformedY, transformedY);
    bounds[2] = Math.min(bounds[2] ?? transformedZ, transformedZ);
    bounds[3] = Math.max(bounds[3] ?? transformedX, transformedX);
    bounds[4] = Math.max(bounds[4] ?? transformedY, transformedY);
    bounds[5] = Math.max(bounds[5] ?? transformedZ, transformedZ);
  }
  if (mesh.vertexCount === 0) bounds.fill(0);
  return { ...mesh, bounds, positions };
}
