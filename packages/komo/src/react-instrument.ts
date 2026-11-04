"use client";
// Runtime for build-time component instrumentation (`@hazem3500/komo/vite`). Only preview
// builds that enable the plugin import it: the plugin's generated module proxies wrap each
// eligible component export with `instrument()`, and this module publishes one
// ComponentAdapter for the realm, which Design mode asks before the app's own adapter.
//
// Edits are state-backed: each instance keeps its overrides in its own wrapper and renders
// the original component with them, through React's normal update path. Nothing writes to
// React's internals. Finding the instance for a picked DOM node reads React's fiber links
// (`return`, `type`, `memoizedProps`, `child`), as the react-fiber adapter does; anything
// unexpected names no component.
import { createElement, forwardRef, memo, useLayoutEffect, useReducer, version } from "react";
import type { ComponentAdapter, ComponentEditor, ComponentIdentity, ComponentProperty } from "./design-system.js";
import { current, hostFiber, rootElement, type Fiber } from "./adapters/react-fiber.js";

export interface InstrumentedComponent {
  /** Display name, e.g. "Button". */
  name: string;
  /** Where it comes from, e.g. "src/cards/Card.tsx:12" or a package name. */
  source?: string;
  /** Editable scalar props, from the component's declared types. */
  props: ComponentProperty[];
}

type Scalar = string | number | boolean | undefined;
interface Edit { before: unknown; present: boolean; value: Scalar }
interface Instance {
  meta: InstrumentedComponent;
  /** The props this instance was last rendered with, before overrides. */
  props: Record<string, unknown>;
  owned: Map<string, Edit>;
  mounted: boolean;
  listeners: Set<() => void>;
  rerender(): void;
  fiber?: Fiber;
  editor?: ComponentEditor;
}

export const INSTRUMENTED_COMPONENTS = Symbol.for("palette.instrumented-components");
const MEMO = Symbol.for("react.memo");
const FORWARD_REF = Symbol.for("react.forward_ref");
// React 18 function components never receive `ref`; React 19 passes it as a prop.
const refsAsProps = !/^1[0-8]\./.test(version);

/** Wrapper component types, as a fiber's `type` or `elementType`. */
const wrappers = new WeakSet<object>();
const identities = new WeakMap<ComponentIdentity, Instance>();
const known = new WeakSet<Instance>();
interface Slot { instance: Instance }
// A new slot object makes React render the instance again; the instance itself stays.
const bump = (slot: Slot): Slot => ({ instance: slot.instance });
const STATICS = new Set(["$$typeof", "render", "type", "compare", "displayName", "defaultProps", "propTypes", "contextType", "contextTypes", "childContextTypes", "getDerivedStateFromProps", "getDerivedStateFromError", "prototype", "length", "name", "caller", "arguments", "arity"]);

const notify = (instance: Instance) => { for (const listener of [...instance.listeners]) listener(); };

function renderInstance(Component: unknown, meta: InstrumentedComponent, props: Record<string, unknown>, ref?: unknown) {
  // The first hook's state holds this instance: that is how a fiber finds it (see instanceOf).
  const [slot, rerender] = useReducer(bump, null, () => {
    const instance: Instance = { meta, props, owned: new Map(), mounted: false, listeners: new Set(), rerender() {} };
    known.add(instance);
    return { instance };
  });
  const { instance } = slot;
  instance.rerender = rerender as () => void;
  instance.props = props;
  useLayoutEffect(() => {
    instance.mounted = true;
    return () => {
      instance.mounted = false;
      notify(instance);
    };
  }, []);
  // While the panel watches this instance, it hears after each commit; otherwise this never runs.
  useLayoutEffect(() => {
    if (instance.listeners.size) notify(instance);
  }, [instance.listeners.size ? props : null, slot]);
  let next = props;
  if (instance.owned.size) {
    next = { ...props };
    for (const [name, edit] of instance.owned) next[name] = edit.value;
  }
  if (ref != null) next = { ...next, ref };
  return createElement(Component as never, next);
}

const renderable = (value: unknown) =>
  typeof value === "function" ||
  (!!value && typeof value === "object" && ((value as { $$typeof?: unknown }).$$typeof === MEMO || (value as { $$typeof?: unknown }).$$typeof === FORWARD_REF));

const nameOf = (value: unknown): string | undefined => {
  const named = value as { displayName?: unknown; name?: unknown; render?: unknown; type?: unknown } | null;
  if (!named) return undefined;
  if (typeof named.displayName === "string" && named.displayName) return named.displayName;
  if (typeof value === "function") return typeof named.name === "string" && named.name ? named.name : undefined;
  return nameOf(named.render ?? named.type);
};

/**
 * Wrap one component so Design mode can preview its scalar props. The wrapper adds no DOM, keeps
 * the component's statics, forwards `ref` and memoizes like the original. Anything that isn't a
 * function, `forwardRef` or `memo` component is returned unchanged.
 */
