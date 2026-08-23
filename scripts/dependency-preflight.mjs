// Dependency-availability preflight: pure evaluation of the compatibility
// policy contract's declared Host dependency lines against a registry snapshot.
//
// This module reads nothing and fetches nothing. The CLI
// (verify-dependency-preflight.mjs) supplies the policy contract and either a
// recorded snapshot or one it fetched, so the whole classification path is
// exercised offline in the unit gate and only the acquisition path needs a
// network.
//
// Range evaluation follows npm semantics, including the prerelease rule that
// caused the failure this preflight exists to catch: a prerelease version
// satisfies a comparator set only when some comparator in that set carries a
// prerelease on the same major.minor.patch tuple. A published `^0.1.1` edge is
// therefore unsatisfiable while only `0.1.1-rc.x` exists, which is exactly what
// the packed install reports as ERR_PNPM_NO_MATCHING_VERSION after several
// minutes of work.

export const DEPENDENCY_PREFLIGHT_SCHEMA_VERSION = 'dsh-legion-dependency-preflight-v1'
export const REGISTRY_SNAPSHOT_SCHEMA_VERSION = 'dsh-legion-registry-snapshot-v1'
export const COMPATIBILITY_POLICY_SCHEMA_VERSION = 'dsh-legion-compatibility-policy-v1'
export const DSH_SCOPE = '@deepseek-ai'

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
const PARTIAL_PATTERN = /^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
const TOKEN_PATTERN = /(?:>=|<=|>|<|=|\^|~)?\s*[0-9A-Za-z.\-+*xX]+/gu
const OPERATOR_PATTERN = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/u
const HYPHEN_PATTERN = /^(\S+)\s+-\s+(\S+)$/u

const parseVersion = (value) => {
  if (typeof value !== 'string') return null
  const match = VERSION_PATTERN.exec(value.trim())
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

const compareIdentifiers = (left, right) => {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right))
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

const comparePrerelease = (left, right) => {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftIdentifier = left[index]
    const rightIdentifier = right[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    const result = compareIdentifiers(leftIdentifier, rightIdentifier)
    if (result !== 0) return result
  }
  return 0
}

const compareParsed = (left, right) => Math.sign(left.major - right.major)
  || Math.sign(left.minor - right.minor)
  || Math.sign(left.patch - right.patch)
  || comparePrerelease(left.prerelease, right.prerelease)

/** Compare two version strings; unparseable versions sort below parseable ones. */
export const compareVersions = (left, right) => {
  const parsedLeft = parseVersion(left)
  const parsedRight = parseVersion(right)
  if (parsedLeft === null || parsedRight === null) {
    if (parsedLeft === null && parsedRight === null) return left < right ? -1 : left > right ? 1 : 0
    return parsedLeft === null ? -1 : 1
  }
  return compareParsed(parsedLeft, parsedRight)
}

// A partial version carries null for each wildcard position: 1.2.x parses as
// { major: 1, minor: 2, patch: null }, and * is all-null.
const parsePartial = (value) => {
  const match = PARTIAL_PATTERN.exec(value.trim())
  if (match === null) return null
  const position = (part) => (part === undefined || part === 'x' || part === 'X' || part === '*'
    ? null
    : Number(part))
  const major = position(match[1])
  const minor = position(match[2])
  const patch = position(match[3])
  if (major === null && (minor !== null || patch !== null)) return null
  if (minor === null && patch !== null) return null
  return { major, minor, patch, prerelease: match[4] === undefined ? [] : match[4].split('.') }
}

const zeroFilled = (partial) => ({
  major: partial.major ?? 0,
  minor: partial.minor ?? 0,
  patch: partial.patch ?? 0,
  prerelease: partial.prerelease,
})

// The exclusive bound just above everything a partial admits; null when the
// partial names an exact version or admits everything.
const boundAbove = (partial) => {
  if (partial.major === null) return null
  if (partial.minor === null) return { major: partial.major + 1, minor: 0, patch: 0, prerelease: ['0'] }
  if (partial.patch === null) {
    return { major: partial.major, minor: partial.minor + 1, patch: 0, prerelease: ['0'] }
  }
  return null
}

