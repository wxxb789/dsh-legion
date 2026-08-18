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
 * DSH ships an equivalent model for its own cards, but a client bundle may not
 * import another plugin's values, so this is Legion's own.
 */
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

/** The write one staged field performs when the card is saved. */
export type FieldWrite =
  | { readonly kind: 'set'; readonly value: unknown }
  | { readonly kind: 'clear' }

/** How one section field converts between its stored value and its draft. */
export interface FieldSpec {
  /** Field name inside the namespace section. */
  readonly field: string
  /** Render a stored value as draft text; empty when the section carries none. */
  readonly format: (value: unknown) => string
  /** The write this draft stages, or undefined when the draft is not acceptable. */
  readonly parse: (text: string) => FieldWrite | undefined
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
export function textField(field: string): FieldSpec {
  return {
    field,
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
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
      invalid: planned.some(entry => entry.write === undefined),
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
        this.staged.set(field, { text, clear: false })
        this.failed = false
        this.publish()
      },
      resetField: (field) => {
        const spec = this.spec(field)
        this.staged.set(field, { text: spec.format(undefined), clear: true })
        this.failed = false
        this.publish()
      },
      save: () => { void this.commit() },
      discard: () => {
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  /** Resolve every staged edit into the write a save would perform. */
  private plan(): readonly { field: string; write: FieldWrite | undefined }[] {
    return [...this.staged.entries()].map(([field, staged]) => ({
      field,
      write: staged.clear ? { kind: 'clear' as const } : this.spec(field).parse(staged.text),
    }))
  }

  private async commit(): Promise<void> {
    const planned = this.plan()
    if (planned.length === 0 || planned.some(entry => entry.write === undefined)) return
    this.saving = true
    this.failed = false
    this.publish()
    try {
      // Writes are issued in staged order; the scope fences each one with the
      // latest known revision and reloads Host state if the latest is refused.
      for (const entry of planned) {
        if (entry.write === undefined) continue
        if (entry.write.kind === 'clear') await this.scope.unset(entry.field)
        else await this.scope.set(entry.field, entry.write.value)
      }
      this.staged.clear()
    } catch {
      // The Host is authoritative. Keep the drafts so the user can retry or
      // discard, and re-seed nothing: the next scope publication tells the truth.
      this.failed = true
    } finally {
      this.saving = false
      this.publish()
    }
  }

  private spec(field: string): FieldSpec {
    const spec = this.specs.get(field)
    if (spec === undefined) throw new Error(`dsh-legion: unknown settings field "${field}"`)
    return spec
  }

  private sectionValue(field: string): unknown {
    const section = this.scope.getSnapshot().value
    return isRecord(section) ? section[field] : undefined
  }

  /** Whether the raw user layer carries this field — what marks it overridden. */
  private stored(field: string): boolean {
    const user = this.scope.getSnapshot().user
    return isRecord(user) && Object.hasOwn(user, field)
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
