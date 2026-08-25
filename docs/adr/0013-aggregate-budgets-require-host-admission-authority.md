# Aggregate token and cost budgets require Host admission authority

> **Terminology: ADR 0022.** The retired Legion nouns `Profile` and `Team` became Specialist and Cohort; retired machine spellings remain only where compatibility history requires them.

- Status: Accepted
- Date: 2026-08-15

Legion v1 does not declare aggregate token or monetary-cost limits. DSH persists provider-reported `TokenUsage` per Session and its `tokenUsage` projection reliably deduplicates finalized and streamed samples, but both are read-side facts after dispatch. `contextPressure` is explicitly not billing/gating, `maxTokens` caps one response only, subagent lifecycle events are observe-only, and `SubagentResult` carries no usage. Cost has no authoritative DSH field. External providers also need not expose a local Session object.

A hard aggregate limit requires one Host-owned admission Module that maps Cohort Runs to member Sessions, atomically reserves budget before concurrent provider dispatch, reconciles reservations against durable usage, rebuilds after restart, and versions any price table. The existing `agent/request` and `llm/stream` waterfalls are possible enforcement seams but neither alone supplies complete Cohort Run identity and reservation ownership. Legion will not treat projections, estimated context size, output bytes, or locally inferred prices as authority.

Accordingly, the stable v1 Strategy limits are members/agents, concurrency, wall-clock deadline, and accepted artifact bytes. Real-model campaign artifacts may report signed provider usage/cost receipts, but those are evidence guardrails rather than runtime admission. Aggregate token/cost authority is an upstream DSH proposal and can be added later through a new versioned contract without weakening v1 semantics.
