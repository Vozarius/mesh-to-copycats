import {
  ShapeFamily,
  type Aabb16,
  type Axis,
  type Direction,
} from '@mesh-to-copycats/shared';

import { buildShapeCatalog, type PackedShapeCatalog } from './catalog.js';
import { box16 } from './exact.js';
import type {
  ShapeDefinitionInput,
  ShapePartDefinition,
  ShapeState,
} from './types.js';

const FULL_BOX = box16(0, 0, 0, 16, 16, 16);
const HORIZONTAL_DIRECTIONS = ['south', 'west', 'north', 'east'] as const;
const ALL_DIRECTIONS: readonly Direction[] = [
  'down',
  'up',
  'north',
  'south',
  'west',
  'east',
];

const BYTE_KEYS = [
  'bottom_northwest',
  'bottom_northeast',
  'top_northwest',
  'top_northeast',
  'bottom_southwest',
  'bottom_southeast',
  'top_southwest',
  'top_southeast',
] as const;

const BYTE_PANEL_KEYS = [
  'bottom_left',
  'bottom_right',
  'top_left',
  'top_right',
] as const;

function rotateBoxYClockwise(box: Aabb16): Aabb16 {
  return box16(
    16 - box.maxZ,
    box.minY,
    box.minX,
    16 - box.minZ,
    box.maxY,
    box.maxX,
  );
}

function rotateBoxesY(boxes: readonly Aabb16[], quarterTurns: number): Aabb16[] {
  let result = [...boxes];
  for (let turn = 0; turn < ((quarterTurns % 4) + 4) % 4; turn += 1) {
    result = result.map(rotateBoxYClockwise);
  }
  return result;
}

function flipBoxesY(boxes: readonly Aabb16[]): Aabb16[] {
  return boxes.map((box) =>
    box16(box.minX, 16 - box.maxY, box.minZ, box.maxX, 16 - box.minY, box.maxZ),
  );
}

function facingQuarterTurns(facing: (typeof HORIZONTAL_DIRECTIONS)[number]): number {
  return HORIZONTAL_DIRECTIONS.indexOf(facing);
}

function axisHalfBox(axis: Axis, positive: boolean): Aabb16 {
  const minimum = positive ? 8 : 0;
  const maximum = positive ? 16 : 8;
  if (axis === 'x') return box16(minimum, 0, 0, maximum, 16, 16);
  if (axis === 'y') return box16(0, minimum, 0, 16, maximum, 16);
  return box16(0, 0, minimum, 16, 16, maximum);
}

function faceBox(direction: Direction, thickness: number): Aabb16 {
  switch (direction) {
    case 'down':
      return box16(0, 0, 0, 16, thickness, 16);
    case 'up':
      return box16(0, 16 - thickness, 0, 16, 16, 16);
    case 'north':
      return box16(0, 0, 0, 16, 16, thickness);
    case 'south':
      return box16(0, 0, 16 - thickness, 16, 16, 16);
    case 'west':
      return box16(0, 0, 0, thickness, 16, 16);
    case 'east':
      return box16(16 - thickness, 0, 0, 16, 16, 16);
  }
}

function definition(
  blockId: string,
  family: ShapeFamily,
  state: ShapeState,
  boxes: readonly Aabb16[],
  complexity: number,
  routeKeys: readonly string[],
  parts?: readonly ShapePartDefinition[],
): ShapeDefinitionInput {
  const result: ShapeDefinitionInput = {
    blockId,
    boxes,
    complexity,
    family,
    routeKeys,
    state,
  };
  return parts === undefined ? result : { ...result, parts };
}

function pushBaseShapes(result: ShapeDefinitionInput[]): void {
  result.push(definition('fixture:air', ShapeFamily.AIR, {}, [], 0, ['AIR']));
  result.push(
    definition('fixture:full_cube', ShapeFamily.FULL_CUBE, {}, [FULL_BOX], 0, ['FULL']),
  );
  result.push(
    definition('fixture:copycat_block', ShapeFamily.FULL_CUBE, {}, [FULL_BOX], 2, ['FULL']),
  );
}

