import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function normalizeRegistry(value) {
  const registry = value.trim().replace(/\/+$/, '')
  let url
  try {
    url = new URL(registry)
  } catch {
    throw new Error(`invalid npm registry URL: ${JSON.stringify(value)}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`npm registry must use http or https: ${JSON.stringify(value)}`)
  }
  return registry
}

function projectRegistry(projectRoot) {
  let source
  try {
    source = readFileSync(join(projectRoot, '.npmrc'), 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  for (const line of source.split(/\r?\n/).reverse()) {
    const match = /^\s*registry\s*=\s*(.*?)\s*$/.exec(line)
    if (match?.[1]) return match[1]
  }
  return undefined
}

/** Resolve one install registry without duplicating the project .npmrc value. */
export function resolveNpmRegistry(projectRoot, explicit = process.env.DSH_REGISTRY) {
  const candidate = explicit === null
    ? projectRegistry(projectRoot)
    : explicit
      ?? process.env.NPM_CONFIG_REGISTRY
      ?? process.env.npm_config_registry
      ?? projectRegistry(projectRoot)
  if (candidate === undefined || candidate.trim().length === 0) {
    throw new Error('npm registry is not configured; set DSH_REGISTRY or add registry= to .npmrc')
  }
  return normalizeRegistry(candidate)
}
