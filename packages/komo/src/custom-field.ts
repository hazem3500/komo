import { fontView } from "./css-value-parts.js";
import { inlineStyleSnapshot, validStyleValue } from "./design-preview.js";
import type { Control, Field, PanelContext } from "./design-panel.js";
import type { DesignTarget } from "./design-target.js";
import type { TokenPickerOptions } from "./token-picker.js";

const live = new WeakSet<HTMLElement>();
const fields = new WeakMap<HTMLElement, { field: Field; declared(): string; seen: string; set(value: string): void; keep(value: string): void; refresh(): void }>();

/** Returns `own`, which runs the field's own edits so syncFields leaves what they show. */
export function registerCustomField(control: Control, field: Field, context: Pick<PanelContext, "element" | "begin" | "apply" | "commit">, show: () => void) {
  let syncDisplay = () => {};
  const display = (value: string) => {
    if (control instanceof HTMLInputElement && field.kind === "length") control.type = "text";
    if (control instanceof HTMLSelectElement && ![...control.options].some(option => option.value === value)) {
      const option = document.createElement("option"); option.value = option.textContent = value; control.prepend(option);
    }
    control.value = field.kind === "length" && /^-?[\d.]+px$/.test(value) ? value.slice(0, -2) : value;
    control.title = value;
    syncDisplay();
  };
  if (field.kind === "length") display(context.element.style.getPropertyValue(field.property) || getComputedStyle(context.element).getPropertyValue(field.property));
  if (field.property === "font-family") {
    const box = control.parentElement!;
    const style = document.createElement("style");
    style.textContent = '.komo-font-name{position:absolute;inset:0 28px 0 var(--lead,8px);display:flex;align-items:center;gap:6px;pointer-events:none;overflow:hidden;white-space:nowrap}.komo-font-name span{overflow:hidden;color:#f1efeb;text-overflow:ellipsis}.komo-font-name small{flex:none;color:#898680;font-size:10px}.komo-font-name[data-unresolved] span{color:#e7c27d}.design-field:has(.komo-font-name)>input:not(:focus){color:transparent}.design-field:has(>input:focus)>.komo-font-name,.design-field[data-token-mode=token]>.komo-font-name,.design-field[data-token-mode=connected]>.komo-font-name{display:none}';
    const name = document.createElement("span"), aa = document.createElement("b"), text = document.createElement("span"), note = document.createElement("small");
    name.className = "komo-font-name"; name.setAttribute("aria-hidden", "true"); aa.textContent = "Aa"; name.append(aa, text, note);
    const sync = () => {
      const element = context.element, computed = getComputedStyle(element);
      const view = fontView(element.style.getPropertyValue("font-family") || declaredFamily(element), computed.fontFamily, variable => computed.getPropertyValue(variable));
      text.textContent = view.label; note.textContent = view.note; control.title = view.title;
      name.toggleAttribute("data-unresolved", view.label.endsWith(" unresolved"));
      aa.style.fontFamily = text.style.fontFamily = computed.fontFamily;
    };
    syncDisplay = sync;
    control.addEventListener("input", sync); control.addEventListener("blur", sync); const watch = new MutationObserver(() => box.isConnected ? sync() : watch.disconnect()); watch.observe(context.element, { attributeFilter: ["style", "class"] }); sync(); box.append(style, name);
  }
  const declared = () => context.element.style.getPropertyValue(field.property);
  const entry = { field, declared, seen: declared(), set(value: string) {
    own(() => {
      context.begin(control, field.property);
      context.apply(control, field.property, value);
      context.commit(control, field.property);
    });
    display(value);
  }, keep(value: string) {
    // A live value from the popup: part of the field's pending edit, made final when the popup closes.
    own(() => {
      context.apply(control, field.property, value);
      context.commit(control, field.property, false);
    });
    display(value);
  }, refresh() {
    entry.seen = declared();
    if (field.kind === "length") display(entry.seen || getComputedStyle(context.element).getPropertyValue(field.property));
    else show();
  } };
  // The field's own edits keep what it shows, e.g. "50%"; syncFields refreshes it only when something else changes it.
  const own = (run: () => void) => {
    editing = control;
    try { run(); } finally {
      editing = undefined;
      entry.seen = declared();
    }
  };
  fields.set(control, entry);
  return own;
}

