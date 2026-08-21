import { finalizeMesh, type PackedTriangleMesh } from './types.js';

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
  const radians = Math.PI / 180;
  const sinX = Math.sin(degreesX * radians);
  const cosX = Math.cos(degreesX * radians);
  const sinY = Math.sin(degreesY * radians);
  const cosY = Math.cos(degreesY * radians);
  const sinZ = Math.sin(degreesZ * radians);
  const cosZ = Math.cos(degreesZ * radians);
  const positions: number[] = [];
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    const x = (mesh.positions[vertex * 3] ?? 0) * uniformScale;
    const y = (mesh.positions[vertex * 3 + 1] ?? 0) * uniformScale;
    const z = (mesh.positions[vertex * 3 + 2] ?? 0) * uniformScale;
    const afterXy = y * cosX - z * sinX;
    const afterXz = y * sinX + z * cosX;
    const afterYx = x * cosY + afterXz * sinY;
    const afterYz = -x * sinY + afterXz * cosY;
    positions.push(
      afterYx * cosZ - afterXy * sinZ + translateX,
      afterYx * sinZ + afterXy * cosZ + translateY,
      afterYz + translateZ,
    );
  }
  return finalizeMesh({
    ...(mesh.embeddedTextures === undefined ? {} : { embeddedTextures: mesh.embeddedTextures }),
    indices: Array.from(mesh.indices),
    ...(mesh.materialBaseColorsLinear === undefined
      ? {}
      : { materialBaseColorsLinear: Array.from(mesh.materialBaseColorsLinear) }),
    materialNames: [...mesh.materialNames],
    ...(mesh.materialTextureIndexes === undefined
      ? {}
      : { materialTextureIndexes: Array.from(mesh.materialTextureIndexes) }),
    positions,
    ...(mesh.texcoords === undefined ? {} : { texcoords: Array.from(mesh.texcoords) }),
    triangleMaterials: Array.from(mesh.triangleMaterials),
    ...(mesh.textureAtlas === undefined ? {} : { textureAtlas: mesh.textureAtlas }),
  });
}
