import { isDesignTarget, type DesignTarget } from "./design-target.js";
import { isolated, textEntry } from "./dom.js";
import { isMac } from "./kbd.js";
import { isElement, pageDocument } from "./frame-target.js";

// Check ancestors in the composed path, including widgets across shadow boundaries.
export function ownsKeyboard(event: KeyboardEvent, inspect = false): boolean {
  return event.composedPath().some(node => isElement(node) && !(inspect && node.matches('button,a[href],summary') && !node.matches('[contenteditable],[inert],[role]:not([role=button]):not([role=link])')) && node.matches(
    'input,textarea,select,button,a[href],summary,dialog,[contenteditable]:not([contenteditable="false"]),[inert],[role]:not([role="none"]):not([role="presentation"]):not([role="img"]):not([role="group"]):not([role="region"]):not([role="main"]):not([role="article"]):not([role="heading"]):not([role="paragraph"]):not([role="generic"])',
  ));
}

export function designKeyboard(options: {
  host: HTMLElement;
  compare: HTMLElement;
  reserved?(event: KeyboardEvent): boolean;
  selected(): DesignTarget | null;
  select(element: DesignTarget): void;
  compareBefore(before?: boolean): void;
  help?(): void;
  /** Design mode's Undo; ⌘Z (Ctrl+Z) presses it from anywhere but a text field. */
  undo?: HTMLButtonElement;
  root?: ShadowRoot;
  signal?: AbortSignal;
}) {
  // A closed select's type-ahead would pick an option on komo's own keys (B, ?, the review
  // shortcuts); once every handler has run, those keys never reach it. Other letters still do.
  const guard = (event: KeyboardEvent) => {
    const target = event.composedPath()[0];
    if (target instanceof HTMLSelectElement && event.composedPath().includes(options.host) && !textEntry(target) &&
      !event.ctrlKey && !event.metaKey && !event.altKey && (/^[b?]$/i.test(event.key) || options.reserved?.(event))) event.preventDefault();
  };
  const { root, signal } = options;
  addEventListener("keydown", guard, { signal });
  root?.addEventListener("keydown", event => isolated(event, root) && guard(event as KeyboardEvent), { signal });
  return (event: KeyboardEvent): boolean => {
    if (event.isComposing || event.keyCode === 229) return false;
    const key = event.key.toLowerCase();
    const path = event.composedPath();
    const typing = textEntry(path[0]);
    const { undo } = options;
    // Undo leaves focus where it was; when it redraws a field, on the same control there.
    if (undo && !undo.disabled && key === "z" && (isMac() ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey && !typing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const focused = root?.activeElement ?? document.activeElement;
      const field = focused?.closest<HTMLElement>("[data-field-property]")?.dataset.fieldProperty;
      undo.click();
      // Undo from the canvas or the focused selection keeps the selection drawn, like any canvas key.
      const selected = options.selected();
      if (selected && (!path.includes(options.host) || focused?.matches(".design-geometry__frame"))) options.select(selected);
      const back = focused?.isConnected ? focused : field && root?.querySelector(`[data-field-property="${CSS.escape(field)}"] ${focused!.localName}`);
      if (back instanceof HTMLElement) back.focus({ preventScroll: true });
      // Undo moves focus to its button; from the canvas, give it back so canvas keys keep working.
      if (!path.includes(options.host)) (root?.activeElement as HTMLElement | null)?.blur();
      return true;
    }
    // A field cancels its own preview on Escape. Checked before defaultPrevented:
    // komo's window-capture isolation already prevents every Escape inside its host.
    if (key === "escape" && path.some(node => isElement(node) && node.matches("[data-field-property]"))) return true;
    if (event.defaultPrevented || options.reserved?.(event)) return false;
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const horizontal = key === "arrowleft" || key === "arrowright";
    const comparison = path.includes(options.compare);
    // B and ? work from the canvas and any panel control; only true text entry pauses them.
    if (plain && !options.compare.hidden && (comparison && horizontal || key === "b" && !typing)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      options.compareBefore(key === "b" ? undefined : key === "arrowleft");
      return true;
    }
    if (event.key === "?" && options.help && !typing && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      options.help();
      return true;
    }
    const inspect = plain && (key === "enter" || key === " ");
    if (path.includes(options.host) || ownsKeyboard(event, inspect)) return false;
    const selected = options.selected();
    const eligible = (element: Element | null): element is DesignTarget => isDesignTarget(element)
      && element.isConnected && element !== element.ownerDocument.body && element !== element.ownerDocument.documentElement
      && !options.host.contains(element) && !element.matches("script,style,defs,title,desc,metadata,[hidden],[inert]")
      && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden";
    let next: Element | null = null;
    if (selected?.isConnected && plain && horizontal) {
      const direction = key === "arrowleft" ? "previousElementSibling" : "nextElementSibling";
      next = selected[direction];
      while (next && !eligible(next)) next = next[direction];
      // Own the bounded canvas arrow even at an edge; never scroll or wrap.
      event.preventDefault();
      event.stopImmediatePropagation();
    } else if (selected?.isConnected && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (key === "arrowup") next = selected.parentElement;
      if (key === "arrowdown") next = [...selected.children].find(eligible) ?? null;
    } else if (inspect) next = pageDocument().activeElement;
    if (!eligible(next)) return event.defaultPrevented;
    event.preventDefault();
    event.stopImmediatePropagation();
    next.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    options.select(next);
    return true;
  };
}

/** The control focus belongs on after a redraw, by its property, label or id. */
function focusKey(node: Element): string {
  const field = node.closest<HTMLElement>("[data-field-property]")?.dataset.fieldProperty;
  const scope = field ? `[data-field-property=${JSON.stringify(field)}] ` : "";
  const property = node.getAttribute("data-property"), label = node.getAttribute("aria-label");
  return property ? `${node.localName}[data-property=${JSON.stringify(property)}]`
    : label ? `${scope}${node.localName}[aria-label=${JSON.stringify(label)}]`
    : node.id ? `[id=${JSON.stringify(node.id)}]` : scope && `${scope}${node.localName}`;
}

/**
 * Once `container` is redrawn, focus the control matching the one that had focus; props and
 * tokens attach a little later, so it waits up to 400ms, then calls `fallback`. Nothing moves
 * if focus went somewhere else meanwhile. The returned function stops waiting.
 */
export function keepFocus(container: HTMLElement, focused: Element, done: () => void, fallback: () => void): (fallback: boolean) => void {
  const root = container.getRootNode() as Document | ShadowRoot;
  const key = focusKey(focused);
  const lost = () => !root.activeElement && (!document.activeElement || document.activeElement === document.body);
  const finish = (fall: boolean) => {
    observer.disconnect();
    clearTimeout(timer);
    done();
    if (fall && lost()) fallback();
  };
  const attempt = () => {
    if (!lost()) return finish(false);
    const next = key ? container.querySelector<HTMLElement>(key) : null;
    if (next) { next.focus({ preventScroll: true }); finish(false); }
  };
  const observer = new MutationObserver(attempt);
  observer.observe(container, { childList: true, subtree: true });
  const timer = setTimeout(finish, 400, true);
  return finish;
}
