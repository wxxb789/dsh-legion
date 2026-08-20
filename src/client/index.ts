/**
 * Legion's browser half: one settings card keyed on the `legion` namespace.
 *
 * DSH serves every registered settings namespace and keys the plugin
 * configuration tab's cards on the namespace they edit, so a plugin that
 * registers both halves is paired up automatically. Legion's Host half
 * registers the namespace (see `src/settings.ts`); this half draws it.
 *
 * The card owns its chrome, its staging, and its revision fencing. A client
 * bundle may not import another plugin's values — that would either duplicate a
 * runtime instance or require a specifier the Host's frozen module table cannot
 * answer — so nothing here is borrowed from the cards DSH ships.
 */
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Module scope: the loader claims plugin styles as soon as this factory
// returns, so the tag must exist by then.
import './styles.ts'
import { LegionCard, type LegionCardState } from './LegionCard.ts'
import {
  SettingsForm, booleanField, numberField, textField, type FormActions,
} from './settings-form.ts'
import { en, zh } from './locales.ts'

export type { LegionCardProps, LegionCardState } from './LegionCard.ts'
export type { FieldSpec, FieldState, FormActions, FormShell } from './settings-form.ts'
export { en, zh } from './locales.ts'

/**
 * The settings namespace this card edits. It is the join key the plugin
 * configuration tab pairs with the Host registration, so it must equal
 * `LEGION_SETTINGS_NAMESPACE` in the Host half.
 */
export const LEGION_NAMESPACE = 'legion'

/** Dictionary namespace owning this card's copy. */
export const LEGION_LOCALE_NS = 'settings.legion'

/** The slot the plugin configuration tab dispatches one card per namespace into. */
export const LEGION_CARD_SLOT = 'settings.plugin.item'

/**
 * The range the Host schema accepts for `maxResourceBytes`, mirrored so the
 * control can refuse a draft before it becomes a write the Host would reject.
 * A client bundle cannot import the schema — that would inline the whole Host
 * configuration module — so `tests/client-bundle.spec.ts` pins this against
 * `Config` in `src/config.ts` instead.
 */
export const LEGION_MAX_RESOURCE_BYTES = { min: 1, max: 4 * 1024 * 1024 } as const

/** The Legion section fields this card edits — a deliberate subset of the schema. */
export interface LegionCardSection {
  toolName?: string
  defaultProfile?: string
  maxResourceBytes?: number
  enableRunInBackground?: boolean
  enableStrategies?: boolean
}

/** The face this card's slot registration injects. */
export interface LegionCardFace extends FormActions {
  hooks: {
    /** Card snapshot bound by the renderer as `useLegionCard`. */
    legionCard: unknown
  }
  /** Disclose or collapse the card's controls. */
  toggle: () => void
}

/** Bridges the `legion` scope onto the card's staged form. */
export class LegionCardController {
  private readonly form: SettingsForm<LegionCardSection>
  private readonly store: ReturnType<typeof createSnapshotStore<LegionCardState>>
  /**
   * Which card a user has open is a reading gesture the Host has no stake in,
   * so it lives beside the drafts rather than in the document. It rides the
   * card store rather than React state so the bundle's React surface stays at
   * `createElement`, which is the whole of the hand-maintained declaration in
   * `dsh-client.d.ts`.
   */
  private open = false

  /** @param scope - the bound settings scope for the `legion` namespace. */
  constructor(scope: SettingsScope<LegionCardSection>) {
    this.form = new SettingsForm(scope, [
      textField('toolName'),
      textField('defaultProfile'),
      numberField('maxResourceBytes', LEGION_MAX_RESOURCE_BYTES),
      booleanField('enableRunInBackground'),
      booleanField('enableStrategies'),
    ])
    this.store = createSnapshotStore<LegionCardState>(this.projection())
    this.form.onChange(() => { this.store.set(this.projection()) })
  }

  private projection(): LegionCardState {
    return {
      ...this.form.shell(),
      open: this.open,
      toolName: this.form.field('toolName'),
      defaultProfile: this.form.field('defaultProfile'),
      maxResourceBytes: this.form.field('maxResourceBytes'),
      enableRunInBackground: this.form.field('enableRunInBackground'),
      enableStrategies: this.form.field('enableStrategies'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot store, its disclosure, and its form actions.
   */
  inject(): LegionCardFace {
    return {
      hooks: { legionCard: this.store },
      toggle: () => {
        this.open = !this.open
        this.store.set(this.projection())
      },
      ...this.form.actions(),
    }
  }
}

/** Required browser services. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Mount Legion's settings card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new LegionCardController(
    ctx.settingsScope.bind<LegionCardSection>({ namespace: LEGION_NAMESPACE }),
  )
  ctx.effect(() => ctx.locale.register(LEGION_LOCALE_NS, { en, zh }), 'dsh-legion: card dictionaries')
  // inject() defers registration until the tab declares the slot, so this half
  // does not need the tab to exist yet — or ever.
  ctx.slots.inject(LEGION_CARD_SLOT, () => ctx.slots.register({
    name: LEGION_CARD_SLOT,
    key: LEGION_NAMESPACE,
    locale: LEGION_LOCALE_NS,
    inject: () => controller.inject(),
  }, LegionCard))
}