export function instrument<T>(Component: T, meta: InstrumentedComponent): T {
  if (!renderable(Component) || !meta.props.length) return Component;
  const inner = refsAsProps
    ? function Instrumented(props: Record<string, unknown>) { return renderInstance(Component, meta, props); }
    : forwardRef(function Instrumented(props: Record<string, unknown>, ref) { return renderInstance(Component, meta, props, ref); });
  const compare = (Component as { $$typeof?: unknown; compare?: unknown }).$$typeof === MEMO ? (Component as { compare?: (a: object, b: object) => boolean }).compare : undefined;
  const wrapped = (Component as { $$typeof?: unknown }).$$typeof === MEMO ? memo(inner as never, compare ?? undefined) : inner;
  const name = nameOf(Component) ?? meta.name;
  for (const target of new Set<object>([inner, wrapped])) {
    wrappers.add(target);
    try { (target as { displayName?: string }).displayName = name; } catch { /* Frozen types keep their own name. */ }
  }
  // Compound parts such as Select.Option and any other statics stay reachable.
  for (const key of Reflect.ownKeys(Component as object)) {
    if (typeof key === "string" && STATICS.has(key)) continue;
    if (key in (wrapped as object)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(Component as object, key);
    if (descriptor) try { Object.defineProperty(wrapped, key, descriptor); } catch { /* Skip what can't be copied. */ }
  }
  return wrapped as T;
}

/** The instrumented instance that rendered `element`: the nearest wrapper above it. */
function instanceOf(element: Element): Instance | null {
  let fiber: Fiber | null | undefined = hostFiber(element);
  for (let steps = 0; fiber && steps < 5000; steps++, fiber = fiber.return) {
    const type = fiber.type as object | undefined, elementType = (fiber as { elementType?: object }).elementType;
    if (!(type && wrappers.has(type)) && !(elementType && wrappers.has(elementType))) continue;
    const live = current(fiber)?.fiber ?? fiber;
    // The wrapper's first hook holds its instance; only an instance this module made counts.
    const instance = ((live as { memoizedState?: { memoizedState?: Slot } }).memoizedState?.memoizedState)?.instance;
    if (!instance || !known.has(instance)) return null;
    instance.fiber = live;
    return instance;
  }
  return null;
}

function elementOf(instance: Instance): Element | null {
  if (!instance.mounted || !instance.fiber) return null;
  const live = current(instance.fiber)?.fiber;
  if (!live) return null;
  instance.fiber = live;
  const element = rootElement(live);
  return element?.isConnected ? element : null;
}

function values(instance: Instance) {
  const result: Record<string, Scalar> = {};
  for (const prop of instance.meta.props) {
    const edit = instance.owned.get(prop.name);
    result[prop.name] = (edit ? edit.value : instance.props[prop.name]) as Scalar;
  }
  return result;
}

/** Whether the panel can show this value in the prop's control. */
function shown(prop: ComponentProperty, value: unknown) {
  if (prop.kind === "string") return typeof value === "string" && value.length <= 500;
  if (prop.kind === "number") return typeof value === "number" && Number.isFinite(value);
  if (prop.kind === "boolean") return typeof value === "boolean";
  return prop.kind === "enum" && (prop.values ?? []).includes(value as never);
}

function editorOf(instance: Instance): ComponentEditor {
  return instance.editor ??= {
    schema: instance.meta.props,
    available: () => instance.mounted,
    currentElement: () => elementOf(instance),
    read: () => values(instance),
    subscribe(listener) {
      instance.listeners.add(listener);
      return () => { instance.listeners.delete(listener); };
    },
    release(names) {
      let changed = false;
      for (const name of names) changed = instance.owned.delete(name) || changed;
      if (changed) instance.rerender();
    },
    apply(next) {
      if (!instance.mounted) throw new Error("This component instance is no longer available.");
      const base = instance.props;
      let changed = false;
      for (const prop of instance.meta.props) {
        const name = prop.name, value = next[name];
        // Only what the panel sends. A value it can't show (null, a long string) reaches it as
        // unset, so unset there leaves the page's own value alone.
        if (!(name in next)) continue;
        let edit = instance.owned.get(name);
        if (!edit) {
          if (Object.is(base[name], value) || (value === undefined && !shown(prop, base[name]))) continue;
          edit = { before: base[name], present: Object.hasOwn(base, name), value };
          instance.owned.set(name, edit);
          changed = true;
        } else if (!Object.is(edit.value, value)) changed = true;
        edit.value = value;
        // Back to where it started: the page's own value shows again, set or absent as it was.
        if (Object.is(value, edit.before) || (value === undefined && edit.before == null)) instance.owned.delete(name);
      }
      if (changed) instance.rerender();
    },
  };
}

/** The adapter for this realm's instrumented components. */
export const instrumentedComponents: ComponentAdapter = {
  identify(element) {
    try {
      const instance = instanceOf(element);
      const root = instance && elementOf(instance);
      if (!instance || !root) return null;
      const props: Record<string, string | number | boolean | null> = {};
      for (const [name, value] of Object.entries(values(instance)))
        if (value !== undefined) props[name] = value;
      const identity: ComponentIdentity = { name: instance.meta.name, props, element: root, ...(instance.meta.source ? { source: instance.meta.source } : {}) };
      identities.set(identity, instance);
      return identity;
    } catch {
      return null;
    }
  },
  editor(identity) {
    const instance = identities.get(identity);
    return instance ? editorOf(instance) : null;
  },
};

if (typeof window !== "undefined") {
  const realm = window as unknown as Record<symbol, ComponentAdapter | undefined>;
  realm[INSTRUMENTED_COMPONENTS] ??= instrumentedComponents;
}
