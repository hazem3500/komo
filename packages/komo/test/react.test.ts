// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KomoConfig } from "../src/config";

const init = vi.hoisted(() => vi.fn());
vi.mock("../src/index.js", () => ({ initKomo: init }));
import { useKomo } from "../src/react";

function App({ config }: { config: KomoConfig }) {
  useKomo(config);
  return null;
}
let root: Root;
let container: HTMLDivElement;
let active: number;
let peak: number;
let destroyed: ReturnType<typeof vi.fn>[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  active = peak = 0;
  destroyed = [];
  init.mockReset().mockImplementation(() => {
    active++;
    peak = Math.max(active, peak);
    const destroy = vi.fn(() => active--);
    destroyed.push(destroy);
    return { destroy };
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(active).toBe(0);
});
const render = async (config: KomoConfig) => {
  await act(async () => root.render(createElement(App, { config })));
};
describe("useKomo", () => {
  it("preserves the instance across equivalent inline options", async () => {
    await render({ project: "test" });
    await render({ project: "test" });
    expect(init).toHaveBeenCalledTimes(1);
    expect(active).toBe(1);
  });
  it("preserves pending setup across equivalent site lists", async () => {
    const pending = () => ({
      project: "setup_fixture",
      onboarding: {
        inProject: true,
        code: "fixture",
        sites: ["https://site.example"],
      },
    });
    await render(pending());
    await render(pending());
    expect(init).toHaveBeenCalledTimes(1);
    await render({
      ...pending(),
      onboarding: { ...pending().onboarding, sites: ["https://other.example"] },
    });
    expect(init).toHaveBeenCalledTimes(2);
  });
  it("compares inline shortcut options by value", async () => {
    await render({ project: "test", shortcuts: { comment: "M" } });
    await render({ project: "test", shortcuts: { comment: "M" } });
    expect(init).toHaveBeenCalledTimes(1);
    await render({ project: "test", shortcuts: { comment: "N" } });
    expect(init).toHaveBeenCalledTimes(2);
  });
  it("compares inline feature options by value", async () => {
    await render({ project: "test", features: { tags: false } });
    await render({ project: "test", features: { tags: false } });
    expect(init).toHaveBeenCalledTimes(1);
    await render({ project: "test", features: { tags: true } });
    expect(init).toHaveBeenCalledTimes(2);
  });
  it("cleans up before remounting changed configuration", async () => {
    await render({ project: "first" });
    await render({ project: "second" });
    expect(destroyed[0]).toHaveBeenCalledOnce();
    expect(init).toHaveBeenLastCalledWith({ project: "second" });
    expect(peak).toBe(1);
  });
  it("supports disabling and re-enabling", async () => {
    await render({ project: "test", enabled: false });
    expect(init).not.toHaveBeenCalled();
    await render({ project: "test", enabled: true });
    await render({ project: "test", enabled: false });
    expect(active).toBe(0);
    await render({ project: "test" });
    expect(active).toBe(1);
  });
  it("does not overlap instances during Strict Mode effect replay", async () => {
    await act(async () =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(App, { config: { project: "test" } }),
        ),
      ),
    );
    expect(init).toHaveBeenCalledTimes(2);
    expect(destroyed[0]).toHaveBeenCalledOnce();
    expect(active).toBe(1);
    expect(peak).toBe(1);
  });
  it("does not initialize during server rendering", () => {
    expect(
      renderToString(createElement(App, { config: { project: "test" } })),
    ).toBe("");
    expect(init).not.toHaveBeenCalled();
  });
  it("compares callback and element options by identity", async () => {
    const page = () => "/";
    await render({ project: "test", page, pageRoot: container });
    await render({ project: "test", page, pageRoot: container });
    expect(init).toHaveBeenCalledTimes(1);
    await render({ project: "test", page: () => "/new", pageRoot: container });
    expect(init).toHaveBeenCalledTimes(2);
    const pickRoots = () => [container];
    await render({ project: "test", pickRoots });
    await render({ project: "test", pickRoots });
    expect(init).toHaveBeenCalledTimes(3);
    await render({ project: "test", pickRoots: () => [container] });
    expect(init).toHaveBeenCalledTimes(4);
  });
});
