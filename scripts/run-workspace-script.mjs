#!/usr/bin/env node

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runNativeCommand } from './native-command.mjs'
import { readWorkspacePackages } from './workspace-packages.mjs'

const script = process.argv[2]
if (script === undefined || process.argv.length !== 3) {
  throw new Error('usage: run-workspace-script.mjs <package-local-script>')
}
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
for (const workspacePackage of readWorkspacePackages(root)) {
  if (typeof workspacePackage.manifest.scripts?.[script] !== 'string') {
    throw new Error(`${workspacePackage.name} does not declare ${script}`)
  }
  runNativeCommand('pnpm', ['--dir', workspacePackage.directory, 'run', script], root)
}