const caretBound = (partial) => {
  if (partial.major !== 0) return { major: partial.major + 1, minor: 0, patch: 0, prerelease: ['0'] }
  if (partial.minor === null) return { major: 1, minor: 0, patch: 0, prerelease: ['0'] }
  if (partial.minor !== 0) return { major: 0, minor: partial.minor + 1, patch: 0, prerelease: ['0'] }
  if (partial.patch === null) return { major: 0, minor: 1, patch: 0, prerelease: ['0'] }
  return { major: 0, minor: 0, patch: partial.patch + 1, prerelease: ['0'] }
}

const tildeBound = (partial) => (partial.minor === null
  ? { major: partial.major + 1, minor: 0, patch: 0, prerelease: ['0'] }
  : { major: partial.major, minor: partial.minor + 1, patch: 0, prerelease: ['0'] })

const expandComparator = (operator, partial) => {
  if (partial.major === null) {
    // '*' and its spellings admit every release; a strict inequality over a
    // wildcard is a degenerate form this evaluator declines rather than guesses.
    return operator === undefined || operator === '=' || operator === '>=' || operator === '<='
      ? [{ any: true }]
      : null
  }
  const exact = partial.patch !== null
  const lower = zeroFilled(partial)
  const above = boundAbove(partial)
  switch (operator) {
    case '>=':
      return [{ operator: '>=', version: lower }]
    case '>':
      return exact ? [{ operator: '>', version: lower }] : [{ operator: '>=', version: above }]
    case '<':
      return [{ operator: '<', version: lower }]
    case '<=':
      return exact ? [{ operator: '<=', version: lower }] : [{ operator: '<', version: above }]
    case '^':
      return [{ operator: '>=', version: lower }, { operator: '<', version: caretBound(partial) }]
    case '~':
      return [{ operator: '>=', version: lower }, { operator: '<', version: tildeBound(partial) }]
    default:
      return exact
        ? [{ operator: '=', version: lower }]
        : [{ operator: '>=', version: lower }, { operator: '<', version: above }]
  }
}

const parseHyphen = (lowerText, upperText) => {
  const lower = parsePartial(lowerText)
  const upper = parsePartial(upperText)
  if (lower === null || upper === null) return null
  const comparators = lower.major === null ? [] : [{ operator: '>=', version: zeroFilled(lower) }]
  if (upper.major === null) return comparators.length === 0 ? [{ any: true }] : comparators
  const above = boundAbove(upper)
  comparators.push(above === null
    ? { operator: '<=', version: zeroFilled(upper) }
    : { operator: '<', version: above })
  return comparators
}

const parseComparatorSet = (text) => {
  const trimmed = text.trim()
  if (trimmed === '') return [{ any: true }]
  const hyphen = HYPHEN_PATTERN.exec(trimmed)
  if (hyphen !== null) return parseHyphen(hyphen[1] ?? '', hyphen[2] ?? '')
  const tokens = trimmed.match(TOKEN_PATTERN)
  if (tokens === null) return null
  // Whitespace is the only thing tokenizing may drop, so anything else left
  // over is grammar this evaluator does not implement.
  const collapse = (value) => value.replace(/\s+/gu, '')
  if (collapse(tokens.join('')) !== collapse(trimmed)) return null
  const comparators = []
  for (const token of tokens) {
    const parts = OPERATOR_PATTERN.exec(token.trim())
    if (parts === null) return null
    const partial = parsePartial(parts[2] ?? '')
    if (partial === null) return null
    const expanded = expandComparator(parts[1], partial)
    if (expanded === null) return null
    comparators.push(...expanded)
  }
  return comparators
}

/**
 * Parse an npm range into a union of comparator sets. Returns null for any
 * grammar this evaluator does not implement, so an unknown range is reported
 * rather than silently treated as satisfied.
 */
