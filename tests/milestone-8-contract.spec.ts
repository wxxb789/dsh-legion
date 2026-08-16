import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_LEGION_PROJECTION_STATE, LEGION_EVENT_TYPES, LEGION_RUN_PROJECTION_KEY,
  LEGION_RUN_PROJECTION_STATE_VERSION, applyLegionProjection, detectDurableCapabilities,
  materializeConfig, restoreLegionProjection,
} from '../src/index.ts'
const ROOT=dirname(fileURLToPath(new URL('../package.json',import.meta.url)))
const journal=JSON.parse(readFileSync(join(ROOT,'contracts/journal-v1.json'),'utf8'))
describe('v1.1 release compatibility contract',()=>{
  it('freezes eight event families and projection state 6',()=>{
    expect(journal.eventFamilies.map((item:{type:string})=>item.type)).toEqual(LEGION_EVENT_TYPES)
    expect(journal.eventFamilies).toHaveLength(8)
    expect(journal.projection).toMatchObject({key:LEGION_RUN_PROJECTION_KEY,stateVersion:LEGION_RUN_PROJECTION_STATE_VERSION})
  })
  it('preserves previous config and catalog defaults when durable fields are omitted',()=>{
    const config=materializeConfig({configVersion:2,profiles:{legacy:{description:'Legacy v1.0 profile.',subagentProvider:'spawn',maxDepth:1,defaultRunInBackground:false}}})
    expect(config.enableDurableRuns).toBe(false)
    expect(config.enableStrategies).toBe(false)
    expect(config.durableRunPolicy).toEqual({maxStartsPerActivation:16,maxConcurrentTasks:4})
  })
  it('projects unrelated event-free history as empty by identity',()=>{
    const unrelated={seq:7,timestamp:1,type:'host/unrelated',data:{}} as never
    expect(applyLegionProjection(EMPTY_LEGION_PROJECTION_STATE,unrelated)).toBe(EMPTY_LEGION_PROJECTION_STATE)
  })
  it('refolds rather than trusting an old checkpoint',()=>{
    expect(restoreLegionProjection({stateVersion:4,state:{runs:{invalid:{} as never}}},[],[])).toEqual(EMPTY_LEGION_PROJECTION_STATE)
  })
  it('reports deterministic rc.6 capability absence and cannot mutate',()=>{
    const first=detectDurableCapabilities({get:()=>undefined})
    const second=detectDurableCapabilities({get:()=>undefined})
    expect(second).toEqual(first)
    expect(first.durableMutation).toBe(false)
    expect(first.diagnostics).toEqual([
      'LEGION_DURABLE_FLUSH_UNAVAILABLE','LEGION_SESSION_PROJECTION_UNAVAILABLE',
      'LEGION_DURABLE_COORDINATION_UNAVAILABLE','LEGION_GLOBAL_ADMISSION_UNAVAILABLE',
      'LEGION_DURABLE_CHILD_RECEIPT_UNAVAILABLE',
    ])
  })
})
