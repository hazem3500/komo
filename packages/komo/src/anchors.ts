import type { Anchor } from "./types.js";
import { pageDocument, pageWindow, screenRect, toScreen, toView } from "./frame-target.js";

const privateText =
  "input,textarea,select,script,style,[contenteditable],[hidden],[aria-hidden=true]";
const trim = (text: string, limit = 160) =>
  text.replace(/\s+/g, " ").trim().slice(0, limit);
function textFor(element: Element): string {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text = "",
    node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.parentElement?.closest(privateText))
      text += node.textContent + " ";
    if (text.length > 320) break;
  }
  return trim(text);
}
function unique(selector: string): Element | null {
  const matches = pageDocument().querySelectorAll(selector);
  return matches.length === 1 ? matches[0] : null;
}
// React useId (":r1:", "«r3»", "_r_15_") and Radix ids change between renders.
const generatedId = /^radix-|^:r|_r_|«r/;
function stableFor(element: Element, preferred?: string): string | undefined {
  for (const attr of [
    "data-comment-anchor",
    "id",
    "data-testid",
    "data-test",
    "data-cy",
  ]) {
    const value = element.getAttribute(attr);
    if (
      !value ||
      value.length > 500 ||
      (attr === "id" && generatedId.test(value))
    )
      continue;
    const selector =
      attr === "id"
        ? `#${CSS.escape(value)}`
        : `[${attr}="${CSS.escape(value)}"]`;
    if (
      selector.length <= 2000 &&
      (!preferred || selector === preferred) &&
      unique(selector) === element
    )
      return selector;
  }
}
function selectorFor(element: Element): string {
  const document = element.ownerDocument;
  const parts: string[] = [];
  let node: Element | null = element;
  while (node && node !== document.body && node !== document.documentElement) {
    const stable = stableFor(node);
    if (stable) {
      parts.unshift(stable);
      break;
    }
    const siblings = node.parentElement
      ? [...node.parentElement.children].filter(
          (sibling) => sibling.tagName === node!.tagName,
        )
      : [];
    const tag = node.tagName.toLowerCase();
    parts.unshift(siblings.length > 1
      ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})`
      : tag);
    node = node.parentElement;
  }
  if (node === document.body) parts.unshift("body");
  else if (node === document.documentElement) parts.unshift("html");
  return parts.join(" > ");
}
function labelFor(element: Element): string {
  return trim(
    element.getAttribute("aria-label") ||
      (element.getAttribute("aria-labelledby") || "")
        .split(/\s+/)
        .map((id) => {
          const label = id && element.ownerDocument.getElementById(id);
          return label ? textFor(label) : "";
        })
        .join(" ") ||
      element.getAttribute("alt") ||
      ((element as HTMLInputElement).labels &&
        [...(element as HTMLInputElement).labels!].map(textFor).join(" ")) ||
      "",
  );
}
function nearbyFor(element: Element): string {
  const document = element.ownerDocument;
  const parent =
    element.parentElement?.closest("li,article,tr,[data-comment-anchor]") ||
    element.parentElement;
  return parent &&
    parent !== document.body &&
    parent !== document.documentElement
    ? textFor(parent)
    : "";
}
const overlayBoundary = (element: Element) =>
  element.matches("dialog,[role=dialog],[role=alertdialog],[popover]") ||
  getComputedStyle(element).position === "fixed";
function contextFor(element: Element): NonNullable<Anchor["context"]> {
  const document = element.ownerDocument;
  let parent = overlayBoundary(element) ? null : element.parentElement,
    scope: string | undefined;
  while (parent && parent !== document.body) {
    scope = stableFor(parent);
    if (scope) break;
    if (overlayBoundary(parent)) {
      const selector = selectorFor(parent);
      if (selector.length <= 2000) scope = selector;
      break;
    }
    parent = parent.parentElement;
  }
  const selection = document.defaultView?.getSelection();
  const selected = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const style = getComputedStyle(element);
  return {
    tag:
      element.tagName.length <= 32 ? element.tagName.toLowerCase() : undefined,
    role: trim(element.getAttribute("role") || "", 80) || undefined,
    label: labelFor(element) || undefined,
    nearby: nearbyFor(element) || undefined,
    classes: trim(element.getAttribute("class") || "", 200) || undefined,
    styles: [
      "display",
      "width",
      "height",
      "font-size",
      "color",
      "padding",
      "gap",
    ]
      .map((key) => `${key}: ${style.getPropertyValue(key)}`)
      .join("; ")
      .slice(0, 500),
    selectedText:
      selected &&
      element.contains(selected.commonAncestorContainer) &&
      !element.closest(privateText) &&
      !element.querySelector(privateText)
        ? trim(selection!.toString(), 200) || undefined
        : undefined,
    scope,
  };
}
function matches(element: Element, anchor: Anchor): boolean {
  const context = anchor.context;
  if (!anchor.text && !context?.label && !context?.nearby) return false;
  return (
    (!anchor.text ||
      (context
        ? textFor(element) === trim(anchor.text)
        : trim(element.textContent || "").startsWith(trim(anchor.text)))) &&
    (!context ||
      ((!context.tag || element.tagName.toLowerCase() === context.tag) &&
        (!context.role || element.getAttribute("role") === context.role) &&
        (!context.label || labelFor(element) === context.label) &&
        (!context.nearby || nearbyFor(element) === context.nearby)))
  );
}
function related(saved: string, current: string): boolean {
  if (saved === current) return true;
  if (saved && current && (saved.startsWith(current) || current.startsWith(saved)))
    return true;
  const before = saved.toLowerCase().split(" ").filter(Boolean);
  const after = new Set(current.toLowerCase().split(" ").filter(Boolean));
  const shared = before.filter((word) => after.has(word)).length;
  return (2 * shared) / (before.length + after.size || 1) >= 0.6;
}
/** The stored selector still names the same kind of element; its text changed only slightly. */
function similar(element: Element, anchor: Anchor): boolean {
  const context = anchor.context;
  return (
    !!context?.tag &&
    element.tagName.toLowerCase() === context.tag &&
    (!context.role || element.getAttribute("role") === context.role) &&
    (!context.classes ||
      trim(element.getAttribute("class") || "", 200) === context.classes) &&
    related(trim(anchor.text), textFor(element)) &&
    (!context.nearby || related(context.nearby, nearbyFor(element)))
  );
}

/** Prefer a persistent comment owner without changing precise DOM anchor capture. */
export function commentAnchorTarget(
  element: Element,
  root: Element,
  resolve?: (element: Element) => Element | undefined,
): Element {
  const ancestors: Element[] = [];
  const document = element.ownerDocument;
  for (let node: Element | null = element; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (node !== root || node === element) ancestors.push(node);
    if (node === root || overlayBoundary(node)) break;
  }
  const custom = resolve?.(element);
  if (custom?.isConnected && ancestors.includes(custom)) return custom;
  const declared = ancestors.find(node => node.hasAttribute("data-comment-anchor") && stableFor(node));
  if (declared) return declared;
  return ancestors.slice(1).find(node =>
    node.matches("article,li,tr,[role=listitem],[role=row],[role=button],[role=link]") && stableFor(node),
  ) ?? element;
}
export function captureAnchor(
  element: Element,
  start: { x: number; y: number },
  end: { x: number; y: number },
  source?: string | ((element: Element) => string | undefined),
): Anchor {
  let target = element;
  const document = element.ownerDocument, view = document.defaultView ?? window;
  // Points arrive on screen; the anchor is in the page's own client pixels.
  [start, end] = [toView(start.x, start.y, view), toView(end.x, end.y, view)];
  const left = Math.min(start.x, end.x),
    top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x),
    bottom = Math.max(start.y, end.y);
  while (target.parentElement && target !== document.body) {
    const r = target.getBoundingClientRect();
    if (
      left >= r.left &&
      right <= r.right &&
      top >= r.top &&
      bottom <= r.bottom &&
      r.width &&
      r.height
    )
      break;
    target = target.parentElement;
  }
  const rect = target.getBoundingClientRect();
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const area = right - left > 6 || bottom - top > 6;
  const x = clamp((left - rect.left) / (rect.width || 1));
  const y = clamp((top - rect.top) / (rect.height || 1));
  return {
    selector: selectorFor(target),
    text: textFor(target),
    context: contextFor(target),
    x,
    y,
    width: area ? Math.min(1 - x, (right - left) / (rect.width || 1)) : 0,
    height: area ? Math.min(1 - y, (bottom - top) / (rect.height || 1)) : 0,
    pageX: left + view.scrollX,
    pageY: top + view.scrollY,
    viewportWidth: view.innerWidth,
    source:
      (typeof source === "function" ? source(target) : source) ??
      target
        .closest("[data-comment-source]")
        ?.getAttribute("data-comment-source") ??
      undefined,
  };
}
type Search = (
  scope: Element,
  anchor: Anchor,
  scoped: boolean,
) => Element[];
const search: Search = (scope, anchor, scoped) => {
  const candidates = [
    ...(scoped ? scope.querySelectorAll(anchor.context!.tag!) : scope.children),
  ].filter((candidate) => matches(candidate, anchor));
  return candidates;
};
export function resolveAnchor(
  anchor: Anchor,
  target?: Element | null,
  find: Search = search,
): Element | null {
  let element: Element | null = null;
  try {
    const found = anchor.selector ? unique(anchor.selector) : pageDocument().body;
    element = target?.isConnected && target === found ? target : found;
    if (element && stableFor(element, anchor.selector)) return element;
    if (element && !matches(element, anchor))
      return (
        findByContext(anchor, find) ??
        (similar(element, anchor) ? element : null)
      );
    if (element || !anchor.context?.scope) return element && confirm(element, anchor, find);
    element = findByContext(anchor, find);
  } catch {
    // Invalid legacy selectors or ambiguous/missing targets retain their fallback position.
    element = null;
  }
  return element;
}
/** Reject competing branches, while preserving the exact target among nested text wrappers. */
function confirm(element: Element, anchor: Anchor, find: Search) {
  const context = anchor.context;
  if (!context?.tag || !(anchor.text || context.label || context.nearby))
    return element;
  const scope = context.scope ? unique(context.scope) : null;
  const candidates = scope
    ? find(scope, anchor, true)
    : element.parentElement ? find(element.parentElement, anchor, false) : [];
  if (candidates.length === 1) return candidates[0];
  // Nested wrappers can share all their text; peer branches must remain ambiguous.
  return candidates.includes(element) && candidates.every((candidate) =>
    candidate.contains(element) || element.contains(candidate),
  ) ? element : null;
}
function findByContext(anchor: Anchor, find: Search) {
  const context = anchor.context;
  if (!context?.tag || !context.scope || !(anchor.text || context.label || context.nearby))
    return null;
  const scope = unique(context.scope);
  const candidates = scope ? find(scope, anchor, true) : [];
  return candidates.length === 1 ? candidates[0] : null;
}
export function locateAnchor(
  anchor: Anchor,
  target?: Element | null,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  attached: boolean;
  component?: { left: number; top: number; right: number; bottom: number };
} {
  return measure(anchor, resolveAnchor(anchor, target));
}
function measure(anchor: Anchor, element: Element | null) {
  if (element) {
    const rect = screenRect(element);
    if (rect.width && rect.height)
      return {
        x: rect.left + rect.width * anchor.x,
        y: rect.top + rect.height * anchor.y,
        width: rect.width * anchor.width,
        height: rect.height * anchor.height,
        attached: true,
        component: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
      };
  }
  const view = pageWindow();
  const point = toScreen({
    left: (anchor.pageX * view.innerWidth) / anchor.viewportWidth - view.scrollX,
    top: anchor.pageY - view.scrollY,
    width: 0,
    height: 0,
  }, view);
  return { x: point.left, y: point.top, width: 0, height: 0, attached: false };
}

/** Synchronous geometry-pass cache: discard before the DOM can change. */
export function anchorPass() {
  const resolved = new Map<Anchor, Element | null>();
  const measured = new Map<Anchor, ReturnType<typeof measure>>();
  const scopes = new WeakMap<
    Element,
    Map<string, Map<string, Element[]>>
  >();
  const identities = new WeakMap<Element, string[]>();
  const find: Search = (scope, anchor, scoped) => {
    const c = anchor.context!;
    const expected = [trim(anchor.text), c.tag, c.role, c.label, c.nearby];
    const key = JSON.stringify([scoped, c.tag, expected.map(Boolean)]);
    let indexes = scopes.get(scope);
    if (!indexes) scopes.set(scope, (indexes = new Map()));
    let index = indexes.get(key);
    const signature = (values: (string | undefined)[]) =>
      JSON.stringify(values.map((value, i) => (expected[i] ? value : null)));
    if (!index) {
      indexes.set(key, (index = new Map()));
      for (const element of scoped
        ? scope.querySelectorAll(c.tag!)
        : scope.children) {
        let identity = identities.get(element);
        if (!identity)
          identities.set(
            element,
            (identity = [
              textFor(element),
              element.tagName.toLowerCase(),
              element.getAttribute("role") || "",
              labelFor(element),
              nearbyFor(element),
            ]),
          );
        const value = signature(identity);
        const matches = index.get(value);
        if (matches) matches.push(element);
        else index.set(value, [element]);
      }
    }
    return index.get(signature(expected)) ?? [];
  };
  const resolve = (anchor: Anchor) => {
    if (!resolved.has(anchor))
      resolved.set(anchor, resolveAnchor(anchor, undefined, find));
    return resolved.get(anchor) ?? null;
  };
  return {
    resolve,
    locate(anchor: Anchor) {
      if (!measured.has(anchor))
        measured.set(anchor, measure(anchor, resolve(anchor)));
      return measured.get(anchor)!;
    },
  };
}
