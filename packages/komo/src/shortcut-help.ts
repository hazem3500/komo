import { designCommands, designGestures, reviewCommands } from "./design-commands.js";
import { button, el } from "./dom.js";
import { renderKbd, renderKeycaps, shortcutKeys } from "./kbd.js";
import type { Shortcut } from "./shortcuts.js";

type HelpCommand = { label: string; shortcut?: Shortcut | null; group?: string; keys?: string[]; gesture?: string; aria?: string };

const css = `.komo-shortcuts{box-sizing:border-box;width:min(720px,calc(100vw - 32px));max-width:none;max-height:min(680px,calc(100dvh - 32px));margin:auto;padding:0;overflow:hidden;border:0;border-radius:16px;background:var(--mm-surface);color:var(--mm-ink);box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--mm-ink) 12%,transparent),0 24px 64px -16px rgb(0 0 0/55%);font:12px/1.4 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;pointer-events:auto;color-scheme:dark}
.komo-shortcuts[open]{display:flex;flex-direction:column;animation:komo-help-in var(--duration-fast) var(--ease-smooth-out)}
.komo-shortcuts::backdrop{background:rgb(0 0 0/40%);pointer-events:auto}
@keyframes komo-help-in{from{opacity:0;scale:.98;translate:0 4px}}
.komo-shortcuts header{flex:none;position:relative;display:flex;align-items:center;gap:8px;padding:10px 10px 4px 16px}
.komo-shortcuts h2{flex:1;margin:0;font-size:14px;font-weight:600}
.komo-shortcuts__close{width:28px;height:28px;border-radius:8px;color:color-mix(in oklab,var(--mm-ink) 60%,transparent)}
.komo-shortcuts__close:hover{background:color-mix(in oklab,var(--mm-ink) 8%,transparent);color:var(--mm-ink)}
.komo-shortcuts__close svg{width:16px;height:16px}
.komo-shortcuts .komo-shortcuts__tip{top:50%;bottom:auto;right:44px;translate:0 -50%;opacity:0;transition:opacity var(--duration-quick) var(--ease-smooth-out)}
.komo-shortcuts__close:hover+.komo-shortcuts__tip,.komo-shortcuts__close:focus-visible+.komo-shortcuts__tip{opacity:1;transition-delay:400ms}
.komo-shortcuts input{flex:none;width:auto;height:30px;margin:6px 16px;padding:0 10px;border-radius:8px;background:color-mix(in oklab,var(--mm-ink) 7%,transparent);box-shadow:none}
.komo-shortcuts input:focus{box-shadow:inset 0 0 0 1px var(--accent,#bda6ef)}
.komo-shortcuts input::placeholder{color:color-mix(in oklab,var(--mm-ink) 50%,transparent)}
.komo-shortcuts__close:focus-visible{outline:2px solid var(--accent,#bda6ef);outline-offset:-2px}
.komo-shortcuts__body{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:4px 16px 14px;columns:2 240px;column-gap:28px;outline:0}
.komo-shortcuts section{break-inside:avoid;padding-bottom:10px}
.komo-shortcuts h3{margin:0;padding:6px 0 2px;font-size:11px;font-weight:600;color:color-mix(in oklab,var(--mm-ink) 62%,transparent)}
.komo-shortcuts__row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:28px}
.komo-shortcuts [hidden]{display:none}
.komo-shortcuts .komo-kbd{align-items:center;gap:4px}
.komo-shortcuts__row kbd{box-sizing:border-box;display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:5px;font-size:11px;line-height:1}
.komo-shortcuts .komo-kbd span,.komo-shortcuts p{color:color-mix(in oklab,var(--mm-ink) 55%,transparent)}
.komo-shortcuts p{column-span:all;margin:4px 0 0;font-size:11px}
@media (prefers-reduced-motion:reduce){.komo-shortcuts[open]{animation:none}}
@media (pointer:coarse){.komo-shortcuts__close{width:44px;height:44px}}`;

/**
 * Opens shortcut help, listing `mode`'s groups first. Help owns the keyboard while open;
 * Escape, ?, the close button and a click outside close it at once and return focus to
 * the control that opened it. Opening it again while it is open keeps it open.
 */
