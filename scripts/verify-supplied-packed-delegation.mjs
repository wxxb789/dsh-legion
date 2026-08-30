import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPackedPackageSet } from './package-set.mjs'
import { readWorkspacePackages } from './workspace-packages.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const arguments_ = process.argv.slice(2).filter(argument => argument !== '--')
const directory = resolve(arguments_[0] ?? 'package-tarball')
const packageSet = readPackedPackageSet(directory, readWorkspacePackages(root))
const rootArtifact = packageSet.find(item => item.name === 'dsh-legion')
const companionArtifact = packageSet.find(item => item.name === 'dsh-legion-receipts')
if (rootArtifact === undefined || companionArtifact === undefined) {
  throw new Error('packed delegation requires the root and companion tarballs')
}
process.env.DSH_LEGION_TARBALL = rootArtifact.tarball
process.env.DSH_LEGION_RECEIPTS_TARBALL = companionArtifact.tarball
await import('./verify-packed-delegation.mjs')
