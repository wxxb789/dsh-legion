import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const installed = (path: string): string => resolve(ROOT, 'node_modules/@deepseek-ai', path)

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@deepseek-ai/dsh-api-gateway/client': installed('dsh-api-gateway/src/client/index.ts'),
      '@deepseek-ai/dsh-api-session-controller/client': installed('dsh-api-session-controller/src/client/index.ts'),
      '@deepseek-ai/dsh-client-ui-chat/client': installed('dsh-client-ui-chat/lib/types/client/contract/snapshot.js'),
      '@deepseek-ai/dsh-client-ui-conversation/client': installed('dsh-client-ui-conversation/lib/types/client/contract/snapshot.js'),
      '@deepseek-ai/dsh-client-ui-renderer/client': installed('dsh-client-ui-renderer/src/client/index.ts'),
      '@deepseek-ai/dsh-client-ui-session/client': installed('dsh-client-ui-session/src/client/index.ts'),
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
