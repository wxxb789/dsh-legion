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
const officialClientSource = (
  packageName: string,
  sourceDirectory: string,
  path: string,
  localFallback = `src/${path}`,
): string => process.env.DSH_LEGION_DSH_TEST_SOURCE === undefined
  ? installed(`${packageName}/${localFallback}`)
  : resolve(process.env.DSH_LEGION_DSH_TEST_SOURCE, 'packages/client', sourceDirectory, 'src', path)

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@deepseek-ai/dsh-api-gateway/client': installed('dsh-api-gateway/lib/types/client/index.js'),
      '@deepseek-ai/dsh-api-session-controller/client': installed('dsh-api-session-controller/lib/types/client/index.js'),
      '@deepseek-ai/dsh-client-ui-chat/client': officialClientSource(
        'dsh-client-ui-chat', 'ui-chat', 'client/contract/snapshot.ts', 'lib/types/client/contract/snapshot.js',
      ),
      '@deepseek-ai/dsh-client-ui-conversation/client': officialClientSource(
        'dsh-client-ui-conversation', 'ui-conversation', 'client/contract/snapshot.ts', 'lib/types/client/contract/snapshot.js',
      ),
      '@deepseek-ai/dsh-client-ui-renderer/client': officialClientSource('dsh-client-ui-renderer', 'ui-renderer', 'client/index.ts'),
      '@deepseek-ai/dsh-client-ui-renderer/src/client/bind.ts': officialClientSource('dsh-client-ui-renderer', 'ui-renderer', 'client/bind.ts'),
      '@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx': officialClientSource('dsh-client-ui-renderer', 'ui-renderer', 'client/scoped-slots.tsx'),
      '@deepseek-ai/dsh-client-ui-session/client': officialClientSource('dsh-client-ui-session', 'ui-session', 'client/index.ts'),
      'react-dom/client': resolve(
        resolveWorkspaceInstalledPackage(ROOT, WORKSPACE_PACKAGES, 'react-dom'),
        'client.js',
      ),
      'react-dom': resolve(
        resolveWorkspaceInstalledPackage(ROOT, WORKSPACE_PACKAGES, 'react-dom'),
        'index.js',
      ),
      'use-sync-external-store/shim/with-selector': resolve(
        resolveWorkspaceInstalledPackage(ROOT, WORKSPACE_PACKAGES, 'use-sync-external-store'),
        'shim/with-selector.js',
      ),
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
