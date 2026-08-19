# Can `@deepseek-ai/dsh-experimental-agent-team` replace part of Legion's durable-run subsystem?

Assessed against DSH 0.1.0-rc.8 (`packages/experimental/agent-team`, ~2,100 lines read in full) and
`dsh-legion` `src/durable-run/` (25 modules, ~4,900 lines). Every claim below is verified in the
implementation, not in package prose.

## Verdict

**No — and the blocking reason is a capability mismatch, not the packaging.** The package is a
domain-specific coordination *store*, not the coordination *primitive* Legion is missing. Its
atomicity is process-local, which is the one alternative Legion's own ADR 0020 already rejected by
name.

The dive was still worth doing: it surfaced three concrete, actionable findings, and one of them
(`sessionPersistence.inspect` as a child-receipt substrate) is a genuine reuse opportunity Legion
had not considered.

## 1. The decisive mismatch: process-local vs cross-process

Legion's mandatory port (`src/durable-run/host.ts:34-39`) demands a distributed lease:

```ts
export interface RunCoordination {
  acquire(request: AcquireRunLeaseRequest): Promise<unknown>
  renew(request: { lease: RunLease; ttlMs: number }): Promise<unknown>
  assert(request: { runId: RunId; owner: OwnerFingerprint; fence: Fence }): Promise<unknown>
  release(request: { lease: RunLease }): Promise<void>
}
```

`OwnerFingerprint` is `{hostInstanceId, processBootId, pluginGeneration, anchorSessionId,
activationId}` (`src/durable-run/contract.ts:222-228`). Every one of those fields exists only to
distinguish a *different process, host, or restart* — the type itself states the requirement.
`run-control.ts:51-64` repeats the real demand four times: *atomically reject unless lease
owner/fence are still current at append* — a compare-and-set at the moment of the journal append,
not merely a prior check.

What agent-team actually provides:

| Mechanism | Evidence | Scope |
|---|---|---|
| Per-Lead promise-chain mutex | `journal.ts:14` `private readonly tails = new Map<SessionId, Promise<void>>()`, used by `transact` at `journal.ts:40-50` | **One `TeamService` instance in one process** |
| Task revision compare-and-set | `task-board.ts:119-124` rejects `current.revision !== request.expectedRevision` | Real CAS, but atomic **only because** the mutex above serializes read-check-append |
| Session append | `journal.ts:66-68` — unconditional `append(type, data)`, no expected-seq | No storage-level guard |

There is no lease, no owner identity, no TTL, no fence, no conflict result, and no renewal anywhere
in the package. It documents this itself: `mailbox.ts:23` "Owns every **process-local** state
transition"; its README states concurrent harness processes over one Team are unsupported.

Legion's ADR 0020 lists this exact mechanism under **Rejected alternatives**:

> Process-local mutexes and counters do not coordinate other processes or Sessions.

