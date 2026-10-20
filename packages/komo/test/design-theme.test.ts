// @vitest-environment jsdom
// The Design panel's theme control: one light/dark axis is a one-click switch, more
// options or axes are a compact menu with one row per axis, and nothing to choose shows
// nothing. Switching re-lists tokens for the new theme, and Design mode puts the
// original theme back when it closes. Theme is context, not an edit, so Before/After,
// Undo and Reset leave it alone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesignMode } from "../src/design-mode.js";
import { designContext } from "../src/react-props-panel.js";
import type { DesignSystem, DesignToken, ThemeAxis, ThemeState, TokenAdapter, TokenUsage } from "../src/design-system.js";

const values: Record<string, Record<string, string>> = {
  light: { "color.text.primary": "#1f1f1f", "color.text.secondary": "#6b6b6b" },
  dark: { "color.text.primary": "#f5f5f5", "color.text.secondary": "#a3a3a3" },
};
const tokensFor = (theme?: ThemeState): DesignToken[] =>
  Object.entries(values[theme?.mode ?? "light"]).map(([path, value]) => ({
    path, type: "color", value, properties: ["color"], ref: path.replace("color.", "").replace(".", "-"),
  }));

function adapter(): TokenAdapter & { list: ReturnType<typeof vi.fn> } {
  return {
    id: "classes",
    list: vi.fn(tokensFor),
    resolve(element): Record<string, TokenUsage> {
      const token = tokensFor().find((item) => element.classList.contains(item.ref!));
      return { color: token ? { path: token.path } : { offToken: "#000" } };
    },
    preview(element, _property, token) {
      const old = tokensFor().find((item) => element.classList.contains(item.ref!))?.ref;
      if (old) element.classList.remove(old);
      element.classList.add(token.ref!);
      return () => {
        element.classList.remove(token.ref!);
        if (old) element.classList.add(old);
      };
    },
  } as TokenAdapter & { list: ReturnType<typeof vi.fn> };
}

/** A light/dark axis on <html data-mode>, like the react-props example's `?theme`. */
function modeAxis(): ThemeAxis & { apply: ReturnType<typeof vi.fn> } {
  return {
    id: "mode",
    options: [{ id: "light" }, { id: "dark" }],
    current: () => document.documentElement.dataset.mode ?? "light",
    apply: vi.fn((id: string) => { document.documentElement.dataset.mode = id; }),
  };
}

let shadow: ShadowRoot;
let label: HTMLElement;
let controller: ReturnType<typeof createDesignMode> | undefined;

async function open(design: DesignSystem) {
  document.body.innerHTML = '<main><p id="label" class="text-secondary">Hello</p></main><div id="komo"></div>';
  label = document.querySelector("#label")!;
  const host = document.querySelector<HTMLElement>("#komo")!;
  shadow = host.attachShadow({ mode: "open" });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  controller = createDesignMode({ root: shadow, host, design, targetAt: () => label, onComment: () => {}, onExit: () => {} });
  controller.setActive(true);
  await controller.ready;
  pick();
  await vi.waitFor(() => expect(field().querySelector(".design-token-binding")).not.toBeNull());
}
function pick() {
  const event = new Event("pointerdown", { bubbles: true, cancelable: true, composed: true });
  Object.defineProperties(event, { clientX: { value: 10 }, clientY: { value: 10 }, button: { value: 0 } });
  label.dispatchEvent(event);
}
const field = () => shadow.querySelector<HTMLElement>('[data-field-property="color"]')!;
const option = (path: string) => field().querySelector<HTMLOptionElement>(`.design-token-binding option[value="${path}"]`);
const switcher = () => shadow.querySelector<HTMLElement>(".design-theme-switch");
const themeButton = (name: string) =>
  [...shadow.querySelectorAll<HTMLButtonElement>(".design-theme-options button")].find((button) => button.textContent === name)!;
