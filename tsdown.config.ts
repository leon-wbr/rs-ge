import { defineConfig } from 'tsdown';

export default defineConfig([
  { entry: ['src/index.ts'], format: 'esm', dts: true, platform: 'neutral', clean: true },
  { entry: ['src/cli.ts'], format: 'esm', platform: 'node', dts: false },
]);
