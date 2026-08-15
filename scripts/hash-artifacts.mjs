import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const directory = resolve(process.argv[2] ?? 'dist')
const names = (await readdir(directory, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name !== 'SHA256SUMS')
  .map(entry => entry.name)
  .sort()
if (names.length === 0) throw new Error(`no release artifacts found in ${directory}`)
const lines = []
for (const name of names) {
  const bytes = await readFile(resolve(directory, name))
  lines.push(`${createHash('sha256').update(bytes).digest('hex')}  ${basename(name)}`)
}
await writeFile(resolve(directory, 'SHA256SUMS'), lines.join('\n') + '\n')
process.stdout.write(`hashed ${String(names.length)} release artifacts\n`)
