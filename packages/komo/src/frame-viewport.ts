type Owner = {
  node?: HTMLElement;
  attribute: string | null;
  css: string;
  values: Map<string, [original: string, priority: string, applied: string]>;
};

const units = /(?<![\w.#-])(-?[\d.]+)[sld]?v(w|h|i|b|min|max)\b/g;
const inline = '[style*="vw"],[style*="vh"],[style*="vmin"],[style*="vmax"]';

/**
 * Resolve viewport units in page styles against an unscaled frame, the page's
 * viewport while it is framed. Accessible stylesheet rules and inline styles
 * are rewritten in place, keeping the cascade, and restored on release.
 */
export function createFrameViewport(skip: Element) {
  const owners = new Map<CSSStyleDeclaration, Owner>();
  let size: number[] | null = null;
  let rules = -1;
  let frame = 0;
  let pending: Set<Element> | null = null;
  let sheets = false;
  const convert = (value: string) =>
    value.includes("url(")
      ? value
      : value.replace(units, (_, amount: string, axis: string) => {
          const [width, height] = size!;
          const base =
            axis === "w" || axis === "i"
              ? width
              : axis === "h" || axis === "b"
                ? height
                : Math[axis as "min" | "max"](width, height);
          return `${(+amount * base) / 100}px`;
        });
  function touch(style: CSSStyleDeclaration, node?: HTMLElement) {
    let owner = owners.get(style);
    for (let index = 0; index < style.length; index++) {
      const name = style[index];
      const current = style.getPropertyValue(name);
      const value = owner?.values.get(name);
      const original = value && value[2] === current ? value[0] : current;
      const next = convert(original);
      if (next === original) {
        owner?.values.delete(name);
        continue;
      }
      if (next === current) continue;
      if (!owner)
        owners.set(
          style,
          (owner = {
            node,
            attribute: node?.getAttribute("style") ?? null,
            css: style.cssText,
            values: new Map(),
          }),
        );
      const priority = style.getPropertyPriority(name);
      style.setProperty(name, next, priority);
      owner.values.set(name, [original, priority, style.getPropertyValue(name)]);
    }
  }
  const visit = (list: CSSRuleList) => {
    for (const rule of list) {
      const { style, cssRules, styleSheet } = rule as CSSStyleRule &
        CSSImportRule;
      if (style) touch(style);
      if (cssRules) visit(cssRules);
      if (styleSheet) read(styleSheet, visit);
    }
  };
  const read = (sheet: CSSStyleSheet, use: (list: CSSRuleList) => void) => {
    try {
      use(sheet.cssRules);
    } catch {
      // Cross-origin stylesheets cannot be read or rewritten.
    }
  };
  const all = () => [
    ...document.styleSheets,
    ...(document.adoptedStyleSheets ?? []),
  ];
  const element = (node: Element) => {
    if (
      node !== skip &&
      node instanceof HTMLElement &&
      (owners.has(node.style) || node.matches(inline))
    )
      touch(node.style, node);
  };
  function scan(full: boolean) {
    if (!size) return;
    if (full) {
      for (const sheet of all()) read(sheet, visit);
      for (const node of [
        ...[...owners.values()].map((owner) => owner.node),
        ...document.querySelectorAll(inline),
      ])
        if (node) element(node);
    } else
      for (const node of pending ?? []) {
        element(node);
        for (const child of node.querySelectorAll(inline)) element(child);
      }
    pending = null;
    observer.takeRecords();
  }
  const observer = new MutationObserver((records) => {
    for (const { target, addedNodes } of records) {
      if (/^(STYLE|LINK)$/.test(target.nodeName)) sheets = true;
      for (const node of [target, ...addedNodes])
        if (node instanceof Element) {
          if (/^(STYLE|LINK)$/.test(node.nodeName)) sheets = true;
          (pending ??= new Set()).add(node);
        }
    }
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      scan(sheets);
      sheets = false;
    });
  });
  const loaded = (event: Event) => {
    if (event.target instanceof HTMLLinkElement) scan(true);
  };
  return {
    update(next: number[] | null) {
      if (!next) {
        if (!size) return;
        size = null;
        observer.disconnect();
        cancelAnimationFrame(frame);
        frame = 0;
        pending = null;
        document.removeEventListener("load", loaded, true);
        for (const [style, { node, attribute, css, values }] of owners) {
          for (const [name, [original, priority, applied]] of values)
            if (style.getPropertyValue(name) === applied)
              style.setProperty(name, original, priority);
          if (node && attribute !== null && style.cssText === css)
            node.setAttribute("style", attribute);
        }
        owners.clear();
        rules = -1;
        return;
      }
      if (!size) {
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["style"],
        });
        document.addEventListener("load", loaded, true);
      }
      // Script-inserted rules do not notify observers; their count does change.
      let count = 0;
      for (const sheet of all()) read(sheet, (list) => (count += list.length));
      if (size && size[0] === next[0] && size[1] === next[1] && count === rules)
        return;
      size = next;
      rules = count;
      scan(true);
    },
  };
}
