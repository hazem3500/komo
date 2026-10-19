// Import before react-dom/client to receive its development renderer capabilities.
// This entry point never imports React or writes Fiber fields.
import type { ComponentEditor, ComponentProperty } from "../design-system.js";

type Props = Record<string, string | number | boolean | undefined>;
interface Snapshot { fiber: object; root: object; props: Record<string, unknown> }
export interface ReactPreviewRequest {
  schema: ComponentProperty[];
  current(): Snapshot | null;
}
interface Renderer {
  bundleType?: number;
  version?: string;
  rendererPackageName?: string;
  overrideProps?(fiber: object, path: string[], value: unknown): void;
}
interface Hook {
  supportsFiber?: boolean;
  renderers?: Map<number, Renderer>;
  inject?(renderer: Renderer): number;
  getFiberRoots?(id: number): Set<object>;
  onCommitFiberRoot?(id: number, root: object, ...args: unknown[]): void;
  [key: symbol]: unknown;
}
const copyProps = (props: Record<string, unknown>) => Object.defineProperties({}, Object.fromEntries(
  Object.entries(Object.getOwnPropertyDescriptors(props)).map(([name, descriptor]) => [name, {
    ...descriptor, configurable: true, ...("value" in descriptor ? { writable: true } : {}),
  }]),
)) as Record<string, unknown>;
export const reactPreviewKey = Symbol.for("inline-feedback.react-preview");
export interface ReactPreviewBridge { editor(request: ReactPreviewRequest): ComponentEditor | null }

/** Preserve an existing DevTools hook; install only the minimal renderer bridge otherwise. */
function installBridge(): boolean {
  if (typeof window === "undefined") return false;
  const target = globalThis as typeof globalThis & { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook };
  let hook = target.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook?.[reactPreviewKey]) return true;
  if (!hook) {
    const renderers = new Map<number, Renderer>();
    const roots = new Map<number, Set<object>>();
    hook = {
      supportsFiber: true, renderers,
      inject(renderer) { const id = renderers.size + 1; renderers.set(id, renderer); return id; },
      getFiberRoots(id) {
        let set = roots.get(id);
        if (!set) roots.set(id, set = new Set());
        return set;
      },
    };
    try { target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook; } catch { return false; }
  }
  if (!hook.supportsFiber || !hook.renderers) return false;
  const active = new Set<(root: object) => void>();
  const committed = new Set<object>();
  const rendererForRoot = new WeakMap<object, Renderer>();
  for (const [id, renderer] of hook.renderers) {
    for (const root of hook.getFiberRoots?.(id) ?? []) rendererForRoot.set(root, renderer);
  }
  const previous = hook.onCommitFiberRoot;
  let queued = false;
  const commit = function(this: Hook, id: number, root: object, ...args: unknown[]) {
    try { previous?.call(this, id, root, ...args); } finally {
      const renderer = hook!.renderers!.get(id);
      if (renderer) rendererForRoot.set(root, renderer);
      committed.add(root);
      if (active.size && !queued) {
        queued = true;
        queueMicrotask(() => {
          queued = false;
          const roots = [...committed];
          committed.clear();
          for (const root of roots) for (const apply of [...active]) apply(root);
        });
      } else if (!active.size) committed.clear();
    }
  };
  try { hook.onCommitFiberRoot = commit; } catch { return false; }
  if (hook.onCommitFiberRoot !== commit) return false;

  const bridge: ReactPreviewBridge = {
    editor(request) {
      const snapshot = request.current();
      const renderer = snapshot && rendererForRoot.get(snapshot.root);
      if (!renderer?.overrideProps || renderer.bundleType !== 1 || renderer.rendererPackageName !== "react-dom" || !/^(18|19)\./.test(renderer.version ?? "")) return null;
      const owned = new Map<string, { before: unknown; present: boolean; value: unknown }>();
      const listeners = new Set<() => void>();
      let pending: Record<string, unknown> | undefined;
      const read = () => request.current();
      const apply = (root: object) => {
        const current = read();
        if (!current) { active.delete(apply); owned.clear(); pending = undefined; return; }
        if (current.root !== root) return;
        pending = undefined;
        if (owned.size) {
          const next = copyProps(current.props);
          let changed = false;
          for (const [name, edit] of owned) {
            if (!Object.is(next[name], edit.value)) { next[name] = edit.value; changed = true; }
          }
          if (changed) { renderer.overrideProps!(current.fiber, [], next); return; }
        }
        for (const listener of listeners) listener();
        if (!owned.size && !listeners.size) active.delete(apply);
      };
      return {
        schema: request.schema,
        available: () => !!read(),
        release(names) { for (const name of names) owned.delete(name); },
        subscribe(listener) {
          listeners.add(listener);
          active.add(apply);
          return () => { listeners.delete(listener); if (!listeners.size && !owned.size && !pending) active.delete(apply); };
        },
        read() {
          const props: Props = {};
          const values = pending ?? read()?.props ?? {};
          for (const prop of request.schema) props[prop.name] = Object.getOwnPropertyDescriptor(values, prop.name)?.value as Props[string];
          return props;
        },
        apply(next) {
          const current = read();
          if (!current) return;
          const baseline = pending ?? current.props;
          const props = copyProps(current.props);
          for (const prop of request.schema) {
            const name = prop.name;
            const value = next[name];
            let edit = owned.get(name);
            if (!edit && !Object.is(baseline[name], value)) {
              edit = { before: baseline[name], present: Object.hasOwn(baseline, name), value };
              owned.set(name, edit);
            }
            if (!edit) continue;
            edit.value = value;
            props[name] = value;
            if (Object.is(value, edit.before)) {
              if (!edit.present) delete props[name];
              owned.delete(name);
            }
          }
          pending = props;
          active.add(apply);
          renderer.overrideProps!(current.fiber, [], props);
        },
      };
    },
  };
  try { hook[reactPreviewKey] = bridge; } catch { hook.onCommitFiberRoot = previous; return false; }
  return true;
}

export function installReactPreview(): boolean {
  try { return installBridge(); } catch { return false; }
}

installReactPreview();
