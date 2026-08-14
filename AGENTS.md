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

## Files and language

Use English for code, comments, documentation, commit messages, and release notes. Public documentation must use repository-relative paths, generic placeholders, or URLs—never a developer machine's absolute path.
