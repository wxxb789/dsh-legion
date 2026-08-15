import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const outputArgument = process.argv.slice(2).find(argument => argument !== '--')
const outputDirectory = outputArgument === undefined ? undefined : resolve(outputArgument)
const sandbox = await mkdtemp(join(tmpdir(), 'dsh-legion-reproducible-pack-'))

function run(program, args) {
  const command = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : program
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', program, ...args]
    : args
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} failed with exit code ${String(result.status)}`)
  }
}

try {
  const digests = []
  const tarballs = []
  for (const round of ['first', 'second']) {
    run('pnpm', ['run', 'build'])
    const destination = join(sandbox, round)
    await mkdir(destination)
    run('npm', ['pack', '--ignore-scripts', '--pack-destination', destination])
    const tarball = join(destination, `dsh-legion-${String(manifest.version)}.tgz`)
    tarballs.push(tarball)
    digests.push(createHash('sha256').update(await readFile(tarball)).digest('hex'))
  }
  if (digests[0] !== digests[1]) {
    throw new Error(`reproducible pack mismatch: ${digests[0]} != ${digests[1]}`)
  }
  if (outputDirectory !== undefined) {
    await mkdir(outputDirectory, { recursive: true })
    await copyFile(
      tarballs[0],
      join(outputDirectory, `dsh-legion-${String(manifest.version)}.tgz`),
    )
  }
  process.stdout.write(`verified reproducible package sha256:${digests[0]}\n`)
} finally {
  await rm(sandbox, { recursive: true, force: true })
}
