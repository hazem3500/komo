// @vitest-environment jsdom
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { discoverReactComponents } from "../src/adapters/react-fiber.js";
import type { ComponentAdapter, ComponentIdentity, DesignSystem } from "../src/design-system.js";
import { registerInspectableRoot } from "../src/react-inspector.js";
import { createReactPropsPanel, designContext } from "../src/react-props-panel.js";

// React 19 is the package's own dev dependency; React 18 lives in its own workspace fixture.
const root = process.cwd();
const versions = [
  { label: "React 19", require: createRequire(resolve(root, "package.json")), major: 19 },
  { label: "React 18", require: createRequire(resolve(root, "../komo-react18-fixture/package.json")), major: 18 },
];

type Rendered = { root: { render(node: unknown): void; unmount(): void }; container: HTMLElement };
interface ReactApi {
  createElement: (...args: any[]) => any;
  version: string;
  render(node: unknown, container?: HTMLElement): Rendered;
}

function load(version: (typeof versions)[number]): ReactApi {
  const React = version.require("react");
  const { createRoot } = version.require("react-dom/client");
  const { flushSync } = version.require("react-dom");
  return {
    createElement: React.createElement,
    version: React.version,
    render(node, container = document.body.appendChild(document.createElement("div"))) {
      const root = createRoot(container);
      flushSync(() => root.render(node));
      const handle = {
        container,
        root: {
          render: (next: unknown) => flushSync(() => root.render(next)),
          unmount: () => flushSync(() => root.unmount()),
        },
      };
      mounted.push(handle);
      return handle;
    },
  };
}
const mounted: Rendered[] = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

