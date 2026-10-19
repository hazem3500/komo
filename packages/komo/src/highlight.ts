type Box = { left: number; top: number; right: number; bottom: number };

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
      /([\d.]+)px/g,
      (_, value) => `${+value * scale}px`,
    );
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
