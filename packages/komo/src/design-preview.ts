import { isDesignTarget, type DesignTarget } from "./design-target.js";

export function removeEmptyStyle(element: DesignTarget) {
  if (element.style.length) return;
  // Flush SVG's pending style serialization before removing the attribute.
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
  const transition = animate ? [...properties].map(property => `${property} .3s cubic-bezier(.22,1,.36,1)`).join() : "none";
  element.style.setProperty("transition", transition, "important");
  const applied = element.style.getPropertyValue("transition");
  const restore = () => {
    transitions.delete(element);
    if (element.style.getPropertyValue("transition") !== applied || element.style.getPropertyPriority("transition") !== "important") return;
    if (value) element.style.setProperty("transition", value, priority);
    else element.style.removeProperty("transition");
    if (removeEmpty) removeEmptyStyle(element);
  };
  apply();
  if (animate) transitions.set(element, { restore, timer: window.setTimeout(restore, 320) });
  else {
    void getComputedStyle(element).color;
    restore();
  }
}
