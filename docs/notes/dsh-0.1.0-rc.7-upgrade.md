# DSH 0.1.0-rc.7 upgrade assessment

Assessed on 2026-08-17 against the DSH release commits `15148dbd9a` (0.1.0-rc.6) and `bb4ca698d6` (0.1.0-rc.7).

## Verdict

**No breaking change reaches this plugin, and the upgrade required no compatibility fix.** The declared peer range `>=0.1.0-rc.6 <0.2.0` already admits 0.1.0-rc.7. Typecheck, build, and the full unit suite pass unchanged against rc.7 sources.

## Surface Legion actually imports

| Package | Imported symbols | rc.6 to rc.7 |
|---|---|---|
| `@deepseek-ai/cordis` | `Context` | unchanged |
| `dsh-agent` | `Agent` | unchanged (no source diff) |
| `dsh-llm` | `ContentBlock`, `LlmResolvedModelInfo`, `LlmRuntime` | unchanged |
| `dsh-session` | `JsonValue`, `Session`, `SessionEvent`, `SessionEventMap`, `snapshotJsonValue`, `SessionId` | unchanged (no source diff) |
| `dsh-subagent` | `SubagentCapabilities`, `SubagentProvider`, `SubagentResult`, `SubagentRun`, `SubagentStartRequest` | unchanged (version bump only) |
| `dsh-system-prompt` | side-effect import | unchanged |
| `dsh-tools` | `JsonValue`, `ObjectJsonSchema`, `ToolDefinition`, `defineTool`, `validateJsonSchemaValue` | unchanged |

## The one real breaking change, and why it misses Legion

`dsh-llm` gained `ReplayEnvelope` (`packages/llm/llm/src/types.ts`) and retyped the terminal `finish` chunk's `replayState` from `unknown` to `ReplayEnvelope`; `BlockAssembler.replayState` now returns `ReplayEnvelope | undefined` and prunes per-block entries in step with max-token truncation. That narrows a *producer* position, so it is source-breaking for LLM **adapter authors** only. Legion authors no adapter and never touches `replayState`.

Two further narrowings sit outside Legion's imports: `AttachmentError.code` narrowed from `string` to `AttachmentErrorCode`, and the apiproxy dropped the `settings-not-exposed` RPC error code.

## Notable additions

- **Plugin-owned settings surface (PR #2404).** The service contract itself is unchanged since rc.6; what rc.7 changed is exposure — the apiproxy `WEB_SETTINGS_NAMESPACES` allowlist is gone, so the Host now serves *every* registered namespace, and the browser slot became keyed by namespace. Adopted; see ADR 0021 and `docs/settings.md`.
- **Background product subagents (PR #2374).** Codex and Claude Code preset rows can now run one-shot background jobs. This added no package and no API: the opt-in is composition-level (mount the optional provider package, drop `disabled: true`, set `backgroundMode: one-shot`, mount `dsh-jobs-local` + `dsh-tool-jobs`). `SubagentCapabilities` gained no flag, and background execution consults none. Legion needs no change; a Profile targeting those providers must keep `maxDepth: 'provider-managed'`, which Legion already enforces because both providers report all capabilities false.
- **Rich-content bridge.** `AttachmentStore.saveImages` performs ordered batch admission, and code mode now forwards nested image results to the model. Legion's tool returns text, so nothing to adopt.
- **`low` reasoning effort for DeepSeek.** Legion mirrors `LlmResolvedModelInfo.reasoning.efforts` as opaque strings rather than a hardcoded enum, so the new level flows through route evidence with no change.
- **Cancellation fidelity (`caf7d48f88`).** A background subagent cancelled while its cleanup also fails now settles `failed` instead of being flattened to `killed`.

## Still missing upstream

The roadmap's upstream asks are unchanged by rc.7: no child reasoning-effort override at the `AgentOptions`/request seam, and no unified recovery seam. Most importantly for v1.1, rc.7 still ships no atomic run-coordination Host service, so `durableMutation` stays `unavailable-fail-closed`. Session flush and `sessionProjections` do exist in DSH; coordination is the single missing mandatory capability.
