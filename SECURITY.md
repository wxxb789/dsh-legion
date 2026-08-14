# Security Policy

## Supported versions

Only the latest released minor version receives security fixes during the pre-1.0 period.

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
