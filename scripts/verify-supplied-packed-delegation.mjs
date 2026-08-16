import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const directory = resolve(process.argv[2] ?? 'package-tarball')
const tarballs = (await readdir(directory, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.tgz'))
  .map(entry => resolve(directory, entry.name))
if (tarballs.length !== 1) {
  throw new Error(`packed delegation requires exactly one supplied tarball, found ${String(tarballs.length)}`)
}
process.env.DSH_LEGION_TARBALL = tarballs[0]
await import('./verify-packed-delegation.mjs')
