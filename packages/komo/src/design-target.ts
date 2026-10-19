export type DesignTarget = HTMLElement | SVGElement;

export function isDesignTarget(element: Element | null): element is DesignTarget {
  return element instanceof HTMLElement || element instanceof SVGElement;
}

/** Icons pick as a whole unless the reviewer explicitly drills into a shape. */
export function pickDesignTarget(element: Element | null, precise = false): DesignTarget | null {
  if (!isDesignTarget(element)) return null;
  return !precise && element instanceof SVGElement ? element.closest("svg") ?? element : element;
}
