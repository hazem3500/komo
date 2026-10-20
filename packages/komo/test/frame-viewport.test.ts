// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { createFrameViewport } from "../src/frame-viewport";

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

it("resolves viewport units against the frame in rules and inline styles and restores them", async () => {
  const style = document.createElement("style");
  style.textContent =
    ".shell{width:100vw;height:calc(100dvh - 10px) !important;--gap:2vmin}@media (min-width:1px){.nav{width:20svw;background:url(a-100vh.png)}}";
  document.head.append(style);
  const rules = () => [...style.sheet!.cssRules].map((rule) => rule.cssText);
  const before = rules();
  const node = document.createElement("div");
  node.setAttribute("style", "width:50vw;margin-left:-10vh;color:red");
  const host = document.createElement("div");
  host.setAttribute("style", "height:100vh");
  document.body.append(node, host);
  const viewport = createFrameViewport(host);
  viewport.update([800, 600]);
  const shell = (style.sheet!.cssRules[0] as CSSStyleRule).style;
  const nav = ((style.sheet!.cssRules[1] as CSSMediaRule).cssRules[0] as CSSStyleRule).style;
  expect(shell.width).toBe("800px");
  expect(shell.height).toMatch(/^calc\((600px - 10px|590px)\)$/);
  expect(shell.getPropertyPriority("height")).toBe("important");
  expect(shell.getPropertyValue("--gap")).toBe("12px");
  expect(nav.width).toBe("160px");
  expect(nav.background).toContain("a-100vh.png");
  expect(node.style.width).toBe("400px");
  expect(node.style.marginLeft).toBe("-60px");
  expect(host.style.height).toBe("100vh");
  viewport.update([400, 300]);
  expect(shell.width).toBe("400px");
  expect(node.style.width).toBe("200px");
  // Host changes made while framed are kept and resolved too.
  node.style.marginLeft = "5vw";
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(node.style.marginLeft).toBe("20px");
  viewport.update(null);
  expect(rules()).toEqual(before);
  expect(node.style.marginLeft).toBe("5vw");
  node.style.marginLeft = "-10vh";
  const attribute = node.getAttribute("style");
  viewport.update([800, 600]);
  viewport.update(null);
  expect(node.getAttribute("style")).toBe(attribute);
});
