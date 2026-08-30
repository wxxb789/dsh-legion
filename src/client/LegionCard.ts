/**
 * Legion's plugin settings card.
 *
 * The card edits the scalar policies that are meaningful to change while the
 * harness runs. Specialists, routes, Cohorts, Strategies, and catalog layers stay in
 * the configuration document on purpose: they are structured data whose
 * validity depends on other entries, and a form that let them be edited
 * field-by-field would publish half-built catalogs.
 *
 * The chrome is a disclosure card, matching the shape DSH's own plugin cards
 * use as of 0.1.0-rc.8: the plugin configuration tab renders every card into
 * one `<ul>`, so a card that drew itself as an always-open `<section>` would
 * read as a different kind of object than its neighbours. Form controls are
 * plain elements rather than the `Button`/`Input` atoms, for the same reason
 * DSH's own cards use plain elements: those atoms are 36px capsules sized for
 * toolbars, not for a settings row's density.
 *
 * Written with `createElement` rather than JSX because React is a platform
 * module resolved from the Host's module table. The published React and slot
 * types still check this component at build time without adding a JSX transform.
 */
import { createElement as h, type ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FieldState, FormActions, FormShell } from './settings-form.ts'

/** What the Legion card renders. */
export interface LegionCardState extends FormShell {
  /** Whether the card is disclosing its controls. */
  readonly open: boolean
  readonly toolName: FieldState
  readonly defaultSpecialist: FieldState
  readonly maxResourceBytes: FieldState
  readonly enableRunInBackground: FieldState
  readonly enableStrategies: FieldState
}

/** The registration-side face the card's slot entry injects. */
export interface LegionCardFace extends FormActions {
  hooks: {
    /** Card snapshot bound by the renderer as `useLegionCard`. */
    legionCard: SnapshotStore<LegionCardState>
  }
  /** Disclose or collapse the card's controls. */
  toggle: () => void
}

/** Props the slot renderer composes from the published slot contracts. */
export type LegionCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.legion'>
  & InjectFace<LegionCardFace>

/** Copy every control row needs regardless of what it edits. */
interface RowCopy {
  readonly overriddenLabel: string
  readonly resetLabel: string
  readonly disabled: boolean
}

/** One labelled row: its label, its override badge and reset, and its hint. */
function row(options: RowCopy & {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly invalidLabel: string
  readonly state: FieldState
  /** Builds the control; receives the id the label points at. */
  readonly control: ReactNode
  /** True when the label names the control through `aria-labelledby` instead. */
  readonly labelledBy: boolean
  readonly onReset: () => void
}): ReactNode {
  const label = options.labelledBy
    ? h('span', { className: 'dsh-legion-card__label', id: `${options.id}-label`, key: 'label' }, options.label)
    : h('label', { className: 'dsh-legion-card__label', htmlFor: options.id, key: 'label' }, options.label)
  return h('div', { className: 'dsh-legion-card__row', key: options.id }, [
    h('div', { className: 'dsh-legion-card__head', key: 'head' }, [
      label,
      options.state.overridden
        ? h('span', { className: 'dsh-legion-card__badges', key: 'badges' }, [
            h('span', { className: 'dsh-legion-card__badge', key: 'badge' }, options.overriddenLabel),
            h('button', {
              key: 'reset',
              type: 'button',
              className: 'dsh-legion-card__reset',
              disabled: options.disabled,
              onClick: options.onReset,
            }, options.resetLabel),
          ])
        : null,
    ]),
    options.control,
    // The invalid line replaces the hint rather than stacking under it: a row
    // that reports both says two things about one control.
    h('p', {
      className: options.state.invalid ? 'dsh-legion-card__invalid' : 'dsh-legion-card__hint',
      key: 'hint',
    }, options.state.invalid ? options.invalidLabel : options.hint),
  ])
}

