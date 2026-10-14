/** On-demand formatting for Design mode's Copy CSS and comment proposal actions. */
export function cssSelector(element: Element): string {
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

export function cssText(element: Element, values: Map<string, string>): string {
  return `${cssSelector(element)} {\n${[...values].map(([property, value]) => `  ${property}: ${value};`).join("\n")}\n}`;
}

/**
 * One proposal for everything previewed on the element. Token-bound properties
 * are described by the token section, so they are not repeated as raw CSS.
 */
export function designProposal(
  element: Element,
  values: Map<string, string> | undefined,
  before: (property: string) => string | undefined,
  bound: Set<string> | undefined,
  sections: Array<string | undefined>,
): string | undefined {
  const rows = [...values ?? []].filter(([property]) => !bound?.has(property))
    .map(([property, value]) => `- ${property}: ${before(property) || "(unset)"} → ${value}`);
  return [
    rows.length ? `Proposed style changes (preview only)\nTarget: ${cssSelector(element)}\n${rows.join("\n")}` : "",
    ...sections,
  ].filter(Boolean).join("\n\n") || undefined;
}