function pushSlabs(result: ShapeDefinitionInput[]): void {
  for (const axis of ['x', 'y', 'z'] as const) {
    for (const slabType of ['bottom', 'top'] as const) {
      const positive = slabType === 'top';
      result.push(
        definition(
          'fixture:copycat_slab',
          ShapeFamily.SLAB,
          { axis, type: slabType },
          [axisHalfBox(axis, positive)],
          2,
          [`SLAB:${axis}:${slabType}`],
          [
            {
              boxes: [axisHalfBox(axis, positive)],
              key: slabType,
              materialSlot: 0,
            },
          ],
        ),
      );
    }
    result.push(
      definition(
        'fixture:copycat_slab',
        ShapeFamily.SLAB,
        { axis, type: 'double' },
        [FULL_BOX],
        4,
        ['FULL', `SLAB:${axis}:double`],
        [
          { boxes: [axisHalfBox(axis, false)], key: 'bottom', materialSlot: 0 },
          { boxes: [axisHalfBox(axis, true)], key: 'top', materialSlot: 1 },
        ],
      ),
    );
  }
}

function pushLayers(result: ShapeDefinitionInput[]): void {
  for (const facing of ALL_DIRECTIONS) {
    for (let layers = 1; layers <= 8; layers += 1) {
      const boxes = [faceBox(facing, layers * 2)];
      result.push(
        definition(
          'fixture:copycat_layer',
          ShapeFamily.LAYER,
          { facing, layers },
          boxes,
          2,
          [`LAYER:${facing}:${layers}`],
        ),
      );
    }
  }
}

function halfLayerPartBox(
  axis: 'x' | 'z',
  positive: boolean,
  half: 'bottom' | 'top',
  layers: number,
): Aabb16 {
  const height = layers * 2;
  const minY = half === 'bottom' ? 0 : 16 - height;
  const maxY = half === 'bottom' ? height : 16;
  const axisMin = positive ? 8 : 0;
  const axisMax = positive ? 16 : 8;
  return axis === 'x'
    ? box16(axisMin, minY, 0, axisMax, maxY, 16)
    : box16(0, minY, axisMin, 16, maxY, axisMax);
}

function pushHalfLayers(result: ShapeDefinitionInput[]): void {
  for (const axis of ['x', 'z'] as const) {
    for (const half of ['bottom', 'top'] as const) {
      for (let negativeLayers = 0; negativeLayers <= 8; negativeLayers += 1) {
        for (let positiveLayers = 0; positiveLayers <= 8; positiveLayers += 1) {
          if (negativeLayers === 0 && positiveLayers === 0) continue;
          const parts: ShapePartDefinition[] = [];
          if (negativeLayers > 0) {
            parts.push({
              boxes: [halfLayerPartBox(axis, false, half, negativeLayers)],
              key: 'negative_layers',
              materialSlot: 0,
            });
          }
          if (positiveLayers > 0) {
            parts.push({
              boxes: [halfLayerPartBox(axis, true, half, positiveLayers)],
              key: 'positive_layers',
              materialSlot: parts.length,
            });
          }
          const boxes = parts.flatMap((part) => part.boxes);
          result.push(
            definition(
              'fixture:copycat_half_layer',
              ShapeFamily.HALF_LAYER,
              {
                axis,
                half,
                negative_layers: negativeLayers,
                positive_layers: positiveLayers,
              },
              boxes,
              parts.length > 1 ? 4 : 3,
              [`HALF_LAYER:${axis}:${half}:${negativeLayers}:${positiveLayers}`],
              parts,
            ),
          );
        }
      }
    }
  }
}

function stairFootprint(shape: string): Aabb16[] {
  switch (shape) {
    case 'straight':
      return [box16(0, 8, 8, 16, 16, 16)];
    case 'inner_left':
      return [box16(0, 8, 8, 16, 16, 16), box16(8, 8, 0, 16, 16, 8)];
    case 'inner_right':
      return [box16(0, 8, 8, 16, 16, 16), box16(0, 8, 0, 8, 16, 8)];
    case 'outer_left':
      return [box16(8, 8, 8, 16, 16, 16)];
    case 'outer_right':
      return [box16(0, 8, 8, 8, 16, 16)];
    default:
      throw new Error(`Unknown stair shape ${shape}`);
  }
}

function pushStairs(result: ShapeDefinitionInput[]): void {
  const stairShapes = ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'];
  for (const facing of HORIZONTAL_DIRECTIONS) {
    for (const half of ['bottom', 'top'] as const) {
      for (const shape of stairShapes) {
        let boxes = [box16(0, 0, 0, 16, 8, 16), ...stairFootprint(shape)];
        if (half === 'top') boxes = flipBoxesY(boxes);
        boxes = rotateBoxesY(boxes, facingQuarterTurns(facing));
        result.push(
          definition(
            'fixture:copycat_stairs',
            ShapeFamily.STAIRS,
            { facing, half, shape },
            boxes,
            shape === 'straight' ? 2 : 3,
            [`STAIRS:${facing}:${half}:${shape}`],
          ),
        );
      }
    }
  }
}

