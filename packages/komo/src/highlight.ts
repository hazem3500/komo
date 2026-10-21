import { eachFrameDocument, isElement } from "./frame-target.js";

type Box = { left: number; top: number; right: number; bottom: number };
const visibleColor = (value: string) =>
  value && value !== "transparent" && !/(?:^rgba\([^)]*,|\/)\s*0(?:\.0+)?%?\s*\)$/.test(value);

/** Paint the full border shape before clipping, so cropped edges do not gain corners. */
export function drawHighlight(
  node: HTMLElement,
  rect: Box,
  element: Element | null,
  bounds: Box = { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
) {
  const left = Math.max(0, bounds.left, rect.left),
    top = Math.max(bounds.top, rect.top);
  const right = Math.min(bounds.right, rect.right),
    bottom = Math.min(bounds.bottom, rect.bottom);
  if (right <= left || bottom <= top) return false;
  let radius = "0px";
  if (element) {
    const css = getComputedStyle(element);
    let width = parseFloat(css.width);
    if (css.boxSizing !== "border-box")
      for (const key of [
        "paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth",
      ] as const)
        width += parseFloat(css[key]) || 0;
    if (!width || css.display === "inline")
      width = (element as HTMLElement).offsetWidth;
    const scale = width ? (rect.right - rect.left) / width : 1;
    // Percentages scale with the overlay box; only absolute lengths need scaling.
    radius = css.borderRadius.replace(
      /([+-]?[\d.]+(?:e[+-]?\d+)?)px/gi,
      (_, value) => `${+value * scale}px`,
    );
    const stroke = (prefix: string) =>
      !["none", "hidden"].includes(css.getPropertyValue(`${prefix}-style`)) &&
      parseFloat(css.getPropertyValue(`${prefix}-width`)) > 0 &&
      visibleColor(css.getPropertyValue(`${prefix}-color`));
    if (
      !/[1-9]/.test(radius) &&
      !visibleColor(css.backgroundColor) &&
      (!css.backgroundImage || css.backgroundImage === "none") &&
      !["border-top", "border-right", "border-bottom", "border-left", "outline"].some(stroke)
    ) radius = `${4 * scale}px`;
  }
  Object.assign(node.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.right - rect.left}px`,
    height: `${rect.bottom - rect.top}px`,
    borderRadius: radius,
    clipPath: `inset(${Math.max(bounds.top - rect.top, -4)}px ${Math.max(rect.right - bounds.right, -4)}px ${Math.max(rect.bottom - bounds.bottom, -4)}px ${Math.max(Math.max(0, bounds.left) - rect.left, -4)}px)`,
  });
  return true;
}

/** Follow style-only changes and live transitions, without observing feedback chrome. */
export function watchHighlight(host: HTMLElement, targets: () => Array<Element | null>, update: () => void, signal: AbortSignal, lost?: () => void) {
  if (signal.aborted) return;
  const view = host.ownerDocument.defaultView!;
  const sheets = "style,link[rel~=stylesheet]";
  const sheetTarget = (node: Node) => isElement(node)
    ? node.matches(sheets) || !!node.closest("style")
    : !!node.parentElement?.closest("style");
  let frame = 0;
  function schedule() {
    if (frame || signal.aborted || !targets().some(Boolean)) return;
    frame = view.requestAnimationFrame(() => {
      frame = 0;
      update();
      for (const target of targets())
        for (let node = target; node?.isConnected; node = node.parentElement)
          if (node.getAnimations?.().some(animation => animation.playState === "running")) {
            schedule();
            return;
          }
    });
  }
  const relevant = (node: Node) => node !== host && !host.contains(node) && targets().some(target =>
    target && (!target.isConnected || node.contains(target) || target.contains(node) || sheetTarget(node)),
  );
  // The page, and Frame's viewport iframe whenever it shows one.
  const watch = (document: Document, signal: AbortSignal) => {
    const observer = new MutationObserver(records => {
      if (!targets().some(Boolean)) return;
      const primary = targets()[0];
      if (primary && !primary.isConnected) lost?.();
      if (records.some(record => relevant(record.target) ||
        (record.type === "attributes" && record.attributeName === "rel" && record.target.nodeName === "LINK") ||
        // Head insertions/removals report the parent, not the stylesheet, as target.
        (record.type === "childList" && [...record.addedNodes, ...record.removedNodes].some(node =>
          isElement(node) && (node.matches(sheets) || node.querySelector(sheets)),
        )))) schedule();
    });
    observer.observe(document.documentElement, { attributes: true, childList: true, characterData: true, subtree: true });
    for (const type of ["transitionrun", "animationstart"])
      document.addEventListener(type, event => { if (isElement(event.target) && relevant(event.target)) schedule(); }, { capture: true, signal });
    document.addEventListener("load", event => { if (isElement(event.target) && sheetTarget(event.target)) schedule(); }, { capture: true, signal });
    signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  };
  watch(host.ownerDocument, signal);
  eachFrameDocument(watch, signal);
  signal.addEventListener("abort", () => view.cancelAnimationFrame(frame), { once: true });
}
