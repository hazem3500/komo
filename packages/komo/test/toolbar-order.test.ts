// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { icon } from "../src/dom";
import { initComments } from "../src/index";
import { createToolbar, type ToolbarProps } from "../src/lazy-toolbar";
import { mountToolbar } from "../src/toolbar-runtime";
import { badgeText, countLabel, defaultToolbarItems, normalizeToolbarItems, toolbarLayout } from "../src/toolbar-items";
import type { CommentsController, CommentsOptions } from "../src/types";

let controller: CommentsController | undefined;
const options: CommentsOptions = { endpoint: "https://example.test", project: "fixture", repo: "fixture", branch: "main" };
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  sessionStorage.clear();
});
afterEach(() => {
  controller?.destroy();
  controller = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const shadow = () => [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
const bar = (root: ParentNode = shadow()) =>
  [...root.querySelectorAll<HTMLElement>(".morphing-menu__bar > *")].map((node) => node.dataset.menuItem ?? (node.classList.contains("morphing-menu__separator") ? "|" : "?"));

describe("toolbar item config", () => {
  it("normalizes entries and warns once for invalid or repeated ids", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normalizeToolbarItems(undefined)).toBe(defaultToolbarItems);
    expect(normalizeToolbarItems(["comments", "|", "browse"])).toEqual(["comments", "|", "browse"]);
    expect(warn).not.toHaveBeenCalled();
    expect(normalizeToolbarItems(["browse", "nope", "browse", { id: "custom" }, "|"])).toEqual(["browse", "|"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('"nope", "browse", {"id":"custom"}');
    expect(normalizeToolbarItems("browse")).toBe(defaultToolbarItems);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("skips unavailable ids and collapses leading, trailing and doubled separators", () => {
    const all = () => true;
    expect(toolbarLayout(["|", "|", "browse", "|", "|", "design", "|", "comments", "|"], all)).toEqual(["browse", "|", "design", "|", "comments"]);
    expect(toolbarLayout(["browse", "|", "design", "|", "comments"], (id) => id !== "design")).toEqual(["browse", "|", "comments"]);
    expect(toolbarLayout(["|", "design", "|"], (id) => id !== "design")).toEqual([]);
  });

  it("formats the open-thread badge and its label", () => {
    expect(badgeText(1)).toBe("1");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
    expect(countLabel("All comments", 0)).toBe("All comments");
    expect(countLabel("All comments", 1)).toBe("All comments, 1 open comment");
    expect(countLabel("All comments", 250)).toBe("All comments, 250 open comments");
  });
});

describe("toolbar order", () => {
  it("defaults to modes | comments | utilities | dismiss", () => {
    controller = initComments(options);
    expect(bar()).toEqual(["browse", "comment", "design", "|", "comments", "|", "more", "account", "|", "dismiss"]);
    expect(shadow().querySelector('[data-menu-item="more"] svg')?.outerHTML).toBe(icon("more").outerHTML);
    expect(shadow().querySelector('[data-menu-item="browse"]')!.getAttribute("aria-current")).toBe("page");
  });

  it("follows a custom order and hides omitted ids from the bar", () => {
    controller = initComments({ ...options, toolbar: { items: ["comments", "|", "comment", "browse", "|", "dismiss"] } });
    expect(bar()).toEqual(["comments", "|", "comment", "browse", "|", "dismiss"]);
    expect(shadow().querySelector('.morphing-menu__bar [data-menu-item="account"]')).toBeNull();
  });

  it("skips ids removed by disabled features without doubling separators", () => {
    controller = initComments({ ...options, features: { designMode: false }, toolbar: { items: ["|", "design", "|", "browse", "|", "|", "design", "dismiss", "|"] } });
    expect(bar()).toEqual(["browse", "|", "dismiss"]);
    controller.destroy();
    controller = initComments({ ...options, features: { designMode: false } });
    expect(bar()).toEqual(["browse", "comment", "|", "comments", "|", "more", "account", "|", "dismiss"]);
  });

  it("warns once for invalid config however often the toolbar renders", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    controller = initComments({ ...options, toolbar: { items: ["browse", "unknown" as never, "browse", "comment"] } });
    for (const key of ["c", "v", "c", "v"]) document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(bar()).toEqual(["browse", "comment"]);
    expect(warn.mock.calls.filter(([message]) => String(message).includes("toolbar.items"))).toHaveLength(1);
  });

  it("keeps hidden dismiss and account reachable, and the restore shortcut working", () => {
    controller = initComments({ ...options, toolbar: { items: ["browse", "comment"] } });
    const root = shadow();
    expect(root.querySelector('.morphing-menu__bar [data-menu-item="dismiss"]')).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "K", shiftKey: true, bubbles: true }));
    expect(root.querySelector<HTMLElement>(".toolbar")!.style.display).not.toBe("none");
  });

  it("hides an empty toolbar but keeps shortcuts", () => {
    controller = initComments({ ...options, toolbar: { items: ["|"] } });
    expect(shadow().querySelector<HTMLElement>(".toolbar")!.style.display).toBe("none");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    expect(shadow().querySelector<HTMLElement>(".catch")!.hidden).toBe(false);
  });

  it("keeps the setup controls during onboarding whatever the configured items", () => {
    controller = initComments({ ...options, onboarding: { inProject: true }, toolbar: { items: ["browse", "dismiss"] } });
    controller.close();
    expect(bar()).toEqual(["comments", "|", "more", "account"]);
  });
});

describe("toolbar badge and focus", () => {
  const props = (count: number): ToolbarProps => ({
    items: [
      { id: "browse", label: "Browse website", icon: { glyph: "pointer" } },
      { id: "comments", label: "All comments", count, icon: { glyph: "expand" }, shortcut: { key: "l", label: "L", shift: false, alt: false, ctrl: false, meta: false } },
      { id: "dismiss", label: "Dismiss feedback", icon: { glyph: "close" } },
    ],
    bar: ["browse", "|", "comments", "|", "more", "dismiss"],
  });
  const badge = (root: ParentNode) => root.querySelector('[data-menu-item="comments"] .morphing-menu__badge')?.textContent ?? null;

  it.each([[0, null, "All comments"], [7, "7", "All comments, 7 open comments"], [120, "99+", "All comments, 120 open comments"]])(
    "shows %i open threads as %s in both renderers",
    (count, text, label) => {
      const element = document.createElement("div");
      document.body.append(element);
      const toolbar = createToolbar(element, () => document.createElement("i"));
      toolbar.render(props(count));
      expect(bar(element)).toEqual(["browse", "|", "comments", "|", "more", "dismiss"]);
      expect(badge(element)).toBe(text);
      expect(element.querySelector('[data-menu-item="comments"]')!.getAttribute("aria-label")).toBe(label);
      toolbar.unmount();
      const mounted = mountToolbar(element, props(count));
      expect(bar(element)).toEqual(["browse", "|", "comments", "|", "more", "dismiss"]);
      expect(badge(element)).toBe(text);
      expect(element.querySelector('[data-menu-item="comments"]')!.getAttribute("aria-label")).toBe(label);
      mounted.unmount();
    },
  );

  it("moves focus with arrow keys and Home/End in visual order", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const mounted = mountToolbar(element, props(3));
    const focused = () => (document.activeElement as HTMLElement | null)?.dataset.menuItem;
    const press = (key: string) => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    element.querySelector<HTMLElement>('[data-menu-item="browse"]')!.focus();
    const order = [focused()];
    for (let step = 0; step < 4; step++) { press("ArrowRight"); order.push(focused()); }
    expect(order).toEqual(["browse", "comments", "more", "dismiss", "browse"]);
    press("ArrowUp");
    expect(focused()).toBe("dismiss");
    press("Home");
    expect(focused()).toBe("browse");
    press("End");
    expect(focused()).toBe("dismiss");
    mounted.unmount();
  });
});