function verticalStairBoxes(shape: string, side: 'left' | 'right'): Aabb16[] {
  const base = box16(0, 0, 8, 16, 16, 16);
  const sideMin = side === 'left' ? 8 : 0;
  const sideMax = side === 'left' ? 16 : 8;
  switch (shape) {
    case 'straight':
      return [base, box16(sideMin, 0, 0, sideMax, 16, 8)];
    case 'outer_bottom':
      return [base, box16(sideMin, 0, 0, sideMax, 8, 8)];
    case 'outer_top':
      return [base, box16(sideMin, 8, 0, sideMax, 16, 8)];
    case 'inner_bottom':
      return [
        base,
        box16(sideMin, 0, 0, sideMax, 16, 8),
        box16(side === 'left' ? 0 : 8, 0, 0, side === 'left' ? 8 : 16, 8, 8),
      ];
    case 'inner_top':
      return [
        base,
        box16(sideMin, 0, 0, sideMax, 16, 8),
        box16(side === 'left' ? 0 : 8, 8, 0, side === 'left' ? 8 : 16, 16, 8),
      ];
    default:
      throw new Error(`Unknown vertical stair shape ${shape}`);
  }
}

function pushVerticalStairs(result: ShapeDefinitionInput[]): void {
  const shapes = ['straight', 'outer_bottom', 'outer_top', 'inner_bottom', 'inner_top'];
  for (const facing of HORIZONTAL_DIRECTIONS) {
    for (const side of ['left', 'right'] as const) {
      for (const shape of shapes) {
        const boxes = rotateBoxesY(
          verticalStairBoxes(shape, side),
          facingQuarterTurns(facing),
        );
        result.push(
          definition(
            'fixture:copycat_vertical_stairs',
            ShapeFamily.VERTICAL_STAIRS,
            { facing, side, vertical_stair_shape: shape },
            boxes,
            shape === 'straight' ? 2 : 3,
            [`VERTICAL_STAIRS:${facing}:${side}:${shape}`],
          ),
        );
      }
    }
  }
}

function pushSlices(result: ShapeDefinitionInput[]): void {
  for (const facing of HORIZONTAL_DIRECTIONS) {
    const rotation = facingQuarterTurns(facing);
    for (let layers = 1; layers <= 8; layers += 1) {
      const thickness = layers * 2;
      for (const half of ['bottom', 'top'] as const) {
        let boxes = [box16(0, 0, 16 - thickness, 16, thickness, 16)];
        if (half === 'top') boxes = flipBoxesY(boxes);
        boxes = rotateBoxesY(boxes, rotation);
        result.push(
          definition(
            'fixture:copycat_slice',
            ShapeFamily.SLICE,
            { facing, half, layers },
            boxes,
            3,
            [`SLICE:${facing}:${half}:${layers}`],
          ),
        );
      }

      const verticalBoxes = rotateBoxesY(
        [box16(16 - thickness, 0, 16 - thickness, 16, 16, 16)],
        rotation,
      );
      result.push(
        definition(
          'fixture:copycat_vertical_slice',
          ShapeFamily.VERTICAL_SLICE,
          { facing, layers },
          verticalBoxes,
          3,
          [`VERTICAL_SLICE:${facing}:${layers}`],
        ),
      );

      for (const half of ['bottom', 'top'] as const) {
        let boxes = [
          box16(16 - thickness, 0, 16 - thickness, 16, thickness, 16),
        ];
        if (half === 'top') boxes = flipBoxesY(boxes);
        boxes = rotateBoxesY(boxes, rotation);
        result.push(
          definition(
            'fixture:copycat_corner_slice',
            ShapeFamily.CORNER_SLICE,
            { facing, half, layers },
            boxes,
            3,
            [`CORNER_SLICE:${facing}:${half}:${layers}`],
          ),
        );
      }
    }
  }
}

function byteBox(bit: number): Aabb16 {
  const minX = (bit & 1) === 0 ? 0 : 8;
  const minY = (bit & 2) === 0 ? 0 : 8;
  const minZ = (bit & 4) === 0 ? 0 : 8;
  return box16(minX, minY, minZ, minX + 8, minY + 8, minZ + 8);
}

