import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // общий пакет — это TS-исходники, вшиваем его в бандл
  noExternal: ['@peciatka/shared'],
});
