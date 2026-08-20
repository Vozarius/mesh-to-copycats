import { finalizeMesh, type PackedTriangleMesh } from './types.js';

export interface ObjImportOptions {
  readonly degenerateEpsilon?: number;
}

interface ObjReference {
  readonly position: number;
  readonly texcoord?: number;
}

function objIndex(value: string, count: number, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed === 0) throw new Error(`Invalid OBJ ${label} index ${value}`);
  const index = parsed > 0 ? parsed - 1 : count + parsed;
  if (index < 0 || index >= count) throw new RangeError(`OBJ ${label} index ${value} is out of range`);
  return index;
}

function parseReference(value: string, positionCount: number, texcoordCount: number): ObjReference {
  const fields = value.split('/');
  const positionToken = fields[0];
  if (positionToken === undefined || positionToken.length === 0) {
    throw new Error(`OBJ face reference ${value} has no position`);
  }
  const texcoordToken = fields[1];
  return {
    position: objIndex(positionToken, positionCount, 'position'),
    ...(texcoordToken === undefined || texcoordToken.length === 0
      ? {}
      : { texcoord: objIndex(texcoordToken, texcoordCount, 'texcoord') }),
  };
}

export function importObj(
  text: string,
  options: ObjImportOptions = {},
): PackedTriangleMesh {
  const sourcePositions: number[] = [];
  const sourceTexcoords: number[] = [];
  const positions: number[] = [];
  const texcoords: number[] = [];
  const indices: number[] = [];
  const triangleMaterials: number[] = [];
  const materialNames = ['default'];
  const materialIds = new Map<string, number>([['default', 0]]);
  const vertices = new Map<string, number>();
  let currentMaterial = 0;
  let hasTexcoords = false;

  const vertexIndex = (reference: ObjReference): number => {
    const key = `${reference.position}/${reference.texcoord ?? ''}`;
    const existing = vertices.get(key);
    if (existing !== undefined) return existing;
    const next = positions.length / 3;
    vertices.set(key, next);
    positions.push(
      sourcePositions[reference.position * 3] ?? 0,
      sourcePositions[reference.position * 3 + 1] ?? 0,
      sourcePositions[reference.position * 3 + 2] ?? 0,
    );
    if (reference.texcoord === undefined) {
      texcoords.push(0, 0);
    } else {
      hasTexcoords = true;
      texcoords.push(
        sourceTexcoords[reference.texcoord * 2] ?? 0,
        sourceTexcoords[reference.texcoord * 2 + 1] ?? 0,
      );
    }
    return next;
  };

  const lines = text.replace(/\r/gu, '').split('\n');
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = (lines[lineNumber] ?? '').trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const tokens = line.split(/\s+/u);
    const keyword = tokens.shift();
    if (keyword === 'v') {
      if (tokens.length < 3) throw new Error(`OBJ line ${lineNumber + 1}: vertex needs xyz`);
      sourcePositions.push(...tokens.slice(0, 3).map(Number));
    } else if (keyword === 'vt') {
      if (tokens.length < 2) throw new Error(`OBJ line ${lineNumber + 1}: texcoord needs uv`);
      sourceTexcoords.push(Number(tokens[0]), Number(tokens[1]));
    } else if (keyword === 'usemtl') {
      const name = tokens.join(' ');
      if (name.length === 0) throw new Error(`OBJ line ${lineNumber + 1}: usemtl needs a name`);
      let materialId = materialIds.get(name);
      if (materialId === undefined) {
        materialId = materialNames.length;
        materialIds.set(name, materialId);
        materialNames.push(name);
      }
      currentMaterial = materialId;
    } else if (keyword === 'f') {
      if (tokens.length < 3) throw new Error(`OBJ line ${lineNumber + 1}: face needs 3 vertices`);
      const references = tokens.map((token) => parseReference(
        token,
        sourcePositions.length / 3,
        sourceTexcoords.length / 2,
      ));
      const first = vertexIndex(references[0]!);
      for (let corner = 1; corner + 1 < references.length; corner += 1) {
        indices.push(first, vertexIndex(references[corner]!), vertexIndex(references[corner + 1]!));
        triangleMaterials.push(currentMaterial);
      }
    }
  }
  return finalizeMesh(
    {
      indices,
      materialNames,
      positions,
      ...(hasTexcoords ? { texcoords } : {}),
      triangleMaterials,
    },
    options,
  );
}
