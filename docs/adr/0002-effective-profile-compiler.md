# ADR 0002: Compile one EffectiveSpecialist catalog before registration

> **Terminology: ADR 0022.** The retired Legion nouns `Profile` and `Team` became Specialist and Cohort; retired machine spellings remain only where compatibility history requires them.

- Status: Accepted
- Date: 2026-08-15

## Context

Version 0.1 validated specialist configuration in several places: plugin activation, provider lifecycle filtering, tool registration, prompt rendering, and the final start edge. Each location reconstructed part of the same policy. This was small, but it made future model metadata, route planning, explain diagnostics, and structured result contracts likely to drift.

Provider availability is runtime state. A missing subagent provider is not an invalid deployment because Cordis may register it later. A present provider whose configured default mode lacks a required capability is invalid and must fail loudly. Continuable composition and one-shot `SubagentProvider.start()` also have different capability contracts.

Structured subagent output is a one-shot contract. DSH exposes it as provider-owned `unknown`, even after provider validation, so Legion must not pass that value through as an arbitrary live object.

## Decision

Introduce a pure, package-owned compiler:

```ts
compileCatalog(config, providerSnapshot): CompiledCatalog
compileDelegationPlan(catalog, invocation): DelegationPlan
```

The compiler consumes only schema-materialized Legion config and detached provider facts. It returns:

- all detached EffectiveSpecialists;
- the currently active specialist map;
- stable typed diagnostics;
- an active default specialist when available;
- a policy digest independent of runtime state;
- a catalog digest including the provider snapshot.

Tool schema, prompt guidance, activation, and execution use the same CompiledCatalog. `ctx.subagents` remains authoritative at the final start edge, where Legion revalidates the provider to close provider-removal races.

Specialists may select a versioned result contract:

- `text`;
- `findings-v1`;
- `review-v1`.

Structured contracts are foreground-only and require provider `outputSchema` capability. Legion passes the fixed schema into the one-shot request, then revalidates `SubagentResult.structured` and projects declared leaf fields into detached lossless JSON. Undeclared keys and exotic objects never cross the result seam.

## Consequences

### Positive

- One semantic compiler prevents tool/prompt/execution drift.
- Diagnostics have stable codes suitable for a future explain/doctor surface.
- Provider lifecycle refresh produces deterministic sorted catalogs.
- Digests give bounded provenance without introducing persistence or an execution ledger.
- Structured output becomes a versioned contract instead of arbitrary user schema.
- The compiler is naturally testable without Cordis live objects.

### Negative

- Specialist order is canonicalized rather than preserving authored map insertion order.
- Structured specialists cannot default to continuable background execution.
- Digests change when any policy leaf or relevant provider capability changes.
- The compiler only sees subagent provider facts in v0.2; exact LLM route metadata remains a later DSH-backed planning phase.

## Rejected alternatives

### Keep validation distributed

Rejected because route planning, doctor, and model metadata would multiply the same policy across more consumers.

### Expose arbitrary JSON Schema in user config

Rejected for now. Stable named contracts are easier to document, version, render, test, and migrate. A future custom-schema feature needs its own compatibility and security contract.

### Structured continuable children

Rejected because DSH continuable conversations span multiple activations and intentionally omit activation-wide `outputSchema`. Legion will not invent a second completion lifecycle.

### Persist the compiled catalog

Rejected. The catalog is a runtime snapshot and can be recomputed. Persistence, Session state, child descriptors, and settlement remain DSH-owned.
