import {
  CLIENT_FOOTER,
  CLIENT_INTRO,
  clientBanner,
  clientBundle,
  clientPackageId,
} from './build/client-bundle.ts'

const manifest = new URL('./package.json', import.meta.url)

export const CLIENT_BANNER = clientBanner(clientPackageId(manifest))
export { CLIENT_FOOTER, CLIENT_INTRO }

export default clientBundle({
  manifest,
  entry: 'src/client/index.ts',
})