afterEach(() => {
  for (const { root } of mounted.splice(0)) root.unmount();
  document.body.replaceChildren();
  delete (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
});

const adapter = discoverReactComponents();
const find = (element: Element | null) => {
  const identity = adapter.identify(element!);
  return identity;
};

describe.each(versions)("discoverReactComponents with $label", (version) => {
  let react: ReactApi;
  beforeAll(() => {
    react = load(version);
    expect(react.version.startsWith(`${version.major}.`)).toBe(true);
  });

  function Card(props: Record<string, unknown>) {
    return react.createElement("section", { className: "card" }, react.createElement("h2", null, props.title as string));
  }
  const card = (props: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    react.createElement(Card, { ...props, ...extra });
  // React 18 reads the JSX call site from the `__source` the jsx-dev transform adds.
  const withSource = version.major === 18 ? { __source: { fileName: "/app/src/Page.tsx", lineNumber: 42, columnNumber: 7 } } : {};

  it("finds the nearest component's name, root element, props and source", () => {
    const { container } = react.render(card({ title: "Hello", count: 3, on: true, missing: null }, withSource));
    const heading = container.querySelector("h2");
    const identity = find(heading)!;
    expect(identity.name).toBe("Card");
    expect(identity.element).toBe(container.querySelector("section"));
    expect(identity.props).toEqual({ title: "Hello", count: 3, on: true, missing: null });
    if (version.major === 18) expect(identity.source).toBe("/app/src/Page.tsx:42");
    else expect(identity.source).toMatch(/react-fiber-adapter\.test\.ts:\d+$/);
    expect(identity.source).not.toMatch(/node_modules|react-dom|jsx-dev-runtime/);
  });

  it("reads current props after updates, not the stale alternate fiber", () => {
    const { container, root } = react.render(card({ title: "one" }));
    const heading = container.querySelector("h2");
    for (const title of ["two", "three", "four"]) root.render(card({ title }));
    expect(find(heading)?.props).toEqual({ title: "four" });
  });

  it("finds each component under multiple roots and from inside shadow DOM", () => {
    const first = react.render(card({ title: "a" }));
    const second = react.render(card({ title: "b" }));
    expect(find(first.container.querySelector("h2"))?.props?.title).toBe("a");
    expect(find(second.container.querySelector("h2"))?.props?.title).toBe("b");

    const host = document.body.appendChild(document.createElement("div"));
    const shadow = host.attachShadow({ mode: "open" });
    const inner = shadow.appendChild(document.createElement("div"));
    const rendered = react.render(card({ title: "shadow" }), inner);
    const heading = rendered.container.querySelector("h2")!;
    expect(find(heading)?.props?.title).toBe("shadow");
    // A non-React node in the shadow tree resolves through the shadow host to the component around it.
    const plain = inner.querySelector("section")!.appendChild(document.createElement("span"));
    expect(find(plain)?.name).toBe("Card");
  });

  it("falls back to DevTools hook renderers when the node has no fiber key", () => {
    const { container } = react.render(card({ title: "hooked" }));
    const heading = container.querySelector("h2")!;
    const key = Object.keys(heading).find((name) => name.startsWith("__reactFiber$"))!;
    const fiber = (heading as any)[key];
    delete (heading as any)[key];
    const section = heading.parentElement!;
    delete (section as any)[Object.keys(section).find((name) => name.startsWith("__reactFiber$"))!];
    expect(find(heading)).toBeNull();
    (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers: new Map([[1, { findFiberByHostInstance: () => fiber }]]) };
    expect(find(heading)?.props?.title).toBe("hooked");
    (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers: new Map([[1, { findFiberByHostInstance: () => { throw new Error("boom"); } }]]) };
    expect(find(heading)).toBeNull();
  });

  it("names forwardRef and memo components", () => {
    const React = version.require("react");
    const Fancy = React.memo(React.forwardRef(function Fancy(props: { label: string }, ref: unknown) {
      return react.createElement("button", { ref }, props.label);
    }));
    const { container } = react.render(react.createElement(Fancy, { label: "Go" }));
    expect(find(container.querySelector("button"))?.name).toBe("Fancy");
    expect(find(container.querySelector("button"))?.props).toEqual({ label: "Go" });
  });

  it("shows nothing for anonymous or minified component names", () => {
    const Anon = (props: { x: number }) => react.createElement("i", null, props.x);
    Object.defineProperty(Anon, "name", { value: "" });
    const a = (props: { x: number }) => react.createElement("b", null, props.x);
    Object.defineProperty(a, "name", { value: "a" });
    const { container } = react.render(react.createElement("div", null, react.createElement(Anon, { x: 1 }), react.createElement(a, { x: 2 })));
    expect(find(container.querySelector("i"))).toBeNull();
    expect(find(container.querySelector("b"))).toBeNull();
    expect(find(container.querySelector("div"))).toBeNull();
  });

  it("renders a labelled read-only panel with props and source", () => {
    const { container } = react.render(card({ title: "Panel", tags: ["a", "b"], onSelect: () => {} }, withSource));
    const heading = container.querySelector("h2")!;
    const design: DesignSystem = { components: discoverReactComponents() };
    const panel = createReactPropsPanel(heading, () => {}, undefined, undefined, design)!;
    expect(panel.querySelector("summary")?.textContent).toBe("Discovered props");
    expect(panel.textContent).toContain("discovered from React, read-only");
    expect(panel.textContent).toContain("rendered at");
    const fields = Object.fromEntries([...panel.querySelectorAll<HTMLElement>("label")].map((label) => [label.querySelector("span")!.textContent, label.querySelector("input")!]));
    expect(Object.keys(fields)).toEqual(["title", "tags", "onSelect"]);
    expect(fields.tags.value).toBe('["a", "b"]');
    expect(fields.onSelect.value).toBe("ƒ onSelect()");
    for (const input of Object.values(fields)) expect(input.disabled).toBe(true);
    expect(panel.querySelector("select, input:not(:disabled)")).toBeNull();
  });

  describe("precedence", () => {
    function setup() {
      function Inner(props: { note: string }) {
        return react.createElement("em", null, props.note);
      }
      function Outer(props: { title: string }) {
        return react.createElement("section", { id: "root" }, react.createElement("h2", null, props.title), react.createElement(Inner, { note: "nested" }));
      }
      const { container } = react.render(react.createElement(Outer, { title: "Registered" }));
      const root = container.querySelector<HTMLElement>("#root")!;
      const changes: unknown[] = [];
      const definition = { id: "outer", name: "RegisteredOuter", source: "src/outer.tsx", line: 3, props: [{ name: "title", kind: "string" as const, required: true, typeLabel: "string" }] };
      registerInspectableRoot(root, definition, { title: "Registered" }, (next) => changes.push(next));
      const design: DesignSystem = { components: discoverReactComponents() };
      return { container, root, design, changes };
    }

    it("keeps the registered component's editable typed props on its root", () => {
      const { root, design } = setup();
      const panel = createReactPropsPanel(root, () => {}, undefined, undefined, design)!;
      expect(panel.textContent).toContain("RegisteredOuter");
      expect(panel.textContent).not.toContain("Discovered");
      const input = panel.querySelector<HTMLInputElement>("input")!;
      expect(input.disabled).toBe(false);
      expect(designContext(root, design).join("\n")).toContain("Component: RegisteredOuter (src/outer.tsx:3)");
    });

    it("prefers the registered component over a discovered one around a descendant", () => {
      const { container, design } = setup();
      const heading = container.querySelector("h2")!;
      // The discovered component for the heading is the registered one's React component.
      expect(adapter.identify(heading)?.name).toBe("Outer");
      const panel = createReactPropsPanel(heading, () => {}, undefined, undefined, design)!;
      expect(panel.textContent).toContain("Inside RegisteredOuter");
      expect(panel.textContent).not.toContain("Discovered");
      expect(designContext(heading, design).join("\n")).toContain("Component: RegisteredOuter");
    });

    it("discovers an unregistered component nested inside a registered one", () => {
      const { container, design } = setup();
      const note = container.querySelector("em")!;
      const panel = createReactPropsPanel(note, () => {}, undefined, undefined, design)!;
      expect(panel.textContent).toContain("Discovered props");
      expect(panel.textContent).toContain("Inner");
      expect(designContext(note, design).join("\n")).toContain("Component: Inner");
    });

    it("lets the app's own adapter answer first and falls back to discovery", () => {
      const { container } = react.render(card({ title: "x" }));
      const heading = container.querySelector("h2")!;
      const own: ComponentAdapter = { identify: (element) => (element === heading ? { name: "Design System Heading", element } : null) };
      const combined = discoverReactComponents({ adapter: own });
      expect(combined.identify(heading)?.name).toBe("Design System Heading");
      expect(combined.identify(container.querySelector("section")!)?.name).toBe("Card");
    });
  });
});

describe("serialization", () => {
  const props = (value: Record<string, unknown>, options = {}) => {
    const panelAdapter = discoverReactComponents(options);
    const element = fakeComponent("Thing", value);
    const identity = panelAdapter.identify(element)!;
    const panel = panelAdapter.panel!(identity)!;
    return {
      identity,
      shown: Object.fromEntries([...panel.querySelectorAll<HTMLElement>("label")].map((label) => [label.querySelector("span")!.textContent, label.querySelector("input")!.value])),
      panel,
    };
  };

  it("describes functions, symbols, elements and cycles without running anything", () => {
    let calls = 0;
    const cycle: Record<string, unknown> = { name: "loop" };
    cycle.self = cycle;
    const getter = Object.defineProperty({}, "danger", { enumerable: true, get() { calls++; return "run"; } });
    const element = { $$typeof: Symbol.for("react.transitional.element"), type: "button", props: { onClick() { calls++; } } };
    const { shown } = props({
      fn: function save() { calls++; },
      arrow: () => { calls++; },
      sym: Symbol("tag"),
      element,
      cycle,
      getter,
      big: 10n,
      node: document.createElement("canvas"),
      date: new Date(0),
      map: new Map([[1, 2]]),
      instance: new (class Widget {})(),
    });
    expect(shown.fn).toBe("ƒ save()");
    expect(shown.arrow).toBe("ƒ arrow()");
    expect(shown.sym).toBe("Symbol(tag)");
    expect(shown.element).toBe("<button />");
    expect(shown.cycle).toBe('{ name: "loop", self: [Circular] }');
    expect(shown.getter).toBe("{ danger: [getter] }");
    expect(shown.big).toBe("10n");
    expect(shown.node).toBe("<canvas>");
    expect(shown.date).toBe("1970-01-01T00:00:00.000Z");
    expect(shown.map).toBe("Map(1)");
    expect(shown.instance).toBe("Widget {…}");
    expect(calls).toBe(0);
  });

  it("applies depth, item, string and size limits", () => {
    const { shown } = props(
      {
        long: "x".repeat(500),
        list: [1, 2, 3, 4, 5, 6, 7, 8],
        deep: { a: { b: { c: { d: 1 } } } },
        wide: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`k${index}`, index])),
        huge: Array.from({ length: 6 }, () => "y".repeat(80)),
      },
      { maxString: 20, maxItems: 3, maxDepth: 2, maxValue: 60 },
    );
    expect(shown.long).toBe(`"${"x".repeat(20)}…"`);
    expect(shown.list).toBe("[1, 2, 3, … +5]");
    expect(shown.deep).toBe("{ a: { b: {…} } }");
    expect(shown.wide).toBe("{ k0: 0, k1: 1, k2: 2, … +9 }");
    expect(shown.huge.length).toBeLessThanOrEqual(61);
  });

  it("limits the number of props and reports how many were left out", () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`p${index}`, index]));
    const { shown, panel } = props(many, { maxProps: 5 });
    expect(Object.keys(shown)).toHaveLength(5);
    expect(panel.textContent).toContain("+35 more props not shown");
  });

  it("never exposes secret-looking props to the panel or the proposal context", () => {
    const { shown, identity } = props({ apiKey: "sk-live-123", accessToken: "t0k", label: "ok", custom: "private-ish" }, { redact: (name: string) => name === "custom" });
    expect(shown).toEqual({ apiKey: "[redacted]", accessToken: "[redacted]", label: '"ok"', custom: "[redacted]" });
    expect(JSON.stringify({ ...identity, element: undefined })).not.toContain("sk-live-123");
    expect(identity.props).toEqual({ label: "ok" });
  });

  it("tolerates props that throw when read", () => {
    const hostile = new Proxy({}, { ownKeys() { throw new Error("no"); }, getPrototypeOf() { throw new Error("no"); } });
    const { shown } = props({ hostile, fine: 1 });
    expect(shown.hostile).toBe("[unreadable]");
    expect(shown.fine).toBe("1");
  });
});

