import { el } from "./dom.js";

/** On-demand helpers for Design mode's footer: Copy CSS, comment proposals and tool tooltips. */
/**
 * A selector that matches exactly `element`: a path of :nth-of-type steps from
 * body or the nearest unique, non-generated id. Utility classes alone match
 * dozens of elements in Tailwind apps, so they only label the last step.
 */
export function cssSelector(element: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    // React useId and Radix ids change between renders, as in anchors.ts.
    const id = node.id && !/^radix-|^:r|_r_|«r/.test(node.id) ? `#${CSS.escape(node.id)}` : "";
    if (id && document.querySelectorAll(id).length === 1) return [id, ...parts].join(" > ");
    if (node === document.body || !node.parentElement) return [node.tagName.toLowerCase(), ...parts].join(" > ");
    const classes = node === element ? [...node.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`).join("") : "";
    const index = [...node.parentElement.children].filter((child) => child.tagName === node!.tagName).indexOf(node) + 1;
    parts.unshift(`${node.tagName.toLowerCase()}${classes}:nth-of-type(${index})`);
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

/**
 * Footer controls use the toolbar's tooltip surface, like the Comments header.
 * Loaded on the bar's first hover or focus, which `first` replays.
 */
export function footerTips(bar: HTMLElement, root: ShadowRoot, signal: AbortSignal, first: Event) {
  if (signal.aborted) return;
  const tip = el("div", "morphing-menu__tooltip sidebar-tooltip");
  tip.setAttribute("aria-hidden", "true");
  root.append(tip);
  let timer = 0;
  const hide = () => {
    clearTimeout(timer);
    delete tip.dataset.open;
  };
  const show = (event: Event) => {
    const button = (event.target as Element).closest?.<HTMLElement>("[data-tip]");
    if (!button || (event.type === "focusin" && !button.matches(":focus-visible"))) return hide();
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!button.isConnected) return;
      const box = button.getBoundingClientRect();
      tip.textContent = button.dataset.tip ?? "";
      const half = tip.offsetWidth / 2;
      tip.style.left = `${Math.max(8 + half, Math.min(document.documentElement.clientWidth - 8 - half, box.left + box.width / 2))}px`;
      tip.style.top = `${box.top - 8 - tip.offsetHeight}px`;
      tip.dataset.open = "true";
    }, tip.dataset.open ? 0 : 400);
  };
  bar.addEventListener("pointerover", show, { signal });
  bar.addEventListener("focusin", show, { signal });
  for (const type of ["pointerleave", "pointerdown", "focusout"]) bar.addEventListener(type, hide, { signal });
  signal.addEventListener("abort", () => {
    hide();
    tip.remove();
  });
  // The pointer may have left while this chunk loaded.
  if (first.type === "focusin" || bar.matches(":hover")) show(first);
}
