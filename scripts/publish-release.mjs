#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { resolveNativeInvocation } from './native-command.mjs'

function runNpm(args) {
  const invocation = resolveNativeInvocation('npm', args)
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8', shell: false, windowsHide: true,
  })
  if (result.error !== undefined) {
    throw new Error(`cannot run npm ${args[0]}: ${result.error.message}`)
  }
  return result
}

export function integrityOf(filename) {
  const digest = createHash('sha512').update(readFileSync(filename)).digest('base64')
  return `sha512-${digest}`
}

function registryState(packageSpec, registry, execute) {
  const result = execute([
    'view', packageSpec, 'dist.integrity', '--json', `--registry=${registry}`,
  ])
  if (result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`
    if (output.includes('E404') || output.includes('404 Not Found')) return { kind: 'absent' }
    throw new Error(`npm view ${packageSpec} failed:\n${output}`)
  }

  let integrity
  try {
    integrity = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`registry returned invalid dist.integrity for ${packageSpec}`, { cause: error })
  }
  if (typeof integrity !== 'string' || integrity === '') {
    throw new Error(`registry reported no dist.integrity for ${packageSpec}`)
  }
  return { kind: 'present', integrity }
}

export function publishRelease({
  tarball, packageSpec, registry, execute = runNpm, checkOnly = false,
}) {
  const state = registryState(packageSpec, registry, execute)
  if (state.kind === 'present') {
    const localIntegrity = integrityOf(tarball)
    if (state.integrity !== localIntegrity) {
      throw new Error(
        `${packageSpec} is already published with different content`
        + `\n  registry: ${state.integrity}\n  packed:   ${localIntegrity}`
        + '\nBump the version, or investigate why the build is not reproducible.',
      )
    }
    return {
      kind: 'identical',
      message: `${packageSpec} is already published with identical content; skipping`,
    }
  }

  if (checkOnly) {
    return { kind: 'absent', message: `${packageSpec} is not published; preflight passed` }
  }
  const result = execute([
    'publish', tarball, '--access', 'public', '--provenance', `--registry=${registry}`,
  ])
  if (result.status !== 0) {
    const recovered = registryState(packageSpec, registry, execute)
    if (recovered.kind === 'present' && recovered.integrity === integrityOf(tarball)) {
      return {
        kind: 'recovered',
        message: `${packageSpec} published identical content before npm returned an error; recovered`,
      }
    }
    throw new Error(`npm publish ${packageSpec} failed:\n${result.stdout}${result.stderr}`)
  }
  return {
    kind: 'published',
    message: `${packageSpec} published`,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

/** Preflight the complete package set before publishing it in dependency order. */
export function publishPackageSet({ packages, registry, execute = runNpm }) {
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error('publish package set must not be empty')
  }
  const packageSpecs = new Set()
  const preflight = packages.map(item => {
    if (packageSpecs.has(item.packageSpec)) throw new Error(`duplicate release package ${item.packageSpec}`)
    packageSpecs.add(item.packageSpec)
    return publishRelease({ ...item, registry, execute, checkOnly: true })
  })
  return packages.map((item, index) => preflight[index].kind === 'identical'
    ? preflight[index]
    : publishRelease({ ...item, registry, execute }))
}

const entry = process.argv[1]
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  const [tarball, packageSpec, registry, ...flags] = process.argv.slice(2)
  if (tarball === undefined || packageSpec === undefined || registry === undefined
    || flags.some(flag => flag !== '--check-only')) {
    throw new Error('usage: publish-release.mjs <tarball> <package@version> <registry> [--check-only]')
  }
  const result = publishRelease({
    tarball, packageSpec, registry, checkOnly: flags.includes('--check-only'),
  })
  if (result.kind === 'published') {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
  }
  process.stdout.write(`${result.message}\n`)
}
