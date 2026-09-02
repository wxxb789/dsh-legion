---
title: Official DSH Test and Admission Seams - Plan
type: refactor
date: 2026-09-02
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Official DSH Test and Admission Seams - Plan

## Goal Capsule

- **Objective:** Legion maintainers can rely on official DSH Settings, Client test, and Subagent admission behavior with less local code and no user-visible feature regression.
- **Means:** Replace local test doubles with official public test seams and remove runtime checks already owned by `SubagentRuntime` (KTD1, KTD2, KTD3, KTD4).
- **Authority:** The direct user request and accepted three-item audit shortlist govern scope; repository architecture and compatibility contracts govern safety.
- **Execution profile:** Three bounded refactor units on `main`, followed by focused tests, the complete quality gate, packed compatibility lanes, commit, push, and CI verification.
- **Stop conditions:** Stop and preserve the current implementation if an official seam cannot reproduce a covered behavior without adding more local code, weakening a test, or changing the alpha.2–alpha.4 public compatibility window.

## Product Contract

### Summary

Reduce Legion-owned scaffolding by using official DSH public seams for Host Settings tests, direct child admission, and Client Settings-scope tests while preserving every existing product and compatibility contract.

### Problem Frame

Legion currently mirrors parts of DSH Settings and Subagent behavior in local helpers and tests. Those mirrors add maintenance cost and can drift from the Host implementation. The alpha.4 audit identified three bounded replacements that transfer mechanics to their official owners without moving Legion policy or changing the product surface.

### Requirements

**Official ownership**

- R1. Host Settings integration tests must exercise the public `@deepseek-ai/dsh-settings` provider behavior instead of maintaining local layer, freeze, watch, validation, and commit implementations.
- R2. Direct Specialist starts must rely on official `SubagentRuntime` provider and capability admission while Legion retains compile-time catalog diagnostics and exact selected-LLM-adapter checking.
- R3. Client Settings-card tests must use the public `stubSettingsScope` helper and model Host acceptance explicitly.

**Behavior preservation**

- R4. Invalid input, pre-aborted calls, unroutable calls, and rejected child starts must not clear the retained terminal Run Receipt.
- R5. Successful foreground and continuable child publication must clear the retained terminal Run Receipt exactly once without changing the returned Legion result.
- R6. Settings resolution, duplicate registration, service detach fallback, external commits, validation refusal, watcher disposal, and registration-race behavior covered by current tests must remain observable.

**Compatibility and packaging**

- R7. The refactor must not change Legion's public schemas, exports, result contracts, durable capability posture, or DSH peer range.
- R8. New package edges must be development-only exact alpha.4 pins, preserve one coherent lockfile graph, and add no production runtime dependency.
- R9. The final implementation, test, and manifest LOC delta must be negative across the three units; the plan artifact and generated lockfile churn are excluded from this code-size comparison.

### Key Decisions

- **Implement only the accepted first three official-reuse candidates.** (session-settled: user-approved — chosen over implementing the full audit backlog at once: the smaller batch limits regression and review scope.) Governs R1, R2, R3, R7, R9.

### Acceptance Examples

- AE1. **Covers R1, R6.** Given a stored Legion user section over a composition base, when the official in-memory Settings provider publishes or accepts a change, then the Legion tool and catalog republish from the same resolved value as before.
- AE2. **Covers R2, R4.** Given a provider that rejects a requested capability after catalog compilation, when a direct call reaches official admission, then the call fails and the previous terminal Receipt remains present.
- AE3. **Covers R2, R5.** Given a valid foreground or continuable request, when DSH publishes the child successfully, then Legion clears the prior terminal Receipt once and returns the normal result.
- AE4. **Covers R3, R6.** Given a visible staged Settings-card draft, when save records a mutation, then the accepted scope snapshot stays unchanged and the draft stays dirty until the test publishes Host acceptance before resolving the write; missing acceptance leaves the draft visible and marks save as failed.

### Scope Boundaries

#### In scope

- Consolidate the two Host Settings provider doubles behind one shared official-provider fixture.
- Remove duplicated direct-start provider/capability checks and preserve Receipt clearing semantics around official admission.
- Replace the Settings-card `FakeScope` with `stubSettingsScope`.
- Update package development pins, lockfile, focused tests, and any tests that deliberately pin these ownership boundaries.

#### Deferred to Follow-Up Work

- npm `semver`, core/tooling cleanup, `agent-loop-testkit` mount consolidation, UI-primitives mock removal, public form type aliases, and compatibility-floor cleanup from the wider LOC audit.
- Upstream proposals for a public neutral Settings-card runtime kit and per-consumer-base Settings attach seam.

#### Outside this product increment

- Durable Strategy Run redesign or rollback.
- Adoption of Workflow, Goal, Jobs, Storage, `dsh-timeout`, or `dsh-native-command` as replacements for Legion domain behavior.
- Public API, schema, compatibility-range, or user-facing feature changes.

## Planning Contract

### Key Technical Decisions

