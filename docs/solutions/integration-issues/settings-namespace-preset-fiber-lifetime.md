---
title: A settings namespace registered from an Agent Preset fiber is served only while a session is alive
date: 2026-08-21
category: docs/solutions/integration-issues
module: settings surface
problem_type: integration_issue
component: tooling
symptoms:
  - The Settings plugin card is absent after a DSH restart, not listed as unconfigurable but simply missing
  - The card appears mid-session and disappears when the last session using the preset ends
  - Values already saved stay in the user document with no UI left to edit them
  - A second concurrent session silently loses live reconfiguration
root_cause: scope_issue
resolution_type: code_fix
severity: high
related_components:
  - development_workflow
tags: [dsh, cordis, settings, agent-preset, host-plane, plugin-lifecycle, client-bundle]
---

# A settings namespace registered from an Agent Preset fiber is served only while a session is alive

## Problem

A DSH plugin mounted only from an Agent Preset cannot own a settings surface. Both halves of that surface are process-wide, and an Agent Preset is not: the namespace is served exactly while a session using that preset is alive, and the browser card bundle is never discovered at all. The user sees a plugin card that comes and goes with sessions and is missing after every restart, while the values already stored remain in the user document with no way left to edit them.

## Symptoms

- Settings shows no card for the plugin after a restart — absent, not disabled.
- Starting a session that uses the preset registers the namespace, but the card still does not appear until some other settings write or a reconnect makes the browser re-read.
- Ending the last session using that preset removes the card again.
- With two sessions open at once, only the first gets live reconfiguration; the second silently falls back to its composition entry for the rest of its life.

## What Didn't Work

- **Mounting the whole package on the Host plane.** `tools` and `system-prompt` are layered registries, so a Host row lands in the global layer and hands every agent in the process a tool it never asked for. For a plugin whose tooling is deliberately preset-scoped this is not a fix, it is a different product.
- **A settings-only subpath entry point (`<pkg>/settings`) as the Host row.** The Loader resolves a row name as an import specifier, so the row itself mounts — but DSH's client module registry resolves `<row name>/package.json` and caches a negative verdict for subpath rows permanently, and the module system then requires the served bundle to register under the row id. A subpath row therefore contributes no card, and forcing one would serve a bundle whose id does not match its row. The Host row has to be named exactly as the package.
- **Letting the preset row keep registering and hoping the Host row loses.** The provider fails a duplicate namespace loudly; whichever row registers second silently loses its live configuration source.
- **Deriving the row's plane implicitly** (for example from the absence of an agent scope). It silently changes what an existing Host row means and removes a deployment's ability to mount the package globally on purpose.

## Solution

Split the package by *plane* through an explicit composition field, and make the reading half read rather than register.

1. **Ship one Host-plane row in the bundle patch**, named exactly as the package so the client module registry can resolve and serve its bundle:

   ```yaml
   - insert:
       - id: legion-settings
         name: dsh-legion
         config:
           role: settings
           specialists: {}
   ```

2. **Add a composition-only role to the config schema.** A `settings` row registers the namespace and contributes nothing else — no tool, no prompt section, no projection, no service. The role is read from the row's own entry, never from the settings layer, is not carried into the materialized config, and is hidden from configuration surfaces, so a stored section can never flip a row and withdraw a deployment's tooling.

3. **Register or consume, decided by what the Host already serves.** A row registers only a namespace nothing else serves. Beside a served one it reads the raw stored section from the provider's descriptor and layers it over **its own** composition entry — schema defaults, then this row's entry, then the user's overrides — reproducing the provider's own layering walk, and re-derives on the document-updated event. Reading the owner's *resolved* value instead would answer with another row's entry underneath.

4. **Declare service dependencies on the half that uses them.** A package-level `inject` applies to every row regardless of role, so the Host-plane row would wait for services it never touches. Move them onto the inner plugin the dispatcher mounts for a non-settings row.

5. **Attach unconditionally, await conditionally.** Host rows activate on service availability rather than in file order, so gating registration on a synchronous `ctx.get('settings')` probe at apply time loses to a provider composed later. Attach through the injected scope always; await it only when a provider is already there, because awaiting a wait that may never resolve holds the row pending forever.

6. **Split validation along the same seam.** The row that owns a process-wide namespace may judge only what holds for any catalog. A cross-reference such as `defaultProfile` is valid for the row that defines that Specialist and invalid for the row beside it, so it is left to each consuming row, which keeps its last publishable generation and logs.

## Why This Works

Registration is an effect on the registering fiber, and a preset subtree is owned by the agent that mounted it, so the namespace's lifetime was the session's by construction. Moving the registration to a row in the Host composition makes it the process's instead. The card's second half is a different mechanism with the same shape: the client module registry composes its table from the Host loader entries, and a preset subtree is plugged directly rather than created as a loader entry, so a package mounted only in a preset is never scanned. One Host row fixes both, and the `role` field is what keeps that row from also publishing the agent-plane surface the package deliberately scopes to a preset.

The consuming half works because layering is a pure function of *(this row's entry, the stored section)*. Every row can compute it independently from the raw section, so N rows share one registration and one document without sharing a catalog.

## Prevention

- **Ask which fiber owns a registration before choosing where to mount.** Anything registered through an effect lives exactly as long as the fiber that registered it. Session-scoped fiber plus process-wide surface is always a bug.
- **Check both halves of a UI surface.** A browser card needs the namespace *served* and the bundle *discovered*; they fail independently and look identical from the user's seat.
- **Never resolve a plane or role decision from the document the plane is configured by.** Pin it to the composition entry and keep it out of the materialized output.
- **Test the shipped composition artifact, not just the code.** A test that parses the bundle patch and mounts the row it contains is what keeps the patch and the code from drifting.
- **Verify a test suite discriminates.** Every test in the first version of this suite failed pre-fix for the same trivial reason — an unknown config key — while eleven of thirteen still passed with the actual fix reverted. Re-run new tests against a counterfactual revert of each piece they claim to pin.

## Related Issues

- [ADR 0023](../../adr/0023-host-plane-settings-row.md) — the decision record for the split.
- [Live reconfiguration](../../settings.md) and [the settings card](../../settings-card.md) — the behaviour and its two halves.
- Upstream anchors in the DeepSeek Harness tree (another repository, verified at 0.1.1-rc.1): the provider's effect-scoped registration and duplicate refusal in `packages/settings/settings/src/index.ts`, the loader-entry scan in `packages/client/modules/src/index.ts`, and the directly-plugged preset subtree in `packages/preset/agent-presets/src/mount.ts`.
