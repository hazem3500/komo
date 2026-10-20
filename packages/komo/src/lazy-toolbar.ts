import type { MenuAction, MenuItem, MorphingMenuProps } from "./MorphingMenu.js";
import { button, el, icon, type icons } from "./dom.js";
import { shortcutKeys } from "./kbd.js";
import { badgeText, barLayout, countLabel } from "./toolbar-items.js";
import type { Identity } from "./types.js";

export type ToolbarIcon =
  | { glyph: keyof typeof icons }
  | { user: Identity | null };
export type ToolbarMenuItem = Omit<MenuItem, "icon" | "activeIcon" | "children"> & {
  icon: ToolbarIcon;
  children?: ReadonlyArray<Omit<MenuAction, "icon" | "activeIcon"> & { icon: ToolbarIcon }>;
};
export type ToolbarProps = Omit<MorphingMenuProps, "items"> & {
  items: readonly ToolbarMenuItem[];
};

/** Pins and the compact drawer work immediately; React's menu loads on intent. */
export function createToolbar(
  element: HTMLElement,
  glyph: (id: string) => Node,
) {
  let props: ToolbarProps;
  let mounted:
    | ReturnType<(typeof import("./toolbar-runtime.js"))["mountToolbar"]>
    | undefined;
  let loading: Promise<void> | undefined;
  let disposed = false;
  let pressed = false;
  let release: (() => void) | undefined;
  const events = new AbortController();
  element.addEventListener(
    "pointerdown",
    () => {
      pressed = true;
    },
    { capture: true, signal: events.signal },
  );
  const finish = () => {
    pressed = false;
    setTimeout(() => {
      release?.();
      release = undefined;
    }, 0);
  };
  document.addEventListener("pointerup", finish, {
    capture: true,
    signal: events.signal,
  });
  document.addEventListener("pointercancel", finish, {
    capture: true,
    signal: events.signal,
  });
  const load = () => {
    if (mounted || disposed) return Promise.resolve();
    if (loading) return loading;
    loading = import("./toolbar-runtime.js")
      .then(async (module) => {
        if (pressed)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        if (disposed) return;
        const focused = (element.getRootNode() as ShadowRoot)
          .activeElement as HTMLElement | null;
        const focusId = focused?.dataset.menuItem;
        mounted = module.mountToolbar(element, props);
        if (focusId)
          element
            .querySelector<HTMLElement>(`[data-menu-item="${focusId}"]`)
            ?.focus({ preventScroll: true });
      })
      .catch(() => {
        loading = undefined;
      });
    return loading;
  };
  element.addEventListener("pointerenter", () => void load(), { once: true });
  element.addEventListener("focusin", () => void load(), { once: true });
  return {
    render(next: ToolbarProps) {
      props = next;
      if (disposed) return;
      if (mounted) {
        mounted.render(props);
        return;
      }
      const nav = el("nav", "morphing-menu");
      nav.setAttribute("aria-label", props.label ?? "Website review");
      nav.dataset.view = "collapsed";
      nav.dataset.edge = props.edge ?? "bottom";
      nav.dataset.vertical = String(
        props.edge === "left" || props.edge === "right",
      );
      nav.dataset.alignEnd = String(!!props.alignEnd);
      const layout = barLayout(props.items, props.bar);
      const count = layout.filter((entry) => entry !== "|").length;
      nav.style.setProperty("--mm-count", String(count));
      nav.style.setProperty("--mm-gaps", String(layout.length - count));
      const shell = el("div", "morphing-menu__shell"),
        bar = el("div", "morphing-menu__bar");
      for (const entry of layout) {
        const item = props.items.find((candidate) => candidate.id === entry);
        if (entry === "|") {
          const separator = el("span", "morphing-menu__separator");
          separator.setAttribute("aria-hidden", "true");
          bar.append(separator);
        } else if (entry === "more") {
          const more = button(
            props.moreLabel ?? "More review tools",
            () =>
              void load().then(() => {
                if (mounted)
                  element
                    .querySelector<HTMLButtonElement>('[data-menu-item="more"]')
                    ?.click();
                else {
                  more.title = "Could not load menu. Tap to retry.";
                  more.setAttribute("aria-label", more.title);
                }
              }),
            "morphing-menu__shortcut",
            "more",
          );
          more.dataset.menuItem = "more";
          more.setAttribute("aria-expanded", "false");
          bar.append(more);
        } else if (item) {
          const control = button(
            countLabel(item.label, item.count),
            () => {
              item.onSelect?.();
              void load();
            },
            "morphing-menu__shortcut",
          );
          if (item.shortcut) {
            control.title += ` · ${shortcutKeys(item.shortcut).spoken}`;
            control.setAttribute("aria-keyshortcuts", shortcutKeys(item.shortcut).aria);
          }
          control.dataset.menuItem = item.id;
          if (item.id === props.activeId)
            control.setAttribute("aria-current", "page");
          control.replaceChildren(
            glyph("glyph" in item.icon ? item.icon.glyph : item.id),
          );
          if (item.count) {
            const badge = el("span", "morphing-menu__badge", badgeText(item.count));
            badge.setAttribute("aria-hidden", "true");
            control.append(badge);
          }
          bar.append(control);
        }
      }
      shell.append(bar);
      nav.append(shell);
      element.replaceChildren(nav);
    },
    unmount() {
      disposed = true;
      events.abort();
      release?.();
      mounted?.unmount();
      element.replaceChildren();
    },
  };
}