function pushBytes(result: ShapeDefinitionInput[]): void {
  for (let octantMask = 1; octantMask < 256; octantMask += 1) {
    const parts: ShapePartDefinition[] = [];
    const state: Record<string, boolean> = {};
    for (let bit = 0; bit < 8; bit += 1) {
      const occupied = (octantMask & (1 << bit)) !== 0;
      state[BYTE_KEYS[bit]!] = occupied;
      if (occupied) {
        parts.push({
          boxes: [byteBox(bit)],
          key: BYTE_KEYS[bit]!,
          materialSlot: parts.length,
        });
      }
    }
    result.push(
      definition(
        'fixture:copycat_byte',
        ShapeFamily.BYTE,
        state,
        parts.flatMap((part) => part.boxes),
        2 + parts.length,
        [`BYTE:${octantMask}`],
        parts,
      ),
    );
  }
}

function panelPartBox(facing: Direction, horizontal: number, vertical: number): Aabb16 {
  const minHorizontal = horizontal * 8;
  const minVertical = vertical * 8;
  switch (facing) {
    case 'north':
      return box16(minHorizontal, minVertical, 0, minHorizontal + 8, minVertical + 8, 3);
    case 'south':
      return box16(minHorizontal, minVertical, 13, minHorizontal + 8, minVertical + 8, 16);
    case 'west':
      return box16(0, minVertical, minHorizontal, 3, minVertical + 8, minHorizontal + 8);
    case 'east':
      return box16(13, minVertical, minHorizontal, 16, minVertical + 8, minHorizontal + 8);
    case 'down':
      return box16(minHorizontal, 0, minVertical, minHorizontal + 8, 3, minVertical + 8);
    case 'up':
      return box16(minHorizontal, 13, minVertical, minHorizontal + 8, 16, minVertical + 8);
  }
}

function pushBytePanels(result: ShapeDefinitionInput[]): void {
  for (const facing of ALL_DIRECTIONS) {
    for (let partMask = 1; partMask < 16; partMask += 1) {
      const state: Record<string, boolean | string> = { facing };
      const parts: ShapePartDefinition[] = [];
      for (let part = 0; part < 4; part += 1) {
        const occupied = (partMask & (1 << part)) !== 0;
        const key = BYTE_PANEL_KEYS[part]!;
        state[key] = occupied;
        if (occupied) {
          parts.push({
            boxes: [panelPartBox(facing, part & 1, part >>> 1)],
            key,
            materialSlot: parts.length,
          });
        }
      }
      result.push(
        definition(
          'fixture:copycat_byte_panel',
          ShapeFamily.BYTE_PANEL,
          state,
          parts.flatMap((part) => part.boxes),
          3 + parts.length,
          [`BYTE_PANEL:${facing}:${partMask}`],
          parts,
        ),
      );
    }
  }
}

function pushBoards(result: ShapeDefinitionInput[]): void {
  for (let faceMask = 1; faceMask < 64; faceMask += 1) {
    const state: Record<string, boolean> = {};
    const parts: ShapePartDefinition[] = [];
    for (let face = 0; face < ALL_DIRECTIONS.length; face += 1) {
      const direction = ALL_DIRECTIONS[face]!;
      const occupied = (faceMask & (1 << face)) !== 0;
      state[direction] = occupied;
      if (occupied) {
        parts.push({
          boxes: [faceBox(direction, 1)],
          key: direction,
          materialSlot: parts.length,
        });
      }
    }
    result.push(
      definition(
        'fixture:copycat_board',
        ShapeFamily.BOARD,
        state,
        parts.flatMap((part) => part.boxes),
        3 + parts.length,
        [`BOARD:${faceMask}`],
        parts,
      ),
    );
  }
}

export function createFixtureDefinitions(): ShapeDefinitionInput[] {
  const result: ShapeDefinitionInput[] = [];
  pushBaseShapes(result);
  pushSlabs(result);
  pushLayers(result);
  pushHalfLayers(result);
  pushStairs(result);
  pushVerticalStairs(result);
  pushSlices(result);
  pushBytes(result);
  pushBytePanels(result);
  pushBoards(result);
  return result;
}

let cachedFixtureCatalog: PackedShapeCatalog | undefined;

export function createFixtureCatalog(): PackedShapeCatalog {
  return buildShapeCatalog(createFixtureDefinitions());
}

export function getFixtureCatalog(): PackedShapeCatalog {
  cachedFixtureCatalog ??= createFixtureCatalog();
  return cachedFixtureCatalog;
}
