// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { drawHighlight } from "../src/highlight";

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

function target(radius: string, scale = 1, sizing = "border-box") {
  const element = document.createElement("button");
  element.style.cssText = `width:200px;height:40px;padding:6px;border:2px solid;box-sizing:${sizing};border-radius:${radius}`;
  document.body.append(element);
  const rect = new DOMRect(40, 60, (sizing === "border-box" ? 200 : 216) * scale, 40 * scale);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
  return { element, rect, node: document.createElement("div") };
}

it("follows a rounded button's outer border in a scaled Frame", () => {
  const { element, rect, node } = target("12px", 0.625);
  expect(drawHighlight(node, rect, element)).toBe(true);
  expect(node.style.borderRadius).toBe("7.5px");
  expect(node.style.width).toBe("125px");
  expect(node.style.left).toBe("40px");
});

it("scales all corner and ellipse lengths while retaining percentage and pill radii", () => {
  for (const [radius, expected] of [
    ["4px 12px 0px 20px / 8px 16px 0px 24px", "2px 6px 0px 10px / 4px 8px 0px 12px"],
    ["50%", "50%"],
    ["9999px", "4999.5px"],
    ["0px", "0px"],
  ]) {
    const { element, rect, node } = target(radius, 0.5);
    drawHighlight(node, rect, element);
    expect(node.style.borderRadius).toBe(expected);
  }
});

it("uses the border box rather than content width when measuring scale", () => {
  const { element, rect, node } = target("16px", 0.75, "content-box");
  drawHighlight(node, rect, element);
  expect(node.style.borderRadius).toBe("12px");
});

it("clips the original card shape instead of making new rounded corners at a Frame edge", () => {
  const { element, rect, node } = target("24px");
  drawHighlight(node, rect, element, { left: 80, top: 0, right: 1000, bottom: 1000 });
  expect(node.style.left).toBe("40px");
  expect(node.style.width).toBe("200px");
  expect(node.style.clipPath).toBe("inset(-4px -4px -4px 40px)");
});

it("keeps area annotations square and hides fully clipped targets", () => {
  const { rect, node } = target("24px");
  drawHighlight(node, rect, null);
  expect(node.style.borderRadius).toBe("0px");
  expect(drawHighlight(node, rect, null, { left: 400, top: 0, right: 800, bottom: 800 })).toBe(false);
});
