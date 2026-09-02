# DeepSeek Harness 0.1.2-alpha.4 Upgrade Audit

## Purpose and conclusion

This note records the source audit and migration from the previously assessed DeepSeek Harness
0.1.2-alpha.3 generation to 0.1.2-alpha.4. The audit used the official package descriptions,
manifests, exports, TypeScript sources, and Git history under
[`deepseek-ai/deepseek-harness/packages`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages),
not release prose.

The upgrade contains one breaking public change that affects Legion: Session event positions and log
offsets are now distinct branded values, the public `Session.events` snapshot property was replaced by
explicit read methods, and inherited fork length moved out of `SessionHeader`. Legion now consumes the
alpha.4 APIs while keeping its alpha.2 minimum through one narrow read-boundary fallback. The
Subagent `start` and `startContinuable` entry points, tool registry, prompt registry, Settings,
Typert/Gateway, Client Store, Slots, and UI contracts Legion uses remain compatible.

## Exact source states

| State | Canonical tag | Release commit | Tagged master merge | Tree |
|---|---|---|---|---|
| DSH 0.1.2-alpha.3 | `dsh-v0.1.2-alpha.3` | `14bab4422b12ab80cd79de59e086c12888fe00be` | `dd6322d604e00eec1ba5e0c8541159906a21094a` | `86be9091c78528b5ef0866ae6d58b01d4a53582e` |
| DSH 0.1.2-alpha.4 | `dsh-v0.1.2-alpha.4` | `a9e185f205169262ab39cbbda9fc48b16c37bbe9` | `4e84901e6471b79ec0338099867ebb4606d12bb5` | `aeb655f10fe7f8a15ddee8fa29a38af283660167` |

The authoritative release comparison is `dd6322d604..4e84901e64`.

## Breaking changes and migrations

### Session snapshots, sequence brands, and fork lineage

Upstream commits `5660f44d29 perf(session): separate indexed and snapshot log reads` and
`27bf1039db refactor(session)!: distinguish event seqs from log offsets` replace the old log snapshot
surface and separate three values that alpha.3 represented as ordinary numbers:

- `SessionSeq` identifies an existing event;
- `SessionLogOffset` identifies a gap, prefix length, or read offset and may equal the log length;
- `SessionSeqCursor` is an inclusive event watermark or `-1` for an empty log.

`Session.events` is no longer public. Whole or ranged immutable reads use `session.snapshotEvents()`,
indexed reads use `session.eventAt()`, and the next offset is `session.seq`. `SessionHeader.seedLength`
is replaced by required `header.isSeeded`; the exact cut is the Session-owned
`session.inheritedEventCount`. `SessionObservation` carries the same `inheritedEventCount`, and
`ProjectionDefinition.init` receives it as a second argument.

Legion's only production dependency on the removed members was Run Receipt token accounting. It now
reads the official alpha.4 immutable snapshot and exact inherited cut. To preserve the declared
alpha.2 minimum, that boundary feature-detects the alpha.4 methods and otherwise reads alpha.2's
immutable `events` snapshot plus `header.seedLength`. It does not copy Session behavior or retain a
second log. Tests and direct alpha.4 Session fixtures use `snapshotEvents()`, `seq`, `isSeeded`, and
`SessionLogOffset` directly.

The physical JSONL version-0 header still stores the optional field as `seedLength`; alpha.4 maps that
wire field into logical `isSeeded` and `inheritedEventCount`. `SESSION_FORMAT_VERSION` remains 0, so
this migration performs no Legion data rewrite.

### Continuable Subagent messaging was unified

Alpha.4 replaces the public continuable-child `followup`, `reportFrom`, and
`registerContinuableSetup` surfaces with adjacent-Agent `sendMessage` steering, and removes the
separate `@deepseek-ai/dsh-tool-subagent-report` package. Legion uses the stable `start` and
`startContinuable` entry points but none of the removed follow-up, reporting, or setup methods, so no
Legion adapter or replacement service is required. The removed package was not in Legion's 74-package compatibility closure.

### Invariant companion exports were removed

Many official packages stopped publishing their generated `/invariant` companion entry. Legion
imports none of those private validation companions. It continues to consume the public package-root
or documented client entry points owned by Agent, Session, Subagent, Token Meter, Typert/Gateway,
Client Store, Settings, Slots, and UI Primitives.

## Official package reuse decisions

The alpha.4 package catalog was searched before changing code.

- **Reused:** the official `Session.snapshotEvents()`, `Session.seq`,
  `Session.inheritedEventCount`, `SessionObservation.inheritedEventCount`, `SessionLogOffset`, Token
  Meter, Session Query, Session Projection, Subagent lifecycle, `dsh-util-values`,
  SystemPrompt order getters, Typert/Gateway, Client Store, Settings, Slots, and UI primitives.
- **Not adopted:** the unified continuable `sendMessage` API is not part of Legion's delegation
  path. `dsh-workflow` and Goal remain Host-owned runtimes rather than Legion Strategy
  stages.
- **Catalog moves that do not affect Legion:** `dsh-code-runtime-python` moved under experimental,
  and `dsh-tool-subagent-report` was removed. Neither package is a Legion dependency or compatibility
  closure member.
- **Still absent:** no public alpha.4 package or `ctx.*` service provides the lease/fence compare-and-set
  Run Coordination and Host-global Admission contracts required by ADR 0020. `ctx.fs`,
  `dsh-atomic-write`, Jobs, Workflow, Goal, and experimental Agent Team packages do not provide those
  authorities.
- **Still fail-closed:** required out-of-repository `legion/*` event admission remains unavailable.
  The `ignorable` envelope marker cannot truthfully represent state-changing Legion facts.

Consequently, ephemeral Specialists and Strategies remain supported. Journal mutation remains
unavailable, and full ephemeral Run Receipt facts continue through the process-local companion
without a custom Session event or a second persistence system.

## Dependency closure

The alpha.4 closure was derived from both Legion workspace manifests and every official DSH runtime,
peer, and optional dependency reachable from the packed compatibility roots. It remains exactly 74
DSH packages: no package is added to or removed from Legion's closure. Root and companion
development dependencies now pin alpha.4, while peer dependencies remain
`>=0.1.2-alpha.2 <0.2.0` so the minimum channel continues to exercise the compatibility boundary.

## Cutover and rollback

1. Back up Session persistence before changing the Host package graph.
2. Upgrade the complete DSH composition and the Legion package pair together; do not mix alpha.3 and
   alpha.4 Session, Projection, Query, Token Meter, Subagent, or Typert packages.
3. Recreate any deployment code that called the removed continuable Subagent methods; Legion itself
   does not call them.
4. On rollback, restore the prior complete package graph and lockfile together. Finish active turns
   first and preserve the Session backup; a partial rollback leaves alpha.4 Session declarations and
   runtime objects paired with alpha.3 consumers.

The Legion migration is reversible by restoring its previous commit. It writes no user data.

## Verification contract

The upgrade is complete only when all of the following hold:

- the committed lockfile resolves one alpha.4 development graph;
- root and companion typechecks and builds pass against alpha.4;
- Run Receipt tests cover live and cold inherited-event cuts through the alpha.4 APIs;
- the complete unit, Client Runtime, loader-composition, contract, journal, benchmark,
  reproducible-pack, and dry-pack gates pass;
- the packed compatibility matrix continues to pass alpha.2 minimum and alpha.4 latest-tested lanes;
- dependency preflight and captured consumer lockfiles prove one coherent DSH generation per lane.