let editing: Control | undefined;

/**
 * Show current values in fields whose declaration changed outside them, as a fresh
 * render would: a geometry resize, Undo, Reset or Before/After. Fields being edited keep theirs.
 */
export function syncFields(container: ParentNode, dirty: (control: Element) => boolean) {
  for (const control of container.querySelectorAll<Control>(".design-field > [data-property]")) {
    const entry = fields.get(control);
    if (entry && control !== editing && !dirty(control) && (control.getRootNode() as Document).activeElement !== control && entry.declared() !== entry.seen) entry.refresh();
  }
}

/** The page's own font-family rule for the element when it uses a variable, so an unresolved one can be named. */
function declaredFamily(element: Element): string {
  let found = "";
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        const value = rule.style.getPropertyValue("font-family");
        try { if (value.includes("var(") && element.matches(rule.selectorText)) found = value; } catch { /* An unsupported selector matches nothing. */ }
      } else if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of element.ownerDocument.styleSheets) try { visit(sheet.cssRules); } catch { /* Cross-origin sheets stay unread. */ }
  return found;
}

export function customPickerValue(element: DesignTarget, property: string, input?: HTMLElement | null): TokenPickerOptions["custom"] {
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
  const registered = fields.get(input);
  if (!registered && (input instanceof HTMLSelectElement || input.type === "number")) return;
  // Keyword fields and opacity are their own editors: a token list only, no Custom popup.
  if (registered?.field.kind === "select" || property === "opacity") return;
  return {
    // Read when asked, so an open popup can follow a settled transition or theme.
    get value() { return (!/color|^(fill|stroke)$/.test(property) && element.style.getPropertyValue(property).trim()) || getComputedStyle(element).getPropertyValue(property).trim(); },
    field: registered?.field,
    onPreview(value) {
      const before = inlineStyleSnapshot(element, property);
      element.style.setProperty(property, value, "important");
      return before.restore;
    },
    onSelect(value) {
      if (registered && registered.field.kind !== "color") return registered.set(value);
      input.dispatchEvent(new Event("focus"));
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    // The live Custom editors: every kept value updates one pending edit on the field, the
    // popup closing makes it one history entry and Escape cancels it, as the field's own Escape does.
    // Per field, so a refreshed popup (new options) still finishes the same edit.
    onCommit(value) {
      if (!live.has(input)) input.dispatchEvent(new Event("focus"));
      live.add(input);
      if (registered && registered.field.kind !== "color") return registered.keep(value);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    onDone() {
      if (live.delete(input)) input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    onCancel() {
      if (live.delete(input)) input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    },
  };
}

export function inputValue(field: Field, control: Control): string | null {
  const value = control.value.trim();
  if (field.kind === "color") return validStyleValue(field.property, value);
  if (field.kind === "length") {
    if (!value) return null;
    return validStyleValue(field.property, /^-?[\d.]+$/.test(value) ? `${value}px` : value);
  }
  if (field.kind === "size" || field.property === "line-height") {
    if (!/^(auto|normal|(?:\d+(?:\.\d+)?)(?:px|%|vw|vh|rem|em)?)$/.test(value)) return null;
    return field.kind === "size" && /^[\d.]+$/.test(value) ? `${value}px` : value;
  }
  // A plain number of letter spacing is pixels, as the arrows and scrub write it.
  return validStyleValue(field.property, field.property === "letter-spacing" && /^-?[\d.]+$/.test(value) ? `${value}px` : value);
}

