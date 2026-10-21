import { registerCustomField, inputValue } from "./custom-field.js";
export { syncFields } from "./custom-field.js";
import { fieldLabel } from "./field-label.js";
import type { DesignTarget } from "./design-target.js";
import { designPanelStyles } from "./design-panel-styles.js";
import { toHex } from "./design-preview.js";

/** The property controls load as their own chunk, so the Design mode entry stays small. */
export { designPanelStyles };
export { toHex };

export type Control = HTMLInputElement | HTMLSelectElement;

export type Field = {
  property: string;
  label: string;
  kind: "color" | "length" | "size" | "select" | "text";
  /** Short letter or icon path; numeric fields scrub when it is dragged. */
  glyph?: string;
  wide?: boolean;
  values?: string[];
  min?: number;
  max?: number;
  /** One arrow press or scrub step; 1, or 0.1 for unitless text values. */
  step?: number;
  placeholder?: string;
};

export interface PanelContext {
  element: DesignTarget;
  changed?: ReadonlyMap<string, string>;
  collapsed: Set<string>;
  editText: HTMLButtonElement;
  begin(control: Control, property: string): void;
  apply(control: Control, property: string, value: string | null): void;
  commit(control: Control, property: string, final?: boolean): void;
  cancel?(control: Control, property: string): void;
  /** The review shortcuts: a focused select leaves them, B and ? to their shortcut instead of typing ahead. */
  reserved?(event: KeyboardEvent): boolean;
  rerender(): void;
}

export const fields: Field[] = [
  { property: "width", label: "Width", kind: "size", glyph: "W" },
  { property: "height", label: "Height", kind: "size", glyph: "H" },
  { property: "padding", label: "Padding", kind: "length", glyph: "M1.5 1.5h9v9h-9zM4.5 4.5h3v3h-3z", max: 200 },
  { property: "gap", label: "Gap", kind: "length", glyph: "M1.5 1.5h3v9h-3zM7.5 1.5h3v9h-3z", max: 200 },
  { property: "margin", label: "Margin", kind: "length", glyph: "M4 4h4v4H4zM1 3V1h2m6 0h2v2m0 6v2H9m-6 0H1V9", max: 200 },
  { property: "border-radius", label: "Corner radius", kind: "length", glyph: "M1.5 10.5V6A4.5 4.5 0 0 1 6 1.5h4.5", max: 96 },
  { property: "display", label: "Layout", kind: "select", values: ["block", "flex", "grid", "inline-flex", "inline-grid"] },
  { property: "font-family", label: "Font family", kind: "text", wide: true, placeholder: "system-ui, sans-serif" },
  { property: "font-size", label: "Font size", kind: "length", wide: true, glyph: "M2 3V1.5h8V3M6 1.5v9m-1.5 0h3", min: 1, max: 160 },
  { property: "line-height", label: "Line height", kind: "text", glyph: "M1 1.5h10M1 10.5h10M3.5 8.5 6 3l2.5 5.5", placeholder: "1.4 or 24px" },
  { property: "letter-spacing", label: "Letter spacing", kind: "text", glyph: "M1 2.5v7M11 2.5v7M3.5 9.5 6 2.5l2.5 7M4.4 7h3.2", placeholder: "0 or 0.02em" },
  { property: "font-weight", label: "Weight", kind: "select", values: ["300", "400", "500", "600", "700", "800"] },
  { property: "text-align", label: "Alignment", kind: "select", values: ["left", "center", "right", "justify"] },
  { property: "color", label: "Text color", kind: "color", wide: true },
  { property: "background-color", label: "Fill", kind: "color", wide: true },
  { property: "border-width", label: "Border width", kind: "length", glyph: "M1 2.5h10M1 6h10M1 9.5h10", max: 24 },
  { property: "border-style", label: "Border style", kind: "select", values: ["none", "solid", "dashed", "dotted"] },
  { property: "border-color", label: "Border color", kind: "color" },
  { property: "fill", label: "Fill", kind: "color", wide: true },
  { property: "stroke", label: "Stroke", kind: "color", wide: true },
  { property: "opacity", label: "Layer opacity", kind: "text", glyph: "M6 1.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9v9", min: 0, max: 1, step: 0.01, placeholder: "0–1" },
  { property: "box-shadow", label: "Shadow", kind: "text", wide: true },
  { property: "stroke-width", label: "Stroke width", kind: "length", min: 0, max: 24 },
];

/** Fetched with the panel, so its first render already has styled selects. */
const selectMenu = import("./select-menu.js").catch(() => null);
const live = import("./live-colors.js").catch(() => null);
const controls = import("./field-controls.js").catch(() => null);

const typography = ["font-family", "font-size", "line-height", "letter-spacing", "font-weight", "text-align", "color"];

