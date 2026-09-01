/**
 * Legion's own staged settings form.
 *
 * A settings write is a durable, revision-fenced document mutation, so a
 * control that committed as it settled would turn one keystroke into a write
 * the user never asked for. Every edit is staged and written only on save, so
 * what is on screen is exactly what a save would store.
 *
 * A field shows its effective value — the user layer over the composition
 * layer over the schema default — and whether the user layer carries it. That
 * PRESENCE, not a value comparison, is what marks a field overridden: an
 * override equal to the composition default is still an override, and
 * comparing values could not see it.
 *
 * The Host is the only authority on whether a value was accepted: its
 * validators own constraints no schema can express. So a save reads the
 * section back and reports whether the staged value is what the Host now
 * holds, rather than treating "no exception" as "landed".
 *
 * DSH ships an equivalent model for its own cards, but a client bundle may not
 * import another plugin's values, so this is Legion's own. It mirrors the
 * semantics of `CardForm` in `@deepseek-ai/dsh-client-ui-settings-plugins` as
 * of DSH 0.1.0-rc.8.
 */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** The write one staged field performs when the card is saved. */
export type FieldWrite =
  | { readonly kind: 'set'; readonly value: JsonValue }
  | { readonly kind: 'clear' }

/** How one section field converts between its stored value and its draft. */
export interface FieldSpec {
  /** Field name inside the namespace section. */
  readonly field: string
  /** Render a stored value as draft text; empty when the section carries none. */
  readonly format: (value: unknown) => string
  /** The write this draft stages, or undefined when the draft is not acceptable. */
  readonly parse: (text: string) => FieldWrite | undefined
  /** Retired field names read on load and removed by a canonical save. */
  readonly aliases?: readonly string[]
}

/** One control's state as the card renders it. */
export interface FieldState {
  /** Draft text the control renders. */
  readonly text: string
  /** Whether saving would leave a user-layer entry for this field. */
  readonly overridden: boolean
  /** Whether the draft is not a value this field accepts, which blocks saving. */
  readonly invalid: boolean
}

/** Card-level state shared by every control. */
export interface FormShell {
  /** False while the namespace is not served to this client. */
  readonly available: boolean
  /** Whether the Host document accepts writes. */
  readonly writable: boolean
  /** Whether the form holds edits a save would write. */
  readonly dirty: boolean
  /** Whether any staged draft is invalid, which blocks the save. */
  readonly invalid: boolean
  /** Whether a save is crossing the wire. */
  readonly saving: boolean
  /** Whether the last save did not land as staged. */
  readonly failed: boolean
}

/** The write actions the card's slot entry injects. */
export interface FormActions {
  /** Stage draft text for one field. */
  readonly edit: (field: string, text: string) => void
  /** Stage a clear, so saving lets the field re-inherit the composition layer. */
  readonly resetField: (field: string) => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  readonly save: () => void
  /** Drop every staged edit. */
  readonly discard: () => void
}

