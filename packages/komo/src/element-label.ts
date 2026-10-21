const ROLES: Record<string, string> = {
  h: "Heading", a: "Link", button: "Button", img: "Image", p: "Paragraph", li: "List item", input: "Field", textarea: "Field",
};

/**
 * What a reviewer calls an element: its role and accessible name or short
 * text ("Heading “Plan”"), else the bare tag. `text` overrides the name.
 */
export function elementLabel(element: Element | null, tag = element?.localName ?? "", text?: string): string {
  const role = element?.getAttribute("role");
  const kind = role ? `${role[0].toUpperCase()}${role.slice(1)}` : ROLES[/^h[1-6]$/.test(tag) ? "h" : tag];
  const raw = (text ?? element?.getAttribute("aria-label") ?? element?.getAttribute("alt") ?? element?.textContent ?? "").replace(/\s+/g, " ").trim();
  const name = raw.length > 28 ? `${raw.slice(0, 27)}…` : raw;
  return [kind, name && `“${name}”`].filter(Boolean).join(" ") || tag || "Element";
}