export function showShortcutHelp(root: ShadowRoot, commands: HelpCommand[], design = false, mode?: "design" | "comment") {
  const open = root.querySelector<HTMLDialogElement>("dialog.komo-shortcuts");
  if (open) return open.querySelector<HTMLElement>("[autofocus]")?.focus();
  const active = root.activeElement ?? document.activeElement;
  const previous = (active?.closest(".morphing-menu__panel") ? root.querySelector('[data-menu-item="more"]') : active) as HTMLElement | null;
  const dialog = el("dialog", "komo-shortcuts");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "komo-shortcuts-title");
  const title = el("h2", "", "Keyboard shortcuts");
  title.id = "komo-shortcuts-title";
  const close = button("Close", () => finish(), "icon komo-shortcuts__close", "close");
  close.removeAttribute("title");
  const tip = el("span", "morphing-menu__tooltip komo-shortcuts__tip", "Close");
  tip.setAttribute("aria-hidden", "true");
  tip.append(renderKeycaps(["Esc"], "Escape"));
  const header = el("header");
  header.append(title, close, tip);
  const filter = el("input");
  filter.type = "search";
  filter.placeholder = "Filter shortcuts";
  filter.setAttribute("aria-label", "Filter shortcuts");
  filter.autocomplete = "off";
  filter.spellcheck = false;
  const body = el("div", "komo-shortcuts__body");
  body.tabIndex = 0;
  body.setAttribute("autofocus", "");
  body.setAttribute("role", "region");
  body.setAttribute("aria-label", "Shortcuts");
  // Design mode reuses the comments visibility key for its overlays.
  const own: HelpCommand[] = design ? [...designGestures(), ...designCommands(undefined, commands.find(item => /^(Hide|Show) comments$/.test(item.label))?.shortcut)] : [];
  const review: HelpCommand[] = [...commands, ...reviewCommands()];
  const listed = (mode === "design" ? [...own, ...review] : [...review, ...own])
    .filter(item => item.shortcut || item.keys?.length || item.gesture);
  const groups = [...new Set(listed.map(item => item.group ?? "General"))]
    .sort((a, b) => +(mode === "comment" && b === "Comments") - +(mode === "comment" && a === "Comments"));
  const rows: [HTMLElement, string][] = [];
  for (const group of groups) {
    const section = el("section");
    section.append(el("h3", "", group));
    for (const command of listed.filter(item => (item.group ?? "General") === group)) {
      const line = el("div", "komo-shortcuts__row");
      const spoken = command.shortcut ? shortcutKeys(command.shortcut) : undefined;
      if (spoken) line.setAttribute("aria-keyshortcuts", spoken.aria);
      const keys = command.shortcut ? renderKbd(command.shortcut) : renderKeycaps(command.keys!, command.aria ?? command.keys!.join(" + "));
      if (command.gesture) keys.append(el("span", "", command.gesture));
      line.append(el("span", "", command.label), keys);
      section.append(line);
      rows.push([line, `${command.label} ${keys.getAttribute("aria-label")} ${keys.textContent}`.toLowerCase()]);
    }
    body.append(section);
  }
  const empty = el("p", "", "No matching shortcuts");
  empty.setAttribute("role", "status");
  empty.hidden = true;
  body.append(empty, el("p", "", "Shortcuts pause while typing in a text field."));
  filter.addEventListener("input", () => {
    const terms = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
    for (const [line, text] of rows) line.hidden = !terms.every(term => text.includes(term));
    for (const section of body.querySelectorAll("section")) section.hidden = !section.querySelector(".komo-shortcuts__row:not([hidden])");
    empty.hidden = rows.some(([line]) => !line.hidden);
  });
  dialog.append(Object.assign(el("style"), { textContent: css }), header, filter, body);
  const listeners = new AbortController();
  const { signal } = listeners;
  // Closing tears down here, not on the queued "close" event, so focus is back before
  // the next key or click; the event still covers a close from elsewhere.
  const finish = () => {
    if (signal.aborted) return;
    listeners.abort();
    dialog.close();
    dialog.remove();
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
  dialog.addEventListener("close", finish, { signal });
  // Help owns the keyboard: host, review and Design shortcuts wait until it closes.
  // Native typing, scrolling and Tab still run; a nearer open dialog keeps its own keys.
  window.addEventListener("keydown", event => {
    const nearest = event.composedPath().find(node => node instanceof HTMLDialogElement && node.open);
    if (nearest && nearest !== dialog) return;
    event.stopImmediatePropagation();
    if (event.isComposing) return;
    const typing = root.activeElement === filter;
    if (event.key === "Escape" || event.key === "?" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      finish();
    } else if (event.key === "Tab") {
      const stops: HTMLElement[] = [close, filter, body];
      const at = stops.indexOf(root.activeElement as HTMLElement);
      event.preventDefault();
      stops[at < 0 ? event.shiftKey ? 2 : 0 : (at + (event.shiftKey ? 2 : 1)) % 3]!.focus();
    }
  }, { capture: true, signal });
  // The backdrop belongs to the dialog: a press and release both outside its box close it.
  let outside = false;
  const beyond = (event: MouseEvent) => {
    const box = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
  };
  dialog.addEventListener("pointerdown", event => { outside = beyond(event); }, { signal });
  dialog.addEventListener("click", event => { if (outside && beyond(event)) finish(); }, { signal });
  root.append(dialog);
  dialog.showModal();
}
