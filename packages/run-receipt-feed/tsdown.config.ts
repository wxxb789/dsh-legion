import { isAbsolute } from 'node:path'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'
import { defineConfig } from 'tsdown'

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('\0') && !isAbsolute(specifier)
}

export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/types.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: isBareSpecifier,
    alwaysBundle: (specifier: string) => !isBareSpecifier(specifier),
  },
  plugins: [typertPlugin({ mode: 'package', faces: ['host'] })],
})
