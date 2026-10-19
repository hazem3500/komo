// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { drawHighlight, watchHighlight } from "../src/highlight";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

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

it("scales a scientific radius serialization as one length", () => {
  const { element, rect, node } = target("8px", 0.665625);
  const computed = getComputedStyle(element);
  vi.spyOn(window, "getComputedStyle").mockImplementation(() => new Proxy(computed, {
    get(object, key) { return key === "borderRadius" ? "3.40282e+38px" : Reflect.get(object, key); },
  }));
  drawHighlight(node, rect, element);
  expect(node.style.borderRadius).toBe(`${3.40282e38 * 0.665625}px`);
});

it("coalesces target and ancestor changes, ignores feedback and unrelated churn, and disconnects on teardown", async () => {
  const host = document.createElement("div"), parent = document.createElement("section");
  const target = parent.appendChild(document.createElement("button"));
  const unrelated = document.createElement("aside");
  document.body.append(host, parent, unrelated);
  const update = vi.fn(), abort = new AbortController();
  watchHighlight(host, () => [target], update, abort.signal);
  host.className = "chrome";
  unrelated.className = "host-update";
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(update).not.toHaveBeenCalled();
  target.className = "rounded";
  parent.style.setProperty("--radius", "20px");
  await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
  target.remove();
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  abort.abort();
  parent.className = "after-destroy";
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(update).toHaveBeenCalledTimes(2);
});

it("follows running target animations and stops scheduling after abort", async () => {
  const host = document.createElement("div"), element = document.createElement("button");
  document.body.append(host, element);
  const update = vi.fn(), abort = new AbortController();
  element.getAnimations = () => [{ playState: "running" }] as Animation[];
  watchHighlight(host, () => [element], update, abort.signal);
  element.style.borderRadius = "24px";
  await vi.waitFor(() => expect(update.mock.calls.length).toBeGreaterThan(1));
  abort.abort();
  const count = update.mock.calls.length;
  await new Promise(resolve => setTimeout(resolve, 60));
  expect(update).toHaveBeenCalledTimes(count);
});

it("repaints for stylesheet insertion, editing, removal and load while ignoring unrelated head churn", async () => {
  const host = document.createElement("div"), element = document.createElement("button");
  document.body.append(host, element);
  const update = vi.fn(), abort = new AbortController();
  watchHighlight(host, () => [element], update, abort.signal);
  const meta = document.head.appendChild(document.createElement("meta"));
  meta.content = "unrelated";
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(update).not.toHaveBeenCalled();
  const style = document.createElement("style");
  style.textContent = "button{border-radius:40px}";
  document.head.append(style);
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  style.textContent = "button{border-radius:20px}";
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  style.firstChild!.textContent = "button{border-radius:12px}";
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(3));
  style.remove();
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(4));
  const link = document.createElement("link");
  link.rel = "stylesheet";
  document.head.append(link);
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(5));
  link.rel = "preload";
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(6));
  link.rel = "stylesheet";
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(7));
  link.dispatchEvent(new Event("load"));
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(8));
  link.remove();
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(9));
  abort.abort();
  document.head.append(link);
  link.dispatchEvent(new Event("load"));
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(update).toHaveBeenCalledTimes(9);
  link.remove();
  meta.remove();
});

it("softens transparent text at Frame scale while keeping visible square surfaces square", () => {
  for (const [surface, expected] of [
    ["", "2.5px"],
    ["background:#fff", "0px"],
    ["background:linear-gradient(#fff,#ddd)", "0px"],
    ["border-bottom:2px solid #333", "0px"],
    ["border:2px solid transparent", "2.5px"],
    ["outline-style:solid;outline-width:2px;outline-color:#333", "0px"],
    ["outline-style:solid;outline-width:2px;outline-color:transparent", "2.5px"],
  ]) {
    const element = document.createElement("span");
    element.textContent = "Review this text";
    element.style.cssText = `display:inline-block;box-sizing:border-box;width:200px;height:40px;border-radius:0;background:transparent;${surface}`;
    document.body.append(element);
    const node = document.createElement("div");
    drawHighlight(node, new DOMRect(40, 60, 125, 25), element);
    expect(node.style.borderRadius, surface).toBe(expected);
  }
});

it("preserves explicit corners on a transparent container", () => {
  const { element, rect, node } = target("0px 12px 0px 4px", 0.5);
  element.style.border = "none";
  element.style.background = "transparent";
  drawHighlight(node, rect, element);
  expect(node.style.borderRadius).toBe("0px 6px 0px 2px");
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
