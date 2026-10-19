import { isDesignTarget } from "./design-target.js";

export const popupStyles = `.komo-select,.komo-tokens{position:absolute;z-index:20;box-sizing:border-box;border-radius:10px;background:#232323;box-shadow:0 0 0 1px #ffffff14,0 12px 32px #0008;color:#d9d6d1;font-size:11px;font-weight:400;line-height:1.25;text-align:left;cursor:default;transform-origin:top;animation:komo-popup-in var(--duration-fast,250ms) var(--ease-smooth-out,cubic-bezier(.22,1,.36,1)) backwards}.komo-select[data-up],.komo-tokens[data-up]{transform-origin:bottom}@keyframes komo-popup-in{from{opacity:0;transform:scale(.97)}}@media (prefers-reduced-motion:reduce){.komo-select,.komo-tokens{animation:none}}`;

/** A transient declaration without changing bindings, proposals or history. */
export function previewStyle(element: Element, property: string, value: string): () => void {
  if (!isDesignTarget(element)) return () => {};
  const before = element.style.getPropertyValue(property);
  const priority = element.style.getPropertyPriority(property);
  element.style.setProperty(property, value, priority);
  return () => {
    if (before) element.style.setProperty(property, before, priority);
    else element.style.removeProperty(property);
  };
}

/** The nearest scrolling or clipping ancestor, bounded by the viewport. */
export function popupBounds(from: Element) {
  const view = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
  for (let node = from.parentElement; node; node = node.parentElement)
    if (/auto|scroll|hidden/.test(getComputedStyle(node).overflowY)) {
      const rect = node.getBoundingClientRect();
      return {
        top: Math.max(rect.top, 0), left: Math.max(rect.left, 0),
        bottom: Math.min(rect.bottom, view.bottom), right: Math.min(rect.right, view.right),
      };
    }
  return view;
}

/** Cancel before a Design transition and when a render replaces the trigger. */
export function watchPopup(trigger: HTMLElement, close: () => void, signal: AbortSignal) {
  const root = trigger.getRootNode();
  root.addEventListener("komo-preview-cancel", close, { signal });
  const observer = new MutationObserver(() => { if (!trigger.isConnected) close(); });
  observer.observe(document, { childList: true, subtree: true });
  if (root instanceof ShadowRoot) observer.observe(root, { childList: true, subtree: true });
  signal.addEventListener("abort", () => observer.disconnect(), { once: true });
}
