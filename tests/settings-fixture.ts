import type { Context } from '@deepseek-ai/cordis'
import SettingsProvider, { type SettingsNamespace } from '@deepseek-ai/dsh-settings'

export class SettingsFixture {
  private document: Record<string, unknown>
  private provider: MemorySettings | undefined
  private disposeProvider: (() => Promise<void>) | undefined

  constructor(
    stored: Record<string, Record<string, unknown>> = {},
    readonly missFirstGet = false,
  ) {
    this.document = structuredClone(stored)
  }

  async mount(ctx: Context): Promise<void> {
    const fiber = ctx.plugin(MemorySettings, this)
    await fiber
    const provider = ctx.get('settings')
    if (!(provider instanceof MemorySettings)) throw new Error('settings fixture did not mount')
    this.provider = provider
    this.disposeProvider = () => fiber.dispose()
  }

  async unmount(): Promise<void> {
    await this.disposeProvider?.()
    this.disposeProvider = undefined
  }

  get service(): MemorySettings {
    if (this.provider === undefined) throw new Error('settings fixture is not mounted')
    return this.provider
  }

  get registrations(): Map<string, ReturnType<MemorySettings['describe']>[number]> {
    return new Map(this.service.describe().map(descriptor => [descriptor.ns, descriptor]))
  }

  commit(namespace: string, section: Record<string, unknown>): void {
    this.document[namespace] = structuredClone(section)
    this.service.pushExternal(this.document)
  }

  load(): Record<string, unknown> {
    return structuredClone(this.document)
  }

  persist(namespace: SettingsNamespace, section: Record<string, unknown>): void {
    this.document[namespace] = structuredClone(section)
  }
}

class MemorySettings extends SettingsProvider {
  readonly writable = true
  private missed = false

  constructor(ctx: Context, private readonly fixture: SettingsFixture) {
    super(ctx)
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(this.fixture.load())
  }

  protected persist(namespace: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.fixture.persist(namespace, section)
    return Promise.resolve()
  }

  override get<const Namespace extends string>(namespace: Namespace): unknown {
    if (this.fixture.missFirstGet && !this.missed) {
      this.missed = true
      return undefined
    }
    return super.get(namespace as never)
  }

  pushExternal(document: Record<string, unknown>): void {
    this.publish(structuredClone(document))
  }
}
