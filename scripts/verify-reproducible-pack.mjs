import { createHash } from 'node:crypto'
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const outputArgument = process.argv.slice(2).find(argument => argument !== '--')
const outputDirectory = outputArgument === undefined ? undefined : resolve(outputArgument)
const sandbox = await mkdtemp(join(tmpdir(), 'dsh-legion-reproducible-pack-'))
const canonicalTempRoot = await realpath(tmpdir())
const canonicalSandboxRoot = await realpath(sandbox)
const relativeSandbox = relative(canonicalTempRoot, canonicalSandboxRoot)
if (relativeSandbox.startsWith('..') || relativeSandbox === '') {
  throw new Error(`refusing to use unexpected temporary path: ${sandbox}`)
}

function run(program, args, cwd) {
  const command = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : program
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', program, ...args]
    : args
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} failed with exit code ${String(result.status)}`)
  }
}

const excludedRoots = new Set(['.git', 'dist', 'lib', 'node_modules'])
const copySource = source => {
  const relativeSource = relative(root, source)
  if (relativeSource === '') return true
  return !excludedRoots.has(relativeSource.split(/[\\/]/u)[0])
}

try {
  const digests = []
  const tarballs = []
  for (const round of ['first', 'second']) {
    const roundRoot = join(sandbox, round)
    const packageRoot = join(roundRoot, 'package')
    const destination = join(roundRoot, 'pack')
    await mkdir(roundRoot)
    await cp(root, packageRoot, { recursive: true, filter: copySource })
    await symlink(
      join(root, 'node_modules'),
      join(packageRoot, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    run('pnpm', ['run', 'build'], packageRoot)
    await mkdir(destination)
    run('npm', ['pack', '--ignore-scripts', '--pack-destination', destination], packageRoot)
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
