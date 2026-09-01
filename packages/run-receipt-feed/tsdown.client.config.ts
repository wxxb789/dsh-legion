import { clientBundle } from '../../build/client-bundle.ts'

export default clientBundle({
  manifest: new URL('./package.json', import.meta.url),
  entry: 'lib/types/client/index.js',
  inline: ['@deepseek-ai/dsh-typert-protocol', 'dsh-legion-receipts/remote', 'zod'],
})
