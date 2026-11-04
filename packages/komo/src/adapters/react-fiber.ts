// Opt-in component adapter that discovers React components from a picked DOM element.
//
//   import { discoverReactComponents } from "@hazem3500/komo/adapters/react-fiber";
//   initKomo({ design: { components: discoverReactComponents() } });
//
// WARNING: this reads React's private fields (`__reactFiber$*` on DOM nodes, `fiber.return`,
// `memoizedProps`, `_debugSource`, `_debugStack`, and the DevTools hook's renderers). They are
// not a public API and can change in any React release; every access is guarded, and anything
// unexpected yields "no component" rather than an error. komo's core never reads them, so this
// entry point is outside the core bundle and off unless an app installs it.
//
// Primitive props are read for comment context without invoking getters or callbacks; the
// panel shows no prop it was not told about. Runtime editing is opt-in, limited to props
// declared through `schema`, and uses capabilities supplied by the separate React preview
// bridge. Explicitly registered components always take precedence.
import type { ComponentAdapter, ComponentEditor, ComponentIdentity, ComponentProperty, ComponentPropValue } from "../design-system.js";
import type { ReactPreviewBridge, ReactPreviewRequest } from "./react-preview.js";

export interface DiscoverReactComponentsOptions {
  /** The app's own adapter, asked first; this adapter answers only when it names nothing. */
  adapter?: ComponentAdapter;
  /** Enable runtime editing when the optional react-preview bridge supports this renderer. */
  edit?: boolean;
  /** The editable props of a discovered component; return undefined to leave it read-only. */
  schema?: (identity: ComponentIdentity) => ComponentProperty[] | undefined;
  /** Component names to show; return false to skip a component (e.g. library wrappers). */
  include?: (name: string) => boolean;
  /**
   * Turn a location read from React's debug fields into the path to display,
   * e.g. through a source map. Return undefined to drop the location.
   * `file` is the file name or URL with the origin removed.
   */
  resolveSource?: (file: string, line: number, column: number) => string | undefined;
  /** Prop names whose values are never shown, in addition to secret-looking names. */
  redact?: (name: string) => boolean;
  /** Most props kept for comment context; default 24. */
  maxProps?: number;
  /** @deprecated Opaque values are no longer displayed. */
  maxDepth?: number;
  /** @deprecated Opaque values are no longer displayed. */
  maxItems?: number;
  /** @deprecated Prop values are no longer displayed. */
  maxString?: number;
  /** @deprecated Only bounded primitive values are displayed. */
  maxValue?: number;
}

/** The fiber `identify` found, kept beside the plain identity. */
interface Discovery {
  fiber: Fiber;
}

// Fiber tags: function, class, forward-ref, simple-memo components. These numbers have been
// stable across React 17-19; a tag outside the set simply is not a component to us.
const COMPONENT_TAGS = new Set([0, 1, 11, 15]);
const HOST_COMPONENT = 5;
const HOST_ROOT = 3;
const secret = /pass(word|wd)?|secret|token|auth|api[-_]?key|credential|cookie|session|private/i;
const minified = /^[a-z_$][\w$]?$/i;
const ignored = (name: string) => /^(key|ref|children|dangerouslySetInnerHTML|suppressHydrationWarning)$|^on[A-Z]|^_|^\$\$/.test(name);
const technical = (name: string) => /^(className|id|role|tabIndex|asChild)$|^(data-|aria-)/.test(name) && name !== "aria-label";

const discoveries = new WeakMap<ComponentIdentity, Discovery>();

const attempt = <T>(read: () => T): T | undefined => {
  try {
    return read();
  } catch {
    return undefined;
  }
};
const text = (value: unknown, limit: number) => {
  const string = String(value).replace(/\s+/g, " ");
  return string.length > limit ? `${string.slice(0, limit)}…` : string;
};

type Fiber = {
  tag?: number;
  type?: unknown;
  return?: Fiber | null;
  child?: Fiber | null;
  sibling?: Fiber | null;
  alternate?: Fiber | null;
  stateNode?: unknown;
  memoizedProps?: unknown;
  _debugSource?: unknown;
  _debugStack?: unknown;
};
const isFiber = (value: unknown): value is Fiber => !!value && typeof value === "object";

interface Hook {
  renderers?: Map<number, { findFiberByHostInstance?: (node: Element) => unknown }>;
  [key: symbol]: ReactPreviewBridge | undefined;
}
/**
 * The DevTools hook of the window that rendered `node`. In Frame's viewport iframe the app's
 * React, its renderer and the preview bridge live in the iframe's realm, not in this one.
 */
const hookOf = (node: Node) =>
  attempt(() => ((node.ownerDocument?.defaultView ?? globalThis) as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook }).__REACT_DEVTOOLS_GLOBAL_HOOK__);