/** A staged free-text or numeric control. */
function textControl(options: {
  readonly id: string
  readonly state: FieldState
  readonly disabled: boolean
  readonly numeric: boolean
  readonly onEdit: (text: string) => void
}): ReactNode {
  return h('input', {
    key: 'control',
    id: options.id,
    type: 'text',
    className: options.state.invalid ? 'dsh-legion-card__input--invalid' : 'dsh-legion-card__input',
    // `numeric` only hints the keypad. Which drafts a field accepts is decided
    // by its spec, so the control never silently rewrites what was typed.
    ...options.numeric ? { inputMode: 'numeric' } : {},
    ...options.state.invalid ? { 'aria-invalid': true } : {},
    value: options.state.text,
    disabled: options.disabled,
    onChange: (event: { currentTarget: { value: string } }) => { options.onEdit(event.currentTarget.value) },
  })
}

/** The three states a tri-state boolean control offers, in reading order. */
const TOGGLE_CHOICES = [
  { value: '', key: 'inherit' },
  { value: 'true', key: 'on' },
  { value: 'false', key: 'off' },
] as const

/**
 * A tri-state boolean control: inherited, explicitly on, or explicitly off.
 *
 * Three options rather than a `<select>`, because all three states are then
 * visible at once — a collapsed list hides that "inherit" is a distinct choice
 * from the value it currently resolves to. They are native radios rather than
 * pressable buttons because the three are mutually exclusive: a radio group
 * carries that exclusivity to assistive technology, and arrow-key traversal
 * comes with it instead of having to be re-implemented.
 */
function toggleControl(options: {
  readonly id: string
  readonly state: FieldState
  readonly disabled: boolean
  readonly copy: LegionCardProps['t']
  readonly onEdit: (text: string) => void
}): ReactNode {
  return h('div', {
    key: 'control',
    id: options.id,
    className: 'dsh-legion-card__toggle',
    role: 'radiogroup',
    'aria-labelledby': `${options.id}-label`,
  }, TOGGLE_CHOICES.map(choice => h('label', {
    key: choice.key,
    className: 'dsh-legion-card__option',
    'data-active': options.state.text === choice.value ? 'true' : undefined,
  }, [
    h('input', {
      key: 'input',
      type: 'radio',
      className: 'dsh-legion-card__radio',
      name: options.id,
      value: choice.value,
      checked: options.state.text === choice.value,
      disabled: options.disabled,
      onChange: () => { options.onEdit(choice.value) },
    }),
    h('span', { key: 'text' }, options.copy(choice.key)),
  ])))
}

/**
 * Render the Legion card.
 * @param props - locale copy, the card snapshot, and the form actions.
 * @returns the card, or nothing while the namespace is not served.
 */
