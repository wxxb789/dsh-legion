/** Loader-owned Receipt layout styles; colors remain on official theme aliases. */
const PLUGIN_ID = 'dsh-legion-receipts'
const STYLE_ID = `${PLUGIN_ID}/run-receipt.css`

const CSS = `
.dsh-legion-receipt,
.dsh-legion-receipt__launcher {
  pointer-events: auto;
}
.dsh-legion-receipt__launcher {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 1;
}
.dsh-legion-receipt {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  width: min(420px, calc(100% - 24px));
  max-height: calc(100% - 24px);
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 12px 28px var(--dsw-alias-border-l2);
}
.dsh-legion-receipt__header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 8px 10px 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  cursor: move;
  touch-action: none;
  user-select: none;
}
.dsh-legion-receipt__identity { flex: 1; min-width: 0; }
.dsh-legion-receipt__identity h1 {
  margin: 0;
  font-size: 15px;
  line-height: 1.4;
}
.dsh-legion-receipt__identity code {
  display: block;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-legion-receipt__actions { display: flex; align-items: center; gap: 4px; }
.dsh-legion-receipt__action { min-width: 44px; min-height: 44px; }
.dsh-legion-receipt__action:focus-visible,
.dsh-legion-receipt summary:focus-visible,
.dsh-legion-receipt h1:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsh-legion-receipt__notice {
  margin: 0;
  padding: 9px 12px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.45;
}
.dsh-legion-receipt__diagnostic {
  display: block;
  margin: -3px 12px 9px;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
}
.dsh-legion-receipt__header-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 8px;
  margin-top: 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.dsh-legion-receipt__header-meta > span { display: inline-flex; align-items: center; gap: 5px; }
.dsh-legion-receipt__selector {
  display: grid;
  gap: 4px;
  padding: 0 12px 10px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dsh-legion-receipt__selector select {
  width: 100%;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
}
.dsh-legion-receipt__section {
  padding: 10px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dsh-legion-receipt__section h2,
.dsh-legion-receipt__section h3 {
  margin: 0 0 6px;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
.dsh-legion-receipt__section h2 {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  text-transform: uppercase;
}
.dsh-legion-receipt__overview { margin: 0 0 7px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-legion-receipt__stages,
.dsh-legion-receipt__stage-group ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dsh-legion-receipt__stages li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 3px 7px;
  font-size: 12px;
}
.dsh-legion-receipt__stages li > span:nth-of-type(2) { grid-column: 3; }
.dsh-legion-receipt__stages small { grid-column: 2 / 4; color: var(--dsw-alias-label-tertiary); }
.dsh-legion-receipt__stage-group + .dsh-legion-receipt__stage-group { margin-top: 10px; }
.dsh-legion-receipt__participant {
  padding: 7px 0;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dsh-legion-receipt__participant-main {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.dsh-legion-receipt__participant-main strong { color: var(--dsw-alias-label-primary); font-size: 12px; }
.dsh-legion-receipt__details { margin: 5px 0 0 16px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-legion-receipt__details summary { display: flex; align-items: center; min-height: 44px; cursor: pointer; }
.dsh-legion-receipt__details dl,
.dsh-legion-receipt__aggregate dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 8px;
  margin: 6px 0 0;
}
.dsh-legion-receipt__details dd,
.dsh-legion-receipt__aggregate dd { margin: 0; text-align: right; }
.dsh-legion-receipt__aggregate p { margin: 6px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-legion-receipt__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (max-width: 639px), (pointer: coarse) {
  .dsh-legion-receipt {
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    top: auto !important;
    width: 100%;
    max-height: min(78vh, calc(100% - 44px));
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 12px 12px 0 0;
  }
  .dsh-legion-receipt__header { cursor: default; touch-action: auto; }
  .dsh-legion-receipt__participant-main { grid-template-columns: auto minmax(0, 1fr) auto; }
  .dsh-legion-receipt__participant-main > :nth-last-child(-n+2) { grid-column: 2 / 4; }
}
`

export function injectReceiptStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

injectReceiptStyles()
