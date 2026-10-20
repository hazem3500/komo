import { typedCustom } from "./typed-custom.js";
import type { Field } from "./design-panel.js";
import type { DesignToken } from "./design-system.js";
import { el } from "./dom.js";

/** The typed Custom editor (lengths, shadows, fonts), fetched only when Custom opens; typing never creates history. Colors use color-editor.ts. */
export function customEditor(property: string, initial: string, preview: (value: string) => void, commit: (value: string) => void, field?: Field, tokens: readonly DesignToken[] = []): HTMLElement & { refresh(value: string): void; destroy(): void } {
  const box = el("div", "komo-custom");
  const body = el("div", "komo-custom__body");
  const actions = el("div", "komo-custom__actions");
  const style = el("style");
  style.textContent = `.komo-custom{display:flex;flex:1;flex-direction:column;min-height:0}.komo-custom__body{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:8px;min-height:0;overflow:auto;overscroll-behavior:contain}.komo-custom__actions{flex:none;padding:8px 10px;border-top:1px solid #ffffff14}.komo-custom__actions button{width:100%}.komo-custom input,.komo-custom select,.komo-custom button{box-sizing:border-box;min-width:0;max-width:100%;height:32px;border:1px solid #ffffff20;border-radius:5px;background:#ffffff0a;color:inherit;font:inherit;padding:5px 8px}.komo-custom label{display:flex;align-items:center;gap:8px;grid-column:1/-1}.komo-custom [aria-invalid=true]{border-color:#f8a898}.komo-custom button{cursor:pointer}.komo-custom button:disabled{opacity:.4;cursor:default}.komo-custom :focus-visible{outline:1px solid #bda6ef;outline-offset:2px}`;
  const value = el("input");
  value.value = initial;
  value.setAttribute("aria-label", "CSS value");
  const apply = el("button", "", "Apply custom");
  apply.type = "button";
  let current = initial;
  let dirty = false;
  const accept = (next: string) => {
    dirty = true;
    const valid = !!next.trim() && CSS.supports(property, next) && !/[{};]/.test(next);
    value.setAttribute("aria-invalid", String(!valid));
    apply.disabled = !valid;
    if (valid) { current = next; preview(next); }
    return valid;
  };
  box.append(style, body, actions);
  const refreshTyped = typedCustom(body, property, initial, value, accept, field, tokens);
  apply.onclick = () => { if (!apply.disabled) commit(current); };
  box.onkeydown = event => { if (event.key === "Enter" && !event.isComposing && event.target instanceof HTMLInputElement && event.target.type !== "checkbox") { event.preventDefault(); event.stopPropagation(); apply.click(); } };
  actions.append(apply);
  return Object.assign(box, { destroy() {}, refresh(next: string) {
    if (dirty) return;
    const start = value.selectionStart, end = value.selectionEnd;
    current = next;
    value.value = next;
    refreshTyped(next);
    if (start !== null && end !== null) value.setSelectionRange(start, end);
  } });
}

export function pickerEditor(options: import("./token-picker.js").TokenPickerOptions, preview: (value: string) => void, commit: (value: string) => void) {
  return customEditor(options.property, options.custom!.value, preview, commit, options.custom?.field, options.tokens);
}
