import { designModeStyles } from "./design-mode-styles.js";
import { icon } from "./dom.js";

export interface DesignModeOptions {
  root: ShadowRoot;
  host: HTMLElement;
  targetAt(x: number, y: number): Element | null;
  onComment(element: Element): void;
  onExit(): void;
}

type Edit = {
  element: HTMLElement;
  property: string;
  before: Original;
  after: Original;
};

type Original = { value: string; priority: string };

type Field = {
  property: string;
  label: string;
  kind: "color" | "length" | "select" | "text";
  values?: string[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
};

const fields: Field[] = [
  { property: "color", label: "Text color", kind: "color" },
  { property: "background-color", label: "Fill", kind: "color" },
  { property: "font-size", label: "Font size", kind: "length", min: 1, max: 160 },
  { property: "font-weight", label: "Weight", kind: "select", values: ["300", "400", "500", "600", "700", "800"] },
  { property: "line-height", label: "Line height", kind: "text", placeholder: "1.4 or 24px" },
  { property: "text-align", label: "Alignment", kind: "select", values: ["left", "center", "right", "justify"] },
  { property: "display", label: "Layout", kind: "select", values: ["block", "flex", "grid", "inline-flex", "inline-grid"] },
  { property: "gap", label: "Gap", kind: "length", min: 0, max: 200 },
  { property: "padding", label: "Padding", kind: "length", min: 0, max: 200 },
  { property: "width", label: "Width", kind: "text", placeholder: "auto or 240px" },
  { property: "border-width", label: "Border", kind: "length", min: 0, max: 24 },
  { property: "border-style", label: "Border style", kind: "select", values: ["none", "solid", "dashed", "dotted"] },
  { property: "border-color", label: "Border color", kind: "color" },
  { property: "border-radius", label: "Corner radius", kind: "length", min: 0, max: 96 },
];

function toHex(value: string): string {
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  if (/^#[\da-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map((char) => char + char).join("")}`;
  const match = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!match) return "#000000";
  return `#${match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}

function cssSelector(element: Element): string {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && parts.length < 6) {
    const classes = [...current.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`).join("");
    const siblings = current.parentElement
      ? [...current.parentElement.children].filter((child) => child.tagName === current!.tagName)
      : [];
    parts.unshift(`${current.tagName.toLowerCase()}${classes}:nth-of-type(${siblings.indexOf(current) + 1})`);
    if (current.parentElement?.id) {
      parts.unshift(`#${CSS.escape(current.parentElement.id)}`);
      break;
    }
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function valueFor(field: Field, element: HTMLElement): string {
  const value = getComputedStyle(element).getPropertyValue(field.property).trim();
  if (field.kind === "color") return value || "transparent";
  if (field.kind === "length") {
    const match = value.match(/^(-?\d+(?:\.\d+)?)px$/);
    return match ? String(Number(match[1])) : "0";
  }
  return value;
}

function inputValue(field: Field, control: HTMLInputElement | HTMLSelectElement): string | null {
  const value = control.value.trim();
  if (field.kind === "color") {
    const style = document.createElement("span").style;
    style.color = value;
    return style.color ? value : null;
  }
  if (field.kind === "length") {
    if (!value) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < (field.min ?? -200) || number > (field.max ?? 1000)) return null;
    return `${number}px`;
  }
  if (field.property === "width" || field.property === "line-height") {
    if (!/^(auto|normal|(?:\d+(?:\.\d+)?)(?:px|%|vw|vh|rem|em)?)$/.test(value)) return null;
    return field.property === "width" && /^\d/.test(value) && !/[a-z%]/i.test(value) ? `${value}px` : value;
  }
  return value;
}

