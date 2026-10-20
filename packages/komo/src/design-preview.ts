import { isDesignTarget, type DesignTarget } from "./design-target.js";

export const previewMessage = "Runtime preview · Undo, Reset or reload to restore";

export type StyleOriginal = { value: string; priority: string; computed?: string; restore?(): void; bindingUndo?(): void };
export type StyleEdit = { kind: "style"; element: DesignTarget; property: string; before: StyleOriginal; after: StyleOriginal };

export function createStyleEdits(history: Array<StyleEdit | { element?: DesignTarget; kind?: string }>) {
  const starts = new WeakMap<Element, StyleOriginal>();
  const pending = new WeakMap<Element, StyleEdit>();
  return {
    begin(control: Element, value: StyleOriginal) { starts.set(control, value); },
    override(control: Element, undo?: () => void) {
      const before = starts.get(control);
      if (undo && before && !before.bindingUndo && !pending.has(control)) before.bindingUndo = undo;
    },
    commit(control: Element, element: DesignTarget, property: string, final: boolean) {
      const after = { value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) };
      const edit = pending.get(control);
      const before = edit?.before ?? starts.get(control) ?? { value: "", priority: "" };
      if (after.value === before.value && after.priority === before.priority && !before.bindingUndo) {
        if (edit) history.splice(history.indexOf(edit), 1);
        pending.delete(control);
      } else if (edit) edit.after = after;
      else {
        const next: StyleEdit = { kind: "style", element, property, before, after };
        history.push(next);
        pending.set(control, next);
      }
      if (final) { starts.set(control, after); pending.delete(control); }
    },
    cancel(control: Element, element: DesignTarget, property: string) {
      const edit = pending.get(control);
      if (edit) {
        restoreStyle(element, property, edit.before);
        edit.before.bindingUndo?.();
        history.splice(history.indexOf(edit), 1);
      }
      pending.delete(control);
      starts.delete(control);
    },
    isDirty(control: Element) { return pending.has(control); },
  };
}

export function restoreStyle(element: DesignTarget, property: string, original?: StyleOriginal) {
  if (original?.restore) original.restore();
  else element.style.setProperty(property, original?.value ?? "", original?.priority);
}

export function toHex(value: string): string {
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  if (/^#[\da-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map((char) => char + char).join("")}`;
  const match = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!match) return "#000000";
  return `#${match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}

export function validStyleValue(property: string, value: string): string | null {
  if (!value) return null;
  let quote = "", depth = 0, escaped = false;
  for (const character of value) {
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (quote) { if (character === quote) quote = ""; }
    else if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth++;
    else if (character === ")" && --depth < 0) return null;
  }
  if (quote || depth || escaped) return null;
  const style = document.createElement("span").style;
  style.setProperty(property, value);
  return style.getPropertyValue(property) ? value : null;
}

const afterTransition = new WeakMap<DesignTarget, Array<() => void>>();

/** Restore one declaration, retaining unrelated edits and the original shorthand when possible. */
export function inlineStyleSnapshot(element: DesignTarget, property: string) {
  const attribute = element.getAttribute("style");
  const css = element.style.cssText;
  const value = element.style.getPropertyValue(property);
  const priority = element.style.getPropertyPriority(property);
  const computed = getComputedStyle(element).getPropertyValue(property).trim();
  const without = (text: string) => {
    const style = element.ownerDocument.createElement("span").style;
    style.cssText = text;
    style.setProperty(property, "");
    return style.cssText;
  };
  const others = without(css);
  const snapshot = { value, priority, computed, absent: attribute === null, restore() {
    afterTransition.get(element)?.push(() => {
      if (element.style.getPropertyValue(property) === value && element.style.getPropertyPriority(property) === priority) snapshot.restore();
    });
    if (without(element.style.cssText) === others) {
      if (attribute === null) {
        // Flush pending CSSOM serialization before removing the attribute.
        element.getAttribute("style");
        element.removeAttribute("style");
      }
      else element.setAttribute("style", attribute);
    } else {
      element.style.setProperty(property, value, priority);
      if (attribute === null && !element.style.length) removeEmptyStyle(element);
    }
  } };
  return snapshot;
}

export function removeEmptyStyle(element: DesignTarget) {
  if (element.style.length) return;
  // Flush pending CSSOM serialization before removing the attribute.
  element.getAttribute("style");
  element.removeAttribute("style");
}

/** A transient declaration without changing bindings, proposals or history. */
export function previewStyle(element: Element, property: string, value: string): () => void {
  if (!isDesignTarget(element)) return () => {};
  const before = element.style.getPropertyValue(property);
  const priority = element.style.getPropertyPriority(property);
  const absent = !element.hasAttribute("style");
  element.style.setProperty(property, value, priority);
  return () => {
    if (before) element.style.setProperty(property, before, priority);
    else element.style.removeProperty(property);
    if (absent) removeEmptyStyle(element);
  };
}

const transitions = new WeakMap<DesignTarget, { timer: number; restore(): void }>();

/** Resume and reset immediately; explicit Before/After comparisons may animate. */
export function changePreviewStyles(element: DesignTarget, properties: Iterable<string>, apply: () => void, animate = false, removeEmpty = false) {
  const pending = transitions.get(element);
  if (pending) {
    clearTimeout(pending.timer);
    pending.restore();
  }
  const value = element.style.getPropertyValue("transition");
  const priority = element.style.getPropertyPriority("transition");
  const absent = !element.hasAttribute("style");
  const transition = animate ? [...properties].map(property => `${property} .3s cubic-bezier(.22,1,.36,1)`).join() : "none";
  element.style.setProperty("transition", transition, "important");
  const applied = element.style.getPropertyValue("transition");
  const settled: Array<() => void> = [];
  const restore = () => {
    transitions.delete(element);
    if (element.style.getPropertyValue("transition") !== applied || element.style.getPropertyPriority("transition") !== "important") return;
    if (value) element.style.setProperty("transition", value, priority);
    else element.style.removeProperty("transition");
    if (removeEmpty || absent) removeEmptyStyle(element);
    for (const finish of settled) finish();
  };
  afterTransition.set(element, settled);
  try { apply(); } finally { afterTransition.delete(element); }
  if (animate) transitions.set(element, { restore, timer: window.setTimeout(restore, 320) });
  else {
    void getComputedStyle(element).color;
    restore();
  }
}
