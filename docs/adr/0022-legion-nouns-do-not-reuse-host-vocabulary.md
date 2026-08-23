# Legion domain nouns must not reuse DeepSeek Harness vocabulary

- Status: Accepted
- Date: 2026-08-23

Legion named three of its central concepts with nouns DeepSeek Harness had already assigned to different concepts, and a fourth collision is pending. Because Legion's nouns reach users through CLI output, configuration keys, documentation, and the model-facing tool schema, a collision is not cosmetic: it makes a correct sentence ambiguous. We therefore adopt a standing naming rule — **a Legion domain noun must not reuse a noun the Host uses for a different concept on any public surface** — and rename the existing offenders.

## Evidence

Verified against the DeepSeek Harness checkout at version 0.1.1-rc.2 (227 packages).

- **`profile`** is a deployment/launcher composition unit: the directory `$DSH_HOME/profiles/<name>` holding a manifest of ordered bundles and a `cordis.patch.yml` patch layer, deciding which plugins a process boots (`packages/boot/app-boot/src/profile.ts:5-13,36,114-117`). It is a noun the user types: `dsh --profile web`, `dsh plugin --profile <name>` (`apps/cli/src/args.ts:131,173`). The Host separately owns **`agent preset`** (`ctx.agentPresets`) for the plugins an agent mounts, and **`persona`** (`dsh-persona`) for an agent's identity prose. Legion's "Profile" — a reusable worker capability template — was a fourth meaning inside an already crowded three-noun space.
- **`team`** is claimed by `@deepseek-ai/dsh-experimental-agent-team`, whose service key is `ctx.agentTeams` and whose description is "Implicit-root Agent Teams roster, durable peer mailbox, and shared task DAG". Its `TeamId` equals the root `SessionId`, and its vocabulary includes `lead`/`teammate`, `TeamMemberView`, and a revision-CAS task DAG. The package carries 2,149 LOC of source against 2,381 LOC of tests, a committed `lib/`, and an invariant replay validator; it is held back by single-process durability and a missing Web surface, not by incompleteness. It is `private: true`, so Legion can neither depend on it today nor avoid its vocabulary tomorrow.

## Decision

- `Profile` becomes **`Specialist`**.
- `Team` becomes **`Cohort`**, and `Team Run` becomes **`Cohort Run`**. `Member Slot` is kept but its definition states explicitly that it names a position, not a participant.
- Any future Legion noun is checked against the Host package tree before it enters `CONTEXT.md`.

`Cohort` is not merely a free word; it is the more accurate one. A Legion Cohort is authored, validated, and compiled — it never holds a live participant — whereas a Host Team is a live roster. Calling it a Team was misleading before the collision existed.

## Consequences

- Legion's positioning moves one layer up. Legion owns cohort and dispatch policy — which Specialist is sent, under which route, within which limits, and on what evidence a run is complete — while execution mechanics (roster, mailbox, task DAG) stay with the Host. Today those mechanics are reached through `ctx.subagents`; if `ctx.agentTeams` is published, the backend changes and the vocabulary does not.
- The rename touches the authored configuration schema, the model-facing tool parameter, branded identities, compiled IR, public contract documents, and the settings namespace. It ships as a dual-name window: `profiles`/`specialists` and `teams`/`cohorts` are both accepted for one minor version, the old name emits a deprecation diagnostic, and migration is a pure function that never overwrites a user preset.
- This rule cannot be satisfied once and forgotten. The Host is a lockstep monorepo of 227 packages under active development and does not accept external pull requests, so its vocabulary will keep growing into space Legion may already occupy. Checking a noun against the Host tree becomes part of adding a term.

## Considered options

- **Keep the current names and adapt when a collision actually breaks something.** Rejected: the breakage lands on the day a Host package publishes, and by then the colliding noun is in a released configuration contract, a released tool schema, and every document. The migration cost is strictly higher and the timing is not ours.
- **Prefix Legion nouns (`LegionProfile`, `LegionTeam`).** Rejected: it makes prose worse rather than clearer, and it concedes that the Host owns the concept while Legion keeps the word.
- **Rename only `Profile`, since `ctx.agentTeams` is unpublished.** Rejected: the evidence says that package is near-ship rather than abandoned, and a second rename later would spend the migration window twice.
