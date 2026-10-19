export const designPanelStyles = `
/* Property controls keep essential labels above compact value rows. */
.design-inspector__controls > * + * { border-top:1px solid #ffffff0d; }
.design-group { padding:0 12px 10px; }
.design-section > .design-group { padding-bottom:12px; }
.design-group summary { cursor:pointer; display:flex; align-items:center; gap:4px; height:36px; color:#e9e6e1; font-size:11px; font-weight:600; list-style:none; }
.design-group summary::-webkit-details-marker { display:none; }
.design-group summary::after { content:''; width:5px; height:5px; margin:-2px 0 0 3px; border:solid #77736f; border-width:0 1.2px 1.2px 0; rotate:45deg; opacity:0; transition:opacity .12s,rotate .2s var(--ease-smooth-out); }
.design-group:not([open]) summary::after { rotate:-45deg; margin:0 0 0 2px; }
.design-group summary:is(:hover,:focus-visible)::after,.design-group:not([open]) summary::after { opacity:1; }
.design-group summary:focus-visible { outline-offset:-2px; border-radius:6px; }
.design-section { position:relative; }
.design-section__title { display:flex; align-items:center; height:36px; padding:0 12px; color:#898680; font-size:11px; font-weight:600; }
.design-section__tools { position:absolute; z-index:1; top:6px; right:8px; display:flex; gap:2px; }
.design-section__tools button { display:grid; place-items:center; width:24px; height:24px; border-radius:6px; color:#898680; font-size:16px; line-height:1; }
.design-section__tools button:hover { background:#ffffff12; color:#f1efeb; }
.design-text-edit { font-size:0 !important; }
.design-text-edit::before { content:'T'; font:600 13px/1 Georgia,"Times New Roman",serif; }
.design-text-edit[aria-label^="Finish"] { background:#bda6ef33; color:#e6dcfb !important; }
.design-text-edit:disabled { opacity:.35; cursor:default; }
.design-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:6px 8px; }
.design-field { position:relative; --lead:4px; min-width:0; height:28px; display:flex; align-items:center; border-radius:6px; background:#ffffff0a; color:#898680; transition:box-shadow .12s var(--ease-smooth-out); }
.design-field:hover { box-shadow:inset 0 0 0 1px #ffffff1c; }
.design-field:focus-within { box-shadow:inset 0 0 0 1px #bda6ef; }
.design-field:has([aria-invalid="true"]) { box-shadow:inset 0 0 0 1px #fda29b; }
.design-field[data-wide] { grid-column:1/-1; }
.design-field:has(.design-field__glyph) { --lead:22px; }
.design-field--color { --lead:26px; }
.design-field > input:not([type="color"]),.design-field > select { flex:1; box-sizing:border-box; width:100%; min-width:0; height:100%; margin:0; padding:0 8px; border:0; border-radius:6px; outline:0; box-shadow:none; background:none; color:#f1efeb; font:inherit; font-size:11px; font-variant-numeric:tabular-nums; text-overflow:ellipsis; }
.design-field input[type="number"] { appearance:textfield; -moz-appearance:textfield; }
.design-field input::-webkit-inner-spin-button { appearance:none; }
.design-field__glyph { flex:none; display:grid; place-items:center; width:22px; height:100%; margin-right:-6px; color:#77736f; font-size:10px; font-weight:600; cursor:ew-resize; user-select:none; touch-action:none; }
.design-field__glyph:hover { color:#e9e6e1; }
.design-field__glyph svg { width:12px; height:12px; fill:none; stroke:currentColor; stroke-width:1.1; }
.design-field input[type="color"] { flex:none; width:16px; height:16px; margin:0 -2px 0 6px; padding:0; border:0; border-radius:4px; box-shadow:inset 0 0 0 1px #ffffff26; background:none; cursor:pointer; }
.design-field input[type="color"]::-webkit-color-swatch-wrapper { padding:0; }
.design-field input[type="color"]::-webkit-color-swatch { border:0; border-radius:4px; box-shadow:inset 0 0 0 1px #ffffff26; }
.design-field input[type="color"]::-moz-color-swatch { border:0; border-radius:4px; }
`;
