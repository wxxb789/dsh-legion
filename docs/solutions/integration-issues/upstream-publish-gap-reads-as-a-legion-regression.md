---
title: An upstream publish gap surfaces as a raw resolver error in the slowest gate and reads as a Legion regression
date: 2026-08-23
category: docs/solutions/integration-issues
module: compatibility policy contract
problem_type: integration_issue
component: tooling
symptoms:
  - The main branch goes red on a commit set that changed only Markdown
  - The failure is ERR_PNPM_NO_MATCHING_VERSION inside the packed profile install, minutes into the slowest job
  - The named package and range belong to the Host, not to anything this repository declares
  - The packed E2E jobs stay green while the quality job fails, so the break looks arbitrary
root_cause: dependency_issue
resolution_type: process_fix
severity: high
related_components:
  - development_workflow
tags: [dsh, compatibility, registry, semver, prerelease, ci, preflight]
---

# An upstream publish gap surfaces as a raw resolver error in the slowest gate and reads as a Legion regression

## Problem

The compatibility policy contract declares which Host versions Legion claims, but nothing checked that those
declarations are actually installable. The first gate to find out was the packed profile install, which resolves
the Host live from the public registry with no lockfile. An upstream publish gap therefore arrived as a raw
package-manager resolution error, minutes into the slowest job in the matrix, naming a package and a range that
appear nowhere in this repository — so it read as if Legion had broken. It did break main this way, on a commit
set that changed only Markdown.

## Symptoms

- `pnpm run test:profile-install` fails with `[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for
  @deepseek-ai/dsh-typert-protocol@>=0.1.1 <0.2.0-0`, and on the other matrix row with the same error for
  `@deepseek-ai/dsh-invariants`.
- The registry does publish `0.1.1-rc.1` of both packages, so the error looks wrong.
- The packed E2E jobs, which install the same Host line, pass — they pin the whole closure through overrides and
  never evaluate the upstream ranges.
- The failing range is normalized `^0.1.1`, written by the Host's own packages about their own siblings.

## Root cause

npm admits a prerelease version against a comparator set only when some comparator in that set carries a
prerelease on the same `major.minor.patch` tuple. `^0.1.1` normalizes to `>=0.1.1 <0.2.0-0`, whose comparators
carry no prerelease on the `0.1.1` tuple, so `0.1.1-rc.1` does not satisfy it. The Host published a
prerelease-only `0.1.1` line whose packages depend on each other through stable-only caret ranges. Every declared
version exists; the line still cannot resolve unless the installer pins it.

Legion's own peer range had just gained the `>=0.1.1-rc.1 <0.2.0` clause, so a free install slid up to the
prerelease line and hit the upstream ranges. The packed gates never did, because their overrides bypass ranges
entirely.

The version that fails is not one the contract names. A free install takes the *highest* version the declared
peer range admits, which was a prerelease published after the declared latest-tested line. Checking only the
declared lines therefore reports "satisfied" while the install still fails — the first live run of the preflight
did exactly that, and the check had to be widened to the version the peer range resolves to.

## What didn't work

- **Reading the version list alone.** Every declared line was published. A preflight that only asks "does this
  version exist" answers yes and misses the failure completely.
- **Checking only the versions the contract names.** The failing build is the one the peer range resolves to,
  which is by definition newer than the declared latest-tested line whenever the contract has drifted.
- **Trusting the dist-tags.** `latest` pointed at `0.1.0-rc.6` for one package and at `0.0.1-rc.1` for another
  while newer versions existed, so the tag says nothing about whether a declared line resolves.
- **Treating the packed E2E result as coverage.** It pins the closure to one exact generation, which is the one
  install shape that cannot observe an unsatisfiable upstream range.
- **Reproducing it locally.** The condition lives in registry metadata, not in the working tree, and the local
  install is lockfile-pinned.

## Solution

`scripts/verify-dependency-preflight.mjs` reads the declared closure and version lines from
`contracts/compatibility.json`, resolves each declared package against the registry, and evaluates three things:
whether each declared line is published, whether the declared peer range is satisfiable, and whether the
published packages can satisfy their own `@deepseek-ai/dsh-*` ranges — both at the declared lines and at the
highest version the declared peer range admits, which is the one an unpinned consumer installs. It classifies the outcome
as an upstream publish gap (exit 1) or a local regression in this repository (exit 2), and reports drift between
the declared latest-tested version and the highest version resolvable across the whole closure as an advisory.

Evidence it could not establish is its own outcome (exit 3): an unreachable registry, an unreadable contract, a
range grammar it does not implement, or a declared package the snapshot never recorded is reported as incomplete
evidence rather than as either a gap or a pass. A gate that answers "satisfied" because it could not look is the
same failure in a new place.

It runs ahead of every packed install, so the fast precise diagnostic precedes the slow ambiguous one, and it is
exercised offline in the unit gate against recorded snapshots under `tests/fixtures/registry/`.

## Prevention rule

A declared dependency line is a claim about a registry, and a claim about a registry is verified by asking the
registry — including what the packages it returns require of each other. Declare nothing about an upstream
version that no gate resolves before the slowest job depends on it, and classify every such failure as upstream
or local at the point of detection, because a diagnostic that does not name the responsible side sends the next
maintainer looking for a regression that is not there.
