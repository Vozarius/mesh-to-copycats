#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import {
  GeometryOptimizer,
  familyName,
  type GeometryCandidate,
  type GeometryComparisonDebug,
  type OptimizerSettings,
} from '@mesh-to-copycats/optimizer';
import {
  getFixtureCatalog,
  type PackedShapeCatalog,
  type ShapeState,
} from '@mesh-to-copycats/shapes';
import {
  AdaptiveOccupancy,
  maskFromHex,
  type TargetOccupancy,
} from '@mesh-to-copycats/voxelizer';

const MODE_NAMES = ['FAST', 'BALANCED', 'QUALITY'] as const;
type ModeName = (typeof MODE_NAMES)[number];

interface CliOptions {
  diff: boolean;
  help: boolean;
  mask16: string | undefined;
  mode: ModeName;
  preset: string | undefined;
  shapeId: number | undefined;
}

interface TargetSelection {
  occupancy: TargetOccupancy;
  source: Readonly<Record<string, number | string>>;
}

interface PresetDefinition {
  readonly blockId?: string;
  readonly state?: ShapeState;
  readonly predicate?: (x16: number, y16: number, z16: number) => boolean;
}

const BYTE_SINGLE_STATE: ShapeState = {
  bottom_northeast: false,
  bottom_northwest: true,
  bottom_southeast: false,
  bottom_southwest: false,
  top_northeast: false,
  top_northwest: false,
  top_southeast: false,
  top_southwest: false,
};

const BOARD_NORTH_STATE: ShapeState = {
  down: false,
  east: false,
  north: true,
  south: false,
  up: false,
  west: false,
};

const PRESETS: Readonly<Record<string, PresetDefinition>> = {
  air: { blockId: 'fixture:air', state: {} },
  board: { blockId: 'fixture:copycat_board', state: BOARD_NORTH_STATE },
  byte: { blockId: 'fixture:copycat_byte', state: BYTE_SINGLE_STATE },
  complex: {
    predicate: (x, y, z) =>
      (x + y < 15 && z < 9) ||
      (x > 8 && y > 5 && z > 7 && x + z < 25),
  },
  full: { blockId: 'fixture:full_cube', state: {} },
  'layer-1': {
    blockId: 'fixture:copycat_layer',
    state: { facing: 'down', layers: 1 },
  },
  'slab-bottom': {
    blockId: 'fixture:copycat_slab',
    state: { axis: 'y', type: 'bottom' },
  },
  'slab-top': {
    blockId: 'fixture:copycat_slab',
    state: { axis: 'y', type: 'top' },
  },
  stairs: {
    blockId: 'fixture:copycat_stairs',
    state: { facing: 'south', half: 'bottom', shape: 'straight' },
  },
};

function usage(): string {
  return [
    'Usage: pnpm harness -- [target] [options]',
    '',
    'Choose at most one target:',
    `  --preset <name>     ${Object.keys(PRESETS).join(', ')}`,
    '  --shape-id <id>     Use a fixture ShapeCatalog shape as the target',
    '  --mask16 <hex|@file>  4096-bit mask as 1024 hex chars, or read it from a file',
    '',
    'Options:',
    '  --mode <FAST|BALANCED|QUALITY>  Refinement mode (default: BALANCED)',
    '  --diff              Render target/candidate/missing/extra 16^3 slices to stderr',
    '  --help              Show this help',
    '',
    'When no target is supplied, --preset full is used. JSON is written to stdout.',
  ].join('\n');
}

function optionValue(arguments_: readonly string[], index: number, name: string): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseMode(value: string): ModeName {
  const normalized = value.toUpperCase();
  if (!MODE_NAMES.includes(normalized as ModeName)) {
    throw new Error(`Unknown mode ${value}; expected ${MODE_NAMES.join(', ')}`);
  }
  return normalized as ModeName;
}

function parseArguments(arguments_: readonly string[]): CliOptions {
  const options: CliOptions = {
    diff: false,
    help: false,
    mask16: undefined,
    mode: 'BALANCED',
    preset: undefined,
    shapeId: undefined,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === '--') {
      continue;
    } else if (argument === '--diff') {
      options.diff = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--mask16') {
      options.mask16 = optionValue(arguments_, index, argument);
      index += 1;
    } else if (argument === '--mode') {
      options.mode = parseMode(optionValue(arguments_, index, argument));
      index += 1;
    } else if (argument === '--preset') {
      options.preset = optionValue(arguments_, index, argument).toLowerCase();
      index += 1;
    } else if (argument === '--shape-id') {
      const value = optionValue(arguments_, index, argument);
      const shapeId = Number(value);
      if (!Number.isSafeInteger(shapeId) || shapeId < 0) {
        throw new Error(`Invalid shape id ${value}`);
      }
      options.shapeId = shapeId;
      index += 1;
    } else {
      throw new Error(`Unknown argument ${argument}`);
    }
  }

  const targetCount = Number(options.mask16 !== undefined) +
    Number(options.preset !== undefined) +
    Number(options.shapeId !== undefined);
  if (targetCount > 1) {
    throw new Error('Choose only one of --preset, --shape-id, or --mask16');
  }
  return options;
}

