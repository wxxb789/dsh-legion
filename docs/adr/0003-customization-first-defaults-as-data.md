# Customization first; defaults are ordinary catalog data

> **Terminology: ADR 0022.** The retired Legion nouns `Profile` and `Team` became Specialist and Cohort; retired machine spellings remain only where compatibility history requires them.

- Status: Accepted
- Date: 2026-08-15

Legion will let users define their own Specialists, Cohorts, and Strategies while shipping a curated Default Catalog that uses exactly the same public contracts. Built-in names, member shapes, routing choices, and orchestration policies must not receive hidden runtime privileges or hardcoded branches; users can replace, extend, or disable them. Strategies compile to bounded executable DeepSeek Harness subagent operations, so customization changes policy without creating a second execution or authority runtime. Session-owned DSH Goals are intentionally not member stages.

## Consequences

- A Cohort contains named Member Slots that reference Specialists; it does not persist live Agents or Sessions.
- A Strategy owns orchestration policy, artifact handoffs, completion semantics, and limits; DSH owns execution lifecycle, persistence, cancellation, sandbox, approval, and model adapters.
- Default Specialists, Cohorts, and Strategies are versioned, inspectable, and overridable catalog entries.
- Third-party strategies use the same registration and validation contract as Legion defaults.
- Project or user customization may narrow capabilities directly; authority widening remains subject to DSH policy and approval.
- A user can obtain a useful experience without configuration, but can reproduce the default behavior entirely from the published catalog data.

## Rejected alternatives

- A fixed mythology-based organization chart: easy to demo, difficult to adapt and reason about.
- Hardcoded `deep`, `quick`, or `review` behavior in runtime branches: prevents replacement and makes defaults a hidden protocol.
- Arbitrary user code with direct Agent/Session access as the primary strategy interface: too much authority and too much lifecycle surface.
- A Legion-owned Cohort runtime: duplicates DSH workflow, subagent, goal, Session, and security owners.