/** Opaque colors read as short hex; fully transparent ones as `transparent`; partial alpha stays exact. */
function shortColor(value: string): string {
  const alpha = value.match(/^rgba\(.*,\s*([\d.]+)\)$/)?.[1];
  if (alpha === undefined) return /^rgb\(/.test(value) ? toHex(value) : value || "transparent";
  return Number(alpha) ? value : "transparent";
}

/** The element's computed value, or `resolved` when a token already names it. */
export function valueFor(field: Field, element: DesignTarget, resolved?: string): string {
  const value = (resolved || getComputedStyle(element).getPropertyValue(field.property)).trim();
  if (field.kind === "color") return shortColor(value);
  if (field.kind === "length" || field.kind === "size") {
    const match = value.match(/^(-?\d+(?:\.\d+)?)px$/);
    return match ? String(Math.round(Number(match[1]) * 10) / 10) : field.kind === "size" ? value || "auto" : "0";
  }
  return value;
}

/** Shared by every section, including the shared theme tokens. */
export function fieldControl(field: Field, context: Pick<PanelContext, "element" | "begin" | "apply" | "commit" | "cancel">) {
  const { element } = context;
  const box = document.createElement("div");
  box.className = `design-field design-field--${field.kind}`;
  box.dataset.fieldProperty = field.property;
  box.toggleAttribute("data-wide", !!field.wide);
  const control = field.kind === "select" ? document.createElement("select") : document.createElement("input");
  if (control instanceof HTMLSelectElement) {
    for (const value of field.values ?? []) {
      const option = document.createElement("option");
      option.value = option.textContent = value;
      control.append(option);
    }
  } else {
    control.type = field.kind === "length" ? "number" : "text";
    control.autocomplete = "off";
    control.spellcheck = false;
    control.placeholder = field.placeholder ?? "";
    if (field.kind === "length") {
      control.min = String(field.min ?? 0);
      control.max = String(field.max ?? 1000);
      control.setAttribute("inputmode", "decimal");
    }
  }
  const label = fieldLabel(control, field, box);
  box.append(label);
  control.dataset.property = field.property;
  control.setAttribute("aria-label", field.label);
  /** The element's value, as on first render, Escape and syncFields. */
  const show = () => {
    const value = valueFor(field, element);
    if (control instanceof HTMLSelectElement && ![...control.options].some((option) => option.value === value)) control.prepend(new Option(value, value));
    control.value = value;
    const swatch = box.querySelector<HTMLInputElement>('input[type="color"]');
    if (swatch) swatch.value = toHex(value);
  };
  show();
  const begin = () => context.begin(control, field.property);
  const apply = () => own(() => {
    context.apply(control, field.property, inputValue(field, control));
    context.commit(control, field.property, false);
  });
  const commit = () => own(() => context.commit(control, field.property));
  control.addEventListener("focus", begin);
  control.addEventListener("input", apply);
  control.addEventListener("change", commit);
  control.addEventListener("blur", commit);
  if (field.kind === "color") {
    const swatch = document.createElement("input");
    swatch.type = "color";
    swatch.setAttribute("aria-label", `${field.label} picker`);
    const sync = () => { swatch.value = toHex(control.value); };
    sync();
    swatch.addEventListener("pointerdown", begin);
    swatch.addEventListener("focus", begin);
    swatch.addEventListener("input", () => {
      control.value = swatch.value;
      apply();
    });
    swatch.addEventListener("change", commit);
    control.addEventListener("input", sync);
    box.append(swatch);
  }
  if (field.glyph) {
    /** Step a numeric value, keeping its unit; Shift moves ten times as far. */
    const nudge = (steps: number) => {
      const match = control.value.trim().match(/^(-?\d*\.?\d+)([a-z%]*)$/i);
      const unit = match ? match[2] : field.kind === "text" ? "px" : "";
      const start = match ? Number(match[1]) : parseFloat(getComputedStyle(element).getPropertyValue(field.property)) || 0;
      let next = Math.round((start + steps * (field.step ?? (field.kind === "text" && !unit ? 0.1 : 1))) * 100) / 100;
      if (field.kind !== "text" || field.max) next = Math.min(field.max ?? 1e4, Math.max(field.min ?? 0, next));
      control.value = `${next}${unit}`;
      apply();
    };
    const glyph = document.createElement("span");
    glyph.className = "design-field__glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.title = `${field.label} · drag to adjust`;
    if (field.glyph.length > 1) glyph.innerHTML = `<svg viewBox="0 0 12 12"><path d="${field.glyph}"/></svg>`;
    else glyph.textContent = field.glyph;
    // The icon and the field's name both scrub; a click on the name still focuses the field.
    // Like the icon: a touch drag on the name scrubs instead of scrolling the panel.
    label.style.cssText += ";cursor:ew-resize;user-select:none;touch-action:none";
    for (const handle of [glyph, label]) handle.addEventListener("pointerdown", (event) => {
      if (event.button) return;
      event.preventDefault();
      begin();
      handle.setPointerCapture?.(event.pointerId);
      let x = event.clientX;
      const move = (next: PointerEvent) => {
        const steps = Math.trunc((next.clientX - x) / 2);
        if (!steps) return;
        x += steps * 2;
        nudge(steps * (next.shiftKey ? 10 : 1));
      };
      const end = () => {
        handle.removeEventListener("pointermove", move);
        commit();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end, { once: true });
      handle.addEventListener("pointercancel", end, { once: true });
    });
    (control as HTMLElement).addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      nudge((event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1));
    });
    box.append(glyph);
  }
  if (control instanceof HTMLInputElement)
    control.addEventListener("keydown", (event) => { if (event.key === "Enter") control.blur(); });
  box.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !context.cancel) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    context.cancel(control, field.property);
    show();
    queueMicrotask(() => {
      if (box.dataset.tokenMode !== "custom") box.querySelector<HTMLElement>(".design-token-binding select")?.focus();
    });
  });
  box.append(control);
  const own = registerCustomField(control, field, context, show);
  return box;
}

