import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  compileExtractedCatalog,
  decodeGeneratedCatalog,
  decodeWebRuntimeCatalog,
  encodeGeneratedCatalog,
  getFixtureCatalog,
  type GeneratedCatalogArtifacts,
  type GeneratedCatalogSources,
} from '@mesh-to-copycats/shapes';

const DEFAULT_SOURCES: GeneratedCatalogSources = {
  copycats: '3.0.4+mc.1.21.1-neoforge',
  create: '6.0.10',
  extractor: '0.2.0',
  loader: 'neoforge-21.1.219',
  minecraft: '1.21.1',
};

interface Arguments {
  readonly fixture: boolean;
  readonly input?: string;
  readonly output: string;
  readonly verify: boolean;
}

function usage(): string {
  return [
    'Usage:',
    '  pnpm catalog:compile -- --input extracted-catalog.json --out generated/catalog',
    '  pnpm catalog:fixture -- --out generated/fixture',
    '',
    'Options:',
    '  --input <file>  Extracted JSON emitted by the NeoForge mod',
    '  --out <dir>     Output directory (default: generated/catalog)',
    '  --fixture       Compile the deterministic TypeScript fixture',
    '  --no-verify     Skip decoding the newly encoded artifacts',
  ].join('\n');
}

function parseArguments(values: readonly string[]): Arguments {
  let fixture = false;
  let input: string | undefined;
  let output = 'generated/catalog';
  let verify = true;
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === '--fixture') fixture = true;
    else if (argument === '--no-verify') verify = false;
    else if (argument === '--input') input = values[++index];
    else if (argument === '--out') output = values[++index] ?? '';
    else if (argument === '--help' || argument === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else throw new Error(`Unknown argument ${String(argument)}`);
  }
  if (output.length === 0) throw new Error('--out needs a directory');
  if (fixture === (input !== undefined)) {
    throw new Error('Choose exactly one of --fixture and --input <file>');
  }
  return {
    fixture,
    ...(input === undefined ? {} : { input }),
    output,
    verify,
  };
}

async function generate(arguments_: Arguments): Promise<GeneratedCatalogArtifacts> {
  if (arguments_.fixture) {
    return encodeGeneratedCatalog(getFixtureCatalog(), DEFAULT_SOURCES);
  }
  const inputPath = resolve(arguments_.input!);
  const sourceJson = await readFile(inputPath, 'utf8');
  const compiled = compileExtractedCatalog(sourceJson);
  return encodeGeneratedCatalog(
    compiled.catalog,
    compiled.document.sources,
    compiled.extraction,
    { evidenceMode: 'split' },
  );
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const artifacts = await generate(arguments_);
  if (arguments_.verify) {
    if (artifacts.runtimeMetadataJson === undefined) {
      decodeGeneratedCatalog({
        blocks: artifacts.blocks,
        metadata: artifacts.metadata,
        shapes: artifacts.shapes,
      });
    } else {
      decodeWebRuntimeCatalog({
        blocks: artifacts.blocks,
        metadata: artifacts.metadata,
        runtimeMetadata: artifacts.runtimeMetadataJson,
        shapes: artifacts.shapes,
      });
    }
  }
  const output = resolve(arguments_.output);
  await mkdir(output, { recursive: true });
  const writes = [
    writeFile(resolve(output, 'generated-shapes.bin'), artifacts.shapes),
    writeFile(resolve(output, 'generated-blocks.bin'), artifacts.blocks),
    writeFile(resolve(output, 'metadata.json'), artifacts.metadataJson, 'utf8'),
  ];
  if (artifacts.runtimeMetadataJson !== undefined) {
    writes.push(writeFile(
      resolve(output, 'runtime-metadata.json'),
      artifacts.runtimeMetadataJson,
      'utf8',
    ));
  }
  if (artifacts.auditMetadataJson !== undefined) {
    writes.push(writeFile(
      resolve(output, 'extraction-audit.json'),
      artifacts.auditMetadataJson,
      'utf8',
    ));
  }
  await Promise.all(writes);
  process.stdout.write(
    `${JSON.stringify(
      {
        counts: artifacts.metadata.counts,
        files: artifacts.metadata.artifacts,
        output,
        verified: arguments_.verify,
      },
      undefined,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
  process.exitCode = 1;
});
