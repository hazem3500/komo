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
  font:12px/1.4 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif; color-scheme:dark;
  opacity:0; translate:0 6px; pointer-events:none;
  transition:opacity .15s var(--ease-smooth-out),translate .25s var(--ease-smooth-out);
}
.design-inspector[hidden] { display:none; }
.design-inspector[data-state="active"] { opacity:1; translate:0 0; pointer-events:auto; }
.design-inspector[data-state="closing"] { opacity:0; translate:0 4px; }
.design-inspector button { cursor:pointer; }
.design-inspector__heading { flex:none; display:flex; align-items:center; gap:2px; height:44px; padding:0 6px 0 12px; border-bottom:1px solid #ffffff12; }
.design-inspector__identity { min-width:0; flex:1; display:flex; align-items:baseline; gap:4px; white-space:nowrap; }
.design-inspector__parent { flex:none; max-width:30%; overflow:hidden; text-overflow:ellipsis; margin-left:-4px; padding:2px 4px; border-radius:4px; color:#77736f; font-size:12px; }
.design-inspector__parent::after { content:'/'; margin-left:4px; color:#4a4845; }
.design-inspector__parent:hover { color:#e9e6e1; background:#ffffff0d; }
.design-inspector__target { flex:none; margin-right:2px; max-width:60%; overflow:hidden; text-overflow:ellipsis; font-weight:600; font-size:12px; }
.design-inspector__heading small { min-width:0; overflow:hidden; text-overflow:ellipsis; color:#77736f; font-size:11px; }
.design-inspector__close,.design-inspector__fold { display:grid; place-items:center; width:28px; height:28px; flex:none; border-radius:6px; color:#898680; }
.design-inspector__close svg,.design-inspector__fold svg { width:14px; height:14px; }
.design-inspector__close:hover,.design-inspector__fold:hover { background:#ffffff12; color:#fff; }
.design-inspector__fold { display:none; }
.design-inspector__fold svg { transition:rotate .25s var(--ease-smooth-out); }
.design-inspector[data-folded] .design-inspector__fold svg { rotate:180deg; }
.design-inspector[data-folded] > :not(.design-inspector__heading) { display:none; }
.design-inspector[data-folded] .design-inspector__heading { border:0; }
.design-inspector__controls { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-width:thin; }
.design-inspector__empty { margin:0; padding:16px 12px; color:#898680; }
/* One slim bar: a quiet Comment action, plus a change count and tools once something changed. */
.design-inspector__bar { flex:none; display:flex; align-items:center; gap:8px; min-height:44px; padding:0 8px 0 12px; border-top:1px solid #ffffff12; color:#898680; font-size:11px; }
.design-inspector__count { white-space:nowrap; font-variant-numeric:tabular-nums; }
.design-inspector__status { display:none; min-width:0; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; animation:design-status .2s var(--ease-smooth-out); }
.design-inspector__bar[data-message] .design-inspector__status { display:block; }
.design-inspector__bar[data-message] .design-inspector__count,.design-inspector__bar:not([data-changes]) .design-inspector__tool { display:none; }
.design-inspector__actions { display:flex; align-items:center; gap:2px; margin-left:auto; }
.design-inspector__actions button { display:grid; place-items:center; min-width:28px; height:28px; border-radius:6px; color:#aaa6a0; }
.design-inspector__actions button:hover:not(:disabled) { background:#ffffff12; color:#fff; }
.design-inspector__actions button:disabled { cursor:default; opacity:.35; }
.design-inspector__actions svg { width:14px; height:14px; }
.design-inspector__actions button:last-child { padding:0 10px; color:#e9e6e1; font-size:11px; font-weight:550; }
.design-inspector__bar[data-changes] .design-inspector__actions button:last-child { margin-left:4px; background:#bda6ef; color:#211b2d; }
.design-inspector__bar[data-changes] .design-inspector__actions button:last-child:hover { background:#c8b5f4; }
.design-inspector :focus-visible { outline:2px solid #bda6ef; outline-offset:2px; }
@keyframes design-status { from { opacity:0; translate:0 2px; } }
@media (max-width:520px) {
  /* A content-sized bottom sheet; folding it leaves only the heading over the page. */
  .design-inspector {
    position:fixed; inset:auto 12px calc(12px + env(safe-area-inset-bottom,0px));
    max-height:min(58dvh,560px);
    border-radius:24px; box-shadow:0 -1px 0 #ffffff24,0 16px 48px #0005;
    transition:translate 320ms cubic-bezier(.22,1,.36,1),scale 320ms cubic-bezier(.22,1,.36,1),opacity 150ms ease;
    transform-origin:bottom center;
  }
  .design-inspector__heading { height:52px; padding-left:18px; }
  .design-inspector__fold { display:grid; }
  .design-field { height:34px; }
}
@media (prefers-reduced-motion:reduce) {
  .design-outline,.design-inspector,.design-inspector__fold svg,.design-inspector__status { transition:none; animation:none; }
}
`;