/** A DOM node wired to hand-made fibers, to exercise shapes React versions might produce. */
function fakeComponent(name: string, memoizedProps: unknown, extra: Record<string, unknown> = {}) {
  const element = document.body.appendChild(document.createElement("div"));
  const component: any = { tag: 0, type: Object.defineProperty(function () {}, "name", { value: name }), memoizedProps, ...extra };
  const host: any = { tag: 5, stateNode: element, return: component };
  component.child = host;
  (element as any).__reactFiber$test = host;
  return element;
}

describe("source locations from debug stacks", () => {
  const locate = (stack: string, options = {}) => {
    const element = fakeComponent("Page", {}, { _debugStack: { stack } });
    return discoverReactComponents(options).identify(element)?.source;
  };

  it("takes the first frame outside React in Chrome, Vite, Firefox and file formats", () => {
    const react = "    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=abc:250:20)";
    expect(locate(`Error: react-stack-top-frame\n${react}\n    at App (http://localhost:5173/src/App.tsx?t=17:12:5)\n    at Root (http://localhost:5173/src/main.tsx:3:1)`)).toBe("/src/App.tsx:12");
    expect(locate("Error: react-stack-top-frame\n    at jsxDEV (/repo/node_modules/.pnpm/react@19.2.7/node_modules/react/cjs/react-jsx-dev-runtime.development.js:339:1)\n    at /repo/src/Home.tsx:8:3")).toBe("/repo/src/Home.tsx:8");
    expect(locate("jsxDEV@http://localhost/node_modules/react/jsx-dev-runtime.js:5:1\nApp@http://localhost/src/App.tsx:30:9\n")).toBe("/src/App.tsx:30");
    expect(locate("Error\n    at fn (file:///C:/work/app/src/Nav.tsx:4:2)")).toBe("/C:/work/app/src/Nav.tsx:4");
    expect(locate("Error\n    at Card (/my work/src/Card.tsx:9:3)")).toBe("/my work/src/Card.tsx:9");
    expect(locate("Error\n    at Card (file:///my%20work/src/Card.tsx:9:3)")).toBe("/my work/src/Card.tsx:9");
  });

  it("drops the location when only React frames or unparsable text are present", () => {
    expect(locate("Error: react-stack-top-frame\n    at jsxDEV (http://x/node_modules/react/cjs/react-jsx-dev-runtime.development.js:339:1)")).toBeUndefined();
    expect(locate("garbage")).toBeUndefined();
    expect(locate(undefined as never)).toBeUndefined();
  });

  it("skips React frames that only show up as such after the source map is applied (bundled apps)", () => {
    const stack = "Error: react-stack-top-frame\n    at jsxDEV (http://localhost/app.js:300:9)\n    at App (http://localhost/app.js:900:4)";
    const resolveSource = (_file: string, line: number) => (line === 300 ? "node_modules/.pnpm/react@19.2.7/node_modules/react/cjs/react-jsx-dev-runtime.development.js:333" : "src/App.tsx:21");
    expect(locate(stack, { resolveSource })).toBe("src/App.tsx:21");
  });

  it("lets the app map generated positions through resolveSource, and survives it throwing", () => {
    const stack = "Error\n    at App (http://localhost/assets/app.js:100:20)";
    expect(locate(stack, { resolveSource: (file: string, line: number, column: number) => `src/App.tsx:${line - 90}:${column}` })).toBe("src/App.tsx:10:20");
    expect(locate(stack, { resolveSource: () => { throw new Error("map failed"); } })).toBeUndefined();
  });
});

