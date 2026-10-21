import { isDesignTarget, type DesignTarget } from "./design-target.js";
import { isolated, textEntry } from "./dom.js";
import { isMac } from "./kbd.js";
import { isElement, pageDocument } from "./frame-target.js";
import { matchesShortcut, resolveDesignKeys, type DesignKeys } from "./shortcuts.js";

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
  /** Design mode's Undo and Redo; their keys press them from anywhere but a text field. */
  undo?: HTMLButtonElement;
  redo?: HTMLButtonElement;
  /** Before/After and selection keys; defaults are ← → and Tab, Shift+Tab, Shift+Enter. */
  keys?: DesignKeys;
  /** Plain Enter with a selection. Return false when Comment is disabled. */
  comment?(): boolean;
  root?: ShadowRoot;
  signal?: AbortSignal;
}) {
  const keys = options.keys ?? resolveDesignKeys();
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
  /** Press Undo or Redo, leaving focus where it was; when it redraws a field, on the same control there. */
  const press = (button: HTMLButtonElement, path: EventTarget[]) => {
    const focused = root?.activeElement ?? document.activeElement;
    const field = focused?.closest<HTMLElement>("[data-field-property]")?.dataset.fieldProperty;
    button.click();
    // From the canvas or the focused selection, the selection stays drawn, like any canvas key.
    const selected = options.selected();
    if (selected && (!path.includes(options.host) || focused?.matches(".design-geometry__frame"))) options.select(selected);
    const back = focused?.isConnected ? focused : field && root?.querySelector(`[data-field-property="${CSS.escape(field)}"] ${focused!.localName}`);
    if (back instanceof HTMLElement) back.focus({ preventScroll: true });
    // The button takes focus; from the canvas, give it back so canvas keys keep working.
    if (!path.includes(options.host)) (root?.activeElement as HTMLElement | null)?.blur();
  };
  return (event: KeyboardEvent): boolean => {
    if (event.isComposing || event.keyCode === 229) return false;
    const key = event.key.toLowerCase();
    const path = event.composedPath();
    const typing = textEntry(path[0]);
    const mod = isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    // ⌘Z undoes; ⌘⇧Z (Ctrl+Y or Ctrl+Shift+Z elsewhere) redoes. Text fields keep their own.
    const button = typing || !mod || event.altKey ? undefined
      : key === "z" ? (event.shiftKey ? options.redo : options.undo) : key === "y" && !isMac() && !event.shiftKey ? options.redo : undefined;
    if (button) {
      if (button.disabled) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      press(button, path);
      return true;
    }
    if (key === "escape") {
      // The innermost thing closes first: a field's edit, an open popup, then Design mode.
      // A text field cancels its own edit first and lets go of focus, so the next Escape leaves.
      if (typing) {
        if (!path.some(node => isElement(node) && node.matches("[data-field-property]"))) {
          event.preventDefault();
          (path[0] as HTMLElement).blur();
        }
        return true;
      }
      return path.some(node => isElement(node) && node.matches("[popover],[role=listbox]"));
    }
    if (event.defaultPrevented || options.reserved?.(event)) return false;
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    // ← Before and → After anywhere in Design mode, except where arrows edit: text fields, open
    // lists, sliders and the focused selection, which keeps its Alt+arrow moves.
    const side = matchesShortcut(event, keys.before) ? true : matchesShortcut(event, keys.after) ? false : undefined;
    const busy = typing || path.some(node => isElement(node) && node.matches("input[type=range],[role=slider],.design-geometry__frame"));
    if (!options.compare.hidden && (side !== undefined && !busy || plain && key === "b" && !typing)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      options.compareBefore(side);
      return true;
    }
    if (event.key === "?" && options.help && !typing && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      options.help();
      return true;
    }
    // Selection keys apply on the page and the selection, never in the panel.
    // Space still inspects a focused element. Enter posts the comment instead.
    const inspect = plain && key === " ";
    const posting = plain && key === "enter" && !event.repeat;
    if (posting) {
      const editing = typing || path.some(node => isElement(node) && node.matches(
        "[data-field-property],[popover],[role=listbox],[role=menu],textarea,.new-comment-composer,.reply-composer",
      ));
      const panelControl = path.includes(options.host) && ownsKeyboard(event);
      if (!editing && !panelControl) {
        const current = options.selected();
        if (current?.isConnected && options.comment?.()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return true;
        }
        return false;
      }
    }
    if (path.includes(options.host) || ownsKeyboard(event, inspect)) return false;
    const selected = options.selected();
    const eligible = (element: Element | null): element is DesignTarget => isDesignTarget(element)
      && element.isConnected && element !== element.ownerDocument.body && element !== element.ownerDocument.documentElement
      && !options.host.contains(element) && !element.matches("script,style,defs,title,desc,metadata,[hidden],[inert]")
      && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden";
    const doc = pageDocument(), focus = doc.activeElement;
    const onSelection = !focus || focus === doc.body || focus === doc.documentElement || focus === selected;
    let next: Element | null = null;
    const sibling = matchesShortcut(event, keys.next) ? "nextElementSibling" : matchesShortcut(event, keys.prev) ? "previousElementSibling" : undefined;
    const alt = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (selected?.isConnected && sibling) {
      next = selected[sibling];
      while (next && !eligible(next)) next = next[sibling];
      // Own the bounded walk even at an edge; never move focus or wrap.
      event.preventDefault();
      event.stopImmediatePropagation();
    } else if (selected?.isConnected && onSelection && (matchesShortcut(event, keys.child) || alt && key === "arrowdown")) next = [...selected.children].find(eligible) ?? null;
    else if (selected?.isConnected && (matchesShortcut(event, keys.parent) || alt && key === "arrowup")) next = selected.parentElement;
    else if (inspect) next = focus;
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
