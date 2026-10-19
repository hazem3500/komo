// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFramePortals } from "../src/frame-portals";

let layer: ReturnType<typeof createFramePortals>;
let surface: HTMLElement, host: HTMLElement;
const frame = { scale: 0.665625, left: 24, top: 80 };
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  surface = document.createElement("main");
  host = document.createElement("div");
  document.body.replaceChildren(surface, host);
  layer = createFramePortals(surface, host, undefined, () => {});
});
afterEach(() => {
  layer.destroy();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("scales a late fixed popover inside a static wrapper without moving or blurring it", async () => {
  layer.update(frame);
  const wrapper = document.createElement("div"),
    popup = document.createElement("div");
  popup.style.cssText =
    "position: fixed; left: 0px; top: 0px; transform: translate(359px, 182px);";
  const input = document.createElement("textarea");
  popup.append(input);
  wrapper.append(popup);
  document.body.append(wrapper);
  input.focus();
  const before = popup.parentElement;
  await vi.waitFor(() => expect(popup.style.scale).toBe(String(frame.scale)));
  expect(popup.parentElement).toBe(before);
  expect(document.activeElement).toBe(input);
  expect(wrapper.style.scale).toBe("");
  expect(popup.style.transform).toBe("translate(359px, 182px)");
  popup.style.transform = "translate(400px, 220px)";
  popup.style.translate = "2px 4px";
  await vi.waitFor(() => expect(popup.style.translate).toContain("2px"));
  layer.update(null);
  expect(popup.style.translate).toBe("2px 4px");
  expect(popup.style.scale).toBe("");
  expect(popup.style.transform).toBe("translate(400px, 220px)");
  expect(document.activeElement).toBe(input);
});

it("does not scale nested fixed descendants twice and restores host changes and priorities", async () => {
  const modal = document.createElement("div"),
    child = document.createElement("div");
  modal.style.cssText =
    "position: fixed; scale: 1.1 !important; translate: 2px 3px !important;";
  child.style.position = "fixed";
  modal.append(child);
  document.body.append(modal);
  layer.update(frame);
  expect(modal.style.scale).toBe(String(1.1 * frame.scale));
  expect(child.style.scale).toBe("");
  modal.style.setProperty("scale", "1.2", "important");
  modal.style.setProperty("translate", "8px 9px", "important");
  await vi.waitFor(() =>
    expect(modal.style.scale).toBe(String(1.2 * frame.scale)),
  );
  layer.destroy();
  expect(modal.style.scale).toBe("1.2");
  expect(modal.style.getPropertyPriority("scale")).toBe("important");
  expect(modal.style.translate).toBe("8px 9px");
  expect(modal.style.getPropertyPriority("translate")).toBe("important");
});

it("honors a body-root exclusion for an entire portal subtree", () => {
  const wrapper = document.createElement("div"),
    popup = document.createElement("div");
  popup.style.position = "fixed";
  wrapper.append(popup);
  document.body.append(wrapper);
  layer.destroy();
  layer = createFramePortals(
    surface,
    host,
    (node) => node !== wrapper,
    () => {},
  );
  layer.update(frame);
  expect(wrapper.style.scale).toBe("");
  expect(popup.style.scale).toBe("");
});

it("keeps the host scale live through an additive animation and cancels only its own effect", async () => {
  const popup = document.createElement("div");
  popup.style.cssText = "position: fixed; scale: .95;";
  const effect = { composite: "add", setKeyframes: vi.fn() };
  const animation = {
    effect,
    pause: vi.fn(),
    cancel: vi.fn(),
    currentTime: null,
  };
  popup.animate = vi.fn(() => animation as unknown as Animation);
  document.body.append(popup);
  layer.update(frame);
  expect(popup.style.scale).toBe("0.95");
  expect(effect.setKeyframes).toHaveBeenLastCalledWith([
    { scale: String(frame.scale) },
    { scale: String(frame.scale) },
  ]);
  popup.style.scale = "1";
  await vi.waitFor(() => expect(effect.setKeyframes).toHaveBeenCalledTimes(4));
  expect(popup.style.scale).toBe("1");
  layer.update(null);
  expect(animation.cancel).toHaveBeenCalledOnce();
  expect(popup.style.scale).toBe("1");
});

it("falls back without breaking Frame when additive animations are unavailable", () => {
  const popup = document.createElement("div");
  popup.style.cssText = "position: fixed; scale: .95;";
  popup.animate = () => {
    throw new Error("Unsupported animation");
  };
  document.body.append(popup);
  layer.update(frame);
  expect(popup.style.scale).toBe(String(0.95 * frame.scale));
  layer.update(null);
  expect(popup.style.scale).toBe("0.95");
});
