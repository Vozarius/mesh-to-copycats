import {
  finalizeMesh,
  type EmbeddedMeshTexture,
  type PackedTriangleMesh,
  type TextureWrapMode,
} from './types.js';

const GLB_MAGIC = 0x4654_6c67;
const JSON_CHUNK = 0x4e4f_534a;
const BIN_CHUNK = 0x004e_4942;

export interface GlbImportOptions {
  readonly degenerateEpsilon?: number;
  readonly scene?: number;
}

type JsonRecord = Record<string, unknown>;
type Matrix4 = readonly number[];

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value as number;
}

function numericArray(value: unknown, length: number, label: string): number[] {
  const values = array(value, label);
  if (values.length !== length || values.some((entry) => !Number.isFinite(entry))) {
    throw new Error(`${label} must contain ${length} finite numbers`);
  }
  return values as number[];
}

function identityMatrix(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrix(left: Matrix4, right: Matrix4): number[] {
  const output = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let inner = 0; inner < 4; inner += 1) {
        sum += (left[inner * 4 + row] ?? 0) * (right[column * 4 + inner] ?? 0);
      }
      output[column * 4 + row] = sum;
    }
  }
  return output;
}

function nodeMatrix(node: JsonRecord, label: string): number[] {
  if (node.matrix !== undefined) return numericArray(node.matrix, 16, `${label}.matrix`);
  const translation = node.translation === undefined
    ? [0, 0, 0]
    : numericArray(node.translation, 3, `${label}.translation`);
  const rotation = node.rotation === undefined
    ? [0, 0, 0, 1]
    : numericArray(node.rotation, 4, `${label}.rotation`);
  const scale = node.scale === undefined
    ? [1, 1, 1]
    : numericArray(node.scale, 3, `${label}.scale`);
  const [x, y, z, w] = rotation as [number, number, number, number];
  const length = Math.hypot(x, y, z, w);
  if (length === 0) throw new Error(`${label}.rotation must not be zero`);
  const qx = x / length;
  const qy = y / length;
  const qz = z / length;
  const qw = w / length;
  const sx = scale[0] ?? 1;
  const sy = scale[1] ?? 1;
  const sz = scale[2] ?? 1;
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx,
    (2 * (qx * qy + qz * qw)) * sx,
    (2 * (qx * qz - qy * qw)) * sx,
    0,
    (2 * (qx * qy - qz * qw)) * sy,
    (1 - 2 * (qx * qx + qz * qz)) * sy,
    (2 * (qy * qz + qx * qw)) * sy,
    0,
    (2 * (qx * qz + qy * qw)) * sz,
    (2 * (qy * qz - qx * qw)) * sz,
    (1 - 2 * (qx * qx + qy * qy)) * sz,
    0,
    translation[0] ?? 0,
    translation[1] ?? 0,
    translation[2] ?? 0,
    1,
  ];
}