export function createDesignMode(options: DesignModeOptions) {
  const style = document.createElement("style");
  style.textContent = designModeStyles;
  const panel = document.createElement("aside");
  panel.className = "design-inspector";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Design mode inspector");
  panel.setAttribute("aria-hidden", "true");
  panel.hidden = true;
  const outline = document.createElement("div");
  outline.className = "design-outline";
  outline.setAttribute("aria-hidden", "true");
  const heading = document.createElement("div");
  heading.className = "design-inspector__heading";
  const mark = document.createElement("span");
  mark.className = "design-inspector__mark";
  mark.setAttribute("aria-hidden", "true");
  mark.append(icon("brush"));
  const title = document.createElement("div");
  title.className = "design-inspector__target";
  const subtitle = document.createElement("small");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "design-inspector__close";
  close.setAttribute("aria-label", "Exit design mode");
  close.textContent = "×";
  const identity = document.createElement("div");
  identity.className = "design-inspector__identity";
  const eyebrow = document.createElement("span");
  eyebrow.className = "design-inspector__eyebrow";
  eyebrow.textContent = "Design";
  identity.append(eyebrow, title, subtitle);
  heading.append(mark, identity, close);

  const controls = document.createElement("div");
  controls.className = "design-inspector__controls";
  const status = document.createElement("p");
  status.className = "design-inspector__status";
  status.textContent = "Preview only · resets on refresh";
  const actions = document.createElement("div");
  actions.className = "design-inspector__actions";
  const undo = document.createElement("button");
  undo.type = "button";
  undo.textContent = "Undo";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy CSS";
  const comment = document.createElement("button");
  comment.type = "button";
  comment.textContent = "Comment on element";
  actions.append(undo, reset, copy, comment);
  panel.append(heading, controls, status, actions);
  options.root.append(style, outline, panel);

  let active = false;
  let closeTimer = 0;
  let selected: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let frame = 0;
  const originals = new Map<HTMLElement, Map<string, Original>>();
  const changed = new Map<HTMLElement, Map<string, string>>();
  const history: Edit[] = [];
  const starts = new WeakMap<HTMLInputElement | HTMLSelectElement, Original>();
  const pending = new WeakMap<HTMLInputElement | HTMLSelectElement, Edit>();
  const listeners = new AbortController();
  const collapsed = new Set<string>(["Layout", "Border"]);

  function setProperty(element: HTMLElement, property: string, value: string) {
    element.style.setProperty(property, value);
  }
  function remember(element: HTMLElement, property: string) {
    let values = originals.get(element);
    if (!values) originals.set(element, (values = new Map()));
    if (!values.has(property)) values.set(property, {
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    });
  }
  function preview(field: Field, control: HTMLInputElement | HTMLSelectElement) {
    if (!selected) return;
    const value = inputValue(field, control);
    control.setAttribute("aria-invalid", String(value === null));
    if (value === null) return;
    remember(selected, field.property);
    setProperty(selected, field.property, value);
    const original = originals.get(selected)?.get(field.property);
    if (original?.priority) selected.style.setProperty(field.property, value, original.priority);
    let properties = changed.get(selected);
    if (!properties) changed.set(selected, (properties = new Map()));
    properties.set(field.property, value);
    outlineFor(selected, "selected");
    updateActions();
  }
  function commit(field: Field, control: HTMLInputElement | HTMLSelectElement, final = true) {
    if (!selected) return;
    const after = {
      value: selected.style.getPropertyValue(field.property),
      priority: selected.style.getPropertyPriority(field.property),
    };
    const edit = pending.get(control);
    const before = edit?.before ?? starts.get(control) ?? { value: "", priority: "" };
    if (after.value === before.value && after.priority === before.priority) {
      if (edit) history.splice(history.indexOf(edit), 1);
      pending.delete(control);
    } else if (edit) edit.after = after;
    else {
      const next = { element: selected, property: field.property, before, after };
      history.push(next);
      pending.set(control, next);
    }
    if (final) {
      starts.set(control, after);
      pending.delete(control);
    }
    updateActions();
  }
  function fieldControl(field: Field, element: HTMLElement) {
    const label = document.createElement("label");
    label.className = "design-field";
    const caption = document.createElement("span");
    caption.textContent = field.label;
    const control = field.kind === "select"
      ? document.createElement("select")
      : document.createElement("input");
    if (control instanceof HTMLSelectElement) {
      for (const value of field.values ?? []) {
        const option = document.createElement("option");
        option.value = option.textContent = value;
        control.append(option);
      }
    } else if (field.kind === "color") {
      control.type = "text";
      control.autocomplete = "off";
      control.spellcheck = false;
    } else if (field.kind === "length") {
      control.type = "number";
      control.min = String(field.min ?? 0);
      control.max = String(field.max ?? 1000);
      control.step = String(field.step ?? 1);
      control.setAttribute("inputmode", "decimal");
      control.title = `${field.label} in pixels`;
    } else {
      control.type = "text";
      control.placeholder = field.placeholder ?? "";
      control.autocomplete = "off";
      control.spellcheck = false;
    }
    control.dataset.property = field.property;
    control.setAttribute("aria-label", field.label);
    control.value = valueFor(field, element);
    if (control instanceof HTMLSelectElement && !control.value) {
      const current = document.createElement("option");
      current.value = current.textContent = valueFor(field, element);
      control.prepend(current);
      control.value = current.value;
    }
    const start = () => starts.set(control, {
      value: element.style.getPropertyValue(field.property),
      priority: element.style.getPropertyPriority(field.property),
    });
    control.addEventListener("focus", start);
    control.addEventListener("input", () => {
      preview(field, control);
      commit(field, control, false);
    });
    control.addEventListener("change", () => commit(field, control));
    label.append(caption);
    if (field.kind === "length" || field.kind === "color") {
      const dial = document.createElement("input");
      dial.type = field.kind === "length" ? "range" : "color";
      dial.setAttribute("aria-label", `${field.label} ${field.kind === "length" ? "slider" : "picker"}`);
      dial.min = String(field.min ?? 0);
      dial.max = String(field.max ?? 1000);
      dial.step = String(field.step ?? 1);
      dial.value = field.kind === "color" ? toHex(control.value) : control.value;
      const sync = () => {
        dial.value = field.kind === "color" ? toHex(control.value) : control.value;
        if (field.kind === "length") {
          const fill = (Number(dial.value) - Number(dial.min)) / (Number(dial.max) - Number(dial.min));
          dial.style.setProperty("--fill", `${fill * 100}%`);
          dial.setAttribute("aria-valuetext", `${dial.value} pixels`);
        }
      };
      sync();
      dial.addEventListener("pointerdown", start);
      dial.addEventListener("focus", start);
      dial.addEventListener("input", () => {
        control.value = dial.value;
        preview(field, control);
        commit(field, control, false);
        sync();
      });
      dial.addEventListener("change", () => commit(field, control));
      control.addEventListener("input", sync);
      control.addEventListener("keydown", (event) => {
        if (event instanceof KeyboardEvent && event.key === "Enter") control.blur();
      });
      label.append(dial);
      label.classList.add(field.kind === "length" ? "design-field--dial" : "design-field--color");
    }
    label.append(control);
    return label;
  }
  function renderControls() {
    controls.replaceChildren();
    if (!selected) {
      const empty = document.createElement("p");
      empty.className = "design-inspector__empty";
      empty.textContent = "Hover and click an element, or Tab to it and press Enter, to edit its preview styles.";
      controls.append(empty);
      title.textContent = "Nothing selected";
      subtitle.textContent = "Click a page element";
      return;
    }
    const identity = `${selected.tagName.toLowerCase()}${selected.id ? `#${selected.id}` : ""}`;
    title.textContent = identity;
    subtitle.textContent = selected instanceof HTMLIFrameElement
      ? "Frame only · contents are isolated"
      : (selected.classList.length ? `.${[...selected.classList].slice(0, 2).join(".")}` : "Live page preview");
    for (const [name, start, end] of [
      ["Color", 0, 2], ["Typography", 2, 6], ["Layout", 6, 10], ["Border", 10, 14],
    ] as const) {
      const group = document.createElement("details");
      group.className = "design-group";
      group.open = !collapsed.has(name);
      const summary = document.createElement("summary");
      summary.textContent = name;
      group.append(summary);
      for (const field of fields.slice(start, end)) group.append(fieldControl(field, selected));
      group.addEventListener("toggle", () => {
        if (!group.isConnected) return;
        if (group.open) collapsed.delete(name);
        else collapsed.add(name);
      });
      controls.append(group);
    }
  }
  function outlineFor(element: HTMLElement | null, kind: "hover" | "selected") {
    if (!active || !element?.isConnected) {
      outline.hidden = true;
      return;
    }
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      outline.hidden = true;
      return;
    }
    outline.hidden = false;
    outline.dataset.kind = kind;
    Object.assign(outline.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }
  function scheduleOutline() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      outlineFor(selected ?? hovered, selected ? "selected" : "hover");
    });
  }
  function select(element: Element | null) {
    if (!(element instanceof HTMLElement) || element === options.host || options.host.contains(element)) return;
    selected = element;
    hovered = element;
    renderControls();
    outlineFor(element, "selected");
    updateActions();
  }
  function updateActions() {
    undo.disabled = history.length === 0;
    reset.disabled = !selected || !(changed.get(selected)?.size);
    copy.disabled = !selected || !(changed.get(selected)?.size);
    comment.disabled = !selected;
  }
  function onMove(event: PointerEvent) {
    if (!active || event.composedPath().includes(options.host)) return;
    const element = options.targetAt(event.clientX, event.clientY);
    if (!(element instanceof HTMLElement) || element === options.host || options.host.contains(element)) return;
    hovered = element;
    if (!selected) outlineFor(hovered, "hover");
  }
  function onDown(event: PointerEvent) {
    if (!active || event.composedPath().includes(options.host)) return;
    const element = options.targetAt(event.clientX, event.clientY);
    if (!(element instanceof HTMLElement) || element === options.host || options.host.contains(element)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    select(element);
  }
  function onClick(event: MouseEvent) {
    if (!active || event.composedPath().includes(options.host)) return;
    // Cancelling pointerdown alone does not cancel a link's click navigation.
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function onKey(event: KeyboardEvent) {
    if (active && (event.key === "Enter" || event.key === " ") && !event.composedPath().includes(options.host)) {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== document.body && focused !== document.documentElement) {
        event.preventDefault();
        event.stopImmediatePropagation();
        select(focused);
        return;
      }
    }
    if (active && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      setActive(false);
      options.onExit();
    }
  }
  function setActive(value: boolean) {
    window.clearTimeout(closeTimer);
    closeTimer = 0;
    active = value;
    if (value) {
      panel.hidden = false;
      panel.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => {
        if (active) panel.dataset.state = "active";
      });
      outline.hidden = !selected;
      renderControls();
      outlineFor(selected, "selected");
      close.focus({ preventScroll: true });
    } else {
      outline.hidden = true;
      panel.setAttribute("aria-hidden", "true");
      panel.dataset.state = "closing";
      if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
        panel.hidden = true;
        delete panel.dataset.state;
      } else {
        closeTimer = window.setTimeout(() => {
          closeTimer = 0;
          if (!active) {
            panel.hidden = true;
            delete panel.dataset.state;
          }
        }, 250);
      }
    }
  }

  close.addEventListener("click", () => {
    setActive(false);
    options.onExit();
  });
  undo.addEventListener("click", () => {
    const edit = history.pop();
    if (!edit) return;
    if (edit.before.value) edit.element.style.setProperty(edit.property, edit.before.value, edit.before.priority);
    else edit.element.style.removeProperty(edit.property);
    const values = changed.get(edit.element);
    const original = originals.get(edit.element)?.get(edit.property);
    if (edit.before.value === (original?.value ?? "") && edit.before.priority === (original?.priority ?? "")) values?.delete(edit.property);
    else values?.set(edit.property, edit.before.value);
    if (!values?.size) changed.delete(edit.element);
    if (selected === edit.element) renderControls();
    outlineFor(selected ?? hovered, selected ? "selected" : "hover");
    updateActions();
    (undo.disabled ? close : undo).focus({ preventScroll: true });
  });
  reset.addEventListener("click", () => {
    if (!selected) return;
    const values = changed.get(selected);
    if (!values) return;
    for (const property of values.keys()) {
      const original = originals.get(selected)?.get(property);
      if (original?.value) selected.style.setProperty(property, original.value, original.priority);
      else selected.style.removeProperty(property);
    }
    changed.delete(selected);
    for (let index = history.length - 1; index >= 0; index--)
      if (history[index].element === selected) history.splice(index, 1);
    renderControls();
    outlineFor(selected, "selected");
    updateActions();
    close.focus({ preventScroll: true });
  });
  copy.addEventListener("click", async () => {
    if (!selected) return;
    const values = changed.get(selected);
    if (!values?.size) return;
    const css = `${cssSelector(selected)} {\n${[...values].map(([property, value]) => `  ${property}: ${value};`).join("\n")}\n}`;
    try {
      await navigator.clipboard.writeText(css);
      status.textContent = "CSS copied · apply it in your site stylesheet";
    } catch {
      status.textContent = css;
    }
  });
  comment.addEventListener("click", () => {
    if (selected) options.onComment(selected);
  });
  document.addEventListener("pointermove", onMove, { capture: true, signal: listeners.signal });
  document.addEventListener("pointerdown", onDown, { capture: true, signal: listeners.signal });
  document.addEventListener("click", onClick, { capture: true, signal: listeners.signal });
  document.addEventListener("keydown", onKey, { capture: true, signal: listeners.signal });
  window.addEventListener("scroll", scheduleOutline, { capture: true, passive: true, signal: listeners.signal });
  window.addEventListener("resize", scheduleOutline, { passive: true, signal: listeners.signal });

  return {
    setActive,
    get active() { return active; },
    destroy() {
      window.clearTimeout(closeTimer);
      listeners.abort();
      cancelAnimationFrame(frame);
      for (const [element, properties] of originals) {
        for (const [property, original] of properties) {
          if (original.value) element.style.setProperty(property, original.value, original.priority);
          else element.style.removeProperty(property);
        }
      }
      panel.remove();
      outline.remove();
      style.remove();
    },
  };
}