const toggle = () => shadow.querySelector<HTMLButtonElement>(".design-theme-toggle")!;
const tool = (name: string) => shadow.querySelector<HTMLButtonElement>(`.design-inspector__actions [aria-label="${name}"]`)!;

afterEach(() => {
  controller?.destroy();
  controller = undefined;
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.mode;
  document.body.replaceChildren();
});

describe("Design panel theme switcher", () => {
  it("keeps arbitrary theme axes in a compact header menu", async () => {
    const product: ThemeAxis = {
      id: "product", label: "Product", options: ["studio", "docs", "plan", "work"].map((id) => ({ id })),
      current: () => "docs", apply() {},
    };
    await open({ tokens: adapter(), themes: [modeAxis(), product] });
    await vi.waitFor(() => expect(switcher()).not.toBeNull());
    expect(switcher()!.parentElement).toBe(shadow.querySelector(".design-inspector__heading"));
    expect(switcher()!.querySelector("summary")!.getAttribute("aria-label")).toBe("Preview theme");
    expect((switcher() as HTMLDetailsElement).open).toBe(false);
    const rows = [...switcher()!.querySelector(".design-theme-popup")!.children].map((row) => row.querySelector("span")!.textContent);
    expect(rows).toEqual(["Mode", "Product"]);
    expect(themeButton("Light").getAttribute("aria-pressed")).toBe("true");
    expect(themeButton("Dark").getAttribute("aria-pressed")).toBe("false");
    expect(switcher()!.querySelector("select")!.value).toBe("docs");
  });

  it("applies the option, then lists tokens for the new theme and refreshes the chips and context", async () => {
    const tokens = adapter();
    const mode = modeAxis();
    await open({ tokens, themes: [mode] });
    expect(option("color.text.secondary")!.title).toContain("#6b6b6b");
    toggle().click();
    expect(mode.apply).toHaveBeenCalledWith("dark");
    await vi.waitFor(() => expect(option("color.text.secondary")?.title).toContain("#a3a3a3"));
    expect(tokens.list).toHaveBeenLastCalledWith({ mode: "dark" });
    expect(field().querySelector(".design-token-chip")!.textContent).toBe("Uses color.text.secondary");
    expect(toggle().getAttribute("aria-label")).toBe("Theme: Dark");
    // Focus follows the switch across the re-render.
    expect(shadow.activeElement).toBe(toggle());
    expect(designContext(label, { themes: [mode] })).toEqual(["Theme: mode=dark"]);
    // Theme is context: no change to count, undo or reset.
    expect(tool("Undo").disabled).toBe(true);
    expect(tool("Reset").disabled).toBe(true);
  });

  it("restores the original option when Design mode exits", async () => {
    const mode = modeAxis();
    document.documentElement.dataset.mode = "light";
    await open({ tokens: adapter(), themes: [mode] });
    toggle().click();
    await vi.waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("true"));
    expect(document.documentElement.dataset.mode).toBe("dark");
    controller!.setActive(false);
    expect(document.documentElement.dataset.mode).toBe("light");
    expect(mode.apply).toHaveBeenLastCalledWith("light");
    // The next session starts from the restored theme and records its own original.
    mode.apply.mockClear();
    controller!.setActive(true);
    pick();
    await vi.waitFor(() => expect(toggle().getAttribute("aria-label")).toBe("Theme: Light"));
    controller!.setActive(false);
    expect(mode.apply).not.toHaveBeenCalled();
  });

  it("restores the original option when the widget is destroyed", async () => {
    const mode = modeAxis();
    document.documentElement.dataset.mode = "dark";
    await open({ tokens: adapter(), themes: [mode] });
    expect(toggle().getAttribute("aria-label")).toBe("Theme: Dark");
    toggle().click();
    await vi.waitFor(() => expect(toggle().getAttribute("aria-label")).toBe("Theme: Light"));
    expect(document.documentElement.dataset.mode).toBe("light");
    controller!.destroy();
    controller = undefined;
    expect(document.documentElement.dataset.mode).toBe("dark");
  });

  it("keeps the theme through Before/After, Undo and Reset", async () => {
    const mode = modeAxis();
    await open({ tokens: adapter(), themes: [mode] });
    toggle().click();
    await vi.waitFor(() => expect(option("color.text.primary")?.title).toContain("#f5f5f5"));
    const picker = field().querySelector<HTMLSelectElement>(".design-token-binding select")!;
    picker.value = "color.text.primary";
    picker.dispatchEvent(new Event("change"));
    expect(label.className).toBe("text-primary");
    mode.apply.mockClear();
    const [before, after] = shadow.querySelectorAll<HTMLButtonElement>(".design-inspector__compare button");
    before.click();
    expect(label.className).toBe("text-secondary");
    expect(document.documentElement.dataset.mode).toBe("dark");
    after.click();
    expect(label.className).toBe("text-primary");
    expect(document.documentElement.dataset.mode).toBe("dark");
    tool("Undo").click();
    expect(label.className).toBe("text-secondary");
    expect(document.documentElement.dataset.mode).toBe("dark");
    picker.value = "color.text.primary";
    picker.dispatchEvent(new Event("change"));
    tool("Reset").click();
    expect(label.className).toBe("text-secondary");
    expect(document.documentElement.dataset.mode).toBe("dark");
    expect(mode.apply).not.toHaveBeenCalled();
  });

  it("survives an axis whose current() or apply() throws", async () => {
    const mode = modeAxis();
    const unreadable: ThemeAxis = { id: "broken", options: [{ id: "a" }, { id: "b" }], current: () => { throw new Error("no"); }, apply() {} };
    let density = "cozy";
    const failing: ThemeAxis = {
      id: "density",
      options: [{ id: "cozy" }, { id: "compact" }],
      current: () => density,
      apply: vi.fn((id: string) => {
        density = id;
        throw new Error("half applied");
      }),
    };
    await open({ tokens: adapter(), themes: [unreadable, failing, mode] });
    await vi.waitFor(() => expect(switcher()).not.toBeNull());
    // An axis komo can't read is left out; the others still work.
    expect([...switcher()!.querySelector(".design-theme-popup")!.children].map((row) => row.querySelector("span")!.textContent)).toEqual(["Density", "Mode"]);
    expect(() => themeButton("Compact").click()).not.toThrow();
    await vi.waitFor(() => expect(themeButton("Compact").getAttribute("aria-pressed")).toBe("true"));
    await vi.waitFor(() => expect(field().querySelector(".design-token-binding")).not.toBeNull());
    themeButton("Dark").click();
    await vi.waitFor(() => expect(themeButton("Dark").getAttribute("aria-pressed")).toBe("true"));
    // Restoring tries every axis, even after one throws.
    expect(() => controller!.setActive(false)).not.toThrow();
    expect(failing.apply).toHaveBeenLastCalledWith("cozy");
    expect(document.documentElement.dataset.mode).toBe("light");
  });

  it("switches one light/dark axis with a single click on a sun/moon switch", async () => {
    const mode = modeAxis();
    await open({ tokens: adapter(), themes: [mode] });
    expect(switcher()).toBeNull();
    const control = toggle();
    expect(control.parentElement).toBe(shadow.querySelector(".design-inspector__heading"));
    expect(control.nextElementSibling).toBe(shadow.querySelector(".design-inspector__close"));
    expect(control.getAttribute("role")).toBe("switch");
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(control.getAttribute("aria-label")).toBe("Theme: Light");
    expect(control.dataset.tip).toBe("Switch to Dark");
    expect(control.querySelector("svg")).not.toBeNull();
    expect(control.textContent).toBe("");
    control.click();
    expect(mode.apply).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(toggle().getAttribute("aria-label")).toBe("Theme: Dark"));
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(toggle().dataset.tip).toBe("Switch to Light");
    toggle().click();
    await vi.waitFor(() => expect(document.documentElement.dataset.mode).toBe("light"));
    // Never a third, invented option.
    expect(mode.apply.mock.calls.map(([id]) => id)).toEqual(["dark", "light"]);
  });

  it("matches light/dark by label too, and keeps the supplied labels", async () => {
    let id = "day";
    const axis: ThemeAxis = {
      id: "appearance", options: [{ id: "day", label: "Light" }, { id: "night", label: "Dark" }],
      current: () => id, apply: (next) => { id = next; },
    };
    await open({ tokens: adapter(), themes: [axis] });
    expect(toggle().querySelector("svg")).not.toBeNull();
    expect(toggle().getAttribute("aria-label")).toBe("Theme: Light");
    toggle().click();
    await vi.waitFor(() => expect(toggle().getAttribute("aria-label")).toBe("Theme: Dark"));
    expect(id).toBe("night");
  });

  it("shows two other options as a two-segment switch with their labels", async () => {
    let density = "cozy";
    const axis: ThemeAxis = {
      id: "density", options: [{ id: "cozy", label: "Cozy" }, { id: "compact", label: "Compact layout" }],
      current: () => density, apply: (next) => { density = next; },
    };
    await open({ tokens: adapter(), themes: [axis] });
    expect(switcher()).toBeNull();
    expect([...toggle().querySelectorAll("span")].map(span => span.textContent)).toEqual(["Cozy", "Compact layout"]);
    expect(toggle().querySelector("svg")).toBeNull();
    expect(toggle().dataset.on).toBe("0");
    expect(toggle().getAttribute("aria-label")).toBe("Theme: Cozy");
    expect(toggle().dataset.tip).toBe("Switch to Compact layout");
    toggle().click();
    await vi.waitFor(() => expect(toggle().dataset.on).toBe("1"));
    expect(density).toBe("compact");
    expect(toggle().getAttribute("aria-label")).toBe("Theme: Compact layout");
  });

  it("keeps three options in the compact menu", async () => {
    const axis: ThemeAxis = {
      id: "mode", options: [{ id: "light" }, { id: "dark" }, { id: "contrast" }],
      current: () => document.documentElement.dataset.mode ?? "light",
      apply: (id) => { document.documentElement.dataset.mode = id; },
    };
    await open({ tokens: adapter(), themes: [axis] });
    expect(shadow.querySelector(".design-theme-toggle")).toBeNull();
    expect(switcher()!.querySelector("summary")!.textContent).toBe("Light");
    expect([...switcher()!.querySelectorAll(".design-theme-options button")].map(button => button.textContent)).toEqual(["Light", "Dark", "Contrast"]);
    themeButton("Contrast").click();
    await vi.waitFor(() => expect(switcher()!.querySelector("summary")!.textContent).toBe("Contrast"));
  });

  it("follows a theme the host changes outside the inspector", async () => {
    const listeners = new Set<() => void>();
    const mode: ThemeAxis = { ...modeAxis(), subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
    await open({ tokens: adapter(), themes: [mode] });
    document.documentElement.dataset.mode = "dark";
    listeners.forEach(listener => listener());
    await vi.waitFor(() => expect(toggle().getAttribute("aria-label")).toBe("Theme: Dark"));
    expect(toggle().dataset.tip).toBe("Switch to Light");
  });

  it.each([["no themes", undefined], ["an empty list", []]])("shows no control for %s", async (_, themes) => {
    await open({ tokens: adapter(), themes: themes as ThemeAxis[] | undefined });
    await Promise.resolve();
    expect(shadow.querySelector(".design-theme-switch, .design-theme-toggle")).toBeNull();
  });

  it("shows no switcher without an axis that has a choice", async () => {
    await open({ tokens: adapter(), themes: [{ id: "solo", options: [{ id: "only" }], current: () => "only", apply() {} }] });
    await Promise.resolve();
    expect(switcher()).toBeNull();
  });
});
