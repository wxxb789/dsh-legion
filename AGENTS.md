# dsh-legion Agent Instructions

## Rapid development workflow

Work directly on `main`. Do not create a feature branch, worktree, pull request, or review loop unless the human explicitly asks for one.

1. Inspect the current request, `git status`, recent commits, and active validation state.
2. Make scoped changes without reverting unrelated work.
3. Run focused tests while developing, then `pnpm run check` before pushing code changes.
4. Commit with an English Conventional Commit message.
5. Push directly to `origin/main` and verify the resulting GitHub Actions run.

Use force-push only when the human explicitly requests history rewriting. A successful push and green CI are the completion criteria for one rapid-development increment.

## Architecture

Before changing routing policy, profile configuration, result contracts, or DSH lifecycle integration, read `docs/roadmap.md` and the applicable ADR under `docs/adr/`.

DeepSeek Harness remains the sole owner of Agent, Session, subagent, workflow, goal, persistence, sandbox, approval, model adapter, and UI lifecycles. Legion contributes delegation policy and diagnostics through public DSH seams.

Legion is customization-first. Profiles, Teams, Strategies, and the Default Catalog must use public replaceable contracts; do not hardcode default names or grant built-in strategies hidden privileges. Read `CONTEXT.md` when changing these domain concepts.

Use TypeScript as a design tool: separate authored/validated/effective/compiled states, prefer discriminated unions and branded identities, keep public data readonly, and make closed vocabularies exhaustive. Keep `unknown` at real configuration/model/plugin/process boundaries and validate it before constructing trusted domain types. Read ADR 0004 before adding public orchestration contracts.

Keep filesystem access out of pure compilers. Prompt Fragment references must pass the ADR 0006 loader and immutable snapshot boundary; do not add direct `readFile` calls in routing or execution code. Skills remain owned by the scoped DSH Skill registry, not parsed or copied by Legion.

Route planning is pre-start only. Preserve unknown metadata, freeze one ADR 0007 Route Plan, and start at most one child. Never switch candidates or replay after child/provider failure; cross-route recovery requires a unified DSH recovery seam.

Keep `pnpm-lock.yaml` synchronized and use frozen installs. Config migrations are pure and never overwrite user presets. Do not create a release tag unless package version, CHANGELOG, full gates, packed compatibility, and ADR 0009 release metadata all agree.

Teams and Strategies are declarative catalog data. Compile them through ADR 0010 to detached DSH primitive IR; do not add strategy-name branches, arbitrary callbacks, or a Legion scheduler. Every accepted Strategy stage must lower to the thin one-shot subagent adapter; keep the shipped preset's model exposure off until benchmarked; user deployments may explicitly opt in through `enableStrategies`. DSH Goals remain a separate session-owned lifecycle and are not Strategy stages.

## Files and language

Use English for code, comments, documentation, commit messages, and release notes. Public documentation must use repository-relative paths, generic placeholders, or URLs—never a developer machine's absolute path.