export function LegionCard(props: LegionCardProps): ReactNode {
  const { t } = props
  const state = props.useLegionCard(snapshot => snapshot)
  // A Host that does not serve this namespace has no card to show. Rendering
  // an empty shell would claim a surface the deployment did not compose.
  if (!state.available) return null
  const disabled = !state.writable || state.saving
  const shared: RowCopy = {
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    disabled,
  }
  const title = t('title')
  // The label replaces the header's own contents for assistive technology, so
  // the unsaved marker has to be restated here or collapsing the card would
  // hide the fact that it holds edits.
  const name = state.dirty ? `${title} (${t('unsaved')})` : title
  const header = h('button', {
    key: 'header',
    type: 'button',
    className: 'dsh-legion-card__header',
    'aria-expanded': state.open,
    'aria-label': `${t(state.open ? 'collapse' : 'expand')}: ${name}`,
    onClick: props.toggle,
  }, [
    h('span', { className: 'dsh-legion-card__headtext', key: 'text' }, [
      h('span', { className: 'dsh-legion-card__name', key: 'name' }, title),
      h('span', { className: 'dsh-legion-card__description', key: 'description' }, t('description')),
    ]),
    // Carried on the header so a collapsed card still says it holds edits.
    state.dirty ? h('span', { className: 'dsh-legion-card__pending', key: 'pending' }, t('unsaved')) : null,
    h(IconChevronDownOutline14, {
      key: 'chevron',
      className: state.open ? 'dsh-legion-card__chevron--open' : 'dsh-legion-card__chevron',
    }),
  ])
  if (!state.open) return h('li', { className: 'dsh-legion-card' }, [header])
  return h('li', { className: 'dsh-legion-card dsh-legion-card--open' }, [
    header,
    h('div', { className: 'dsh-legion-card__body', key: 'body' }, [
      state.writable
        ? null
        : h('p', { className: 'dsh-legion-card__notice', role: 'status', key: 'read-only' }, t('readOnly')),
      row({
        ...shared,
        id: 'dsh-legion-tool-name',
        label: t('toolName'),
        hint: t('toolNameHint'),
        invalidLabel: t('invalidText'),
        state: state.toolName,
        labelledBy: false,
        onReset: () => { props.resetField('toolName') },
        control: textControl({
          id: 'dsh-legion-tool-name',
          state: state.toolName,
          disabled,
          numeric: false,
          onEdit: text => { props.edit('toolName', text) },
        }),
      }),
      row({
        ...shared,
        id: 'dsh-legion-default-specialist',
        label: t('defaultSpecialist'),
        hint: t('defaultSpecialistHint'),
        invalidLabel: t('invalidText'),
        state: state.defaultSpecialist,
        labelledBy: false,
        onReset: () => { props.resetField('defaultSpecialist') },
        control: textControl({
          id: 'dsh-legion-default-specialist',
          state: state.defaultSpecialist,
          disabled,
          numeric: false,
          onEdit: text => { props.edit('defaultSpecialist', text) },
        }),
      }),
      row({
        ...shared,
        id: 'dsh-legion-max-resource-bytes',
        label: t('maxResourceBytes'),
        hint: t('maxResourceBytesHint'),
        invalidLabel: t('invalidBytes'),
        state: state.maxResourceBytes,
        labelledBy: false,
        onReset: () => { props.resetField('maxResourceBytes') },
        control: textControl({
          id: 'dsh-legion-max-resource-bytes',
          state: state.maxResourceBytes,
          disabled,
          numeric: true,
          onEdit: text => { props.edit('maxResourceBytes', text) },
        }),
      }),
      row({
        ...shared,
        id: 'dsh-legion-run-in-background',
        label: t('enableRunInBackground'),
        hint: t('enableRunInBackgroundHint'),
        invalidLabel: t('invalidText'),
        state: state.enableRunInBackground,
        labelledBy: true,
        onReset: () => { props.resetField('enableRunInBackground') },
        control: toggleControl({
          id: 'dsh-legion-run-in-background',
          state: state.enableRunInBackground,
          disabled,
          copy: t,
          onEdit: text => { props.edit('enableRunInBackground', text) },
        }),
      }),
      row({
        ...shared,
        id: 'dsh-legion-enable-strategies',
        label: t('enableStrategies'),
        hint: t('enableStrategiesHint'),
        invalidLabel: t('invalidText'),
        state: state.enableStrategies,
        labelledBy: true,
        onReset: () => { props.resetField('enableStrategies') },
        control: toggleControl({
          id: 'dsh-legion-enable-strategies',
          state: state.enableStrategies,
          disabled,
          copy: t,
          onEdit: text => { props.edit('enableStrategies', text) },
        }),
      }),
      h('div', { className: 'dsh-legion-card__footer', key: 'footer' }, [
        state.failed
          ? h('p', { className: 'dsh-legion-card__error', role: 'status', key: 'failed' }, t('saveFailed'))
          : null,
        h('button', {
          key: 'discard',
          type: 'button',
          className: 'dsh-legion-card__discard',
          disabled: state.saving || !state.dirty,
          onClick: props.discard,
        }, t('discard')),
        h('button', {
          key: 'save',
          type: 'button',
          className: 'dsh-legion-card__save',
          disabled: disabled || !state.dirty || state.invalid,
          onClick: props.save,
        }, t(state.saving ? 'saving' : 'save')),
      ]),
    ]),
  ])
}