/** The fiber React attached to a DOM node, from its own keys or a DevTools renderer. */
function fiberOf(node: Element): Fiber | null {
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactFiber$")) {
      const fiber = (node as unknown as Record<string, unknown>)[key];
      if (isFiber(fiber)) return fiber;
    }
  }
  for (const renderer of hookOf(node)?.renderers?.values?.() ?? []) {
    const fiber = attempt(() => renderer.findFiberByHostInstance?.(node));
    if (isFiber(fiber)) return fiber;
  }
  return null;
}

/** The nearest fiber at or above `element`, crossing shadow roots. */
function hostFiber(element: Element): Fiber | null {
  let node: Node | null = element;
  for (let steps = 0; node && steps < 2000; steps++) {
    if (node.nodeType === 1) {
      const fiber = fiberOf(node as Element);
      if (fiber) return fiber;
    }
    node = node.parentNode ?? (node as ShadowRoot).host ?? null;
  }
  return null;
}

/**
 * React keeps two copies of each fiber, and a DOM node's key can point at the stale one.
 * Match the fiber, level by level from the root, against the root's current tree.
 * A reused child may retain return links through the other copy, so keep its owner here.
 */
function current(fiber: Fiber): { fiber: Fiber; root: object } | null {
  const chain: Fiber[] = [];
  for (let up: Fiber | null | undefined = fiber; up && chain.length < 5000; up = up.return) chain.push(up);
  const top = chain[chain.length - 1];
  const owner = top?.tag === HOST_ROOT && isFiber(top.stateNode) ? top.stateNode as { current?: unknown } : undefined;
  const root = owner?.current;
  if (!isFiber(root)) return null;
  let at: Fiber = root;
  for (let index = chain.length - 2; index >= 0; index--) {
    let match: Fiber | null | undefined = at.child;
    while (match && match !== chain[index] && match !== chain[index].alternate) match = match.sibling;
    if (!match) return null;
    at = match;
  }
  return { fiber: at, root: owner! };
}

function nameOf(type: unknown, depth = 0): string | undefined {
  if (typeof type === "function") {
    const fn = type as { displayName?: unknown; name?: unknown };
    const name = typeof fn.displayName === "string" && fn.displayName ? fn.displayName : fn.name;
    return typeof name === "string" && name ? name : undefined;
  }
  if (type && typeof type === "object" && depth < 3) {
    const wrapper = type as { displayName?: unknown; render?: unknown; type?: unknown };
    if (typeof wrapper.displayName === "string" && wrapper.displayName) return wrapper.displayName;
    return nameOf(wrapper.render ?? wrapper.type, depth + 1);
  }
  return undefined;
}

/** The first DOM element a component renders, from any realm: `instanceof Element` fails across frames. */
function rootElement(fiber: Fiber): Element | null {
  let node = fiber.child;
  for (let steps = 0; node && steps < 2000; steps++) {
    if (node.tag === HOST_COMPONENT) return (node.stateNode as Node | null)?.nodeType === 1 ? node.stateNode as Element : null;
    node = node.child ?? node.sibling;
  }
  return null;
}

const FRAMEWORK = /jsx[-_](dev[-_])?runtime|react-stack|react[-_.]development|node_modules[\\/](\.[\w-]+[\\/])*(react|react-dom|scheduler)[@\\/]/;
const FRAME = /(?:\(|@|\bat\s+|^\s*)((?:[a-z][a-z0-9+.-]*:\/\/|\/|[a-z]:\\)[^()]*?):(\d+):(\d+)\)?\s*$/i;

const tidy = (file: string) =>
  file
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/@fs/, "")
    .replace(/%20/g, " ");

/**
 * Where the component was written into JSX: the first stack frame outside React. In a bundle
 * React's own frames share the app's file, so frames are checked again after `resolve` maps them.
 */
function fromStack(stack: string, resolve?: DiscoverReactComponentsOptions["resolveSource"]): string | undefined {
  let tried = 0;
  for (const raw of stack.split("\n").slice(0, 40)) {
    const match = FRAMEWORK.test(raw) ? null : FRAME.exec(raw.trim());
    if (!match || ++tried > 8) continue;
    const place = display(match[1], Number(match[2]), Number(match[3]), resolve);
    if (place && !FRAMEWORK.test(place)) return place;
  }
  return undefined;
}

function display(file: string, line: number, column: number, resolve?: DiscoverReactComponentsOptions["resolveSource"]) {
  const path = tidy(file);
  if (!path || !line) return undefined;
  const resolved = attempt(() => (resolve ? resolve(path, line, column) : `${path}:${line}`));
  return typeof resolved === "string" && resolved ? text(resolved, 160) : undefined;
}

