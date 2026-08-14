# Use TypeScript to make illegal orchestration states unrepresentable

- Status: Accepted
- Date: 2026-08-15

Legion will use TypeScript as a primary design tool: authored configuration, validated catalog entries, compiled Profiles, Teams, Strategies, DelegationPlans, artifacts, and terminal outcomes are distinct types connected by explicit constructors. Discriminated unions, branded identities, readonly data, exhaustive switches, generic artifact contracts, and `satisfies` checks should prevent invalid state combinations before runtime. Type complexity must remain behind deep module interfaces; public callers should learn small concrete contracts rather than internal conditional-type machinery.

TypeScript is not a trust boundary. YAML/JSON, model output, third-party packages, DSH services, persistence, and process boundaries enter as `unknown` and require runtime schema validation before they receive trusted domain types. Types and runtime schemas must describe the same versioned contract and be tested together.

## Required design patterns

- Separate source and resolved states: `Authored*`, `Validated*`, `Effective*`, and `Compiled*` are not aliases.
- Model lifecycle and outcomes with discriminated unions instead of optional-field bags or interacting booleans.
- Brand Profile, Role, Team, Strategy, Decision, Attempt, Artifact, and native DSH reference identities where accidental interchange would be harmful.
- Express Strategy inputs and outputs through typed artifact maps; a stage can consume only artifacts its predecessors produce.
- Encode execution mode and result contract compatibility in DelegationPlan types where practical; runtime compilation still returns actionable diagnostics for external configuration.
- Use readonly owned JSON at module seams; live Cordis/DSH objects remain behind adapters.
- Use exhaustive `never` checks for closed internal vocabularies and explicit compatibility handlers for versioned external unions.
- Define the Default Catalog with `as const satisfies` the same public catalog contracts available to users.
- Add type-level contract tests for inference, valid composition, and expected compile failures.

## Guardrails

- Do not use `any` in public or policy modules.
- Keep `unknown` at real boundaries and narrow it once.
- Avoid type assertions that manufacture trusted domain types without validation or a private checked constructor.
- Do not encode facts that only runtime services know—provider presence, model health, permissions, persistence success—as compile-time booleans.
- Prefer a small discriminated union over a generic parameter when the generic does not improve caller safety.
- Reject type-level designs that produce unreadable diagnostics, excessive compile time, or expose implementation state to strategy authors.
