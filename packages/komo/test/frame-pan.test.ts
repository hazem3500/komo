// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { anchoredPan, clampPan, scrollsFirst, wheelTravel } from "../src/frame-size";

/** A scroller with a layout jsdom doesn't compute. */
function scroller(overflow: string, box: { width: number; height: number; scrollWidth: number; scrollHeight: number; left?: number; top?: number }) {
  const node = document.createElement("div");
  // jsdom doesn't expand the shorthand into computed longhands.
  node.style.overflowX = node.style.overflowY = overflow;
  for (const [name, value] of Object.entries({ clientWidth: box.width, clientHeight: box.height, scrollWidth: box.scrollWidth, scrollHeight: box.scrollHeight }))
    Object.defineProperty(node, name, { value, configurable: true });
  Object.defineProperty(node, "scrollLeft", { value: box.left ?? 0, configurable: true, writable: true });
  Object.defineProperty(node, "scrollTop", { value: box.top ?? 0, configurable: true, writable: true });
  return node;
}

describe("Frame stage panning", () => {
  it("keeps the pan inside what the frame has beyond the stage", () => {
    expect(clampPan([-20, 50], [300, 40])).toEqual([0, 40]);
    expect(clampPan([120.6, 10.2], [300, 40])).toEqual([121, 10]);
    // A frame no larger than its stage never pans.
    expect(clampPan([80, 80], [0, 0])).toEqual([0, 0]);
  });

  it("reads wheel and trackpad travel in pixels, lines and pages, and turns Shift+wheel horizontal", () => {
    expect(wheelTravel({ deltaX: 3, deltaY: -12.5, deltaMode: 0, shiftKey: false }, [800, 600])).toEqual([3, -12.5]);
    expect(wheelTravel({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: false }, [800, 600])).toEqual([0, 48]);
    expect(wheelTravel({ deltaX: 0, deltaY: 1, deltaMode: 2, shiftKey: false }, [800, 600])).toEqual([0, 600]);
    expect(wheelTravel({ deltaX: 0, deltaY: 40, deltaMode: 0, shiftKey: true }, [800, 600])).toEqual([40, 0]);
    // Browsers that already turn Shift+wheel into deltaX keep it.
    expect(wheelTravel({ deltaX: 40, deltaY: 0, deltaMode: 0, shiftKey: true }, [800, 600])).toEqual([40, 0]);
  });

  it("lets the page's own scrollers go first and hands the stage the rest at their end", () => {
    const page = document.createElement("main");
    const list = scroller("auto", { width: 300, height: 200, scrollWidth: 300, scrollHeight: 900, top: 0 });
    const item = document.createElement("p");
    list.append(item);
    page.append(list);
    document.body.append(page);
    expect(scrollsFirst(item, 0, 40)).toBe(true);
    expect(scrollsFirst(item, 0, -40)).toBe(false);
    // Horizontal travel isn't the list's to take.
    expect(scrollsFirst(item, 40, 0)).toBe(false);
    Object.defineProperty(list, "scrollTop", { value: 700, configurable: true });
    expect(scrollsFirst(item, 0, 40)).toBe(false);
    expect(scrollsFirst(item, 0, -40)).toBe(true);
    // overflow: hidden is not a scroller for the wheel; body and html never are.
    const clipped = scroller("hidden", { width: 300, height: 200, scrollWidth: 300, scrollHeight: 900 });
    page.append(clipped);
    expect(scrollsFirst(clipped, 0, 40)).toBe(false);
    expect(scrollsFirst(document.body, 0, 40)).toBe(false);
    expect(scrollsFirst(null, 0, 40)).toBe(false);
    page.remove();
  });

  it("chains through shadow roots to the scroller that hosts them", () => {
    const outer = scroller("auto", { width: 300, height: 200, scrollWidth: 300, scrollHeight: 900 });
    const host = document.createElement("div");
    const inner = document.createElement("span");
    host.attachShadow({ mode: "open" }).append(inner);
    outer.append(host);
    document.body.append(outer);
    expect(scrollsFirst(inner, 0, 40)).toBe(true);
    outer.remove();
  });

  it("keeps the anchor point in place when Fit switches to 100%", () => {
    // Fitted at 50% from (24, 48); the point under the pointer is page (400, 300).
    const fitted = { left: 24, top: 48, scale: 0.5 };
    const point = { x: 24 + 400 * 0.5, y: 48 + 300 * 0.5 };
    const pan = anchoredPan(point, fitted, { left: 24, top: 48 });
    // At 100% the frame's left is box.left - pan, and the page point lands under the pointer again.
    expect(24 - pan[0] + 400).toBeCloseTo(point.x);
    expect(48 - pan[1] + 300).toBeCloseTo(point.y);
  });
});
