# Tool presentation: what Legion inherits, and what would break it

Read against DSH 0.1.1-rc.1 (harness commit `3ec5e8f8c4`). Every line reference below is into
that checkout unless it names a Legion path.

## The question

"Make sure the plugin always inherits the latest official Code Mode (shown as PTC mode)."

Two things have to be true for that to hold: Legion must own no copy of the mechanism, and its
delegated children must land in the same presentation as their coordinator. Both are true today.
Neither was verified, guarded, or documented before this change.

## Where the decision lives

Presentation is `native` (every visible schema), `code` (only the reserved `run_code` transport
plus a generated SDK), or `both`. **"PTC mode" is the Web client's label for the code preset**, not
a separate mechanism: `packages/client/ui-agent-preset/src/client/locales.ts:40` renders
`presetCodeName: 'PTC mode'` (`:103` for zh). It is the only occurrence of the term in the harness.

- `ctx.tools.presentAs(mode)` writes the mode onto the **calling scope's** `ToolLayer`
  (`packages/core/tools/src/index.ts:946-971`; the cell is declared at `:723`). It refuses an
  unscoped context (`:948-950`) and refuses a second, conflicting declaration for the same scope
  (`:955-957`).
- `modeFor(scope)` resolves it by walking the scope chain nearest-first and falling back to the
  deployment default (`:900-911`).
- The official row that carries it into a preset is
  `@deepseek-ai/dsh-agent-tool-presentation` (`packages/core/agent-tool-presentation/src/index.ts`).
  A `native` row applies immediately (`:63-66`); a code row waits for `ctx.codeRuntime` (`:69-71`),
  so a preset selecting Code Mode on a deployment that composes no TypeScript runtime fails **at
  mount**, named, rather than at the first request.
- The deployment default is `native` (`packages/core/tools/src/index.ts:791`, `:830`, `:910`).
  Shipped Code Mode comes from a preset, not from the bundle:
  `apps/cli/config/agent-presets/code/agent.cordis.yml:260-263`. The runtime itself is host-plane
  (`packages/bundle/web-app/cordis.patch.yml:48`, `packages/bundle/headless/cordis.patch.yml:24`).

## Children inherit, and why

Not by copying a mode, but by scope re-parenting. When a child agent joins its parent's
composition, `AgentPresets.composeFrom` binds the child's scope key under the parent's **preset
standing scope**: `packages/preset/agent-presets/src/index.ts:316-325`, the binding at `:323`.
`presentAs` was declared on exactly that standing scope
(`packages/core/agent-tool-presentation/src/index.ts:64,70`), and `modeFor` walks the chain, so the
child resolves the same mode — with the `run_code` transport injected into its own scope and the
SDK section regenerated for the tools *that child* can see
(`packages/core/tools/src/index.ts:875-891`).

One boundary is worth recording: a `presentAs` declared on a parent **agent's own** scope rather
than on a preset standing mount would not reach children, because `composeFrom` binds to the preset
scope. Nothing in the harness does this. On a rosterless deployment both parent and child fall
through to the same `defaultMode`, so they still agree.

## `toolFilter` still means what Legion says it means

This mattered enough to check in source rather than assume, because Legion's `review` profile
promises a deny of `write`/`edit` and a plausible failure mode is "hidden from the schema list but
still callable through the SDK". It is not that.

- Visibility is computed once: a name survives only if **every** layer admits it
  (`packages/core/tools/src/index.ts:1174`, with `admits` at `:738-744`).
- The Code Mode binding table is built from that same filtered view —
  `registry.schemas(exec.agent)` at `packages/core/tools/src/code-mode.ts:614`, and `schemas()` is
  `[...this.view(scope).visible.values()]` (`index.ts:1234-1236`). A restricted name is never bound
  (`code-mode.ts:616`).
- The generated SDK text is projected from the same set (`index.ts:1239-1241`).
- Defence in depth: a program that fabricates the name still dispatches through
  `resolveExecution` (`index.ts:1221-1226`), whose `get(name, scope)` reads the filtered visible map
  (`:1204-1206`) and returns `undefined` → `UNKNOWN_TOOL`. The `parent` token a sub-dispatch carries
  lifts only the **code collapse** (`:1224`), never the capability filter.

Two limits are the Host's design and are now stated in the README rather than left to be
discovered:

1. `run_code` itself cannot be denied — `tools.restrict()` refuses to name it (`index.ts:1085-1087`)
   and the transport is injected outside the filterable layer (`:1184-1191`). It does not widen the
   callable set, so this is not a hole.
2. A filter constrains the surface a child **inherits**; tools the child's own scope registers (its
   report and structured-output tools) are exempt by construction (`index.ts:1176-1183`).

## What Legion could have pinned, and does not

Almost nothing is copyable, which is why inheritance is nearly free:

- The transport is privately constructed and never enters the filterable layer
  (`index.ts:913-933`).
- The SDK preamble is a module-private `const` in each language backend
  (`ts-types.ts:250`, `py-types.ts:734`) and is not exported.
- The prompt section is regenerated per live scope on every assembly (`index.ts:875-891`).

The single copyable literal is `RUN_CODE_NAME = 'run_code'` (`code-mode.ts:20`), which **is**
exported and should be imported if Legion ever needs it. Legion currently names it nowhere.

## What this change adds

Two separable things, and keeping them separate is the whole design.

**The bundled preset selects Code Mode**, by composing the official row with `mode: code`. This is
where the capability argument lands: coordination is what Code Mode is best at, because one program
starts several delegations together, waits on them as values, and reduces their results without a
model round trip per child. The coordinator guidance Legion already injects — *"start independent
delegations together"* — is a suggestion under `native` and an ordinary `Promise.all` here. Every
shipping bundle composes a runtime (`packages/bundle/headless`, `packages/bundle/web-app`), and the
failure mode where none does is loud and named at mount rather than silent at first request.

**Legion's own source still owns no part of the mechanism.** Selecting a presentation by composing
the official row and implementing one are opposite acts: the first tracks upstream, the second pins
a version. The row is preset data, exactly like the `dsh-tool-*` rows beside it.

The append-to-your-preset fragment carries **no** presentation row, because one composition selects
one presentation and `presentAs` throws on a second declaration for the same scope
(`packages/core/tools/src/index.ts:955-957`) — regardless of whether the two modes agree. A row
there would break exactly the base preset a PTC-mode user starts from.

`tests/tool-presentation.spec.ts` pins all of it: the complete preset must carry the official row at
`mode: code`, the fragment must carry no presentation row at all, and Legion's source must declare
no presentation, inject no `codeRuntime`, hardcode no `run_code`, and grow no presentation key. It
carries a negative control against samples quoted from upstream code that legitimately does each of
those, so a scan that could never fire cannot pass as a gate.

It also caught a live bug on its first run: `examples/legion.agent.cordis.fragment.yml` — shipped in
the package and named by the README as the recommended install path — had `enableDurableRuns` at
column zero and **was not parseable YAML**. Nothing had ever loaded it. Fixed here.

The remaining drift risk is not in Legion. `DSH_TOOLS_MODE`, the environment escape hatch the
web-app and headless bundles read, is annotated upstream as temporary and due for removal
(`packages/bundle/web-app/cordis.patch.yml:37-40`). A deployment that selects PTC mode through that
variable rather than through a preset row is the configuration that will need revisiting; Legion is
unaffected either way, because it reads neither.