const parseRange = (value) => {
  if (typeof value !== 'string') return null
  if (value.trim() === '') return [[{ any: true }]]
  const sets = []
  for (const alternative of value.split('||')) {
    // A non-empty range carrying an empty alternative is malformed rather than
    // permissive: reading it as '*' would let an unpublished version pass.
    if (alternative.trim() === '') return null
    const comparators = parseComparatorSet(alternative)
    if (comparators === null) return null
    sets.push(comparators)
  }
  return sets
}

const satisfiesSet = (version, set) => {
  for (const comparator of set) {
    if (comparator.any === true) continue
    const result = compareParsed(version, comparator.version)
    const held = comparator.operator === '>=' ? result >= 0
      : comparator.operator === '>' ? result > 0
        : comparator.operator === '<=' ? result <= 0
          : comparator.operator === '<' ? result < 0
            : result === 0
    if (!held) return false
  }
  if (version.prerelease.length === 0) return true
  // npm admits a prerelease only against a comparator carrying a prerelease on
  // the same tuple. This is the whole reason a published `^0.1.1` edge cannot
  // resolve against a registry holding only 0.1.1-rc.x.
  return set.some(comparator => comparator.any !== true
    && comparator.version.prerelease.length > 0
    && comparator.version.major === version.major
    && comparator.version.minor === version.minor
    && comparator.version.patch === version.patch)
}

/** True when the version satisfies the range; null when either cannot be parsed. */
export const satisfies = (version, range) => {
  const parsedVersion = parseVersion(version)
  const parsedRange = parseRange(range)
  if (parsedVersion === null || parsedRange === null) return null
  return parsedRange.some(set => satisfiesSet(parsedVersion, set))
}

/** True when the range is one this evaluator can decide at all. */
export const evaluatableRange = (range) => parseRange(range) !== null

const scoped = (name) => `${DSH_SCOPE}/${name}`

const sortVersions = (versions) => [...versions].sort(compareVersions)

const object = (value) => (typeof value === 'object' && value !== null && !Array.isArray(value)
  ? value
  : null)

// null means the snapshot records nothing for this package, which is missing
// evidence; an empty version list means the registry publishes nothing, which
// is a gap. The acquisition path writes an explicit empty list for a 404, so
// the two never collapse into each other.
const published = (snapshot, name) => {
  const entry = object(object(snapshot.packages) === null ? undefined : snapshot.packages[name])
  if (entry === null) return null
  const versions = Array.isArray(entry.versions)
    ? entry.versions.filter(item => typeof item === 'string')
    : []
  return {
    versions: sortVersions(versions),
    distTags: object(entry.distTags) ?? {},
    manifests: object(entry.manifests) ?? {},
  }
}

const offers = (versions) => (versions.length === 0
  ? 'nothing'
  : `${versions.length} published version${versions.length === 1 ? '' : 's'}, highest ${versions.at(-1)}`
    + ` (newest first: ${[...versions].reverse().slice(0, 4).join(', ')})`)

const finding = (value) => ({ ...value })

/**
 * Check what the compatibility policy contract declares against what a registry
 * publishes. Declared package closure and version lines come from the contract
 * alone; this module owns no second list of Host packages.
 */
