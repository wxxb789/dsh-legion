import { clientBundle } from '../../build/client-bundle.ts'

export default clientBundle({
  manifest: new URL('./package.json', import.meta.url),
  entry: 'lib/types/client/index.js',
  inline: ['dsh-legion-receipts/remote', 'zod'],
})
