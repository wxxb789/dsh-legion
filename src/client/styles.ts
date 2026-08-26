/**
 * Styles for Legion's browser surfaces.
 *
 * DSH's client bundle preset compiles `.module.css` through lightningcss and
 * emits exactly this injection. That preset is unpublished and its compiler is
 * not a dependency Legion can add, so the client bundle carries its stylesheet as text
 * and injects it itself. The end state is identical: one
 * `<style data-plugin="dsh-legion">` tag the loader owns.
 *
 * Injection runs at module scope on purpose. The loader claims plugin styles
 * immediately after a factory returns (`claimStyles`), so a tag created later
 * — inside `apply`, say — would never be claimed and would outlive an unload.
 *
 * The geometry mirrors the cards DSH's own plugin configuration tab renders,
 * because they share one list and a card that measured itself differently
 * would read as a different kind of object. Every colour is a `--dsw-alias-*`
 * design token, so the card follows the active theme instead of pinning
 * light-mode values. One deliberate divergence: DSH's own card CSS reaches for
 * `--dsw-alias-label-error`, which the theme does not define, so error copy
 * here uses `--dsw-alias-state-error-primary`, which it does.
 */

/** Plugin id; must equal the bundle id the loader registered. */
const PLUGIN_ID = 'dsh-legion'

/** Tag identity, mirroring the preset's `<pkg>/<file>` convention. */
const STYLE_ID = `${PLUGIN_ID}/legion-card.css`

const CSS = `
.dsh-legion-card {
  list-style: none;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  transition: border-color .16s, background .16s;
}
.dsh-legion-card:hover { border-color: var(--dsw-alias-label-dimmed); }
/* An open card reads as the one being worked on, not merely taller. */
.dsh-legion-card--open {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-label-dimmed);
}
.dsh-legion-card__header {
  width: 100%;
  appearance: none;
  border-width: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
}
.dsh-legion-card__header:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
/* Name over description: the description is what tells two cards apart, so it
   gets its own line rather than trailing the name. */
.dsh-legion-card__headtext {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsh-legion-card__name {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--dsw-alias-label-primary);
}
.dsh-legion-card__description {
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
/* Carried on the header so a collapsed card still says it holds edits. */
.dsh-legion-card__pending {
  flex: none;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 17px;
  font-weight: 500;
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}
.dsh-legion-card__chevron,
.dsh-legion-card__chevron--open {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  transition: transform .16s;
}
.dsh-legion-card__chevron--open { transform: rotate(180deg); }
.dsh-legion-card__body {
  border-top: 1px solid var(--dsw-alias-border-l2);
  margin: 0 16px;
  padding-bottom: 8px;
}
.dsh-legion-card__notice {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-legion-card__row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
}
.dsh-legion-card__row + .dsh-legion-card__row {
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dsh-legion-card__head { display: flex; align-items: center; gap: 8px; }
.dsh-legion-card__label {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.dsh-legion-card__badges { display: inline-flex; align-items: center; gap: 8px; }
.dsh-legion-card__badge {
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 17px;
  font-weight: 500;
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}
.dsh-legion-card__reset {
  border-width: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-legion-card__reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.dsh-legion-card__reset:disabled { cursor: default; }
.dsh-legion-card__input,
.dsh-legion-card__input--invalid {
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.dsh-legion-card__input:focus-visible,
.dsh-legion-card__input--invalid:focus-visible {
  outline: none;
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-legion-card__input:disabled,
.dsh-legion-card__input--invalid:disabled {
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
}
.dsh-legion-card__input--invalid { border-color: var(--dsw-alias-state-error-primary); }
/* All three states visible at once: a collapsed list would hide that inherit
   is a distinct choice from the value it currently resolves to. */
.dsh-legion-card__toggle {
  display: inline-flex;
  align-self: flex-start;
  padding: 2px;
  gap: 2px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: transparent;
}
.dsh-legion-card__option {
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  transition: background .12s, color .12s;
}
.dsh-legion-card__option:hover { color: var(--dsw-alias-label-primary); }
.dsh-legion-card__option[data-active='true'] {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
/* The radio stays in the accessibility and focus order; only its own glyph is
   removed, so arrow-key traversal and Space still work. */
.dsh-legion-card__radio {
  appearance: none;
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
}
.dsh-legion-card__radio:disabled { cursor: default; }
.dsh-legion-card__option:has(.dsh-legion-card__radio:disabled) {
  cursor: default;
  color: var(--dsw-alias-label-dimmed);
}
.dsh-legion-card__option:has(.dsh-legion-card__radio:focus-visible) {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -1px;
}
.dsh-legion-card__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-legion-card__invalid {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-state-error-primary);
}
.dsh-legion-card__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 4px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dsh-legion-card__error {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-state-error-primary);
}
.dsh-legion-card__discard,
.dsh-legion-card__save {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 5px 14px;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
}
.dsh-legion-card__discard {
  border-color: var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
}
.dsh-legion-card__discard:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-label-dimmed);
}
.dsh-legion-card__save {
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-layer-3);
}
.dsh-legion-card__discard:disabled,
.dsh-legion-card__save:disabled { opacity: 0.4; cursor: default; }
.dsh-legion-card__discard:focus-visible,
.dsh-legion-card__save:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.dsh-legion-receipt {
  position: absolute;
  width: min(360px, calc(100% - 24px));
  max-height: calc(100% - 24px);
  overflow: auto;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  pointer-events: auto;
}
.dsh-legion-receipt__drag {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dsh-legion-receipt__title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  cursor: move;
  touch-action: none;
  user-select: none;
}
.dsh-legion-receipt__actions { display: flex; align-items: center; gap: 6px; }
.dsh-legion-receipt__button {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 7px;
  padding: 3px 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.dsh-legion-receipt__button:hover { color: var(--dsw-alias-label-primary); }
.dsh-legion-receipt__button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-legion-receipt__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
}
.dsh-legion-receipt__metric {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-legion-receipt__section {
  padding: 8px 12px 10px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dsh-legion-receipt__heading {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-tertiary);
  text-transform: uppercase;
}
.dsh-legion-receipt__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dsh-legion-receipt__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 8px;
  align-items: center;
  font-size: 12px;
}
.dsh-legion-receipt__primary {
  display: flex;
  min-width: 0;
  gap: 6px;
  color: var(--dsw-alias-label-primary);
}
.dsh-legion-receipt__secondary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-legion-receipt__status {
  grid-column: 2;
  grid-row: 1 / span 2;
  border-radius: 999px;
  padding: 1px 7px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  white-space: nowrap;
}
.dsh-legion-receipt__status[data-status='failed'] {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-legion-receipt__tokens {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 3px 6px;
  margin: 0;
  text-align: right;
}
.dsh-legion-receipt__tokens dt {
  grid-row: 1;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
}
.dsh-legion-receipt__tokens dd {
  grid-row: 2;
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
@media (max-width: 520px) {
  .dsh-legion-receipt { width: calc(100% - 24px); }
}
`

/**
 * Inject the stylesheet once. Idempotent under re-evaluation, and a no-op
 * outside a browser so the bundle stays loadable under a DOM-free harness.
 */
export function injectCardStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

injectCardStyles()