function transformPoint(matrix: Matrix4, x: number, y: number, z: number): [number, number, number] {
  const w = (matrix[3] ?? 0) * x + (matrix[7] ?? 0) * y +
    (matrix[11] ?? 0) * z + (matrix[15] ?? 1);
  if (Math.abs(w) < 1e-15) throw new Error('GLB node transform produced a point at infinity');
  return [
    ((matrix[0] ?? 1) * x + (matrix[4] ?? 0) * y +
      (matrix[8] ?? 0) * z + (matrix[12] ?? 0)) / w,
    ((matrix[1] ?? 0) * x + (matrix[5] ?? 1) * y +
      (matrix[9] ?? 0) * z + (matrix[13] ?? 0)) / w,
    ((matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y +
      (matrix[10] ?? 1) * z + (matrix[14] ?? 0)) / w,
  ];
}

function componentCount(type: unknown, label: string): number {
  if (type === 'SCALAR') return 1;
  if (type === 'VEC2') return 2;
  if (type === 'VEC3') return 3;
  if (type === 'VEC4') return 4;
  throw new Error(`${label}.type ${String(type)} is unsupported`);
}

function componentBytes(componentType: number): number {
  if (componentType === 5120 || componentType === 5121) return 1;
  if (componentType === 5122 || componentType === 5123) return 2;
  if (componentType === 5125 || componentType === 5126) return 4;
  throw new Error(`GLB accessor component type ${componentType} is unsupported`);
}

function readComponent(
  view: DataView,
  offset: number,
  componentType: number,
  normalized: boolean,
): number {
  let value: number;
  if (componentType === 5120) value = view.getInt8(offset);
  else if (componentType === 5121) value = view.getUint8(offset);
  else if (componentType === 5122) value = view.getInt16(offset, true);
  else if (componentType === 5123) value = view.getUint16(offset, true);
  else if (componentType === 5125) value = view.getUint32(offset, true);
  else if (componentType === 5126) return view.getFloat32(offset, true);
  else throw new Error(`GLB accessor component type ${componentType} is unsupported`);
  if (!normalized) return value;
  if (componentType === 5120) return Math.max(value / 127, -1);
  if (componentType === 5121) return value / 255;
  if (componentType === 5122) return Math.max(value / 32767, -1);
  if (componentType === 5123) return value / 65535;
  throw new Error('Only byte and short integer accessors can be normalized');
}

interface AccessorValues {
  readonly components: number;
  readonly count: number;
  readonly values: number[];
}

function readAccessor(
  document: JsonRecord,
  binary: Uint8Array,
  accessorIndex: number,
): AccessorValues {
  const accessors = array(document.accessors, 'accessors');
  const accessor = record(accessors[accessorIndex], `accessors[${accessorIndex}]`);
  if (accessor.sparse !== undefined) throw new Error('Sparse GLB accessors are not supported');
  const bufferViewIndex = integer(accessor.bufferView, `accessors[${accessorIndex}].bufferView`);
  const bufferViews = array(document.bufferViews, 'bufferViews');
  const bufferView = record(
    bufferViews[bufferViewIndex],
    `bufferViews[${bufferViewIndex}]`,
  );
  if (bufferView.buffer !== undefined && bufferView.buffer !== 0) {
    throw new Error('GLB accessor references an external buffer');
  }
  const count = integer(accessor.count, `accessors[${accessorIndex}].count`);
  const componentType = integer(
    accessor.componentType,
    `accessors[${accessorIndex}].componentType`,
  );
  const components = componentCount(accessor.type, `accessors[${accessorIndex}]`);
  const bytes = componentBytes(componentType);
  const packedStride = bytes * components;
  const stride = bufferView.byteStride === undefined
    ? packedStride
    : integer(bufferView.byteStride, `bufferViews[${bufferViewIndex}].byteStride`);
  if (stride < packedStride) throw new Error('GLB bufferView stride is smaller than the accessor');
  const start = integer(bufferView.byteOffset ?? 0, 'bufferView.byteOffset') +
    integer(accessor.byteOffset ?? 0, 'accessor.byteOffset');
  const end = count === 0 ? start : start + (count - 1) * stride + packedStride;
  if (end > binary.byteLength) throw new RangeError('GLB accessor exceeds the BIN chunk');
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const values = new Array<number>(count * components);
  const normalized = accessor.normalized === true;
  for (let element = 0; element < count; element += 1) {
    for (let component = 0; component < components; component += 1) {
      values[element * components + component] = readComponent(
        view,
        start + element * stride + component * bytes,
        componentType,
        normalized,
      );
    }
  }
  return { components, count, values };
}

function bufferViewBytes(
  document: JsonRecord,
  binary: Uint8Array,
  bufferViewIndex: number,
  label: string,
): Uint8Array {
  const bufferViews = array(document.bufferViews, 'bufferViews');
  const view = record(bufferViews[bufferViewIndex], label);
  if (view.buffer !== undefined && view.buffer !== 0) throw new Error(`${label} references an external buffer`);
  const start = integer(view.byteOffset ?? 0, `${label}.byteOffset`);
  const length = integer(view.byteLength, `${label}.byteLength`);
  if (start + length > binary.length) throw new RangeError(`${label} exceeds the BIN chunk`);
  return binary.slice(start, start + length);
}

function textureWrap(value: unknown, label: string): TextureWrapMode {
  const mode = value === undefined ? 10497 : integer(value, label);
  if (mode !== 10497 && mode !== 33071 && mode !== 33648) {
    throw new Error(`${label} uses unsupported wrap mode ${mode}`);
  }
  return mode;
}

export function importGlb(
  input: ArrayBuffer | Uint8Array,
  options: GlbImportOptions = {},
): PackedTriangleMesh {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 20) throw new Error('GLB file is too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('GLB magic is invalid');
  if (view.getUint32(4, true) !== 2) throw new Error('Only GLB version 2 is supported');
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error('GLB declared length is invalid');
  let cursor = 12;
  let jsonBytes: Uint8Array | undefined;
  let binary: Uint8Array = new Uint8Array();
  while (cursor < bytes.byteLength) {
    if (cursor + 8 > bytes.byteLength) throw new Error('GLB chunk header is truncated');
    const length = view.getUint32(cursor, true);
    const type = view.getUint32(cursor + 4, true);
    cursor += 8;
    if (cursor + length > bytes.byteLength) throw new Error('GLB chunk is truncated');
    const chunk = bytes.subarray(cursor, cursor + length);
    if (type === JSON_CHUNK) {
      if (jsonBytes !== undefined) throw new Error('GLB contains multiple JSON chunks');
      jsonBytes = chunk;
    } else if (type === BIN_CHUNK) {
      if (binary.byteLength !== 0) throw new Error('GLB contains multiple BIN chunks');
      binary = chunk;
    }
    cursor += length;
  }
  if (jsonBytes === undefined) throw new Error('GLB has no JSON chunk');
  let jsonText = new TextDecoder().decode(jsonBytes);
  const nullCharacter = String.fromCharCode(0);
  while (jsonText.endsWith(' ') || jsonText.endsWith(nullCharacter)) {
    jsonText = jsonText.slice(0, -1);
  }
  const document = record(JSON.parse(jsonText) as unknown, 'GLB document');
  const buffers = document.buffers === undefined ? [] : array(document.buffers, 'buffers');
  if (buffers.length > 1 || buffers.some((entry) => record(entry, 'buffer').uri !== undefined)) {
    throw new Error('GLB external buffers are not supported');
  }
  const materials = document.materials === undefined ? [] : array(document.materials, 'materials');
  const textureDefinitions = document.textures === undefined ? [] : array(document.textures, 'textures');
  const imageDefinitions = document.images === undefined ? [] : array(document.images, 'images');
  const samplerDefinitions = document.samplers === undefined ? [] : array(document.samplers, 'samplers');
  const embeddedTextures: EmbeddedMeshTexture[] = textureDefinitions.map((entry, textureIndex) => {
    const texture = record(entry, `textures[${textureIndex}]`);
    const source = integer(texture.source, `textures[${textureIndex}].source`);
    const image = record(imageDefinitions[source], `images[${source}]`);
    if (image.uri !== undefined) throw new Error('GLB external and data-URI images are unsupported');
    const mimeType = image.mimeType;
    if (typeof mimeType !== 'string' || mimeType.length === 0) {
      throw new Error(`images[${source}].mimeType must be present for an embedded image`);
    }
    const sampler = texture.sampler === undefined
      ? undefined
      : record(samplerDefinitions[integer(texture.sampler, `textures[${textureIndex}].sampler`)], 'sampler');
    return {
      bytes: bufferViewBytes(
        document,
        binary,
        integer(image.bufferView, `images[${source}].bufferView`),
        `images[${source}].bufferView`,
      ),
      mimeType,
      wrapS: textureWrap(sampler?.wrapS, `textures[${textureIndex}].wrapS`),
      wrapT: textureWrap(sampler?.wrapT, `textures[${textureIndex}].wrapT`),
    };
  });
  const materialNames = ['default', ...materials.map((entry, index) => {
    const material = record(entry, `materials[${index}]`);
    return typeof material.name === 'string' && material.name.length > 0
      ? material.name
      : `material_${index}`;
  })];
  const materialBaseColorsLinear = [1, 1, 1, 1];
  const materialTextureIndexes = [-1];
  for (let index = 0; index < materials.length; index += 1) {
    const material = record(materials[index], `materials[${index}]`);
    const pbr = material.pbrMetallicRoughness === undefined
      ? undefined
      : record(material.pbrMetallicRoughness, `materials[${index}].pbrMetallicRoughness`);
    const factor = pbr?.baseColorFactor === undefined
      ? [1, 1, 1, 1]
      : array(pbr.baseColorFactor, `materials[${index}].baseColorFactor`);
    if (
      factor.length !== 4 ||
      factor.some((component) =>
        typeof component !== 'number' || !Number.isFinite(component) || component < 0 || component > 1)
    ) {
      throw new Error(`materials[${index}].baseColorFactor must contain four values in 0..1`);
    }
    materialBaseColorsLinear.push(...factor as number[]);
    const textureInfo = pbr?.baseColorTexture === undefined
      ? undefined
      : record(pbr.baseColorTexture, `materials[${index}].baseColorTexture`);
    if (textureInfo?.extensions !== undefined) {
      throw new Error('GLB base-color texture extensions are unsupported');
    }
    if (textureInfo?.texCoord !== undefined && textureInfo.texCoord !== 0) {
      throw new Error('Only GLB TEXCOORD_0 base-color textures are supported');
    }
    const textureIndex = textureInfo === undefined
      ? -1
      : integer(textureInfo.index, `materials[${index}].baseColorTexture.index`);
    if (textureIndex >= embeddedTextures.length) throw new RangeError('GLB base-color texture index is out of range');
    materialTextureIndexes.push(textureIndex);
  }
  const positions: number[] = [];
  const texcoords: number[] = [];
  const indices: number[] = [];
  const triangleMaterials: number[] = [];
  let hasTexcoords = false;
  const meshes = document.meshes === undefined ? [] : array(document.meshes, 'meshes');

  const appendMesh = (meshIndex: number, transform: Matrix4): void => {
    const mesh = record(meshes[meshIndex], `meshes[${meshIndex}]`);
    const primitives = array(mesh.primitives, `meshes[${meshIndex}].primitives`);
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
      const primitive = record(
        primitives[primitiveIndex],
        `meshes[${meshIndex}].primitives[${primitiveIndex}]`,
      );
      if (primitive.mode !== undefined && primitive.mode !== 4) {
        throw new Error('Only GLB TRIANGLES primitives are supported');
      }
      const attributes = record(primitive.attributes, 'primitive.attributes');
      const positionAccessor = integer(attributes.POSITION, 'primitive.attributes.POSITION');
      const positionValues = readAccessor(document, binary, positionAccessor);
      if (positionValues.components !== 3) throw new Error('GLB POSITION accessor must be VEC3');
      const texcoordValues = attributes.TEXCOORD_0 === undefined
        ? undefined
        : readAccessor(document, binary, integer(attributes.TEXCOORD_0, 'TEXCOORD_0'));
      if (texcoordValues !== undefined && (
        texcoordValues.components !== 2 || texcoordValues.count !== positionValues.count
      )) {
        throw new Error('GLB TEXCOORD_0 accessor must be a matching VEC2');
      }
      const vertexOffset = positions.length / 3;
      for (let vertex = 0; vertex < positionValues.count; vertex += 1) {
        positions.push(...transformPoint(
          transform,
          positionValues.values[vertex * 3] ?? 0,
          positionValues.values[vertex * 3 + 1] ?? 0,
          positionValues.values[vertex * 3 + 2] ?? 0,
        ));
        if (texcoordValues === undefined) texcoords.push(0, 0);
        else {
          hasTexcoords = true;
          texcoords.push(
            texcoordValues.values[vertex * 2] ?? 0,
            texcoordValues.values[vertex * 2 + 1] ?? 0,
          );
        }
      }
      const primitiveIndices = primitive.indices === undefined
        ? Array.from({ length: positionValues.count }, (_, index) => index)
        : readAccessor(document, binary, integer(primitive.indices, 'primitive.indices')).values;
      if (primitiveIndices.length % 3 !== 0) throw new Error('GLB primitive index count is not triangular');
      const material = primitive.material === undefined
        ? 0
        : integer(primitive.material, 'primitive.material') + 1;
      if (material >= materialNames.length) throw new RangeError('GLB primitive material is out of range');
      for (let index = 0; index < primitiveIndices.length; index += 3) {
        const a = primitiveIndices[index] ?? -1;
        const b = primitiveIndices[index + 1] ?? -1;
        const c = primitiveIndices[index + 2] ?? -1;
        if (![a, b, c].every((entry) => Number.isInteger(entry) && entry >= 0 && entry < positionValues.count)) {
          throw new RangeError('GLB primitive index is out of range');
        }
        indices.push(vertexOffset + a, vertexOffset + b, vertexOffset + c);
        triangleMaterials.push(material);
      }
    }
  };

  const nodes = document.nodes === undefined ? [] : array(document.nodes, 'nodes');
  const visitNode = (nodeIndex: number, parent: Matrix4, ancestry: Set<number>): void => {
    if (ancestry.has(nodeIndex)) throw new Error('GLB node graph contains a cycle');
    const node = record(nodes[nodeIndex], `nodes[${nodeIndex}]`);
    const world = multiplyMatrix(parent, nodeMatrix(node, `nodes[${nodeIndex}]`));
    if (node.mesh !== undefined) appendMesh(integer(node.mesh, 'node.mesh'), world);
    const nextAncestry = new Set(ancestry).add(nodeIndex);
    for (const child of node.children === undefined ? [] : array(node.children, 'node.children')) {
      visitNode(integer(child, 'node child'), world, nextAncestry);
    }
  };
  if (nodes.length === 0) {
    for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
      appendMesh(meshIndex, identityMatrix());
    }
  } else {
    const scenes = array(document.scenes, 'scenes');
    const sceneIndex = options.scene ?? integer(document.scene ?? 0, 'scene');
    const scene = record(scenes[sceneIndex], `scenes[${sceneIndex}]`);
    for (const nodeIndex of array(scene.nodes ?? [], `scenes[${sceneIndex}].nodes`)) {
      visitNode(integer(nodeIndex, 'scene node'), identityMatrix(), new Set());
    }
  }
  return finalizeMesh(
    {
      indices,
      materialBaseColorsLinear,
      materialNames,
      ...(embeddedTextures.length === 0 ? {} : { embeddedTextures }),
      ...(materialTextureIndexes.every((index) => index < 0) ? {} : { materialTextureIndexes }),
      positions,
      ...(hasTexcoords ? { texcoords } : {}),
      triangleMaterials,
    },
    options,
  );
}
