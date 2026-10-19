// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { changePreviewStyles, previewStyle } from "../src/design-preview.js";

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

it("restores the original transition and priority after interrupted comparisons", () => {
  vi.useFakeTimers();
  const element = document.body.appendChild(document.createElement("div"));
  element.style.setProperty("transition", "opacity 120ms linear", "important");
  const original = element.getAttribute("style");
  changePreviewStyles(element, ["color"], () => { element.style.color = "red"; }, true);
  vi.advanceTimersByTime(100);
  changePreviewStyles(element, ["color"], () => { element.style.color = "blue"; }, true);
  vi.advanceTimersByTime(220);
  expect(element.style.transition).toContain("color .3s");
  changePreviewStyles(element, ["color"], () => element.style.removeProperty("color"));
  expect(element.getAttribute("style")).toBe(original);
  vi.runAllTimers();
  expect(element.getAttribute("style")).toBe(original);
});

it("cleans an originally absent style attribute and preserves a host transition update", () => {
  vi.useFakeTimers();
  const element = document.body.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "path"));
  changePreviewStyles(element, ["color"], () => { element.style.color = "red"; }, true, true);
  changePreviewStyles(element, ["color"], () => element.style.removeProperty("color"), false, true);
  vi.runAllTimers();
  expect(element.getAttribute("style")).toBeNull();
  changePreviewStyles(element, ["color"], () => { element.style.color = "red"; }, true);
  element.style.setProperty("transition", "fill 90ms ease-in", "important");
  vi.runAllTimers();
  expect(element.style.transition).toBe("fill 90ms ease-in");
  expect(element.style.getPropertyPriority("transition")).toBe("important");
});

it.each(["html", "svg"])("rolls back a transient %s declaration to the exact priority and attribute presence", kind => {
  const element = kind === "svg" ? document.createElementNS("http://www.w3.org/2000/svg", "svg") : document.createElement("div");
  const undo = previewStyle(element, "color", "red");
  undo();
  expect(element.getAttribute("style")).toBeNull();
  element.style.setProperty("color", "blue", "important");
  const original = element.getAttribute("style");
  previewStyle(element, "color", "red")();
  expect(element.getAttribute("style")).toBe(original);
});
