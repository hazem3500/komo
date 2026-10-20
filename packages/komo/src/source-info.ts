import { el } from "./dom.js";

/** The app's link for a repository-relative source path, e.g. its `sourceUrl`. */
export type SourceHref = (path: string, line?: number) => string | undefined;

/** One ⓘ for every place a source path appears: Properties headings and change cards. */
export const sourceInfoStyles = `.komo-source{position:relative;flex:none;display:flex}.komo-source>button{width:24px;height:24px;padding:0;border:0;border-radius:6px;background:none;color:#898680;cursor:pointer}.komo-source>button::before{content:"i";display:inline-grid;place-items:center;width:12px;height:12px;border:1.2px solid;border-radius:50%;font:italic 600 9px/1 Georgia,serif}.komo-source>button:is(:hover,[aria-expanded=true]){background:#ffffff12;color:#f1efeb}.komo-source>span{position:absolute;z-index:12;top:calc(100% + 4px);right:0;width:max-content;padding:10px;border-radius:10px;background:#191819;box-shadow:0 0 0 1px #ffffff1a,0 12px 40px #0008;color:#e9e6e1;font:11px/1.45 ui-monospace,Menlo,monospace;overflow-wrap:anywhere}.komo-source span button{margin:8px 6px 0 0;padding:4px 10px;border:0;border-radius:6px;background:#ffffff12;color:#f1efeb;font:12px system-ui,sans-serif;cursor:pointer}@media (max-width:520px){.komo-source>button{width:32px;height:32px}.komo-source span button{padding:9px 12px}}`;

/**
 * An ⓘ button whose popover holds the full source path with Copy and, when the
 * app's sourceUrl gives an editor or repository link for a repository-relative
 * path, Open. Bundle paths such as `/chunk-ab12.js:7` only offer Copy.
 */
export function sourceInfo(name: string, source: string, sourceHref?: SourceHref): HTMLElement {
  const tray = el("span", "komo-source");
  const info = el("button", "komo-source__button");
  const popup = el("span", "", source);
  const label = `${name} source`;
  const button = (text: string, aria: string, run: () => void) => {
    const action = el("button", "", text);
    action.type = "button";
    action.setAttribute("aria-label", aria);
    action.addEventListener("click", run);
    popup.append(action);
    return action;
  };
  info.type = "button";
  info.title = source;
  info.setAttribute("aria-label", label);
  info.setAttribute("aria-expanded", "false");
  popup.hidden = true;
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", label);
  popup.append(el("br"));
  const copy = button("Copy", "Copy source path", () => void Promise.resolve().then(() => navigator.clipboard.writeText(source))
    .then(() => { copy.textContent = "Copied"; }, () => getSelection()?.selectAllChildren(popup.firstChild!)));
  const local = /^([\w@.-][^:]*?\.\w+)(?::(\d+))?(?::\d+)?$/.exec(source);
  let href: string | undefined;
  try { href = local ? sourceHref?.(local[1], Number(local[2]) || undefined) : undefined; } catch { /* No link. */ }
  if (href && /^(https?|vscode|cursor):/.test(href)) button("Open", "Open source", () => { window.open(href, "_blank", "noopener,noreferrer"); toggle(false); });
  let events: AbortController | undefined;
  function toggle(open: boolean) {
    popup.hidden = !open;
    info.setAttribute("aria-expanded", String(open));
    copy.textContent = "Copy";
    events?.abort();
    if (!open) return;
    // Stay inside the nearest clipping box (a dialog, the panel) and the viewport.
    let left = 8, right = innerWidth - 8, node = tray.parentElement;
    while (node && getComputedStyle(node).overflowX === "visible") node = node.parentElement;
    if (node) {
      const box = node.getBoundingClientRect();
      left = Math.max(left, box.left + 4);
      right = Math.min(right, box.right - 4);
    }
    popup.style.translate = "";
    popup.style.maxWidth = `${Math.min(280, right - left)}px`;
    const rect = popup.getBoundingClientRect();
    popup.style.translate = `${Math.max(0, left - rect.left) - Math.max(0, rect.right - right)}px`;
    const { signal } = events = new AbortController();
    info.getRootNode().addEventListener("pointerdown", event => { if (!event.composedPath().includes(tray)) toggle(false); }, { capture: true, signal });
    window.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !event.composedPath().includes(tray)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle(false);
      info.focus();
    }, { capture: true, signal });
  }
  info.addEventListener("click", () => toggle(popup.hidden === true));
  tray.addEventListener("focusout", event => { if (event.relatedTarget instanceof Node && !tray.contains(event.relatedTarget)) toggle(false); });
  tray.append(info, popup);
  return tray;
}