function locate(fiber: Fiber, resolve?: DiscoverReactComponentsOptions["resolveSource"]): string | undefined {
  // React 18 keeps the JSX call site on the fiber (jsx-dev transform); React 19 drops it for an Error stack.
  const source = fiber._debugSource as { fileName?: unknown; lineNumber?: unknown; columnNumber?: unknown } | undefined;
  if (isFiber(source) && typeof source.fileName === "string") return display(source.fileName, Number(source.lineNumber) || 0, Number(source.columnNumber) || 0, resolve);
  const stack = attempt(() => (fiber._debugStack as { stack?: unknown } | undefined)?.stack);
  return typeof stack === "string" ? fromStack(stack, resolve) : undefined;
}

/** A `ComponentAdapter` that finds the nearest React component for a picked element. */
export function discoverReactComponents(options: DiscoverReactComponentsOptions = {}): ComponentAdapter {
  const editors = new WeakMap<Fiber, ComponentEditor>();
  const maxProps = Math.max(1, options.maxProps ?? 24);
  const hidden = (name: string) => secret.test(name) || !!attempt(() => options.redact?.(name));

  function discover(element: Element): ComponentIdentity | null {
    const start = hostFiber(element);
    if (!start) return null;
    // The nearest component above the DOM node; a nameless or minified one is not skipped
    // for its parent, because the parent's props are not this element's component's.
    let fiber: Fiber | null | undefined = start;
    for (let steps = 0; fiber && steps < 5000 && !(fiber.tag !== undefined && COMPONENT_TAGS.has(fiber.tag)); steps++) fiber = fiber.return;
    if (!fiber || !COMPONENT_TAGS.has(fiber.tag as number)) return null;
    fiber = current(fiber)?.fiber ?? fiber;
    const name = nameOf(fiber.type);
    if (!name || minified.test(name) || (options.include && !options.include(name))) return null;
    const props = isFiber(fiber.memoizedProps) ? fiber.memoizedProps : {};
    const keys = attempt(() => Object.keys(props)) ?? [];
    const plain: Record<string, ComponentPropValue> = {};
    let kept = 0;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(props, key);
      if (!descriptor || !("value" in descriptor)) continue;
      const value = descriptor.value;
      if (hidden(key) || ignored(key)) continue;
      if (technical(key)) continue;
      if (value === null) { plain[key] = null; continue; }
      if (!(typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))) continue;
      if (kept++ < maxProps) plain[key] = value;
    }
    const location = locate(fiber, options.resolveSource);
    const identity: ComponentIdentity = {
      name: text(name, 80),
      props: plain,
      element: rootElement(fiber) ?? element,
      ...(location ? { source: location } : {}),
    };
    discoveries.set(identity, { fiber });
    return identity;
  }

  return {
    identify(element) {
      try {
        const found = attempt(() => options.adapter?.identify(element));
        return found?.name ? found : discover(element);
      } catch {
        return null;
      }
    },
    editor(identity) {
      const found = discoveries.get(identity);
      if (!found) return attempt(() => options.adapter?.editor?.(identity)) ?? null;
      if (!options.edit || found.fiber.tag === 1) return null;
      const prior = editors.get(found.fiber) ?? (found.fiber.alternate && editors.get(found.fiber.alternate));
      if (prior && prior.available?.() !== false) return prior;
      const declared = attempt(() => options.schema?.(identity));
      if (!declared) return null;
      const schema = declared.filter(prop => !hidden(prop.name) && !ignored(prop.name) && prop.kind !== "unsupported");
      const read: ReactPreviewRequest["current"] = () => attempt(() => {
        const snapshot = current(found.fiber);
        if (!snapshot) return null;
        const element = rootElement(snapshot.fiber);
        if (!element?.isConnected) return null;
        return { ...snapshot, element, props: (snapshot.fiber.memoizedProps ?? {}) as Record<string, unknown> };
      }) ?? null;
      const editor = attempt(() => hookOf(identity.element)?.[Symbol.for("inline-feedback.react-preview")]?.editor({ schema, current: read }));
      if (editor) editors.set(found.fiber, editor);
      return editor ?? null;
    },
    panel(identity) {
      const found = discoveries.get(identity);
      if (!found) return attempt(() => options.adapter?.panel?.(identity)) ?? null;
      const group = document.createElement("details");
      group.className = "design-group design-react-group design-react-discovered";
      group.open = true;
      // The name is the heading; komo adds the source behind an info button beside it.
      const summary = document.createElement("summary");
      const name = document.createElement("span");
      name.className = "design-react-name";
      name.textContent = name.title = identity.name;
      summary.append(name);
      group.setAttribute("data-empty", "");
      group.append(summary);
      return group;
    },
  };
}
