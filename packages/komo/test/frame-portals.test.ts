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
    expect.objectContaining({ scale: String(frame.scale) }),
    expect.objectContaining({ scale: String(frame.scale) }),
  ]);
  expect(popup.style.translate).toBe("");
  popup.style.scale = "1";
  await vi.waitFor(() =>
    expect(effect.setKeyframes.mock.calls.length).toBeGreaterThanOrEqual(4),
  );
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

const bounds = {
  left: 24,
  top: 133.75,
  width: 852,
  height: 532.5,
  right: 876,
  bottom: 666.25,
};
const boundedFrame = { ...frame, top: bounds.top, bounds };
function rectangle(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  } as DOMRect;
}
function positioner(left = 870.5, top = 253) {
  const popup = document.createElement("div");
  popup.style.cssText = `position:fixed; transform:translate(${left}px,${top}px); transform-origin:0px 0px;`;
  vi.spyOn(popup, "getBoundingClientRect").mockImplementation(() => {
    const [x, y] = popup.style.transform.match(/[\d.]+/g)!.map(Number);
    return rectangle(x, y, 386, 251);
  });
  document.body.append(popup);
  return popup;
}
function displayedPoint(popup: HTMLElement, point: number[]) {
  const delta = [...popup.style.translate.matchAll(/calc\(([-\d.e]+)px/g)].map(
    (match) => Number(match[1]),
  );
  return point.map((value, axis) => value * frame.scale + delta[axis]);
}

it("clamps a late viewport positioner to the final Frame bounds during page animation", async () => {
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(
    rectangle(0, 0, 1280, 800),
  );
  layer.update(boundedFrame);
  const popup = positioner();
  await vi.waitFor(() => expect(popup.style.scale).toBe(String(frame.scale)));
  const [left, top] = displayedPoint(popup, [870.5, 253]);
  expect(left + 386 * frame.scale).toBeCloseTo(bounds.right - 8);
  expect(top).toBeCloseTo(253);
  expect(popup.style.transform).toBe("translate(870.5px,253px)");
});

it("refreshes existing host positioners after Frame changes and re-clamps unchanged coordinates", async () => {
  const popup = positioner(500, 389);
  const place = vi.fn(() => {
    popup.style.transform = "translate(870.5px,253px)";
  });
  window.addEventListener("resize", place);
  try {
    layer.update(boundedFrame);
    expect(displayedPoint(popup, [500, 389])[0]).toBeCloseTo(
      24 + 500 * frame.scale,
    );
    await vi.waitFor(() => expect(place).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(
        displayedPoint(popup, [870.5, 253])[0] + 386 * frame.scale,
      ).toBeCloseTo(bounds.right - 8),
    );
    layer.reposition();
    await vi.waitFor(() => expect(place.mock.calls.length).toBeGreaterThan(1));
    expect(
      displayedPoint(popup, [870.5, 253])[0] + 386 * frame.scale,
    ).toBeCloseTo(bounds.right - 8);
  } finally {
    window.removeEventListener("resize", place);
  }
});

it("keeps the portal gap in screen pixels when the document is zoomed", async () => {
  layer.update({ ...boundedFrame, zoom: 2 });
  const popup = positioner();
  vi.mocked(popup.getBoundingClientRect).mockReturnValue(
    rectangle(1741, 506, 772, 502),
  );
  await vi.waitFor(() => expect(popup.style.scale).toBe(String(frame.scale)));
  const [left] = displayedPoint(popup, [870.5, 253]);
  expect((left + 386 * frame.scale) * 2).toBeCloseTo(bounds.right * 2 - 8);
});

it("leaves percentage translation and host transitions untouched over repeated geometry updates", () => {
  const modal = document.createElement("div");
  modal.style.cssText =
    "position:fixed;left:50%;top:50%;translate:-50% -50%;transition:all 180ms ease;scale:.95;";
  const style = modal.getAttribute("style");
  const effect = { composite: "add", setKeyframes: vi.fn() };
  const animation = {
    effect,
    pause: vi.fn(),
    cancel: vi.fn(),
    currentTime: null,
  };
  const transition = {
    playState: "running",
    effect: { getKeyframes: () => [{ opacity: 0 }, { opacity: 1 }] },
    cancel: vi.fn(),
  };
  modal.animate = vi.fn(() => animation as unknown as Animation);
  modal.getAnimations = vi.fn(
    () => [animation, transition] as unknown as Animation[],
  );
  document.body.append(modal);
  for (let index = 0; index < 100; index++) layer.update(boundedFrame);
  expect(modal.getAttribute("style")).toBe(style);
  layer.update(null);
  expect(modal.getAttribute("style")).toBe(style);
  expect(animation.cancel).toHaveBeenCalledOnce();
  expect(transition.cancel).not.toHaveBeenCalled();
});

it("constrains oversized portals reversibly without replacing host sizing updates", () => {
  const popup = positioner();
  popup.style.cssText +=
    "width:1800px;height:1200px;min-width:max-content;max-width:2000px;overflow:clip !important;";
  vi.mocked(popup.getBoundingClientRect).mockReturnValue(
    rectangle(10, 10, 1800, 1200),
  );
  layer.update(boundedFrame);
  expect(popup.style.minWidth).toBe("0px");
  expect(popup.style.maxWidth).toContain("1255.96px");
  expect(popup.style.overflow).toBe("auto");
  popup.style.setProperty("max-height", "1100px", "important");
  layer.update(boundedFrame);
  layer.update(null);
  expect(popup.style.minWidth).toBe("max-content");
  expect(popup.style.maxWidth).toBe("2000px");
  expect(popup.style.maxHeight).toBe("1100px");
  expect(popup.style.getPropertyPriority("max-height")).toBe("important");
  expect(popup.style.overflow).toBe("clip");
  expect(popup.style.getPropertyPriority("overflow")).toBe("important");
});

it("keeps overflow inside a wrapped dialog's scroll-lock boundary and restores both surfaces", () => {
  const popup = positioner();
  const dialog = document.createElement("div");
  dialog.role = "dialog";
  dialog.style.cssText =
    "height:394px;box-sizing:border-box;overflow:clip !important;max-height:600px;";
  const input = document.createElement("input");
  dialog.append(input);
  popup.append(dialog);
  input.focus();
  vi.mocked(popup.getBoundingClientRect).mockReturnValue(
    rectangle(0, 0, 480, 394),
  );
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(
    rectangle(0, 0, 480, 394),
  );
  Object.defineProperties(popup, {
    clientWidth: { value: 480 },
    clientHeight: { value: 320, configurable: true },
  });
  const shortBounds = { ...bounds, height: 213, bottom: bounds.top + 213 };
  // Centered modals use the entire height; translated positioners reserve an 8px gap.
  popup.style.transform = "translate(-50%, -50%)";
  layer.update({ ...boundedFrame, bounds: shortBounds });
  expect(dialog.style.overflow).toBe("auto");
  expect(dialog.style.maxHeight).toContain("320px");
  expect(dialog.parentElement).toBe(popup);
  expect(document.activeElement).toBe(input);
  expect(dialog.style.scale).toBe("");

  dialog.style.setProperty("overflow", "hidden", "important");
  dialog.style.setProperty("max-height", "700px", "important");
  Object.defineProperty(popup, "clientHeight", { value: 640 });
  layer.update(boundedFrame);
  expect(dialog.style.maxHeight).toContain("640px");
  expect(dialog.style.overflow).toBe("auto");
  layer.update(null);
  expect(dialog.style.maxHeight).toBe("700px");
  expect(dialog.style.getPropertyPriority("max-height")).toBe("important");
  expect(dialog.style.overflow).toBe("hidden");
  expect(dialog.style.getPropertyPriority("overflow")).toBe("important");
  expect(popup.style.maxHeight).toBe("");
});

it("restores a replaced dialog and constrains its replacement without touching nested portals", () => {
  const popup = positioner();
  vi.mocked(popup.getBoundingClientRect).mockReturnValue(
    rectangle(0, 0, 1800, 1200),
  );
  Object.defineProperties(popup, {
    clientWidth: { value: 1000 },
    clientHeight: { value: 600 },
  });
  const first = document.createElement("div");
  first.role = "dialog";
  popup.append(first);
  layer.update(boundedFrame);
  expect(first.style.overflow).toBe("auto");
  const replacement = document.createElement("div");
  replacement.role = "alertdialog";
  const nested = document.createElement("div");
  nested.role = "dialog";
  nested.style.position = "fixed";
  replacement.append(nested);
  first.replaceWith(replacement);
  layer.update(boundedFrame);
  expect(first.style.overflow).toBe("");
  expect(first.style.maxHeight).toBe("");
  expect(replacement.style.overflow).toBe("auto");
  expect(nested.style.overflow).toBe("");
  expect(nested.style.scale).toBe("");
  layer.destroy();
  expect(replacement.style.overflow).toBe("");
});

it("reserves wrapper padding, borders and dialog margins inside the available scroll area", () => {
  const popup = positioner();
  popup.style.cssText += "padding:10px;transform:translate(-50%, -50%);";
  vi.mocked(popup.getBoundingClientRect).mockReturnValue(
    rectangle(0, 0, 480, 394),
  );
  Object.defineProperties(popup, {
    clientWidth: { value: 480 },
    clientHeight: { value: 320 },
  });
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "padding:8px;border:2px solid;";
  const dialog = document.createElement("div");
  dialog.role = "dialog";
  dialog.style.cssText = "box-sizing:border-box;margin:4px;";
  wrapper.append(dialog);
  popup.append(wrapper);
  layer.update({
    ...boundedFrame,
    bounds: { ...bounds, height: 213, bottom: bounds.top + 213 },
  });
  // 320px minus 20px outer padding, 20px inner padding/borders and 8px margins.
  expect(dialog.style.maxHeight).toBe("272px");
  layer.destroy();
  expect(wrapper.style.cssText).toBe("padding: 8px; border: 2px solid;");
  expect(dialog.style.maxHeight).toBe("");
  expect(dialog.style.margin).toBe("4px");
});
