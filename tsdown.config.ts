import { defineConfig } from 'tsdown'

const shared = {
  outDir: 'lib',
  format: ['esm'] as Array<'esm'>,
  platform: 'node' as const,
  target: 'es2024',
  fixedExtension: false,
  deps: { neverBundle: [/^@deepseek-ai\//] },
}

export default defineConfig([
  {
    ...shared,
    entry: ['src/index.ts'],
    dts: true,
    clean: false,
  },
  {
    ...shared,
    entry: ['src/bin.ts'],
    dts: false,
    clean: false,
  },
])