export const evaluateDependencyPreflight = ({ policy, snapshot }) => {
  const registry = {
    url: typeof snapshot?.registry === 'string' ? snapshot.registry : 'unknown',
    source: snapshot?.source === 'live' ? 'live' : 'recorded',
    recordedAt: typeof snapshot?.recordedAt === 'string' ? snapshot.recordedAt : null,
  }
  const closure = Array.isArray(policy?.dshPackageClosure) ? policy.dshPackageClosure : []
  const assessed = Array.isArray(policy?.assessedDshVersions) ? policy.assessedDshVersions : []
  const declared = {
    peerRange: policy?.dshPeerRange ?? null,
    minimumDshVersion: policy?.minimumDshVersion ?? null,
    latestTestedDshVersion: policy?.latestTestedDshVersion ?? null,
    assessedDshVersions: assessed,
    packages: closure.map(scoped),
  }
  const localFindings = []
  const record = (value) => { localFindings.push(finding(value)) }

  if (policy?.schemaVersion !== COMPATIBILITY_POLICY_SCHEMA_VERSION) {
    record({
      code: 'LEGION_COMPATIBILITY_POLICY_UNRECOGNIZED',
      classification: 'local-regression',
      detail: `compatibility policy declares schemaVersion ${String(policy?.schemaVersion)}, expected ${COMPATIBILITY_POLICY_SCHEMA_VERSION}`,
    })
  }
  if (closure.length === 0) {
    record({
      code: 'LEGION_PACKAGE_CLOSURE_EMPTY',
      classification: 'local-regression',
      detail: 'compatibility policy declares no Host package closure to resolve',
    })
  }
  if (!evaluatableRange(declared.peerRange)) {
    record({
      code: 'LEGION_DECLARED_RANGE_UNSUPPORTED',
      classification: 'local-regression',
      range: declared.peerRange,
      detail: `the declared peer range ${String(declared.peerRange)} is not a range this preflight can evaluate`,
    })
  }
  const exactLines = []
  const addLine = (version, kind) => {
    if (parseVersion(version) === null) {
      record({
        code: 'LEGION_DECLARED_VERSION_INVALID',
        classification: 'local-regression',
        version,
        detail: `the declared ${kind} version ${String(version)} is not a valid semantic version`,
      })
      return
    }
    const existing = exactLines.find(line => line.version === version)
    if (existing === undefined) exactLines.push({ version, kinds: [kind] })
    else existing.kinds.push(kind)
  }
  addLine(declared.minimumDshVersion, 'minimum')
  addLine(declared.latestTestedDshVersion, 'latest-tested')
  for (const version of assessed) addLine(version, 'assessed')
  for (const line of exactLines) {
    if (satisfies(line.version, declared.peerRange) === false) {
      record({
        code: 'LEGION_DECLARED_LINE_OUTSIDE_PEER_RANGE',
        classification: 'local-regression',
        version: line.version,
        range: declared.peerRange,
        detail: `the declared ${line.kinds.join('/')} version ${line.version} does not satisfy the declared peer range ${String(declared.peerRange)}`,
      })
    }
  }
  for (const kind of ['minimum', 'latest-tested']) {
    const version = kind === 'minimum' ? declared.minimumDshVersion : declared.latestTestedDshVersion
    if (typeof version === 'string' && !assessed.includes(version)) {
      record({
        code: 'LEGION_ASSESSED_VERSIONS_INCOMPLETE',
        classification: 'local-regression',
        version,
        detail: `the declared ${kind} version ${version} is missing from assessedDshVersions`,
      })
    }
  }
  if (localFindings.length > 0) {
    return {
      schemaVersion: DEPENDENCY_PREFLIGHT_SCHEMA_VERSION,
      status: 'local-regression',
      registry,
      declared,
      checkedLines: 0,
      findings: localFindings,
      drift: { declaredLatestTested: declared.latestTestedDshVersion, highestResolvable: null, state: 'unknown' },
    }
  }

  const findings = []
  const resolvable = []
  const seeds = []
  let checkedLines = 0
  for (const name of declared.packages) {
    const entry = published(snapshot, name)
    if (entry === null) {
      findings.push(finding({
        code: 'LEGION_REGISTRY_COVERAGE_INCOMPLETE',
        classification: 'coverage',
        package: name,
        detail: `the registry snapshot records nothing for ${name}, which this contract declares in the Host package closure`,
      }))
      continue
    }
    if (entry.versions.length === 0) {
      findings.push(finding({
        code: 'LEGION_PACKAGE_UNPUBLISHED',
        classification: 'upstream-publish-gap',
        package: name,
        detail: `${name} is declared in the Host package closure and the registry publishes no version of it`,
      }))
      resolvable.push({ package: name, versions: [] })
      continue
    }
    const versionSet = new Set(entry.versions)
    for (const line of exactLines) {
      checkedLines += 1
      if (versionSet.has(line.version)) continue
      findings.push(finding({
        code: 'LEGION_DECLARED_LINE_UNPUBLISHED',
        classification: 'upstream-publish-gap',
        package: name,
        line: line.version,
        lineKind: line.kinds.join('/'),
        range: line.version,
        publishedVersions: entry.versions,
        detail: `${name} does not publish the declared ${line.kinds.join('/')} line ${line.version}; the registry offers ${offers(entry.versions)}`,
      }))
    }
    checkedLines += 1
    const admitted = entry.versions.filter(version => satisfies(version, declared.peerRange) === true)
    resolvable.push({ package: name, versions: admitted })
    if (admitted.length === 0) {
      findings.push(finding({
        code: 'LEGION_PEER_RANGE_UNSATISFIABLE',
        classification: 'upstream-publish-gap',
        package: name,
        range: declared.peerRange,
        publishedVersions: entry.versions,
        detail: `no published version of ${name} satisfies the declared peer range ${String(declared.peerRange)}; the registry offers ${offers(entry.versions)}`,
      }))
    }
    for (const [tag, version] of Object.entries(entry.distTags)) {
      if (typeof version !== 'string' || versionSet.has(version)) continue
      const advertisesDeclaredLine = exactLines.some(line => line.version === version)
      findings.push(finding({
        code: 'LEGION_DANGLING_DIST_TAG',
        classification: advertisesDeclaredLine ? 'upstream-publish-gap' : 'advisory',
        package: name,
        tag,
        line: version,
        publishedVersions: entry.versions,
        detail: `${name} advertises dist-tag ${tag} as ${version}, which the registry does not publish`
          + (advertisesDeclaredLine ? ' and which this contract declares as a Host line' : ''),
      }))
    }
    // Where a package's own requirements lead is decided by the resolution walk
    // below, not here: an install that does not pin the closure resolves each
    // range to the highest published version satisfying it and then follows
    // that version's requirements, so the version that fails may be several
    // hops from anything this contract names.
    const resolution = sortVersions(admitted).at(-1)
    for (const line of exactLines) {
      if (!versionSet.has(line.version)) continue
      seeds.push({
        package: name,
        version: line.version,
        label: `the declared ${line.kinds.join('/')} line`,
      })
    }
    if (resolution !== undefined && !exactLines.some(line => line.version === resolution)) {
      seeds.push({
        package: name,
        version: resolution,
        label: 'the highest version the declared peer range admits',
      })
    }
  }

  // The resolution walk. Every seed is a version an install can actually pick:
  // a declared line, or the top of the declared peer range for a consumer who
  // pins nothing. From there the walk follows what each version requires,
  // resolving each range the way a package manager does.
  const visited = new Set()
  const pending = [...seeds]
  while (pending.length > 0) {
    const current = pending.shift()
    const key = `${current.package}@${current.version}`
    if (visited.has(key)) continue
    visited.add(key)
    const entry = published(snapshot, current.package)
    if (entry === null) {
      findings.push(finding({
        code: 'LEGION_REGISTRY_COVERAGE_INCOMPLETE',
        classification: 'coverage',
        package: current.package,
        detail: `the snapshot records nothing for ${current.package}, reached as ${current.label}`,
      }))
      continue
    }
    const manifest = object(entry.manifests[current.version])
    if (manifest === null) {
      findings.push(finding({
        code: 'LEGION_REGISTRY_COVERAGE_INCOMPLETE',
        classification: 'coverage',
        package: current.package,
        line: current.version,
        detail: `the snapshot records no manifest for ${key} (${current.label})`
          + ', so what it requires of its siblings could not be checked',
      }))
      continue
    }
    const optionalPeers = object(manifest.peerDependenciesMeta) ?? {}
    const required = {
      ...(object(manifest.dependencies) ?? {}),
      ...(object(manifest.peerDependencies) ?? {}),
    }
    for (const [target, range] of Object.entries(required)) {
      if (!target.startsWith(`${DSH_SCOPE}/dsh-`)) continue
      // An optional peer nothing publishes is not an install failure.
      if (object(optionalPeers[target])?.optional === true) continue
      const targetEntry = published(snapshot, target)
      if (targetEntry === null) {
        findings.push(finding({
          code: 'LEGION_REGISTRY_COVERAGE_INCOMPLETE',
          classification: 'coverage',
          package: current.package,
          line: current.version,
          target,
          range,
          detail: `${key} (${current.label}) requires ${target}@${String(range)}`
            + ` and the snapshot records nothing for ${target}`,
        }))
        continue
      }
      checkedLines += 1
      if (!evaluatableRange(range)) {
        findings.push(finding({
          code: 'LEGION_REQUIRED_RANGE_UNPARSEABLE',
          classification: 'coverage',
          package: current.package,
          line: current.version,
          target,
          range,
          detail: `${key} (${current.label}) requires ${target}@${String(range)}`
            + ', which is not a range this preflight evaluates',
        }))
        continue
      }
      const candidates = targetEntry.versions.filter(version => satisfies(version, range) === true)
      if (candidates.length === 0) {
        findings.push(finding({
          code: 'LEGION_REQUIRED_RANGE_UNSATISFIABLE',
          classification: 'upstream-publish-gap',
          package: current.package,
          line: current.version,
          target,
          range,
          publishedVersions: targetEntry.versions,
          detail: `${key} (${current.label}) requires ${target}@${String(range)}`
            + ` and no published version of ${target} satisfies it; the registry offers ${offers(targetEntry.versions)}`,
        }))
        continue
      }
      pending.push({
        package: target,
        version: sortVersions(candidates).at(-1),
        label: `required by ${key}`,
      })
    }
  }

  const common = resolvable.length === 0
    ? []
    : resolvable.reduce(
      (accumulator, entry) => accumulator.filter(version => entry.versions.includes(version)),
      resolvable[0]?.versions ?? [],
    )
  const highestResolvable = sortVersions(common).at(-1) ?? null
  const declaredLatestTested = declared.latestTestedDshVersion
  const state = highestResolvable === null || typeof declaredLatestTested !== 'string'
    ? 'unresolvable'
    : !common.includes(declaredLatestTested)
        ? 'unresolvable'
        : compareVersions(declaredLatestTested, highestResolvable) < 0 ? 'behind' : 'current'
  const coverageIncomplete = findings.some(item => item.classification === 'coverage')
  if (state === 'unresolvable' && !coverageIncomplete) {
    findings.push(finding({
      code: 'LEGION_HOST_LINE_UNRESOLVABLE',
      classification: 'upstream-publish-gap',
      line: declaredLatestTested,
      detail: `the declared latest-tested Host version ${String(declaredLatestTested)} is not resolvable as one generation across the declared closure`
        + `; the highest resolvable version is ${highestResolvable ?? 'none'}`,
    }))
  } else if (state === 'behind') {
    findings.push(finding({
      code: 'LEGION_HOST_LINE_DRIFT',
      classification: 'advisory',
      line: declaredLatestTested,
      detail: `the declared latest-tested Host version ${String(declaredLatestTested)} has drifted behind the registry`
        + `; ${highestResolvable} is resolvable across the declared closure and inside the declared peer range`,
    }))
  }
  // Every version in the DSH 0.1.x line is a prerelease, and a package manager
  // that auto-installs peers may synthesize a stable-floored range (^0.1.1)
  // for a prerelease it resolved (0.1.1-rc.2). No published version satisfies
  // such a range, and none of it is visible in what upstream published: the
  // packed profile install hit exactly this on 2026-08-23 while every declared
  // line resolved. Reported, never failed on — the range is synthesized by the
  // installer, not declared by anyone.
  const resolutionPrerelease = highestResolvable === null
    ? false
    : (parseVersion(highestResolvable)?.prerelease.length ?? 0) > 0
  if (resolutionPrerelease) {
    findings.push(finding({
      code: 'LEGION_PRERELEASE_ONLY_RESOLUTION',
      classification: 'advisory',
      line: highestResolvable,
      detail: `the declared peer range resolves only to prereleases (highest ${String(highestResolvable)})`
        + ', so an install that auto-installs peers can ask the registry for a stable floor of that line'
        + ' that upstream has never published, even though every declared line resolves as published',
    }))
  }
  const ahead = resolvable
    .filter(entry => entry.versions.length > 0
      && highestResolvable !== null
      && compareVersions(sortVersions(entry.versions).at(-1) ?? '', highestResolvable) > 0)
    .map(entry => `${entry.package}@${sortVersions(entry.versions).at(-1)}`)
  if (ahead.length > 0) {
    findings.push(finding({
      code: 'LEGION_PEER_RANGE_SPLIT_GENERATION',
      classification: 'advisory',
      detail: `the declared peer range admits ${ahead.join(', ')} above the highest generation the whole closure publishes (${String(highestResolvable)})`
        + ', so an install that does not pin the closure can mix Host generations',
    }))
  }

  const all = [...localFindings, ...findings]
  const status = all.some(item => item.classification === 'local-regression')
    ? 'local-regression'
    : all.some(item => item.classification === 'upstream-publish-gap')
        ? 'upstream-publish-gap'
        : all.some(item => item.classification === 'coverage') ? 'incomplete-evidence' : 'satisfied'
  return {
    schemaVersion: DEPENDENCY_PREFLIGHT_SCHEMA_VERSION,
    status,
    registry,
    declared,
    checkedLines,
    findings: all,
    drift: { declaredLatestTested, highestResolvable, state },
  }
}

