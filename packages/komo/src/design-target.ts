export type DesignTarget = HTMLElement | SVGElement;

// Namespace checks, not instanceof: nodes from Frame's viewport iframe belong to another window.
const svg = (element: Element | null): element is SVGElement => element?.namespaceURI === "http://www.w3.org/2000/svg";

/** Elements Design mode can edit, from this page or Frame's viewport iframe. */
export function isDesignTarget(element: Element | null): element is DesignTarget {
  return svg(element) || element?.namespaceURI === "http://www.w3.org/1999/xhtml";
}

/** Icons pick as a whole unless the reviewer explicitly drills into a shape. */
export function pickDesignTarget(element: Element | null, precise = false): DesignTarget | null {
  if (!isDesignTarget(element)) return null;
  return !precise && svg(element) ? element.closest("svg") ?? element : element;
}
