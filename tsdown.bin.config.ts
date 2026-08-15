import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/bin.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  deps: { neverBundle: [/^@deepseek-ai\//] },
  dts: false,
  clean: false,
})