const CLASSIFICATION_HEADINGS = {
  'upstream-publish-gap': 'upstream publish gap (declared upstream, absent from the registry — not a Legion regression)',
  'local-regression': 'local regression (Legion\'s own declarations disagree — the registry is not at fault)',
  coverage: 'incomplete evidence (the preflight could not decide this, and does not report it as satisfied)',
  advisory: 'advisory (reported, does not fail the gate)',
}

const VERDICTS = {
  satisfied: 'every declared Host dependency line resolves against the registry',
  'upstream-publish-gap': 'the Host dependency closure this contract declares does not resolve'
    + ' against the registry as published. This is an upstream publish gap, not a Legion defect:'
    + ' pin, wait, or report it upstream rather than looking for a regression in this repository.',
  'local-regression': 'the compatibility policy contract contradicts itself.'
    + ' This is a local regression in this repository, not an upstream publish gap.',
  'incomplete-evidence': 'the registry evidence needed to decide a declared line is missing.'
    + ' This is neither a proven gap nor a passing line: record the missing metadata and run it again.',
}

/** Render one report as the gate's diagnostic text. */
export const renderDependencyPreflightReport = (report) => {
  const lines = [
    `dependency preflight: ${report.status}`,
    `registry: ${report.registry.url} (${report.registry.source}${report.registry.recordedAt === null ? '' : `, as of ${report.registry.recordedAt}`})`,
    `declared peer range: ${String(report.declared.peerRange)}`,
    `declared lines: minimum ${String(report.declared.minimumDshVersion)}, latest-tested ${String(report.declared.latestTestedDshVersion)}`
      + `, assessed ${report.declared.assessedDshVersions.join(', ')}`,
    `declared closure: ${report.declared.packages.length} packages, ${report.checkedLines} declared lines checked`,
  ]
  for (const classification of ['local-regression', 'upstream-publish-gap', 'coverage', 'advisory']) {
    const group = report.findings.filter(item => item.classification === classification)
    if (group.length === 0) continue
    lines.push('', `${CLASSIFICATION_HEADINGS[classification]}:`)
    for (const item of group) {
      lines.push(`  ${item.code}${item.package === undefined ? '' : ` ${item.package}`}`)
      lines.push(`    ${item.detail}`)
    }
  }
  lines.push(
    '',
    `host line drift: ${report.drift.state} (declared latest-tested ${String(report.drift.declaredLatestTested)}`
      + `, highest resolvable ${report.drift.highestResolvable ?? 'none'})`,
    `verdict: ${VERDICTS[report.status]}`,
  )
  return `${lines.join('\n')}\n`
}
