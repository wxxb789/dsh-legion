import {
  CLIENT_FOOTER,
  CLIENT_INTRO,
  clientBanner,
  clientBundle,
} from './build/client-bundle.ts'

const ID = 'dsh-legion'

export const CLIENT_BANNER = clientBanner(ID)
export { CLIENT_FOOTER, CLIENT_INTRO }

export default clientBundle({
  manifest: new URL('./package.json', import.meta.url),
  entry: 'src/client/index.ts',
})