describe("graceful no-op", () => {
  it("returns null on a non-React page", () => {
    document.body.innerHTML = "<main><p id=p>plain</p></main>";
    const element = document.getElementById("p")!;
    expect(adapter.identify(element)).toBeNull();
    expect(createReactPropsPanel(element, () => {}, undefined, undefined, { components: adapter })).toBeNull();
  });

  it("returns null for unknown fiber shapes instead of throwing", () => {
    const shapes: unknown[] = [null, 0, "fiber", {}, { tag: 99 }, { tag: 0 }, { tag: 0, type: 5 }, { tag: 0, type: [function () {}][0], return: {} }, { get tag(): number { throw new Error("getter"); } }];
    for (const shape of shapes) {
      const element = document.body.appendChild(document.createElement("div"));
      (element as any).__reactFiber$x = shape;
      expect(() => adapter.identify(element)).not.toThrow();
      expect(adapter.identify(element)).toBeNull();
    }
  });

  it("survives cyclic fiber links and a hostile DevTools hook", () => {
    const element = document.body.appendChild(document.createElement("div"));
    const fiber: any = { tag: 5, stateNode: element };
    fiber.return = fiber;
    (element as any).__reactFiber$loop = fiber;
    expect(adapter.identify(element)).toBeNull();
    (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = new Proxy({}, { get() { throw new Error("hook"); } });
    expect(adapter.identify(document.body.appendChild(document.createElement("div")))).toBeNull();
  });

  it("shows no panel when the app's adapter or panel throws", () => {
    const element = fakeComponent("Page", { a: 1 });
    const identity: ComponentIdentity = { name: "X", element };
    const design: DesignSystem = { components: { identify: () => { throw new Error("identify"); }, panel: () => { throw new Error("panel"); } } };
    expect(createReactPropsPanel(element, () => {}, undefined, undefined, design)).toBeNull();
    const combined = discoverReactComponents({ adapter: { identify: () => { throw new Error("x"); } } });
    expect(combined.identify(element)?.name).toBe("Page");
    expect(combined.panel!(identity)).toBeNull();
  });
});
