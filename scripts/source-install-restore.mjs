import { readFileSync, writeFileSync } from 'node:fs'

const DEFAULT_IO = { readFileSync, writeFileSync }

/** Restore every temporary project rewrite and verify exact original bytes. */
export function restoreProjectFiles(originals, installError, io = DEFAULT_IO) {
  const errors = []
  for (const [path, source] of originals) {
    try { io.writeFileSync(path, source) } catch (error) { errors.push(error) }
  }
  for (const [path, source] of originals) {
    try {
      if (io.readFileSync(path, 'utf8') !== source) errors.push(new Error(`source install did not restore ${path}`))
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'source install failed to restore project files',
      installError === undefined ? undefined : { cause: installError })
  }
  if (installError !== undefined) throw installError
}
