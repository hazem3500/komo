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
/* Frame docks the inspector in the sidebar column beside the scaled page. */
:host([data-sidebar="background"]) .design-inspector { position:fixed; inset:0 0 0 auto; width:380px; border-radius:0; }
/* The floating inspector drags by its heading, like the comment sidebar's grip. */
:host([data-sidebar="edge"]) .design-inspector__heading { cursor:grab; touch-action:none; padding-top:22px; }
/* The sidebar's own grip stays visible above the inspector, as it is above Comments. */
:host(.design-active[data-sidebar="edge"]) .edge-sidebar .edge-sidebar-grip { z-index:10; opacity:1 !important; }
.design-inspector[data-state="active"] { opacity:1; translate:0 0; pointer-events:auto; }
.design-inspector[data-state="closing"] { opacity:0; translate:0 4px; }
.design-inspector button { cursor:pointer; }
/* Header and icon buttons match the Comments panel's title and icons, on the inspector's 12px gutter. */
.design-inspector__heading { flex:none; display:flex; align-items:center; gap:4px; min-height:54px; padding:0 8px 0 12px; }
.design-inspector__identity { min-width:0; flex:1; display:flex; align-items:baseline; gap:6px; white-space:nowrap; }
.design-inspector__parent { flex:none; max-width:35%; overflow:hidden; text-overflow:ellipsis; margin-left:-6px; padding:2px 6px; border-radius:7px; color:#909090; font-size:15px; font-weight:500; }
.design-inspector__parent::after { content:'/'; margin-left:6px; color:#555; }
.design-inspector__target { flex:none; max-width:60%; overflow:hidden; text-overflow:ellipsis; color:#fff; font-weight:600; font-size:15px; }
.design-inspector__heading small { min-width:0; overflow:hidden; text-overflow:ellipsis; color:#909090; font-size:13px; }
.design-inspector__close,.design-inspector__fold,.design-inspector__actions button { display:grid; place-items:center; min-width:28px; height:28px; border-radius:7px; color:#909090; }
.design-inspector__close,.design-inspector__fold { flex:none; }
.design-inspector__close svg,.design-inspector__fold svg,.design-inspector__actions svg { width:16px; height:16px; }
.design-inspector__parent:hover,.design-inspector__close:hover,.design-inspector__fold:hover,.design-inspector__actions button:hover:not(:disabled) { background:#161616; color:#eee; }
.design-inspector__fold { display:none; }
.design-inspector__fold svg { transition:rotate .25s var(--ease-smooth-out); }
.design-inspector[data-folded] .design-inspector__fold svg { rotate:180deg; }
.design-inspector[data-folded] > :not(.design-inspector__heading) { display:none; }
.design-inspector__controls { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-width:thin; }
/* Empty state: the floating sidebar fits a compact, centered hint instead of an empty column. */
:host([data-sidebar="edge"]) .edge-sidebar[data-design-empty]:not([data-morphing]) { height:auto !important; }
:host([data-sidebar="edge"]) [data-design-empty] > .design-inspector { position:relative; inset:auto; }
/* The hidden toolbar docked in the sidebar would otherwise add its height. */
:host([data-sidebar="edge"]) [data-design-empty]:not([data-morphing]) > .toolbar { position:absolute; }
.design-inspector[data-empty] .design-inspector__identity { visibility:hidden; }
.design-inspector[data-empty] .design-inspector__controls { display:grid; place-items:center; }
.design-inspector[data-empty] .design-inspector__bar:not([data-changes],[data-message]) { display:none; }
.design-inspector__empty { display:flex; flex-direction:column; align-items:center; gap:4px; padding:0 24px 28px; color:#898680; font-size:11px; text-align:center; }
.design-inspector__empty > svg { box-sizing:content-box; width:20px; height:20px; margin-bottom:8px; padding:8px; border-radius:10px; background:#ffffff0a; color:#77736f; }
.design-inspector__empty strong { color:#e9e6e1; font-size:12px; font-weight:600; }
.design-inspector__empty ul { display:grid; gap:6px; margin:8px 0 0; padding:0; list-style:none; }
.design-inspector__empty kbd { display:inline-block; min-width:8px; padding:0 5px; border-radius:4px; background:#ffffff0f; box-shadow:inset 0 0 0 1px #ffffff12,inset 0 -1px 0 #ffffff12; color:#c9c5bf; font:inherit; font-size:10px; font-weight:500; line-height:17px; }
/* One slim bar: a quiet Comment action, plus a change count and tools once something changed. */
.design-inspector__bar { flex:none; display:flex; align-items:center; gap:8px; min-height:56px; padding:0 12px; border-top:1px solid #ffffff0d; color:#909090; font-size:12px; }
.design-inspector__count { white-space:nowrap; font-variant-numeric:tabular-nums; }
/* Before/After: the same segmented control as design comment cards. */
.design-inspector__compare { display:inline-flex; flex:none; padding:2px; border-radius:7px; background:#ffffff0a; }
.design-inspector__compare[hidden],.design-inspector__bar[data-message] .design-inspector__compare { display:none; }
.design-inspector__compare button { height:22px; padding:0 8px; border-radius:5px; color:#9a9a9a; font:inherit; font-size:11px; }
.design-inspector__compare button:hover { color:#fff; }
.design-inspector__compare button[aria-pressed="true"] { color:#fff; background:#ffffff1a; }
.design-inspector__status { display:none; min-width:0; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; animation:design-status .2s var(--ease-smooth-out); }
.design-inspector__bar[data-message] .design-inspector__status { display:block; }
.design-inspector__bar[data-message] .design-inspector__count,.design-inspector__bar:not([data-changes]) .design-inspector__tool { display:none; }
.design-inspector__actions { display:flex; align-items:center; gap:2px; margin-left:auto; }
.design-inspector__actions button:disabled { cursor:default; opacity:.35; }
/* Comment is komo's primary action, as on the Comments panel. */
.design-inspector__actions button:last-child { min-height:34px; margin-left:6px; padding:0 14px; border-radius:8px; background:var(--accent,#bda6ef); color:#211b2d; font-size:12px; font-weight:500; }
.design-inspector__actions button:last-child:hover:not(:disabled) { background:var(--accent,#bda6ef); color:#211b2d; filter:brightness(1.08); }
.design-inspector :focus-visible { outline:2px solid var(--accent,#bda6ef); outline-offset:2px; }
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
  .design-inspector[data-empty] .design-inspector__identity { visibility:visible; }
  .design-field { height:34px; }
}
@media (prefers-reduced-motion:reduce) {
  .design-outline,.design-inspector,.design-inspector__fold svg,.design-inspector__status { transition:none; animation:none; }
}
`;
