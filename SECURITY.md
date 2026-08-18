# Security Policy

## Supported versions

Only the latest released 1.x minor version receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for `wxxb789/dsh-legion`. Do not open a public issue containing credentials, exploitable prompts, or sensitive workspace data.

Include:

- affected dsh-legion and DeepSeek Harness versions;
- the configured profile and subagent backend;
- reproduction steps with secrets removed;
- expected and observed authority, tool, sandbox, or data behavior;
- practical impact.

## Security model

Legion does not widen DeepSeek Harness permissions. It selects among deployment-owned profiles and delegates through the existing DSH subagent runtime. Sandbox, approval, credentials, product CLI authentication, and provider registration remain Host responsibilities.

A profile is trusted configuration. It can select a model backend and control a child's visible tools, but a tool filter is not a security boundary by itself. Do not install untrusted Cordis packages or user presets: they execute with the authority of the DSH process.

Prompt Fragment references are confined below explicit relative Resource Roots and reject links, traversal, non-files, malformed text, and oversized input. This protects against accidental path escape; it is not an isolation boundary against an actor who can modify the trusted preset directory, create hardlinks, or replace the installed plugin. Legion snapshots authorized files at activation and does not log their contents or resolved host paths.

Route preflight observes only DSH adapter registration and adapter-owned exact-model metadata. It does not contact a provider to prove credentials, authorization, quota, network reachability, service health, latency, or billing state. Route Plans mark those facts unknown, and a later child/provider failure never authorizes Legion to replay work on another route.

Model Strategy exposure is separate deployment authority and defaults off; catalog presence alone does not make a Strategy model-callable. Catalog Layers can replace deployment policy but cannot widen Host authority: DSH remains the final owner of providers, routes, tools, depth, sandbox, approval, workflow, goal, and cancellation. Strategy invocation limits may only narrow compiled limits. Team/Strategy IR contains no live Agent, Session, Service, or runtime handle. The direct execution adapter accepts only a digest-validated compiled plan, forwards cancellation to every child, and never retries or switches Profiles after failure.

Release dependencies are frozen by the committed lockfile. Tag builds publish the tested tarball with npm provenance, a GitHub build attestation, an SPDX SBOM, and SHA-256 checksums. Verify the package's registry provenance and release checksum before installing it in a privileged DSH profile.

## Durable execution security

DSH remains the sole owner of the Session journal, persistence, projection cache, child lifecycle, sandbox, approval, and Host coordination. Legion durable mutation is opt-in and requires flush, projection registration, and atomic lease/fence coordination. Missing mandatory services fail closed before mutation. The package publishes structural Host ports but no Host service implementations.

Task execution is at least once and stale owner, fence, generation, or continuation results are rejected. This provides one accepted logical commit, not exactly-once external effects. Ambiguous non-idempotent work suspends. Mail is acknowledged only after its evidence is incorporated and the required durability barrier completes.
