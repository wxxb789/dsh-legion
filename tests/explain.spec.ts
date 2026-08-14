import { describe, expect, it } from 'vitest'
import type { Config } from '../src/config.ts'
import { compileCatalog, type RuntimeSnapshot } from '../src/compiler.ts'
import {
  explainCatalog,
  materializeExplainViewV1,
  renderExplainHuman,
} from '../src/explain.ts'

const config: Config = {
  toolName: 'legion',
  enableRunInBackground: true,
  defaultProfile: 'quick',
  profiles: {
    quick: {
      description: 'Fast work.',
      subagentProvider: 'spawn',
      agentOptions: { provider: 'fast', model: 'small' },
      maxDepth: 2,
      defaultRunInBackground: true,
    },
    review: {
      description: 'Review work.',
      subagentProvider: 'remote',
      maxDepth: 'provider-managed',
      defaultRunInBackground: false,
      result: 'review-v1',
    },
  },
}

const providers: RuntimeSnapshot = {
  providers: {
    spawn: {
      continuable: true,
      capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    },
  },
}

describe('explainCatalog', () => {
  it('projects active and inactive profiles into a deterministic JSON-safe view', () => {
    const view = explainCatalog(compileCatalog(config, providers), { providerSnapshot: 'fixture' })

    expect(view).toMatchObject({
      version: 1,
      kind: 'legion-explain',
      source: { providerSnapshot: 'fixture' },
      summary: {
        status: 'warnings',
        configuredProfiles: 2,
        activeProfiles: 1,
        inactiveProfiles: 1,
        errors: 0,
        warnings: 1,
      },
      tool: {
        name: 'legion',
        configuredDefaultProfile: 'quick',
        activeDefaultProfile: 'quick',
      },
      profiles: [
        { kind: 'active-profile', name: 'quick', allowedModes: ['foreground', 'continuable'] },
        {
          kind: 'inactive-profile',
          name: 'review',
          allowedModes: [],
          diagnosticCodes: ['PROFILE_PROVIDER_UNAVAILABLE'],
        },
      ],
    })
    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
  })

  it('shows the authored primary exact route without claiming invocation selection', () => {
    const routed = explainCatalog(compileCatalog({
      ...config,
      profiles: {
        quick: {
          ...config.profiles.quick!,
          agentOptions: undefined,
          routes: [
            { id: 'primary', provider: 'models', model: 'strong', maxTokens: 8192 },
            { id: 'static', provider: 'models', model: 'fast' },
          ],
        } as never,
      },
    }, providers), { providerSnapshot: 'fixture' })
    expect(routed.profiles[0]).toMatchObject({
      name: 'quick',
      route: { provider: 'models', model: 'strong', maxTokens: 8192 },
    })
    expect(renderExplainHuman(routed, { command: 'explain', detail: 'profiles' }))
      .toContain('model route: models/strong')
  })

  it('keeps configured and active defaults distinct for an empty fixture', () => {
    const view = explainCatalog(compileCatalog(config, { providers: {} }), {
      providerSnapshot: 'empty-fixture',
    })

    expect(view.tool.configuredDefaultProfile).toBe('quick')
    expect(view.tool.activeDefaultProfile).toBeUndefined()
    expect(view.summary).toMatchObject({ status: 'warnings', activeProfiles: 0, warnings: 3 })
  })

  it('reports capability mismatches as errors and renders stable human detail', () => {
    const view = explainCatalog(compileCatalog({
      ...config,
      defaultProfile: 'review',
      profiles: { review: config.profiles.review! },
    }, {
      providers: {
        remote: {
          continuable: false,
          capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        },
      },
    }), { providerSnapshot: 'fixture' })

    expect(view.summary.status).toBe('errors')
    expect(view.summary.errors).toBe(1)
    const human = renderExplainHuman(view, { detail: 'profiles' })
    expect(human).toContain('Provider evidence: fixture')
    expect(human).toContain('review')
    expect(human).toContain('PROFILE_OUTPUT_SCHEMA_UNSUPPORTED')
    expect(human).toContain('Result: errors')
  })

  it('runtime-validates and detaches the public V1 JSON contract', () => {
    const source = explainCatalog(compileCatalog(config, providers), { providerSnapshot: 'fixture' })
    const detached = materializeExplainViewV1(source)
    expect(detached).toEqual(source)
    expect(detached).not.toBe(source)

    for (const invalid of [
      { ...source, kind: 'other' },
      { ...source, policyDigest: 'sha256:deadbeef' },
      { ...source, summary: { ...source.summary, activeProfiles: 99 } },
      { ...source, extra: true },
      {
        ...source,
        profiles: source.profiles.map(profile => profile.kind === 'active-profile'
          ? { ...profile, defaultMode: 'continuable', allowedModes: ['foreground'] }
          : profile),
      },
      { ...source, profiles: [source.profiles[0], source.profiles[0]] },
      {
        ...source,
        tool: { ...source.tool, activeDefaultProfile: 'review' },
      },
      {
        ...source,
        profiles: source.profiles.map(profile => ({
          ...profile,
          route: { ...profile.route, maxTokens: 0 },
        })),
      },
      { ...source, diagnostics: [{
        code: 'PROFILE_DEPTH_UNSUPPORTED',
        severity: 'warning',
        message: 'wrong severity',
        profile: 'quick',
      }] },
    ]) {
      expect(() => materializeExplainViewV1(invalid)).toThrow(/dsh-legion:/)
    }
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(() => materializeExplainViewV1(cyclic)).toThrow(/invalid ExplainViewV1/)
  })

  it('returns detached diagnostics and profile arrays', () => {
    const catalog = compileCatalog(config, providers)
    const view = explainCatalog(catalog, { providerSnapshot: 'live-dsh-registry' })
    ;(view.diagnostics as unknown as Array<{ message: string }>)[0]!.message = 'changed'
    ;(view.profiles as unknown[]).pop()
    expect(catalog.diagnostics[0]?.message).not.toBe('changed')
    expect(Object.keys(catalog.profiles)).toHaveLength(2)
  })
})
