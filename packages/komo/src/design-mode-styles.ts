export const designModeStyles = `
/* Design mode is deliberately an in-page preview: all controls remain in the
   widget shadow root and never become site styles. */
.design-outline {
  position:fixed; z-index:1; pointer-events:none; box-sizing:border-box;
  border:2px solid var(--accent,#bda6ef); border-radius:8px;
  box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#bda6ef) 22%,transparent), 0 2px 12px #0003;
  transition:all 80ms ease;
}
.design-outline[data-kind="hover"] { border-style:dashed; opacity:.8; }
/* The inspector replaces the Comments view inside Komo's shared sidebar surface. */
.design-inspector {
  position:absolute; inset:0; z-index:9;
  display:flex; flex-direction:column; overflow:hidden; color:#e9e6e1;
  background:#0d0d0d; border-radius:inherit;
  font:13px/1.45 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif; color-scheme:dark;
  opacity:0; translate:0 6px; pointer-events:none;
  transition:opacity .15s var(--ease-smooth-out),translate .25s var(--ease-smooth-out);
}
.design-inspector[hidden] { display:none; }
.design-inspector[data-state="active"] { opacity:1; translate:0 0; pointer-events:auto; }
.design-inspector[data-state="closing"] { opacity:0; translate:0 4px; }
.design-inspector__heading { display:flex; align-items:center; gap:10px; padding:15px 17px 13px; border-bottom:1px solid #ffffff12; }
.design-inspector__mark { display:grid; place-items:center; width:30px; height:30px; flex:none; border-radius:10px; background:#bda6ef20; color:#c8b5f4; }
.design-inspector__mark svg { width:16px; height:16px; }
.design-inspector__identity { min-width:0; flex:1; }
.design-inspector__eyebrow { display:block; color:#aaa6a0; font-size:11px; margin-bottom:2px; }
.design-inspector__target { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; font-size:14px; letter-spacing:-.01em; }
.design-inspector__heading small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#898680; font-size:11px; margin-top:2px; }
.design-inspector__close,.design-inspector__fold { display:grid; place-items:center; width:32px; height:32px; flex:none; border-radius:10px; color:#aaa6a0; }
.design-inspector__close svg,.design-inspector__fold svg { width:16px; height:16px; }
.design-inspector__close:hover,.design-inspector__fold:hover { background:#ffffff12; color:#fff; }
.design-inspector__fold { display:none; }
.design-inspector__fold svg { transition:rotate .25s var(--ease-smooth-out); }
.design-inspector[data-folded] .design-inspector__fold svg { rotate:180deg; }
.design-inspector[data-folded] > :not(.design-inspector__heading) { display:none; }
.design-inspector[data-folded] .design-inspector__heading { border:0; }
.design-inspector__controls { min-height:0; overflow:auto; overscroll-behavior:contain; padding:4px 0; scrollbar-width:thin; }
.design-group { padding:3px 17px 9px; border-bottom:1px solid #ffffff0d; }
.design-group:last-child { border:0; }
.design-group summary { cursor:pointer; display:flex; align-items:center; gap:8px; padding:10px 0; color:#e9e6e1; font-weight:550; list-style:none; }
.design-group summary::-webkit-details-marker { display:none; }
.design-group summary::before { content:'›'; color:#91919a; font-size:16px; line-height:1; transform:rotate(0deg); }
.design-group[open] summary::before { transform:rotate(90deg); }
.design-field { min-width:0; display:grid; grid-template-columns:82px minmax(0,1fr); align-items:center; gap:8px; min-height:38px; color:#aaa6a0; font-size:12px; }
.design-field--dial { grid-template-columns:82px minmax(0,1fr) 48px; }
.design-field--color { grid-template-columns:82px 24px minmax(0,1fr); }
.design-field input:not([type="range"]),.design-field select { box-sizing:border-box; width:100%; min-width:0; min-height:32px; padding:5px 9px; border:1px solid #ffffff12; border-radius:9px; box-shadow:none; background:#191919; color:#f1efeb; font:12px ui-monospace,monospace; }
.design-field input:hover,.design-field select:hover { border-color:#ffffff28; }
.design-field input[type="number"] { text-align:right; appearance:textfield; -moz-appearance:textfield; }
.design-field input::-webkit-inner-spin-button { appearance:none; }
.design-field input[type="color"] { min-height:24px; height:24px; padding:0; border:1px solid #ffffff26; border-radius:6px; overflow:hidden; cursor:pointer; }
.design-field input[type="color"]::-webkit-color-swatch-wrapper { padding:0; }
.design-field input[type="color"]::-webkit-color-swatch { border:0; border-radius:4px; }
.design-field input[type="range"] { appearance:none; width:100%; min-width:0; height:4px; padding:0; margin:0; border:0; border-radius:4px; box-shadow:none; background:linear-gradient(to right,#bda6ef var(--fill),#ffffff20 var(--fill)); cursor:ew-resize; }
.design-field input[aria-invalid="true"] { border-color:#fda29b; }
.design-field input[type="range"]::-webkit-slider-thumb { appearance:none; width:11px; height:11px; border-radius:50%; background:#f3f3f5; box-shadow:0 1px 4px #0005; }
.design-field input[type="range"]::-moz-range-thumb { width:11px; height:11px; border:0; border-radius:50%; background:#f3f3f5; }
.design-inspector__empty { padding:24px 17px; color:#aaa6a0; line-height:1.6; }
.design-inspector__status { margin:0; padding:10px 17px; color:#898680; font-size:11px; overflow-wrap:anywhere; }
.design-inspector__actions { display:grid; grid-template-columns:1fr 1fr 1.5fr; gap:7px; padding:0 17px 15px; }
.design-inspector__actions button { min-height:34px; padding:7px 10px; border:1px solid #ffffff16; border-radius:10px; background:#ffffff08; color:#e9e6e1; font-size:12px; }
.design-inspector__actions button:hover:not(:disabled) { background:#ffffff14; }
.design-inspector__actions button:disabled { cursor:default; opacity:.35; }
.design-inspector__actions button:last-child { grid-column:1/-1; background:#bda6ef; color:#211b2d; border:0; font-weight:600; }
.design-inspector__actions button:last-child:hover:not(:disabled) { background:#c8b5f4; }
.design-inspector :focus-visible { outline:2px solid #bda6ef; outline-offset:2px; }
@media (max-width:520px) {
  /* A content-sized bottom sheet; folding it leaves only the heading over the page. */
  .design-inspector {
    position:fixed; inset:auto 12px calc(12px + env(safe-area-inset-bottom,0px));
    max-height:min(58dvh,560px);
    border-radius:24px; box-shadow:0 -1px 0 #ffffff24,0 16px 48px #0005;
    transition:translate 320ms cubic-bezier(.22,1,.36,1),scale 320ms cubic-bezier(.22,1,.36,1),opacity 150ms ease;
    transform-origin:bottom center;
  }
  .design-inspector__fold { display:grid; }
  .design-field { min-height:42px; }
}
@media (prefers-reduced-motion:reduce) {
  .design-outline,.design-inspector,.design-inspector__fold svg { transition:none; }
}
`;
