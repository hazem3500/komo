import { fieldLabel } from "./field-label.js";
import { el } from "./dom.js";

/** The color editor is fetched only when Custom opens; typing never creates history. */
export function customEditor(property: string, initial: string, preview: (value: string) => void, commit: (value: string) => void): HTMLElement & { refresh(value: string): void; destroy(): void } {
  const box = el("div", "komo-custom");
  const body = el("div", "komo-custom__body");
  const actions = el("div", "komo-custom__actions");
  const style = el("style");
  style.textContent = `.komo-custom{display:flex;flex:1;flex-direction:column;min-height:0}.komo-custom__body{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:8px;min-height:0;overflow:auto;overscroll-behavior:contain}.komo-custom__actions{flex:none;padding:8px 10px;border-top:1px solid #ffffff14}.komo-custom__actions button{width:100%}.komo-custom__format{display:flex;gap:4px;padding:2px;border-radius:6px;background:#ffffff08}.komo-custom__format button{flex:1;height:28px;border:0;background:none}.komo-custom__format [aria-checked=true]{background:#ffffff18}.komo-custom input,.komo-custom select,.komo-custom button{box-sizing:border-box;min-width:0;max-width:100%;height:32px;border:1px solid #ffffff20;border-radius:5px;background:#ffffff0a;color:inherit;font:inherit;padding:5px 8px}.komo-custom__picker{grid-column:1/-1;min-height:80px}.komo-custom__picker .react-colorful{width:100%;height:80px}.komo-custom__picker .react-colorful__pointer{width:16px;height:16px}.komo-custom label{display:flex;align-items:center;gap:8px;grid-column:1/-1}.komo-custom input[type=range]{flex:1;padding:0;accent-color:var(--accent,#c8b5f4)}.komo-custom [aria-invalid=true]{border-color:#f8a898}.komo-custom button{cursor:pointer}.komo-custom button:disabled{opacity:.4;cursor:default}.komo-custom :focus-visible{outline:1px solid #bda6ef;outline-offset:2px}`;
  const color = /color|^(fill|stroke)$/.test(property);
  const value = el("input");
  value.value = initial;
  value.setAttribute("aria-label", color ? "Color value" : "CSS value");
  const apply = el("button", "", "Apply custom");
  apply.type = "button";
  let picker: ReturnType<typeof import("./accent-picker.js").inlineColorPicker> | undefined;
  let disposed = false;
  let current = initial;
  let dirty = false;
  let display = (next: string) => next;
  const accept = (next: string) => {
    dirty = true;
    const valid = !!next.trim() && CSS.supports(property, next) && !/[{};]/.test(next);
    value.setAttribute("aria-invalid", String(!valid));
    apply.disabled = !valid;
    if (valid) { current = next; preview(next); }
    return valid;
  };
  box.append(style, body, actions);
  if (color) {
    const swatch = el("div", "komo-custom__picker");
    const formats = ["Hex", "RGB", "HSL"];
    let format = /^hsl/.test(initial) ? "HSL" : /^rgb/.test(initial) ? "RGB" : "Hex";
    let changedFormat = false;
    const formatGroup = el("div", "komo-custom__format");
    formatGroup.setAttribute("role", "radiogroup");
    formatGroup.setAttribute("aria-label", "Color format");
    const buttons = formats.map(name => {
      const button = el("button", "", name);
      button.type = "button";
      button.setAttribute("role", "radio");
      button.onclick = () => {
        changedFormat = true;
        format = name;
        syncFormat();
        if (value.getAttribute("aria-invalid") !== "true") value.value = formatted();
      };
      return button;
    });
    function syncFormat() {
      buttons.forEach((button, index) => {
        const selected = formats[index] === format;
        button.setAttribute("aria-checked", String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
    }
    syncFormat();
    formatGroup.append(...buttons);
    formatGroup.onkeydown = event => {
      const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
      if (!step && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      event.stopPropagation();
      const index = event.key === "Home" ? 0 : event.key === "End" ? 2 : (formats.indexOf(format) + step + 3) % 3;
      buttons[index].click();
      buttons[index].focus();
    };
    const alpha = el("input");
    alpha.type = "range";
    alpha.min = "0"; alpha.max = "100"; alpha.step = "1";
    alpha.setAttribute("aria-label", "Opacity");
    const opacity = el("output");
    const label = el("label", "", "Opacity");
    label.append(alpha, opacity);
    let rgba = [0, 0, 0, 1];
    function read(css: string) {
      const probe = el("span"); probe.style.color = css;
      const normalized = probe.style.color === "transparent" ? "rgba(0,0,0,0)" : probe.style.color;
      const parts = /^rgba?\(([^)]+)\)$/.exec(normalized)?.[1].match(/[\d.]+%?/g);
      if (parts) rgba = parts.map((part, index) => parseFloat(part) * (part.endsWith("%") ? index === 3 ? .01 : 2.55 : 1)).concat(parts.length === 3 ? [1] : []);
      else {
        const canvas = el("canvas"); canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.fillStyle = css;
        context.fillRect(0, 0, 1, 1);
        const data = context.getImageData(0, 0, 1, 1).data;
        rgba = [data[0], data[1], data[2], data[3] / 255];
      }
      picker?.update({ r: rgba[0], g: rgba[1], b: rgba[2] });
      alpha.value = String(Math.round(rgba[3] * 100));
      opacity.value = `${alpha.value}%`;
    }
    const hex = (withAlpha = true) => `#${rgba.slice(0, 3).concat(withAlpha && rgba[3] < 1 ? [Math.round(rgba[3] * 255)] : []).map(n => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
    function formatted() {
      const [r, g, b, a] = rgba;
      if (format === "Hex") return hex();
      if (format === "RGB") return `rgb(${r} ${g} ${b} / ${Math.round(a * 100)}%)`;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
      const light = (max + min) / 510;
      const hue = !delta ? 0 : (max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
      const saturation = !delta ? 0 : delta / 255 / (1 - Math.abs(2 * light - 1));
      return `hsl(${Math.round((hue + 360) % 360)} ${Math.round(saturation * 100)}% ${Math.round(light * 100)}% / ${Math.round(a * 100)}%)`;
    }
    read(initial);
    display = next => { read(next); return changedFormat ? formatted() : next; };
    void import("./accent-picker.js").then(({ inlineColorPicker }) => {
      if (disposed || !box.isConnected) return;
      picker = inlineColorPicker({ r: rgba[0], g: rgba[1], b: rgba[2] }, color => {
        rgba = [color.r, color.g, color.b, rgba[3]];
        value.value = formatted();
        accept(value.value);
      });
      swatch.replaceWith(picker.element);
    }, () => { swatch.remove(); });
    alpha.oninput = () => { rgba[3] = Number(alpha.value) / 100; opacity.value = `${alpha.value}%`; value.value = formatted(); accept(value.value); };
    value.oninput = () => { if (accept(value.value)) read(value.value); };
    body.append(swatch, fieldLabel(value, { property, label: "Color value" }, box, true), value, formatGroup, label);
    const EyeDropper = (globalThis as typeof globalThis & { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (EyeDropper && isSecureContext) {
      const pick = el("button", "", "Pick from screen"); pick.type = "button";
      pick.onclick = async () => { try { const result = await new EyeDropper().open(); if (!box.isConnected) return; read(result.sRGBHex); value.value = formatted(); accept(value.value); } catch {} };
      body.append(pick);
    }
  } else {
    value.oninput = () => accept(value.value);
    body.append(fieldLabel(value, { property, label: "CSS value" }, box, true), value);
  }
  apply.onclick = () => { if (!apply.disabled) commit(current); };
  value.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); apply.click(); } };
  actions.append(apply);
  return Object.assign(box, { destroy() { disposed = true; picker?.destroy(); }, refresh(next: string) {
    if (dirty) return;
    const start = value.selectionStart, end = value.selectionEnd;
    current = next;
    value.value = display(next);
    if (start !== null && end !== null) value.setSelectionRange(start, end);
  } });
}
