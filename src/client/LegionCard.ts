/**
 * Legion's plugin settings card.
 *
 * The card edits the few scalar policies that are meaningful to change while
 * the harness runs. Profiles, routes, Teams, Strategies, and catalog layers
 * stay in the configuration document on purpose: they are structured data
 * whose validity depends on other entries, and a form that let them be edited
 * field-by-field would publish half-built catalogs.
 *
 * Written with `createElement` rather than JSX because Legion carries no React
 * toolchain: React is a platform module resolved from the Host's module table,
 * not a dependency of this package.
 */
import { createElement as h, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FieldState, FormShell } from './settings-form.ts'

/** What the Legion card renders. */
export interface LegionCardState extends FormShell {
  readonly toolName: FieldState
  readonly defaultProfile: FieldState
  readonly enableRunInBackground: FieldState
  readonly enableStrategies: FieldState
}

/** Copy the card renders, resolved by the caller. */
export interface LegionCardCopy {
  (key: string): string
}

/** Props the slot renderer binds for this card. */
export interface LegionCardProps {
  /** Locale lookup bound to Legion's dictionary namespace. */
  readonly t: LegionCardCopy
  /** Card snapshot selector published by the controller. */
  readonly useLegionCard: (select: (state: LegionCardState) => LegionCardState) => LegionCardState
  /** Stage draft text for one field. */
  readonly edit: (field: string, text: string) => void
  /** Stage a clear so the field re-inherits the composition layer. */
  readonly resetField: (field: string) => void
  /** Write every staged edit. */
  readonly save: () => void
  /** Drop every staged edit. */
  readonly discard: () => void
}

/** One labelled row wrapping a control plus its override badge. */
function row(options: {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly state: FieldState
  readonly control: ReactNode
  readonly overriddenLabel: string
  readonly resetLabel: string
  readonly onReset: () => void
  readonly disabled: boolean
}): ReactNode {
  return h('div', { className: 'dsh-legion-card__row', key: options.id }, [
    h('label', { className: 'dsh-legion-card__label', htmlFor: options.id, key: 'label' }, options.label),
    h('div', { className: 'dsh-legion-card__control', key: 'control' }, [
      options.control,
      options.state.overridden
        ? h('span', { className: 'dsh-legion-card__badge', key: 'badge' }, options.overriddenLabel)
        : null,
      options.state.overridden
        ? h(Button, {
            key: 'reset',
            variant: 'ghost',
            disabled: options.disabled,
            onClick: options.onReset,
            children: options.resetLabel,
          })
        : null,
    ]),
    h('p', { className: 'dsh-legion-card__hint', key: 'hint' }, options.hint),
  ])
}

/** A tri-state control: inherited, explicitly on, or explicitly off. */
function toggle(options: {
  readonly id: string
  readonly state: FieldState
  readonly disabled: boolean
  readonly onEdit: (text: string) => void
}): ReactNode {
  return h('select', {
    id: options.id,
    value: options.state.text,
    disabled: options.disabled,
    onChange: (event: { currentTarget: { value: string } }) => { options.onEdit(event.currentTarget.value) },
  }, [
    h('option', { value: '', key: 'inherit' }, '—'),
    h('option', { value: 'true', key: 'true' }, 'on'),
    h('option', { value: 'false', key: 'false' }, 'off'),
  ])
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
  const shared = {
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    disabled,
  }
  return h('section', { className: 'dsh-legion-card' }, [
    h('header', { className: 'dsh-legion-card__header', key: 'header' }, [
      h('h3', { key: 'title' }, t('title')),
      h('p', { key: 'description' }, t('description')),
    ]),
    row({
      ...shared,
      id: 'dsh-legion-tool-name',
      label: t('toolName'),
      hint: t('toolNameHint'),
      state: state.toolName,
      onReset: () => { props.resetField('toolName') },
      control: h(Input, {
        id: 'dsh-legion-tool-name',
        value: state.toolName.text,
        disabled,
        onChange: (event: { currentTarget: { value: string } }) => { props.edit('toolName', event.currentTarget.value) },
      }),
    }),
    row({
      ...shared,
      id: 'dsh-legion-default-profile',
      label: t('defaultProfile'),
      hint: t('defaultProfileHint'),
      state: state.defaultProfile,
      onReset: () => { props.resetField('defaultProfile') },
      control: h(Input, {
        id: 'dsh-legion-default-profile',
        value: state.defaultProfile.text,
        disabled,
        onChange: (event: { currentTarget: { value: string } }) => { props.edit('defaultProfile', event.currentTarget.value) },
      }),
    }),
    row({
      ...shared,
      id: 'dsh-legion-run-in-background',
      label: t('enableRunInBackground'),
      hint: t('enableRunInBackgroundHint'),
      state: state.enableRunInBackground,
      onReset: () => { props.resetField('enableRunInBackground') },
      control: toggle({
        id: 'dsh-legion-run-in-background',
        state: state.enableRunInBackground,
        disabled,
        onEdit: text => { props.edit('enableRunInBackground', text) },
      }),
    }),
    row({
      ...shared,
      id: 'dsh-legion-enable-strategies',
      label: t('enableStrategies'),
      hint: t('enableStrategiesHint'),
      state: state.enableStrategies,
      onReset: () => { props.resetField('enableStrategies') },
      control: toggle({
        id: 'dsh-legion-enable-strategies',
        state: state.enableStrategies,
        disabled,
        onEdit: text => { props.edit('enableStrategies', text) },
      }),
    }),
    state.failed ? h('p', { className: 'dsh-legion-card__error', key: 'failed' }, t('saveFailed')) : null,
    h('footer', { className: 'dsh-legion-card__footer', key: 'footer' }, [
      h(Button, {
        key: 'save',
        variant: 'primary',
        disabled: disabled || !state.dirty || state.invalid,
        onClick: props.save,
        children: t('save'),
      }),
      h(Button, {
        key: 'discard',
        variant: 'ghost',
        disabled: state.saving || !state.dirty,
        onClick: props.discard,
        children: t('discard'),
      }),
    ]),
  ])
}