- KTD1. **Use one shared in-memory subclass of public `SettingsProvider`.** Keep only fixture controls that current tests need, such as initial document state, external publication, registration observation, write refusal, and registration-race injection. Delegate layering, freezing, validation, revision fencing, persistence-before-commit, and watcher sequencing to the official base class. Governs R1, R6, R8, R9.
- KTD2. **Make official Subagent admission authoritative.** (session-settled: user-approved — chosen over retaining Legion's duplicate runtime preflight: duplicate checks add LOC and can drift from DSH.) Keep pre-start compile diagnostics and selected adapter validation because those are Legion policy rather than provider admission. Governs R2, R4, R5, R7, R9.
- KTD3. **Clear terminal presentation only after successful child publication.** Move the clear after successful foreground `start` or continuable `startContinuable`; do not clear when official admission rejects. This changes an internal timing assertion but preserves the user-visible failure contract. Governs R4, R5.
- KTD4. **Treat Client Settings writes as proposals until Host acceptance.** Replace optimistic mutation inside the local fake with `stubSettingsScope` spies. For successful saves, publish the accepted snapshot before resolving a controlled write promise; for rejected saves, resolve without acceptance so the staged draft remains visible and failed. Governs R3, R6, R8, R9.

### Sequencing

U1 and U3 both touch the root development graph and lockfile, so land U1 first and let U3 update the advanced graph. U2 is behaviorally independent but should land between them so its Receipt tests remain isolated from Client test harness changes.

### Risks and Mitigations

- **Fixture-control loss:** The official Settings base class hides internal registration state. Expose only test-facing observations in the shared subclass or wrapper; do not reimplement provider mechanics.
- **Asynchronous write drift:** Official Settings writes are asynchronous and serialized. Update tests to await provider effects instead of reproducing synchronous commits.
- **Receipt timing regression:** Moving terminal clearing after child publication can leave the old terminal visible during provider startup. Tests must prove rejection retains it and success clears it once.
- **Client test-runtime packaging defect:** The alpha.4 published test runtime deep-imports renderer source files. Continue using the repository's existing `DSH_LEGION_DSH_TEST_SOURCE` alias path; do not remove source checkout plumbing in this increment.
- **Error wording drift:** Official Subagent errors may differ from Legion's old preflight text. Tests should assert stable outcome/ownership behavior unless an error string is part of a documented contract.

## Implementation Units

### U1. Consolidate Host Settings tests on the official provider

- **Goal:** Replace both local Host Settings implementations with one shared fixture built on `SettingsProvider`.
- **Requirements:** R1, R6, R8, R9; KTD1.
- **Dependencies:** None.
- **Files:** `package.json`, `pnpm-lock.yaml`, `contracts/compatibility.json`, `tests/settings-fixture.ts` (new), `tests/settings.spec.ts`, `tests/settings-plane.spec.ts`.
- **Approach:**
  1. Add the exact latest-tested `@deepseek-ai/dsh-settings` development pin and add `dsh-settings` to `registryInstallPackageClosure` without changing the runtime dependency surface.
  2. Build a small shared fixture around an official in-memory provider subclass and expose only the controls required by current scenarios.
  3. Convert existing assertions to official `describe`, update, external-publication, watch, and disposal behavior.
  4. Delete local merge, freeze, equality, registration, candidate-resolution, and commit implementations.
- **Execution note:** Characterize each current Settings scenario before deleting its fake behavior; keep the official provider as the only mechanics owner.
- **Patterns to follow:** `tests/durable-fixture.ts` for shared test support placement; `@deepseek-ai/dsh-settings` `SettingsProvider` and its official minimal memory subclass pattern.
- **Test scenarios:**
  - Covers AE1. A stored user layer overrides the composition base and publishes the expected tool name and Specialist catalog.
  - Duplicate namespace registration remains rejected and only the process-wide Settings row owns registration.
  - An accepted external commit republishes consumers; an invalid commit leaves the prior generation unchanged.
  - Service detach restores each delegation row's own composition entry.
  - Disposed Legion consumers stop reading or reacting to later provider publications.
  - Racing registration and validation refusal preserve the existing fallback and diagnostic behavior.
- **Verification:** Both Settings suites pass through the official provider, no local provider mechanics remain, and the human-authored LOC delta for this unit is negative.

### U2. Delegate direct-start admission to SubagentRuntime

- **Goal:** Remove duplicated provider/capability checks while preserving Legion policy and Receipt ownership.
- **Requirements:** R2, R4, R5, R7, R9; KTD2, KTD3.
- **Dependencies:** U1 only as repository sequence; no behavioral dependency.
- **Files:** `src/index.ts`, `tests/plugin.spec.ts`.
- **Approach:**
  1. Remove the private direct-start provider/capability preflight and its now-unused type import.
  2. Keep runtime catalog snapshots, compile-time diagnostics, request construction, and selected LLM adapter validation unchanged.
  3. Clear the terminal Receipt only after official foreground or continuable publication succeeds.
  4. Adjust tests from “clear before start” to the success/rejection ownership contract.
- **Execution note:** Start with Receipt-clear characterization cases for official rejection and successful publication before deleting the preflight.
- **Patterns to follow:** Official `SubagentRuntime.start` and `startContinuable` admission; existing `settleChildRun` for late publication and bounded cleanup, which remains Legion-owned.
- **Test scenarios:**
  - Covers AE2. A runtime capability rejection fails without clearing terminal presentation.
  - A pre-aborted or unroutable request still fails before child publication and does not clear.
  - Covers AE3. A foreground start clears once after publication and returns the same completed result.
  - Covers AE3. A continuable start clears once after publication and returns the same child identity.
  - Provider start rejection and continuable admission rejection leave the prior terminal intact.
  - Existing compile-time unavailable-provider and unsupported-capability diagnostics remain unchanged.
- **Verification:** Official admission owns runtime capability enforcement, Receipt clearing follows successful publication, and all direct foreground/continuable tests pass.

### U3. Replace the Client Settings FakeScope

- **Goal:** Use official `stubSettingsScope` for Settings-card write and acceptance behavior.
- **Requirements:** R3, R6, R8, R9; KTD4.
- **Dependencies:** U1 for the advanced package manifest and lockfile.
- **Files:** `package.json`, `pnpm-lock.yaml`, `tests/settings-card.spec.ts`.
- **Approach:**
  1. Add an exact latest-tested root development pin for `@deepseek-ai/dsh-client-test-runtime`; retain the existing source-backed alias mechanism.
  2. Replace `FakeScope` with the official stub and a compact helper that publishes ready snapshots and controls write-promise settlement.
  3. For successful saves, assert the mutation intent, publish the matching accepted snapshot, then resolve the write; for rejected saves, resolve without acceptance and assert failed dirty state.
  4. Preserve the legacy alias unset case, bounded-number validation, boolean staging, save, discard, and reset behavior.
- **Execution note:** Keep one counterfactual test showing that the staged draft is visible immediately, while a recorded save proposal alone neither changes the accepted scope snapshot nor clears dirty state.
- **Patterns to follow:** Existing Receipt overlay tests that use `SlotTestRuntime` and official Client Store/Settings helpers under the source-backed test lane.
- **Test scenarios:**
  - Covers AE4. Loading a legacy `defaultProfile` value renders the canonical field and saving proposes canonical set plus legacy unset operations.
  - Covers AE4. Editing renders the staged draft immediately; a save proposal without Host acceptance retains the draft, remains dirty, and becomes failed.
  - Publishing the matching accepted user/base/value/revision snapshot before resolving the write clears dirty state and updates override badges.
- **Verification:** The local `FakeScope` is gone, official spies and publication controls drive the tests, and the focused Client suite passes with the official alpha.4 source alias.

## Verification Contract

| Gate | Applies to | Required outcome |
|---|---|---|
| Frozen install | U1, U3 | The committed lockfile installs without manifest drift and resolves one alpha.4 development graph. |
| Host Settings focused suites | U1 | All Settings capability, layering, validation, race, detach, and disposal scenarios pass against the official provider. |
| Direct plugin focused suite | U2 | Foreground and continuable admission, error, cancellation, route, cleanup, and Receipt-clear scenarios pass. |
| Client Settings focused suite | U3 | The suite passes through the existing official-source alias and distinguishes write proposal from Host acceptance. |
| Typecheck and build | U1, U2, U3 | Root and companion packages compile and bundle without new public exports or runtime dependencies. |
| Full quality gate | All | `pnpm run check` passes with the official alpha.4 source checkout configured as CI does. |
| Packed compatibility | All | Both `minimum` alpha.2 and `latest-tested` alpha.4 packed delegation lanes pass and each proves one coherent DSH generation. |
| Dependency preflight | U1, U3 | Every declared Host package line resolves; no compatibility closure or version-policy contradiction is introduced. |
| Diff review | All | Plan and generated lockfile lines aside, implementation/test/manifest LOC is lower and no unrelated audit candidate entered the diff. |
| Delivery | All | One Conventional Commit is pushed to `origin/main`, and the resulting CI workflow completes successfully. |

## Definition of Done

- U1 uses one official-provider-based Settings fixture and contains no duplicated layer, freeze, equality, validation, watch, or commit engine.
- U2 contains no duplicate direct provider/capability runtime preflight; official admission and selected-adapter policy remain separate owners.
- U3 contains no local Client Settings scope implementation and proves explicit Host acceptance.
- The root package adds only development pins required by U1 and U3; production dependencies, peer range, public exports, and compatibility claims are unchanged.
- Focused tests, typecheck, build, full quality gate, dependency preflight, and alpha.2/alpha.4 packed lanes pass.
- Code review has no unresolved actionable findings.
- Abandoned implementation attempts and temporary tracked files are removed.
- The final commit is present on `origin/main` and its GitHub Actions run is green.