function toolButton(label: string, content: string, action: (event: MouseEvent) => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.textContent = content;
  button.addEventListener("click", action);
  return button;
}

function section(context: PanelContext, name: string, properties: string[] | null, tools: HTMLElement[] = []) {
  const wrap = document.createElement("section");
  wrap.className = "design-section";
  const tray = document.createElement("div");
  tray.className = "design-section__tools";
  tray.append(...tools);
  if (!properties) {
    const title = document.createElement("span");
    title.className = "design-section__title";
    title.textContent = name;
    wrap.append(title, tray);
    return wrap;
  }
  const group = document.createElement("details");
  group.className = "design-group";
  group.open = !context.collapsed.has(name);
  const summary = document.createElement("summary");
  summary.textContent = name;
  const grid = document.createElement("div");
  grid.className = "design-grid";
  for (const property of properties) {
    const field = fields.find((field) => field.property === property)!;
    grid.append(fieldControl(context.element.namespaceURI === "http://www.w3.org/2000/svg" && property === "color" ? { ...field, label: "Color" } : field, context));
  }
  group.append(summary, grid);
  group.addEventListener("toggle", () => {
    if (!group.isConnected) return;
    if (group.open) context.collapsed.delete(name);
    else context.collapsed.add(name);
  });
  wrap.append(tray, group);
  return wrap;
}

/** This render's color fields follow the element's settled value (see live-colors.ts). */
function liveColors(container: HTMLElement, element: DesignTarget) {
  const boxes = [...container.querySelectorAll<HTMLElement>(".design-field--color")];
  if (boxes.length) void live.then((module) => module?.liveColors(boxes, element, valueFor));
}

/** Render only the sections that apply to the element; empty Fill and Border offer a quiet add. */
export function renderPanel(container: HTMLElement, context: PanelContext) {
  const { element, changed } = context;
  // Selects open komo's own listbox once that module (fetched with the panel) is in.
  void selectMenu.then((menu) => menu?.attach(container, context.element, context.reserved));
  // Icon segments, weight samples and unit suffixes join the fields once their chunk is in.
  void controls.then((module) => module?.enhance(container, context.element));
  const style = getComputedStyle(element);
  if (element.namespaceURI === "http://www.w3.org/2000/svg") {
    container.append(
      section(context, "Layout", element.localName === "svg" ? ["width", "height", "display"] : ["display"]),
      section(context, "Appearance", ["color", "fill", "stroke", "stroke-width"]),
    );
    return liveColors(container, element);
  }
  const touched = (properties: string[]) => properties.some((property) => changed?.has(property));
  // Direct text, or text styles the element sets inline for its children.
  const text = !!element.textContent?.trim() ||
    /(?:^|;)\s*(?:color|font|line-height|text-align)/.test(element.getAttribute("style") ?? "") || touched(typography);
  const flex = /flex|grid/.test(style.display) || touched(["gap"]);
  const fill = shortColor(style.backgroundColor) !== "transparent" || touched(["background-color"]);
  const border = ["top", "right", "bottom", "left"].some((side) =>
    parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 && style.getPropertyValue(`border-${side}-style`) !== "none",
  ) || touched(["border", "border-width", "border-style", "border-color"]);
  const shadow = (style.boxShadow && style.boxShadow !== "none") || touched(["box-shadow"]);
  const add = (name: string, property: string, value: string, focus: string) => toolButton(`Add ${name}`, "+", () => {
    const key = document.createElement("input");
    context.begin(key, property);
    context.apply(key, property, value);
    context.commit(key, property);
    context.rerender();
    container.querySelector<HTMLElement>(`[data-property="${focus}"]`)?.focus();
  });
  container.append(section(context, "Layout", [
    "width", "height", "padding", ...(flex ? ["gap"] : []), "margin", ...(border ? [] : ["border-radius"]), "display",
  ]));
  if (text) container.append(section(context, "Typography", typography, [context.editText]));
  container.append(
    fill ? section(context, "Fill", ["background-color"]) : section(context, "Fill", null, [add("fill", "background-color", "#ffffff", "background-color")]),
    border
      ? section(context, "Border", ["border-width", "border-radius", "border-style", "border-color"])
      : section(context, "Border", null, [add("border", "border", "1px solid", "border-width")]),
    section(context, "Effects", shadow ? ["opacity", "box-shadow"] : ["opacity"], shadow ? [] : [add("shadow", "box-shadow", "0 1px 3px rgba(0, 0, 0, 0.12)", "box-shadow")]),
  );
  liveColors(container, element);
}
