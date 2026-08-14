# ADR 0001: Start with a semantic profile router

- Status: Accepted
- Date: 2026-08-14

## Context

The project needs a SOTA coordinator to delegate work across multiple models and agent roles while remaining installable and configurable as a DeepSeek Harness extension.

DSH already owns the hard lifecycle problems:

- named subagent providers;
- one-shot and continuable children;
- durable Session identity and follow-up delivery;
- cancellation, depth, persona, and tool-filter capability checks;
- model routing through child `AgentOptions`;
- parallel tool execution;
- workflow fan-out for large explicit orchestrations.

A separate Legion scheduler or team runtime would duplicate those modules before the project has a distinct lifecycle requirement. The useful missing seam is semantic routing: the coordinator should choose `quick`, `deep`, or `review`, not raw provider and model ids.

Current DSH in-process children join their parent's standing agent preset through `composeFrom()`. `SubagentStartRequest` can override model, persona, tools, and depth, but it cannot name another agent preset. Continuable setup contributions also receive only the unpublished child context, not per-call Legion profile metadata.

## Decision

Version 0.1 is one agent-plane Cordis plugin with one model-facing tool.

The public configuration maps profile names to:

- a named DSH subagent backend;
- optional child LLM provider/model/maxTokens;
- optional persona and tool restriction;
- depth policy;
- default foreground or continuable-background behavior.

The coordinator receives a generated prompt section describing profiles and calls one tool with `profile`, `description`, `prompt`, and optional `run_in_background`.

Legion delegates through `ctx.subagents.start()` and `startContinuable()`. It does not own Sessions, child persistence, follow-up, provider registration, sandbox policy, approvals, or model credentials.

The plugin lives in an agent preset because it contributes only a model-facing tool and prompt section. Its installable DSH bundle patch is empty by design: installation makes the package resolvable from user-authored presets without publishing a process-global tool or service.

## Consequences

### Positive

- Small interface with high leverage: one tool covers every configured model and backend.
- Configuration is auditable and prompt calls cannot widen the deployment-owned capability envelope.
- DSH lifecycle and provider behavior remain authoritative.
- Multiple coordinators can use different Legion configuration by loading the plugin in different user presets.
- The plugin is HMR-safe because tool and prompt registrations belong to its Cordis Fiber.

### Negative

- Version 0.1 has no model fallback chain or health-based router.
- Product providers such as Codex and Claude Code keep their native model selection.
- A single child cannot select a different DSH agent preset. Profiles vary the child overlay, not its standing composition.
- Configuration is edited in the agent preset instead of the Web settings UI.

## Rejected alternatives

### A Legion-owned Mission/DAG runtime

Rejected for the MVP. It would expose or hide a second scheduling state machine on top of mature DSH subagent and workflow modules. Add it only when a concrete topology cannot be expressed by coordinator tool calls or DSH workflows.

### One generated tool per profile

Rejected. It multiplies tool schemas, increases prompt and cache cost, and makes configuration changes alter the entire tool catalog. A single enum-backed tool keeps the interface and KV-cache impact stable.

### Raw provider/model parameters in each call

Rejected. It moves deployment policy into prompts, weakens auditability, and makes every coordinator relearn model ids. Semantic profiles are the stable interface.

### Claiming per-child DSH preset support

Rejected because the public DSH subagent request has no preset selection field. A future implementation requires an upstream seam that composes a named preset during child creation and persists that choice for cold resume. Legion will not copy the in-process driver or continuation manager to simulate this feature.

## Follow-up roadmap

1. Add model fallback chains only after DSH exposes sufficient provider/model availability facts for deterministic preflight.
2. Propose a narrow upstream per-child preset selection field whose lifecycle remains owned by DSH.
3. Add a host runtime only if shared cross-session policy or observability becomes a real requirement.
4. Add a client settings adapter only when external plugin namespaces can be safely exposed by DSH Web.