/** A free-text field; an empty draft clears it. */
export function textField(field: string, aliases: readonly string[] = []): FieldSpec {
  return {
    field,
    ...aliases.length === 0 ? {} : { aliases },
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

/**
 * A whole-number field bounded by the schema's own range. An empty draft
 * clears it; any other draft outside the range is reported invalid here rather
 * than sent for the Host to refuse, so the user sees which control is wrong
 * instead of a save that silently did not land.
 * @param field - field name inside the namespace section.
 * @param bounds - the inclusive range the Host schema accepts.
 */
export function numberField(field: string, bounds: { min: number; max: number }): FieldSpec {
  return {
    // A section carrying no number renders empty rather than as a value
    // nobody chose.
    field,
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      if (!Number.isSafeInteger(parsed)) return undefined
      if (parsed < bounds.min || parsed > bounds.max) return undefined
      return { kind: 'set', value: parsed }
    },
  }
}

/**
 * A boolean field. Its control writes the canonical strings below rather than
 * free text, so no draft it can produce is ever invalid.
 */
export function booleanField(field: string): FieldSpec {
  return {
    field,
    format: value => typeof value === 'boolean' ? String(value) : '',
    parse: (text) => {
      if (text === '') return { kind: 'clear' }
      if (text === 'true' || text === 'false') return { kind: 'set', value: text === 'true' }
      return undefined
    },
  }
}

/** One field's staged edit. */
interface StagedEdit {
  readonly text: string
  /** True when this edit clears the field whatever text it shows. */
  readonly clear: boolean
}

/** One staged edit resolved into the write a save performs. */
interface PlannedWrite {
  /** Field this entry writes. */
  readonly field: string
  /**
   * Perform the write and report whether the Host holds the staged value
   * afterwards; undefined when the draft is not a value the field accepts.
   */
  readonly run: (() => Promise<boolean>) | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Stages one card's edits over one settings namespace and writes them on save. */
export class SettingsForm<Section> {
  private readonly specs: Map<string, FieldSpec>
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false

  /**
   * @param scope - the bound settings scope for this card's namespace.
   * @param specs - the section fields this card edits.
   */
  constructor(private readonly scope: SettingsScope<Section>, specs: readonly FieldSpec[]) {
    this.specs = new Map(specs.map(spec => [spec.field, spec]))
    scope.subscribe(() => { this.publish() })
  }

  /**
   * Register a projection rebuilt whenever the scope or a draft changes.
   * @param rebuild - recompute and publish the card's state.
   */
  onChange(rebuild: () => void): void {
    this.listeners.add(rebuild)
  }

  /** Read the card-level state: what the Host serves, and what a save would do. */
  shell(): FormShell {
    const snapshot = this.scope.getSnapshot()
    const planned = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: planned.length > 0,
      invalid: planned.some(entry => entry.run === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  /** Read one control's state. */
  field(name: string): FieldState {
    const spec = this.spec(name)
    const staged = this.staged.get(name)
    if (staged === undefined) {
      return { text: spec.format(this.sectionValue(name)), overridden: this.stored(name), invalid: false }
    }
    const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
    return {
      text: staged.text,
      // The badge previews the save rather than reporting a state the pending
      // edit already contradicts.
      overridden: write !== undefined && write.kind === 'set',
      invalid: write === undefined,
    }
  }

  /** Build the write actions for this form. */
  actions(): FormActions {
    return {
      edit: (field, text) => {
        this.spec(field)
        this.stage(field, { text, clear: false })
      },
      resetField: (field) => {
        // Seed the control with what the field will re-inherit, so a reset
        // previews the composition layer instead of blanking the control and
        // implying the setting is about to disappear.
        this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true })
      },
      save: () => { void this.commit() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  /**
   * Every staged edit a save would write. A draft that restates what the
   * section already holds carries no write unless that edit replaces a retired
   * field alias; neither is clearing a field the user layer never carried, however
   * that clear was staged — the tri-state controls reach it by draft, not only
   * through reset. An unacceptable draft carries no runnable write, which keeps
   * the form dirty and makes the save refuse rather than drop it.
   */
  private plan(): readonly PlannedWrite[] {
    const planned: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      const spec = this.spec(field)
      if (staged.clear) {
        if (this.stored(field)) planned.push({ field, run: () => this.clear(field) })
        continue
      }
      if (staged.text === spec.format(this.sectionValue(field)) && !this.legacyStored(field)) continue
      const write = spec.parse(staged.text)
      if (write === undefined) planned.push({ field, run: undefined })
      else if (write.kind === 'clear') {
        if (this.stored(field)) planned.push({ field, run: () => this.clear(field) })
      }
      else planned.push({ field, run: () => this.store(field, write.value) })
    }
    return planned
  }

  /**
   * Write every staged edit, then judge the outcome from what the Host holds.
   *
   * A save that did not land keeps its drafts, so the user can correct them
   * instead of retyping, and re-seeds nothing: the next scope publication
   * tells the truth.
   */
  private async commit(): Promise<void> {
    const planned = this.plan()
    const writes = planned.flatMap(entry => entry.run === undefined ? [] : [entry.run])
    if (planned.length === 0 || this.saving || writes.length !== planned.length) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    // Writes are issued in staged order; the scope fences each one with the
    // latest known revision and reloads Host state if the latest is refused.
    for (const write of writes) {
      landed = await this.attempt(write) && landed
    }
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  /** Run one write, treating a rejection as a write that did not land. */
  private async attempt(write: () => Promise<boolean>): Promise<boolean> {
    try {
      return await write()
    } catch {
      return false
    }
  }

  private async clear(field: string): Promise<boolean> {
    const aliases = this.spec(field).aliases ?? []
    if (aliases.length === 0) await this.scope.unset(field)
    else await this.scope.mutate([field, ...aliases].map(path => ({ op: 'unset', path: [path] })))
    return !this.stored(field)
  }

  private async store(field: string, value: JsonValue): Promise<boolean> {
    const aliases = this.spec(field).aliases ?? []
    if (aliases.length === 0) await this.scope.set(field, value)
    else await this.scope.mutate([
      ...aliases.map(path => ({ op: 'unset' as const, path: [path] })),
      { op: 'set', path: [field], value },
    ])
    const user = this.userLayer()
    if (user?.[field] !== value) return false
    return aliases.every(alias => !Object.hasOwn(user, alias))
  }

  private stage(field: string, edit: StagedEdit): void {
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  private spec(field: string): FieldSpec {
    const spec = this.specs.get(field)
    // Every call site names a field this card declared; a missing one is a
    // wiring mistake that must not degrade into a silently inert control.
    if (spec === undefined) throw new Error(`dsh-legion: unknown settings field "${field}"`)
    return spec
  }

  private fieldValue(source: unknown, field: string): unknown {
    if (!isRecord(source)) return undefined
    for (const candidate of [field, ...(this.spec(field).aliases ?? [])]) {
      if (Object.hasOwn(source, candidate)) return source[candidate]
    }
    return undefined
  }

  private sectionValue(field: string): unknown {
    return this.fieldValue(this.scope.getSnapshot().value, field)
  }

  /** The composition layer's value — what a cleared field re-inherits. */
  private baseValue(field: string): unknown {
    return this.fieldValue(this.scope.getSnapshot().base, field)
  }

  private userLayer(): Record<string, unknown> | undefined {
    const user = this.scope.getSnapshot().user
    return isRecord(user) ? user : undefined
  }

  private legacyStored(field: string): boolean {
    const user = this.userLayer()
    return user !== undefined
      && (this.spec(field).aliases ?? []).some(alias => Object.hasOwn(user, alias))
  }

  /** Whether the raw user layer carries this field — what marks it overridden. */
  private stored(field: string): boolean {
    const user = this.userLayer()
    return user !== undefined
      && [field, ...(this.spec(field).aliases ?? [])].some(candidate => Object.hasOwn(user, candidate))
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
