import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { readWorkspacePackages, resolveWorkspaceInstalledPackage } from './scripts/workspace-packages.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const WORKSPACE_PACKAGES = readWorkspacePackages(ROOT)
const installed = (path: string): string => {
  const separator = path.indexOf('/')
  const packageName = `@deepseek-ai/${separator === -1 ? path : path.slice(0, separator)}`
  const packageRoot = resolveWorkspaceInstalledPackage(ROOT, WORKSPACE_PACKAGES, packageName)
  return separator === -1 ? packageRoot : resolve(packageRoot, path.slice(separator + 1))
}
const rendererTestSource = process.env.DSH_LEGION_RENDERER_TEST_SOURCE
  ?? installed('dsh-client-ui-renderer/src')
const rendererTestFile = (path: string): string => resolve(rendererTestSource, 'client', path)

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@deepseek-ai/dsh-api-gateway/client': installed('dsh-api-gateway/lib/types/client/index.js'),
      '@deepseek-ai/dsh-api-session-controller/client': installed('dsh-api-session-controller/lib/types/client/index.js'),
      '@deepseek-ai/dsh-client-ui-chat/client': installed('dsh-client-ui-chat/lib/types/client/contract/snapshot.js'),
      '@deepseek-ai/dsh-client-ui-conversation/client': installed('dsh-client-ui-conversation/lib/types/client/contract/snapshot.js'),
      '@deepseek-ai/dsh-client-ui-renderer/client': installed('dsh-client-ui-renderer/lib/types/client/index.js'),
      '@deepseek-ai/dsh-client-ui-renderer/src/client/bind.ts': rendererTestFile('bind.ts'),
      '@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx': rendererTestFile('scoped-slots.tsx'),
      '@deepseek-ai/dsh-client-ui-session/client': installed('dsh-client-ui-session/lib/types/client/index.js'),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts', 'packages/*/tests/**/*.spec.ts'],
    server: { deps: { inline: [/@deepseek-ai\/dsh-(?:client-test-runtime|client-ui-renderer|client-ui-session|api-session-controller)/] } },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'packages/*/src/**/*.ts'],
    },
  },
})
