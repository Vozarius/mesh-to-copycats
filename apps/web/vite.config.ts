import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const catalogRoot = resolve(repositoryRoot, 'generated/catalog');
const catalogFiles = new Set([
  'generated-blocks.bin',
  'generated-shapes.bin',
  'metadata.json',
  'material-palette.json',
  'neighbor-transitions.bin',
  'runtime-metadata.json',
]);

function productionCatalog(): Plugin {
  return {
    name: 'production-catalog',
    configureServer(server) {
      server.middlewares.use('/catalog', (request, response, next) => {
        void (async () => {
          const filename = request.url?.replace(/^\//u, '').split('?')[0] ?? '';
          if (!catalogFiles.has(filename)) {
            next();
            return;
          }
          try {
            const body = await readFile(resolve(catalogRoot, filename));
            response.statusCode = 200;
            response.setHeader(
              'Content-Type',
              filename.endsWith('.json') ? 'application/json' : 'application/octet-stream',
            );
            response.end(body);
          } catch {
            response.statusCode = 404;
            response.end('Production catalog has not been generated');
          }
        })();
      });
    },
    async writeBundle(options) {
      const output = resolve(options.dir ?? resolve(import.meta.dirname, 'dist'), 'catalog');
      await mkdir(output, { recursive: true });
      await Promise.all([...catalogFiles].map(async (filename) =>
        copyFile(resolve(catalogRoot, filename), resolve(output, filename))));
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              maxSize: 450_000,
              name: 'three-vendor',
              priority: 20,
              test: /node_modules[\\/]three[\\/]/,
            },
            {
              name: 'react-vendor',
              priority: 10,
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
  plugins: [react(), productionCatalog()],
  root: import.meta.dirname,
  server: { host: '127.0.0.1' },
});
