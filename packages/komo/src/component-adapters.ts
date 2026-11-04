import type { ComponentAdapter, ComponentIdentity, DesignSystem } from "./design-system.js";

// Components instrumented at build time (@hazem3500/palette/vite) publish an adapter on their own
// window, so Frame's viewport iframe answers for its realm.
const INSTRUMENTED = Symbol.for("palette.instrumented-components");
const combined = new WeakMap<ComponentAdapter, WeakMap<ComponentAdapter, ComponentAdapter>>();

function instrumented(element: Element | null | undefined): ComponentAdapter | undefined {
  try {
    return (element?.ownerDocument?.defaultView as unknown as Record<symbol, ComponentAdapter | undefined> | null)?.[INSTRUMENTED];
  } catch {
    return undefined;
  }
}

const ask = (adapter: ComponentAdapter, element: Element) => {
  try {
    const identity = adapter.identify(element);
    return identity?.name ? identity : null;
  } catch {
    return null;
  }
};

/** The component adapter for `element`: build-time instrumented components first, then the app's. */
export function componentAdapter(element: Element | null | undefined, design?: DesignSystem): ComponentAdapter | undefined {
  const built = instrumented(element), app = design?.components;
  if (!built || built === app) return app ?? built;
  if (!app) return built;
  let byApp = combined.get(built);
  if (!byApp) combined.set(built, byApp = new WeakMap());
  let both = byApp.get(app);
  if (!both) {
    const owners = new WeakMap<ComponentIdentity, ComponentAdapter>();
    both = {
      identify(element) {
        const ours = ask(built, element), theirs = ask(app, element);
        // The app's adapter wins only for a component nested inside the instrumented one.
        const identity = theirs && (!ours || (theirs.element !== ours.element && ours.element.contains(theirs.element))) ? theirs : ours;
        if (identity) owners.set(identity, identity === ours ? built : app);
        return identity;
      },
      editor: (identity) => owners.get(identity)?.editor?.(identity) ?? null,
      panel: (identity) => owners.get(identity)?.panel?.(identity) ?? null,
    };
    byApp.set(app, both);
  }
  return both;
}
