import { designModeStyles } from "./design-mode-styles.js";
import { icon } from "./dom.js";
import type { InlineTextTools } from "./inline-text-editor.js";

export interface DesignModeOptions {
  root: ShadowRoot;
  /** Shared Komo sidebar surface; the inspector rides its morph. Tests may omit it. */
  panelRoot?: HTMLElement;
  host: HTMLElement;
  targetAt(x: number, y: number): Element | null;
  onComment(element: Element, proposal?: string): void;
  onExit(): void;
}

type Edit = {
  kind: "style";
  element: HTMLElement;
  property: string;
  before: Original;
  after: Original;
};

type TextEdit = { kind: "text"; element: HTMLElement };

type Original = { value: string; priority: string; computed?: string };

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
  { property: "font-family", label: "Font family", kind: "text", placeholder: "system-ui, sans-serif" },
  { property: "font-size", label: "Font size", kind: "length", min: 1, max: 160 },
  { property: "font-weight", label: "Weight", kind: "select", values: ["300", "400", "500", "600", "700", "800"] },
  { property: "line-height", label: "Line height", kind: "text", placeholder: "1.4 or 24px" },
  { property: "text-align", label: "Alignment", kind: "select", values: ["left", "center", "right", "justify"] },
  { property: "display", label: "Layout", kind: "select", values: ["block", "flex", "grid", "inline-flex", "inline-grid"] },
  { property: "gap", label: "Gap", kind: "length", min: 0, max: 200 },
  { property: "padding", label: "Padding", kind: "length", min: 0, max: 200 },
  { property: "margin", label: "Margin", kind: "length", min: 0, max: 200 },
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
  close.append(icon("close"));
  // Compact screens only: fold the sheet so page elements under it stay reachable.
  const fold = document.createElement("button");
  fold.type = "button";
  fold.className = "design-inspector__fold";
  fold.append(icon("chevron"));
  const identity = document.createElement("div");
  identity.className = "design-inspector__identity";
  const eyebrow = document.createElement("span");
  eyebrow.className = "design-inspector__eyebrow";
  eyebrow.textContent = "Design";
  identity.append(eyebrow, title, subtitle);
  heading.append(mark, identity, fold, close);

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
  const editText = document.createElement("button");
  editText.type = "button";
  editText.textContent = "Edit text";
  editText.setAttribute("aria-label", "Edit selected text inline");
  actions.append(undo, reset, copy, editText, comment);
  panel.append(heading, controls, status, actions);
  options.root.append(style, outline);
  (options.panelRoot ?? options.root).append(panel);

  let active = false;
  let closeTimer = 0;
  let selected: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let textTools: InlineTextTools | null = null;
  let frame = 0;
  let reactPanelModule: typeof import("./react-props-panel.js") | null = null;
  let reactPanelPromise: Promise<typeof import("./react-props-panel.js")> | null = null;
  const originals = new Map<HTMLElement, Map<string, Original>>();
  const changed = new Map<HTMLElement, Map<string, string>>();
  const starts = new WeakMap<HTMLInputElement | HTMLSelectElement, Original>();
  const pending = new WeakMap<HTMLInputElement | HTMLSelectElement, Edit>();
  const listeners = new AbortController();
  const collapsed = new Set<string>(["Layout", "Border"]);
  const history: Array<Edit | TextEdit> = [];

  function remember(element: HTMLElement, property: string, value = element.style.getPropertyValue(property), priority = element.style.getPropertyPriority(property)) {
    let values = originals.get(element);
    if (!values) originals.set(element, (values = new Map()));
    if (!values.has(property)) values.set(property, { value, priority, computed: getComputedStyle(element).getPropertyValue(property).trim() });
  }
  function track(element: HTMLElement, property: string) {
    let values = changed.get(element);
    if (!values) changed.set(element, (values = new Map()));
    const value = element.style.getPropertyValue(property);
    if (value === (originals.get(element)?.get(property)?.value ?? "")) values.delete(property);
    else values.set(property, value);
    if (!values.size) changed.delete(element);
    outlineFor(selected, "selected");
  }
  function restore(element: HTMLElement, property: string, original?: Original) {
    if (original?.value) element.style.setProperty(property, original.value, original.priority);
    else element.style.removeProperty(property);
  }
  function preview(field: Field, control: HTMLInputElement | HTMLSelectElement) {
    if (!selected) return;
    const value = inputValue(field, control);
    control.setAttribute("aria-invalid", String(value === null));
    if (value === null) return;
    remember(selected, field.property);
    // Record token provenance before the override hides the page's own reference.
    reactPanelModule?.noteDesignTokenOverride(selected, field.property, value);
    selected.style.setProperty(field.property, value, originals.get(selected)?.get(field.property)?.priority);
    track(selected, field.property);
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
      const next: Edit = { kind: "style", element: selected, property: field.property, before, after };
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
    label.dataset.fieldProperty = field.property;
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
      empty.textContent = "Select an element to preview styles. Leaf text can be edited inline.";
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
    for (const [name, properties] of [
      ["Color", ["color", "background-color"]],
      ["Typography", ["font-family", "font-size", "font-weight", "line-height", "text-align"]],
      ["Layout", ["display", "gap", "padding", "margin", "width"]],
      ["Border", ["border-width", "border-style", "border-color", "border-radius"]],
    ] as const) {
      const group = document.createElement("details");
      group.className = "design-group";
      group.open = !collapsed.has(name);
      const summary = document.createElement("summary");
      summary.textContent = name;
      group.append(summary);
      for (const field of fields.filter((item) => (properties as readonly string[]).includes(item.property)))
        group.append(fieldControl(field, selected));
      group.addEventListener("toggle", () => {
        if (!group.isConnected) return;
        if (group.open) collapsed.delete(name);
        else collapsed.add(name);
      });
      controls.append(group);
    }
    const element = selected;
    if (element?.closest("[data-komo-inspectable], [data-komo-design-tokens]")) {
      reactPanelPromise ??= import("./react-props-panel.js").then((module) => reactPanelModule = module).catch((error: unknown) => {
        reactPanelPromise = null;
        throw error;
      });
      void reactPanelPromise.then((module) => {
        if (!active || selected !== element || controls.querySelector(".design-react-group, .design-theme-group")) return;
        const styleRoot = options.root;
        const panel = module.createReactPropsPanel(element, () => {
          status.textContent = "React state preview · resets on refresh";
          updateActions();
        }, styleRoot);
        if (panel) controls.append(panel);
        module.attachStyleTokenControls(element, fields, controls, (field, input, before) => {
          remember(element, field.property, before);
          track(element, field.property);
          starts.set(input, { value: before, priority: element.style.getPropertyPriority(field.property) });
          commit(field, input);
        }, styleRoot, valueFor, toHex);
        const theme = module.createDesignThemePanel(element, updateActions, styleRoot);
        if (theme) controls.append(theme);
      }).catch(() => {});
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
    if (!(element instanceof HTMLElement) || options.host.contains(element)) return;
    if (textTools?.element && textTools.element !== element) finishTextEdit();
    selected = element;
    hovered = element;
    renderControls();
    outlineFor(element, "selected");
    updateActions();
  }
  function compact() {
    return typeof matchMedia === "function" && matchMedia("(max-width:520px)").matches;
  }
  function setFolded(value: boolean) {
    panel.toggleAttribute("data-folded", value && compact());
    fold.setAttribute("aria-expanded", String(!panel.hasAttribute("data-folded")));
    fold.setAttribute("aria-label", panel.hasAttribute("data-folded") ? "Expand inspector" : "Collapse inspector");
  }
  /** On compact screens the inspector is a bottom sheet; keep the selection above it. */
  function reveal(element: HTMLElement) {
    setFolded(false);
    if (!compact()) return;
    requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect();
      const limit = panel.getBoundingClientRect().top - 12;
      if (rect.top >= 12 && rect.bottom <= limit) return;
      window.scrollBy({
        top: rect.top - Math.max(12, (limit - rect.height) / 2),
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
  }
  function updateActions() {
    undo.disabled = history.length === 0 && !(selected && reactPanelModule?.canUndoReactProp(selected)) && !(selected && reactPanelModule?.canUndoDesignTokenEdit(selected));
    reset.disabled = !selected || !(changed.get(selected)?.size) && !textTools?.hasChanges(selected) && !(reactPanelModule?.hasReactPropChanges(selected)) && !(reactPanelModule?.hasDesignTokenEdit(selected));
    copy.disabled = !selected || !(changed.get(selected)?.size);
    comment.disabled = !selected;
    // Nested markup is never editable; the editor checks privacy and interactivity on use.
    editText.disabled = !!textTools?.busy || !selected?.isConnected || selected.childElementCount > 0;
    editText.textContent = textTools?.isEditing(selected) ? "Done editing" : "Edit text";
    editText.setAttribute("aria-label", textTools?.isEditing(selected) ? "Finish inline text editing" : "Edit selected text inline");
  }
  function finishTextEdit(cancel = false) {
    textTools?.finish(cancel);
    updateActions();
  }
  editText.addEventListener("click", () => {
    if (textTools) return;
    if (!selected) return;
    status.textContent = "Loading inline text editor…";
    void import("./inline-text-editor.js").then((module) => {
      if (textTools || !selected || !active) return;
      textTools = module.bindInlineTextTools({
        button: editText,
        status,
        selected: () => selected,
        active: () => active,
        onChange: updateActions,
        onCommit(result) {
          history.push({ kind: "text", element: result });
        },
      });
      void textTools.toggle();
    }).catch(() => { status.textContent = "Inline text editing is unavailable."; });
  });
  function onMove(event: PointerEvent) {
    if (!active || event.composedPath().includes(options.host)) return;
    const element = options.targetAt(event.clientX, event.clientY);
    if (!(element instanceof HTMLElement) || options.host.contains(element)) return;
    hovered = element;
    if (!selected) outlineFor(hovered, "hover");
  }
  function onDown(event: PointerEvent) {
    if (!active || event.composedPath().includes(options.host)) return;
    const element = options.targetAt(event.clientX, event.clientY);
    if (!(element instanceof HTMLElement) || options.host.contains(element)) return;
    if (textTools?.element && (element === textTools.element || textTools.element.contains(element))) return;
    if (textTools?.element) finishTextEdit();
    event.preventDefault();
    event.stopImmediatePropagation();
    select(element);
  }
  function onClick(event: MouseEvent) {
    if (!active || event.composedPath().includes(options.host)) return;
    // Cancelling pointerdown alone does not cancel a link's click navigation.
    event.preventDefault();
    event.stopImmediatePropagation();
    // Unfold and scroll only once the tap has finished, so the sheet never lands under the finger.
    if (selected) reveal(selected);
  }
  function onKey(event: KeyboardEvent) {
    if (textTools?.handleKey(event)) {
      editText.focus({ preventScroll: true });
      return;
    }
    if (active && !textTools?.element && (event.key === "Enter" || event.key === " ") && !event.composedPath().includes(options.host)) {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== document.body && focused !== document.documentElement) {
        event.preventDefault();
        event.stopImmediatePropagation();
        select(focused);
        reveal(focused);
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
    if (!value && textTools?.element) finishTextEdit();
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
      setFolded(!selected);
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

  fold.addEventListener("click", () => setFolded(!panel.hasAttribute("data-folded")));
  close.addEventListener("click", () => {
    if (textTools?.element) finishTextEdit();
    setActive(false);
    options.onExit();
  });
  undo.addEventListener("click", () => {
    const edit = history.pop();
    if (!edit) {
      if (selected) {
        reactPanelModule?.undoDesignTokenEdit(selected);
        reactPanelModule?.undoReactProp(selected);
        renderControls();
      }
      status.textContent = "React state preview · resets on refresh";
    } else if (edit.kind === "text") {
      if (selected === (textTools?.undo() ?? edit.element)) renderControls();
    } else {
      restore(edit.element, edit.property, edit.before);
      reactPanelModule?.syncDesignTokenBinding(edit.element, edit.property);
      track(edit.element, edit.property);
      if (selected === edit.element) renderControls();
      outlineFor(selected ?? hovered, selected ? "selected" : "hover");
    }
    updateActions();
    (undo.disabled ? close : undo).focus({ preventScroll: true });
  });
  reset.addEventListener("click", () => {
    if (!selected) return;
    if (textTools?.isEditing(selected)) finishTextEdit(true);
    const values = changed.get(selected);
    const hasTextValue = textTools?.hasChanges(selected) ?? false;
    const hasReactValues = reactPanelModule?.hasReactPropChanges(selected) ?? false;
    const hasTokenValues = reactPanelModule?.hasDesignTokenEdit(selected) ?? false;
    if (!values?.size && !hasTextValue && !hasReactValues && !hasTokenValues) return;
    if (hasTextValue) textTools?.reset(selected);
    for (const property of values?.keys() ?? []) restore(selected, property, originals.get(selected)?.get(property));
    changed.delete(selected);
    if (hasReactValues) reactPanelModule?.resetReactProps(selected);
    if (hasTokenValues) reactPanelModule?.resetDesignTokenEdits(selected);
    for (let index = history.length - 1; index >= 0; index--)
      if (history[index].element === selected) history.splice(index, 1);
    renderControls();
    outlineFor(selected, "selected");
    updateActions();
    close.focus({ preventScroll: true });
  });
  const exporter = () => import("./design-export.js");
  copy.addEventListener("click", () => {
    const element = selected;
    const values = element ? changed.get(element) : undefined;
    if (!element || !values?.size) return;
    void exporter().then(async ({ cssText }) => {
      const css = cssText(element, values);
      try {
        await navigator.clipboard.writeText(css);
        status.textContent = "CSS copied · apply it in your site stylesheet";
      } catch {
        status.textContent = css;
      }
    });
  });
  comment.addEventListener("click", () => {
    const element = selected;
    if (!element) return;
    if (textTools?.isEditing(element)) finishTextEdit();
    void exporter().then(({ designProposal }) => options.onComment(element, designProposal(
      element,
      changed.get(element),
      (property) => originals.get(element)?.get(property)?.computed,
      reactPanelModule?.tokenBoundProperties(element),
      [textTools?.proposal(element), reactPanelModule?.proposedDesignChanges(element)],
    )), () => { status.textContent = "Comment unavailable · try again"; });
  });
  document.addEventListener("pointermove", onMove, { capture: true, signal: listeners.signal });
  document.addEventListener("pointerdown", onDown, { capture: true, signal: listeners.signal });
  document.addEventListener("click", onClick, { capture: true, signal: listeners.signal });
  document.addEventListener("keydown", onKey, { capture: true, signal: listeners.signal });
  window.addEventListener("scroll", scheduleOutline, { capture: true, passive: true, signal: listeners.signal });
  window.addEventListener("resize", scheduleOutline, { passive: true, signal: listeners.signal });

  return {
    setActive,
    mountPanel(parent: HTMLElement) {
      if (panel.parentElement !== parent) parent.append(panel);
    },
    get active() { return active; },
    destroy() {
      if (textTools?.element) finishTextEdit(true);
      window.clearTimeout(closeTimer);
      listeners.abort();
      cancelAnimationFrame(frame);
      for (const [element, properties] of originals)
        for (const [property, original] of properties) restore(element, property, original);
      textTools?.restoreAll();
      panel.remove();
      outline.remove();
      style.remove();
    },
  };
}
