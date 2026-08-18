/**
 * The card's own stylesheet.
 *
 * DSH's client bundle preset compiles `.module.css` through lightningcss and
 * emits exactly this injection. That preset is unpublished and its compiler is
 * not a dependency Legion can add, so the card carries its stylesheet as text
 * and injects it itself. The end state is identical: one
 * `<style data-plugin="dsh-legion">` tag the loader owns.
 *
 * Injection runs at module scope on purpose. The loader claims plugin styles
 * immediately after a factory returns (`claimStyles`), so a tag created later
 * — inside `apply`, say — would never be claimed and would outlive an unload.
 *
 * Every colour is a `--dsw-alias-*` design token, so the card follows the
 * active theme instead of pinning light-mode values.
 */

/** Plugin id; must equal the bundle id the loader registered. */
const PLUGIN_ID = 'dsh-legion'

/** Tag identity, mirroring the preset's `<pkg>/<file>` convention. */
const STYLE_ID = `${PLUGIN_ID}/legion-card.css`

const CSS = `
.dsh-legion-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.dsh-legion-card__header { display: flex; flex-direction: column; gap: 4px; }
.dsh-legion-card__header h3 { margin: 0; font-size: 14px; font-weight: 600; }
.dsh-legion-card__header p {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-legion-card__row { display: flex; flex-direction: column; gap: 6px; }
.dsh-legion-card__label { font-size: 13px; font-weight: 500; }
.dsh-legion-card__control { display: flex; align-items: center; gap: 8px; }
.dsh-legion-card__control > span:first-child { flex: 1 1 auto; min-width: 0; }
.dsh-legion-card__control select {
  flex: 0 0 auto;
  min-width: 96px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: inherit;
  font: inherit;
}
.dsh-legion-card__control select:disabled { opacity: 0.5; }
.dsh-legion-card__badge {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  white-space: nowrap;
}
.dsh-legion-card__hint {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-legion-card__error {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary);
}
.dsh-legion-card__footer { display: flex; gap: 8px; }
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