function occupancyForShape(
  catalog: PackedShapeCatalog,
  shapeId: number,
): AdaptiveOccupancy {
  if (shapeId >= catalog.shapeCount) {
    throw new RangeError(
      `Shape id ${shapeId} is out of range; fixture catalog has ${catalog.shapeCount} shapes`,
    );
  }
  const geometryId = catalog.shapeGeometry[shapeId]!;
  return AdaptiveOccupancy.fromMask16(catalog.getGeometryMask(geometryId, 16).slice());
}

function targetFromPreset(
  catalog: PackedShapeCatalog,
  presetName: string,
): TargetSelection {
  const preset = PRESETS[presetName];
  if (preset === undefined) {
    throw new Error(
      `Unknown preset ${presetName}; expected ${Object.keys(PRESETS).join(', ')}`,
    );
  }
  if (preset.predicate !== undefined) {
    return {
      occupancy: AdaptiveOccupancy.fromPredicate(preset.predicate),
      source: { preset: presetName },
    };
  }
  const blockId = preset.blockId!;
  const shapeId = catalog.findShapeId(blockId, preset.state ?? {});
  if (shapeId === undefined) {
    throw new Error(`Preset ${presetName} does not exist in the fixture catalog`);
  }
  return {
    occupancy: occupancyForShape(catalog, shapeId),
    source: { preset: presetName, shapeId },
  };
}

function readMaskHex(value: string): string {
  const source = value.startsWith('@')
    ? readFileSync(value.slice(1), 'utf8')
    : value;
  return source.replace(/^0x/iu, '').replace(/[\s_]/gu, '');
}

function selectTarget(
  options: CliOptions,
  catalog: PackedShapeCatalog,
): TargetSelection {
  if (options.mask16 !== undefined) {
    const hex = readMaskHex(options.mask16);
    return {
      occupancy: AdaptiveOccupancy.fromMask16(maskFromHex(hex, 16)),
      source: { mask16: hex },
    };
  }
  if (options.shapeId !== undefined) {
    return {
      occupancy: occupancyForShape(catalog, options.shapeId),
      source: { shapeId: options.shapeId },
    };
  }
  return targetFromPreset(catalog, options.preset ?? 'full');
}

function serializeCandidate(candidate: GeometryCandidate): object {
  return {
    ...candidate,
    family: familyName(candidate.family),
    parts: candidate.parts.map((part) => ({
      compatibility: part.compatibility,
      key: part.key,
      materialSlot: part.materialSlot,
      partId: part.partId,
      ...(part.visibleSurfaceMask === undefined
        ? {}
        : { visibleSurfaceMask: Array.from(part.visibleSurfaceMask) }),
    })),
  };
}

function markedRows(slice: string, marker: string): string[] {
  return slice.split('\n').map((row) => row.replaceAll('#', marker));
}

function renderAsciiDiff(comparison: GeometryComparisonDebug): string {
  const lines = [
    `ASCII diff at ${comparison.resolution}^3 (# target, C candidate, M missing, E extra)`,
  ];
  for (let z = 0; z < comparison.resolution; z += 1) {
    const target = markedRows(comparison.target.slices[z]!, '#');
    const candidate = markedRows(comparison.candidate.slices[z]!, 'C');
    const missing = markedRows(comparison.missing.slices[z]!, 'M');
    const extra = markedRows(comparison.extra.slices[z]!, 'E');
    lines.push('', `z=${z}`, 'target            candidate         missing           extra');
    for (let row = 0; row < comparison.resolution; row += 1) {
      lines.push(
        `${target[row]!}  ${candidate[row]!}  ${missing[row]!}  ${extra[row]!}`,
      );
    }
  }
  return lines.join('\n');
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const catalog = getFixtureCatalog();
  const target = selectTarget(options, catalog);
  const optimizer = new GeometryOptimizer({ catalog });
  const result = optimizer.optimizeCell({
    occupancy: target.occupancy,
    settings: {
      collectTimings: true,
      qualityMode: options.mode as OptimizerSettings['qualityMode'],
    },
  });
  const comparison = options.diff
    ? optimizer.compare({ occupancy: target.occupancy }, result.best.geometryId, 16)
    : undefined;

  const output = {
    catalog: {
      estimatedBytes: catalog.estimateByteLength(),
      geometryCount: catalog.geometryCount,
      shapeCount: catalog.shapeCount,
    },
    input: {
      mode: options.mode,
      source: target.source,
    },
    result: {
      alternatives: result.alternatives.map(serializeCandidate),
      best: serializeCandidate(result.best),
      debug: result.debug,
      usedResolution: result.usedResolution,
    },
    ...(comparison === undefined
      ? {}
      : {
          diff: {
            candidateVoxels: comparison.candidate.voxels,
            extraVoxels: comparison.extra.voxels,
            missingVoxels: comparison.missing.voxels,
            resolution: comparison.resolution,
            targetVoxels: comparison.target.voxels,
          },
        }),
  };
  process.stdout.write(`${JSON.stringify(output, undefined, 2)}\n`);
  if (comparison !== undefined) {
    process.stderr.write(`${renderAsciiDiff(comparison)}\n`);
  }
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`harness: ${message}\n\n${usage()}\n`);
  process.exitCode = 1;
}
