// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initComments } from "../src/index";
import { resolveShortcuts } from "../src/shortcuts";
import type { CommentsController, CommentsOptions } from "../src/types";

let controller: CommentsController | undefined;
const options: CommentsOptions = {
  endpoint: "https://example.test",
  project: "visibility",
  repo: "example/review",
  branch: "main",
};
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  controller?.destroy();
  controller = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
});
const mount = (extra: Partial<CommentsOptions> = {}) => {
  controller?.destroy();
  controller = initComments({ ...options, ...extra });
  const host = [...document.body.children].find((node) => node.shadowRoot) as HTMLElement;
  return { host, root: host.shadowRoot! };
};
const key = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, ...init });
  document.dispatchEvent(event);
  return event.defaultPrevented;
};
const visibilityKey = "branch-comments:comments-hidden:visibility:example/review";

it("hides and shows comments with H, for this tab only, without dismissing review", () => {
  let { host, root } = mount();
  expect(resolveShortcuts().visibility?.label).toBe("H");
  expect(key({ key: "h" })).toBe(true);
  expect(host.hasAttribute("data-comments-hidden")).toBe(true);
  expect(sessionStorage.getItem(visibilityKey)).toBe("1");
  expect(localStorage.getItem(visibilityKey)).toBeNull();
  // Review stays enabled: the toolbar is still there to bring comments back.
  expect(root.querySelector<HTMLElement>(".toolbar")!.style.display).not.toBe("none");
  expect(root.querySelectorAll(".pin")).toHaveLength(0);
  ({ host, root } = mount());
  expect(host.hasAttribute("data-comments-hidden")).toBe(true);
  expect(key({ key: "H" })).toBe(true);
  expect(host.hasAttribute("data-comments-hidden")).toBe(false);
  expect(sessionStorage.getItem(visibilityKey)).toBeNull();
});

it("keeps hidden comments hidden through Escape, page clicks and Browse; review modes reveal them", () => {
  const { host } = mount();
  key({ key: "h" });
  for (const init of [{ key: "Escape" }, { key: "v" }]) {
    key(init);
    expect(host.hasAttribute("data-comments-hidden")).toBe(true);
  }
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  expect(host.hasAttribute("data-comments-hidden")).toBe(true);
  key({ key: "c" });
  expect(host.hasAttribute("data-comments-hidden")).toBe(false);
  key({ key: "h" });
  expect(host.hasAttribute("data-comments-hidden")).toBe(true);
  key({ key: "l" });
  expect(host.hasAttribute("data-comments-hidden")).toBe(false);
});

it("uses a configured visibility shortcut, disables it with false, and yields its default", () => {
  let { host } = mount({ shortcuts: { visibility: "Shift+H" } });
  expect(key({ key: "h" })).toBe(false);
  expect(host.hasAttribute("data-comments-hidden")).toBe(false);
  expect(key({ key: "H", code: "KeyH", shiftKey: true })).toBe(true);
  expect(host.hasAttribute("data-comments-hidden")).toBe(true);
  sessionStorage.clear();
  ({ host } = mount({ shortcuts: { visibility: false } }));
  expect(key({ key: "h" })).toBe(false);
  expect(host.hasAttribute("data-comments-hidden")).toBe(false);
  // A host that already bound H keeps it; the new default steps aside.
  const yielded = resolveShortcuts({ comments: "H" });
  expect(yielded.comments?.label).toBe("H");
  expect(yielded.visibility).toBeNull();
  expect(() => resolveShortcuts({ comments: "H", visibility: "H" })).toThrow("both use H");
});

it("defaults pins to full, applies the host size, and prefers the reviewer's stored size", () => {
  let { root } = mount();
  expect(root.querySelector<HTMLElement>(".pins")!.dataset.size).toBeUndefined();
  ({ root } = mount({ pins: { size: "compact" } }));
  expect(root.querySelector<HTMLElement>(".pins")!.dataset.size).toBe("compact");
  localStorage.setItem("branch-comments:pin-size:visibility:example/review", "dot");
  ({ root } = mount({ pins: { size: "compact" } }));
  expect(root.querySelector<HTMLElement>(".pins")!.dataset.size).toBe("dot");
  localStorage.setItem("branch-comments:pin-size:visibility:example/review", "nonsense");
  ({ root } = mount({ pins: { size: "compact" } }));
  expect(root.querySelector<HTMLElement>(".pins")!.dataset.size).toBe("compact");
  controller?.destroy();
  document.body.replaceChildren();
  expect(() => initComments({ ...options, pins: { size: "huge" as "full" } })).toThrow('Invalid komo pins.size: "huge"');
  expect(document.body.children).toHaveLength(0);
});

it("switches auto pins between dots while browsing and full while commenting or listing", () => {
  const { root } = mount({ pins: { size: "auto" } });
  const size = () => root.querySelector<HTMLElement>(".pins")!.dataset.size;
  expect(size()).toBe("dot");
  key({ key: "c" });
  expect(size()).toBeUndefined();
  key({ key: "v" });
  expect(size()).toBe("dot");
  key({ key: "l" });
  expect(size()).toBeUndefined();
  key({ key: "l" });
  expect(size()).toBe("dot");
});
