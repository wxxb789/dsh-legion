# Customization first; defaults are ordinary catalog data

- Status: Accepted
- Date: 2026-08-15

Legion will let users define their own Profiles, Teams, and Strategies while shipping a curated Default Catalog that uses exactly the same public contracts. Built-in names, member shapes, routing choices, and orchestration policies must not receive hidden runtime privileges or hardcoded branches; users can replace, extend, or disable them. Strategies compile to bounded executable DeepSeek Harness subagent operations, so customization changes policy without creating a second execution or authority runtime. Session-owned DSH Goals are intentionally not member stages.

## Consequences

- A Team contains named Member Slots that reference Profiles; it does not persist live Agents or Sessions.
- A Strategy owns orchestration policy, artifact handoffs, completion semantics, and limits; DSH owns execution lifecycle, persistence, cancellation, sandbox, approval, and model adapters.
- Default Profiles, Teams, and Strategies are versioned, inspectable, and overridable catalog entries.
- Third-party strategies use the same registration and validation contract as Legion defaults.
- Project or user customization may narrow capabilities directly; authority widening remains subject to DSH policy and approval.
- A user can obtain a useful experience without configuration, but can reproduce the default behavior entirely from the published catalog data.

## Rejected alternatives

- A fixed mythology-based organization chart: easy to demo, difficult to adapt and reason about.
- Hardcoded `deep`, `quick`, or `review` behavior in runtime branches: prevents replacement and makes defaults a hidden protocol.
- Arbitrary user code with direct Agent/Session access as the primary strategy interface: too much authority and too much lifecycle surface.
- A Legion-owned Team runtime: duplicates DSH workflow, subagent, goal, Session, and security owners.
