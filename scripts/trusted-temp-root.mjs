import { realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute } from 'node:path'

/** Canonicalize the platform temp root selected by TMPDIR/TMP/TEMP and propagate it to child fixtures. */
export function trustedTempRoot() {
  const candidate = tmpdir()
  if (!isAbsolute(candidate)) {
    throw new Error(`system temporary root must be absolute: ${candidate}`)
  }
  const canonical = realpathSync(candidate)
  if (!statSync(canonical).isDirectory()) {
    throw new Error(`system temporary root is not a directory: ${canonical}`)
  }
  process.env.DSH_LEGION_TEMP_ROOT = canonical
  return canonical
}
