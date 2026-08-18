import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACP_AGENT_CATALOG, renderAcpFragment } from '../lib/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(root, 'examples/legion.acp.fragment.yml')
writeFileSync(target, renderAcpFragment(ACP_AGENT_CATALOG))
process.stdout.write(`rendered ${target}\n`)
