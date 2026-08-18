# Contributing

Thank you for helping improve dsh-legion.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting issues

- Bugs and feature requests use the [issue forms](https://github.com/wxxb789/dsh-legion/issues/new/choose); they collect the DSH version, host profile, and configuration needed to reproduce a routing or delegation problem.
- Problems in the Agent, Session, subagent, sandbox, approval, model adapter, or Web GUI belong to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), not to Legion.
- Report suspected vulnerabilities privately through a [security advisory](https://github.com/wxxb789/dsh-legion/security/advisories/new), never in a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

1. Install Node `^22.19.0 || >=24` and pnpm.
2. Run `pnpm install`.
3. Run `pnpm run check` before pushing code changes.

## Design rules

- Reuse DeepSeek Harness seams; do not copy its Agent, Session, subagent, workflow, sandbox, or approval state machines.
- Keep raw model ids in deployment configuration, not in model-facing tool calls.
- Fail loudly when a selected provider lacks a configured capability.
- Every registration and side effect must be owned by the current Cordis Fiber.
- Do not serialize live Cordis, Agent, Session, Service, Event, or Slot objects.
- New public configuration must serve at least two concrete profiles or use cases.
- Preserve the single-tool interface unless measured evidence shows that a second entry point provides more leverage than schema cost.

## Rapid development workflow

The project currently develops directly on `main`. Maintainer and agent changes are committed and pushed to `origin/main` after local gates pass; pull requests are not required unless a human explicitly requests one.

Each pushed change should include:

- the problem and intended behavior;
- tests through the public plugin interface;
- compatibility impact for the supported DSH peer range;
- documentation for new configuration or limitations.

Use English for code, comments, documentation, commit messages, and release notes. Agent-specific execution rules are in [`AGENTS.md`](AGENTS.md).
