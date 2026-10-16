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
// It is for development builds. Production builds drop the debug fields and usually minify
// component names; names that look minified are not shown. Props are summarized for display
// (primitives, small arrays and objects, depth and size limits) and never executed: functions,
// elements, symbols and cycles are described, getters are not invoked. Discovered props are
// read-only; only a component registered with `useKomoInspectable` is editable, and a
// registered component always takes precedence over what this adapter finds.
import type { ComponentAdapter, ComponentIdentity, ComponentPropValue } from "../design-system.js";

export interface DiscoverReactComponentsOptions {
  /** The app's own adapter, asked first; this adapter answers only when it names nothing. */
  adapter?: ComponentAdapter;
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
  /** Most props listed; default 24. */
  maxProps?: number;
  /** Nesting depth of objects and arrays shown; default 3. */
  maxDepth?: number;
  /** Most array items or object keys shown per level; default 6. */
  maxItems?: number;
  /** Longest string shown; default 80. */
  maxString?: number;
  /** Most characters in one summarized prop value; default 240. */
  maxValue?: number;
}

/** What `identify` found, kept beside the plain identity for the read-only panel. */
interface Discovery {
  props: Array<[name: string, text: string]>;
  hidden: number;
  location?: string;
}

// Fiber tags: function, class, forward-ref, simple-memo components. These numbers have been
// stable across React 17-19; a tag outside the set simply is not a component to us.
const COMPONENT_TAGS = new Set([0, 1, 11, 15]);
const HOST_COMPONENT = 5;
const HOST_ROOT = 3;
const ELEMENT_TYPES = ["react.element", "react.transitional.element"];
const secret = /pass(word|wd)?|secret|token|auth|api[-_]?key|credential|cookie|session|private/i;
const minified = /^[a-z_$][\w$]?$/i;

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
}

/** The fiber React attached to a DOM node, from its own keys or a DevTools renderer. */
function fiberOf(node: Element): Fiber | null {
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactFiber$")) {
      const fiber = (node as unknown as Record<string, unknown>)[key];
      if (isFiber(fiber)) return fiber;
    }
  }
  const hook = attempt(() => (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook }).__REACT_DEVTOOLS_GLOBAL_HOOK__);
  for (const renderer of hook?.renderers?.values?.() ?? []) {
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
 */
function current(fiber: Fiber): Fiber {
  const chain: Fiber[] = [];
  for (let up: Fiber | null | undefined = fiber; up && chain.length < 5000; up = up.return) chain.push(up);
  const top = chain[chain.length - 1];
  const root = top?.tag === HOST_ROOT && isFiber(top.stateNode) ? (top.stateNode as { current?: unknown }).current : undefined;
  if (!isFiber(root)) return fiber;
  let at: Fiber = root;
  for (let index = chain.length - 2; index >= 0; index--) {
    let match: Fiber | null | undefined = at.child;
    while (match && match !== chain[index] && match !== chain[index].alternate) match = match.sibling;
    if (!match) return fiber;
    at = match;
  }
  return at;
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

/** The first DOM element a component renders. */
function rootElement(fiber: Fiber): Element | null {
  let node = fiber.child;
  for (let steps = 0; node && steps < 2000; steps++) {
    if (node.tag === HOST_COMPONENT) return node.stateNode instanceof Element ? node.stateNode : null;
    node = node.child ?? node.sibling;
  }
  return null;
}

const FRAMEWORK = /jsx[-_](dev[-_])?runtime|react-stack|react[-_.]development|node_modules[\\/](\.[\w-]+[\\/])*(react|react-dom|scheduler)[@\\/]/;
const FRAME = /(?:\(|@|\bat\s+|^\s*)((?:[a-z][a-z0-9+.-]*:\/\/|\/|[a-z]:\\)[^\s()]*?):(\d+):(\d+)\)?\s*$/i;

const tidy = (file: string) =>
  file
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/@fs/, "");

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

interface Limits {
  depth: number;
  items: number;
  string: number;
  value: number;
}

const isElement = (value: object) => ELEMENT_TYPES.some((name) => (value as { $$typeof?: unknown }).$$typeof === Symbol.for(name));

/** A short description of `value`; reads data properties only and never calls anything. */
function summarize(value: unknown, limits: Limits, seen: object[] = []): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(text(value, limits.string));
    case "number":
    case "boolean":
    case "undefined":
      return String(value);
    case "bigint":
      return `${value}n`;
    case "symbol":
      return attempt(() => String(value)) ?? "Symbol()";
    case "function":
      return `ƒ ${attempt(() => nameOf(value)) ?? "anonymous"}()`;
  }
  if (value === null) return "null";
  const object = value as object;
  if (seen.includes(object)) return "[Circular]";
  if (isElement(object)) {
    const type = (object as { type?: unknown }).type;
    return `<${typeof type === "string" ? type : attempt(() => nameOf(type)) ?? "Component"} />`;
  }
  if (typeof Node !== "undefined" && object instanceof Node) return `<${(object as Element).localName ?? "node"}>`;
  if (Array.isArray(object)) {
    if (seen.length >= limits.depth) return `Array(${object.length})`;
    const shown: string[] = [];
    for (let index = 0; index < Math.min(object.length, limits.items); index++) {
      const item = Object.getOwnPropertyDescriptor(object, index);
      shown.push(item && "value" in item ? summarize(item.value, limits, [...seen, object]) : "[getter]");
    }
    return `[${shown.join(", ")}${object.length > limits.items ? `, … +${object.length - limits.items}` : ""}]`;
  }
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) {
    const name = attempt(() => nameOf((prototype as { constructor?: unknown }).constructor)) ?? "Object";
    if (name === "Date") return attempt(() => (object as Date).toISOString()) ?? "Date";
    if (name === "Map" || name === "Set") return `${name}(${attempt(() => (object as Map<unknown, unknown>).size) ?? "?"})`;
    return name === "RegExp" ? text(attempt(() => String(object)) ?? "RegExp", limits.string) : `${name} {…}`;
  }
  const keys = attempt(() => Object.keys(object)) ?? [];
  if (!keys.length) return "{}";
  if (seen.length >= limits.depth) return "{…}";
  const shown = keys.slice(0, limits.items).map((key) => {
    const item = Object.getOwnPropertyDescriptor(object, key);
    return `${text(key, 40)}: ${item && "value" in item ? summarize(item.value, limits, [...seen, object]) : "[getter]"}`;
  });
  return `{ ${shown.join(", ")}${keys.length > limits.items ? `, … +${keys.length - limits.items}` : ""} }`;
}