So adopting agent-team's coordination would not be a reuse decision — it would silently reverse an
accepted architecture decision and convert a fail-closed subsystem into an unsafe one. This is the
same guarantee class `AGENTS.md` already warns about for `ctx.fs` version-guarded writes
("serialized by a per-process lock map, so `replaceIfVersion` is not a cross-process
compare-and-set").

Worth naming the failure mode precisely, because it is worse than a lost update. Two processes
mutating one Lead Session do not merely race — they break the fold's invariants, and the strict fold
plus its `./invariant` companion surface that as a replay *error*: double-queue (`fold.ts:263`),
non-contiguous revision (`fold.ts:246`), double delivery (`fold.ts:271`). That is detection after
the fact rather than prevention, so the race is converted into an **unloadable Session**. A
coordination layer whose concurrency failure mode is corruption of the durable log is the opposite
of what Legion's fail-closed posture exists to buy.

## 2. The domain models do not line up either

Even setting atomicity aside, the three overlapping nouns are false friends.

| Concept | agent-team | Legion | Replaceable? |
|---|---|---|---|
| **Roster** | Runtime Lead/teammate set, mutated by `spawnTeammate` (`roster.ts`) | **Does not exist.** `member` is a compile-time string on a plan node (`graph.ts:45`); membership is declarative catalog data per ADR 0010 | Nothing to replace |
| **Task DAG** | `{subject, description, status, blockedBy, writeScopes, ownerId}` — a shared versioned to-do list that never executes, schedules, or dispatches | Nodes embed a `DshPrimitive` and name a `profile`; `PlanGraph` carries `strategy`, `team`, `catalogDigest`, `objectiveDigest`, `environmentDigest` (`graph.ts:56-71`); PlanDelta authorizes **by Profile name**: `input.authority.profiles[item.node.profile]` (`plan-delta.ts:199`) | No — only ~120 of ~660 lines (acyclicity, edge ordering, digesting) are neutral |
| **Mailbox** | Delivers bytes; per-target FIFO, at-least-once with target-side dedup | `incorporate` requires payload digests present in a Legion `ContextManifest` and mints `sharedPrefixDigest` for prompt-prefix cache stability (`mailbox.ts:178-198`) — it delivers *context pages under a route-plan-scoped prefix* | Only the reserve/expire/reclaim skeleton (~40%) |

The genuinely separable pieces are **lease and admission** — and ADR 0020 already assigns both to
the *Host*, not to a peer orchestration package.

## 3. Packaging closes the door regardless

`packages/experimental/agent-team/package.json` sets `"private": true`. The incubation decision
(`.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.md:17`)
excludes every `packages/experimental/` manifest from the pack and publish set and adds a
repository check that **rejects `dependencies`, `optionalDependencies`, and `peerDependencies` from
release packages to an experimental package**. Promotion (`:21`) requires contract review,
limitations, test evidence, release payload, runtime dependents, and a named owner — with **no
timeline**.

## 4. What the dive did produce

### 4.1 The stable seams from this work are already usable (published in rc.8)

The incubation note (`:19`) states the generic pieces were deliberately kept in the **stable**
Subagent service, and agent-team is simply their first consumer:

- `startContinuable({ childId, … })` — caller-reserved child identity (`roster.ts:257`, `:280-281`)
- `drainContinuableChildren(root, childIds)` — selective release (`roster.ts:240`)

Both are in published `@deepseek-ai/dsh-subagent` 0.1.0-rc.8. Legion can use them today; this is the
proven-in-use pattern for the durable controller's child-identity correlation.

### 4.2 A possible substrate for the optional child-receipt capability

`legionChildReceipts` (`host.ts:5`) is a **Legion-invented** Host service key for an optional
capability whose absence forces `LEGION_RECOVERY_EFFECT_AMBIGUOUS`. agent-team solves the
equivalent problem without inventing anything: it verifies durable child acceptance through the
official `ctx.sessionPersistence.inspect(childId, signal)` and checks the event suffix past
`meta.seedLength` (`roster.ts:345-353`).

`inspect` is an abstract published method returning `SessionInspection { meta, events }`
(`packages/session/session-persistence/src/index.ts:200`, `:26-31`).

**Caveat, not yet verified:** `DurableChildReceipts.lookup` must return a three-way
`found | absent | unknown` and must never map a missing receipt to success (`host.ts:60-71`,
`recovery.ts:99-116`). Whether `inspect` can distinguish *proven absent* from *unknown* — rather
than throwing for both a missing session and a transient read failure — is **unconfirmed** and must
be settled before any ADR change.

### 4.3 An uncomfortable comparison, stated fairly in both directions

agent-team ships a working coordination system on the same durable substrate Legion uses (Session
log + `sessions.flush`), accepting a weaker guarantee, and it **executes**. Legion's durable-run is
4,904 lines that **cannot execute**, and only one of its two blockers is external:

- **Blocker A, internal and hard-coded:** `const DURABLE_ACTIVATION_ADAPTER: 'unbound' | 'bound' =
  'unbound'` (`capabilities.ts:122`), with no assignment path anywhere in the repository. Even a
  perfect Host coordination service would not turn journal mode on.
- **Blocker B, external:** no Host implements the mandatory `legionRunCoordination`.

The comparison runs the other way too, and the read model is where Legion is clearly ahead.
agent-team registers no projection and keeps no cache: `state()` performs a full
`foldTeam(root.id, root.session.events)` linear replay on *every* read (`journal.ts:30-32`),
including once inside every transaction. Legion's `restoreLegionProjection` (`replay.ts:26-36`)
resumes from a checkpoint and folds only the tail, falling back to a full fold solely when the
checkpoint's `stateVersion` does not match the current version 6. The upstream package is therefore
not uniformly "the more mature implementation" — it is a smaller design that traded read
scalability and cross-process safety for shipping. Treating it as a template for Legion's
engineering standards would be the wrong lesson; the right one is narrower, and it is §4.1 and §4.2.

## Recommendation

1. **Do not adopt `dsh-experimental-agent-team`.** Record it as evaluated-and-rejected with the
   ADR 0020 citation, so the question is not reopened blindly when it is promoted.
2. **Adopt the two stable rc.8 subagent seams** (`childId` reservation, `drainContinuableChildren`)
   in the durable controller design — same as upstream's own consumer.
3. **The highest-value move remains a companion package mounting `legionRunCoordination` and
   `legionGlobalAdmission`**, exactly as `AGENTS.md` prescribes ("Mount it as a separate package,
   and keep Legion failing closed while it is absent") and ADR 0020 requires. That is the difference
   between "cannot execute" and "can". `@deepseek-ai/dsh-atomic-write`'s cross-process
   `withFileLock` is the candidate substrate, noting its documented atomic-but-not-durable caveat.
4. **Investigate 4.2 separately.** If `inspect` can express the required trichotomy, Legion can
   delete an invented Host service key in favour of an official seam.
5. **Blocker A deserves its own decision.** A subsystem that is 38% of source and cannot be switched
   on by any deployment is worth an explicit keep/bind/shrink call, independent of upstream.
