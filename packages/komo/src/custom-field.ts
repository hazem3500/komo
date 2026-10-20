import { primaryFamily } from "./css-value-parts.js";
import { inlineStyleSnapshot, validStyleValue } from "./design-preview.js";
import type { Control, Field, PanelContext } from "./design-panel.js";
import type { DesignTarget } from "./design-target.js";
import type { TokenPickerOptions } from "./token-picker.js";

const fields = new WeakMap<HTMLElement, { field: Field; set(value: string): void }>();

export function registerCustomField(control: Control, field: Field, context: Pick<PanelContext, "element" | "begin" | "apply" | "commit">) {
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
    style.textContent = '.komo-font-name{position:absolute;inset:0 28px 0 var(--lead,8px);display:flex;align-items:center;gap:6px;pointer-events:none;overflow:hidden;white-space:nowrap}.komo-font-name span{overflow:hidden;text-overflow:ellipsis}.design-field:has(.komo-font-name)>input:not(:focus){color:transparent}.design-field:has(>input:focus)>.komo-font-name,.design-field[data-token-mode=token]>.komo-font-name,.design-field[data-token-mode=connected]>.komo-font-name{display:none}';
    const name = document.createElement("span"), aa = document.createElement("b"), text = document.createElement("span");
    name.className = "komo-font-name"; name.setAttribute("aria-hidden", "true"); aa.textContent = "Aa"; name.append(aa, text);
    const sync = () => { const value = context.element.style.fontFamily || getComputedStyle(context.element).fontFamily; text.textContent = primaryFamily(value); aa.style.fontFamily = value; control.title = value; };
    syncDisplay = sync;
    control.addEventListener("input", sync); control.addEventListener("blur", sync); sync(); box.append(style, name);
  }
  fields.set(control, { field, set(value) {
    context.begin(control, field.property);
    context.apply(control, field.property, value);
    context.commit(control, field.property);
    display(value);
  } });
}

export function customPickerValue(element: DesignTarget, property: string, input?: HTMLElement | null): TokenPickerOptions["custom"] {
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
  const registered = fields.get(input);
  if (!registered && (input instanceof HTMLSelectElement || input.type === "number")) return;
  return {
    value: (!/color|^(fill|stroke)$/.test(property) && element.style.getPropertyValue(property).trim()) || getComputedStyle(element).getPropertyValue(property).trim(),
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
  return validStyleValue(field.property, value);
}