/** A read-only `design-react-field` row, styled like the registered props. */
function row(name: string, value: string): HTMLElement {
  const label = document.createElement("label");
  label.className = "design-field design-react-field";
  const caption = document.createElement("span");
  caption.textContent = name;
  caption.title = name;
  const input = document.createElement("input");
  input.value = value;
  input.title = value;
  input.disabled = true;
  input.setAttribute("aria-label", `${name} (discovered, read-only)`);
  label.append(caption, input);
  return label;
}

/** A `ComponentAdapter` that finds the nearest React component for a picked element. */
export function discoverReactComponents(options: DiscoverReactComponentsOptions = {}): ComponentAdapter {
  const limits: Limits = {
    depth: Math.max(0, options.maxDepth ?? 3),
    items: Math.max(1, options.maxItems ?? 6),
    string: Math.max(8, options.maxString ?? 80),
    value: Math.max(40, options.maxValue ?? 240),
  };
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
    fiber = current(fiber);
    const name = nameOf(fiber.type);
    if (!name || minified.test(name) || (options.include && !options.include(name))) return null;
    const props = isFiber(fiber.memoizedProps) ? fiber.memoizedProps : {};
    const keys = attempt(() => Object.keys(props)) ?? [];
    const listed: Array<[string, string]> = [];
    const plain: Record<string, ComponentPropValue> = {};
    for (const key of keys.slice(0, maxProps)) {
      const descriptor = Object.getOwnPropertyDescriptor(props, key);
      if (!descriptor || !("value" in descriptor)) continue;
      const value = descriptor.value;
      if (hidden(key)) {
        listed.push([key, "[redacted]"]);
        continue;
      }
      listed.push([key, text(attempt(() => summarize(value, limits)) ?? "[unreadable]", limits.value)]);
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) plain[key] = value as ComponentPropValue;
    }
    const location = locate(fiber, options.resolveSource);
    const identity: ComponentIdentity = {
      name: text(name, 80),
      props: plain,
      element: rootElement(fiber) ?? element,
      ...(location ? { source: location } : {}),
    };
    discoveries.set(identity, { props: listed, hidden: Math.max(0, keys.length - maxProps), location });
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
    panel(identity) {
      const found = discoveries.get(identity);
      if (!found) return attempt(() => options.adapter?.panel?.(identity)) ?? null;
      const group = document.createElement("details");
      group.className = "design-group design-react-group design-react-discovered";
      group.open = true;
      const summary = document.createElement("summary");
      summary.textContent = "Discovered props";
      const source = document.createElement("small");
      source.className = "design-react-source";
      source.textContent = `${identity.name} · discovered from React, read-only${found.location ? ` · rendered at ${found.location}` : ""}`;
      group.append(summary, source);
      if (!found.props.length) {
        const none = document.createElement("small");
        none.className = "design-react-source";
        none.textContent = "No props.";
        group.append(none);
      }
      for (const [name, value] of found.props) group.append(row(name, value));
      if (found.hidden) {
        const more = document.createElement("small");
        more.className = "design-react-source";
        more.textContent = `+${found.hidden} more props not shown`;
        group.append(more);
      }
      return group;
    },
  };
}
