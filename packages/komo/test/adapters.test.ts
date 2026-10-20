// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classTheme } from "../src/adapters/class-theme.js";
import { tailwindSpacing, tailwindTokens, type TailwindTable } from "../src/adapters/tailwind.js";
import type { DesignToken } from "../src/design-system.js";

const table: TailwindTable = {
  tokens: [
    { path: "color.text.primary", type: "color", class: "text-primary", properties: ["color"], group: "Text", values: { light: "#1f1f1f", dark: "#f5f5f5", "docs+dark": "#fce5d8" } },
    { path: "color.text.secondary", type: "color", class: "text-secondary", properties: ["color"], values: { light: "#555", dark: "#bbb" } },
    { path: "color.bg.primary-interactive", type: "color", class: "bg-primary-interactive", properties: ["background-color"], value: "#e57cd8", states: ["hover", "active", "disabled"] },
    { path: "radius.default", type: "dimension", class: ["rounded", "rounded-md"], properties: ["border-radius"], value: "6px" },
    { path: "radius.lg", type: "dimension", class: "rounded-lg", properties: ["border-radius"], value: "8px" },
    { path: "typography.h1", type: "typography", class: "text-h1", properties: ["font-size", "line-height", "font-weight"], value: "32px/40px 600" },
    ...tailwindSpacing({ prefix: ["p", "px", "gap"], steps: [2, 4, 6] }),
  ],
};
const token = (path: string) => tailwindTokens(table).list({}).find((item) => item.path === path) as DesignToken;

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("class");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
});

describe("tailwindTokens", () => {
  it("lists tokens with per-theme values and class refs", () => {
    const adapter = tailwindTokens(table);
    expect(adapter.id).toBe("tailwind");
    const value = (theme: Record<string, string>) => (adapter.list(theme) as DesignToken[])[0];
    expect(value({ mode: "light", product: "studio" })).toMatchObject({ path: "color.text.primary", value: "#1f1f1f", ref: "text-primary", group: "Text", properties: ["color"] });
    expect(value({ mode: "dark", product: "studio" }).value).toBe("#f5f5f5");
    expect(value({ mode: "dark", product: "docs" }).value).toBe("#fce5d8");
    expect(value({ mode: "dark" }).value).toBe("#f5f5f5");
    const list = adapter.list({}) as DesignToken[];
    expect(list.find((item) => item.path === "radius.default")).toMatchObject({ value: "6px", ref: "rounded" });
    expect(list.find((item) => item.path === "color.bg.primary-interactive")?.states).toEqual(["hover", "active", "disabled"]);
  });

  it("accepts axis=option keys and reads the current theme from axes", () => {
    document.documentElement.className = "dark";
    const mode = classTheme({ id: "mode", options: [{ id: "light", class: "light" }, { id: "dark", class: "dark" }] });
    const adapter = tailwindTokens({ tokens: [{ path: "x", type: "color", class: "x", properties: ["color"], value: "base", values: { "mode=dark": "night" } }] }, { themes: [mode] });
    expect((adapter.list() as DesignToken[])[0].value).toBe("night");
    expect((adapter.list({ mode: "light" }) as DesignToken[])[0].value).toBe("base");
  });

  it("resolves exact classes, ignores variants, and covers several properties per class", () => {
    const adapter = tailwindTokens(table, { offToken: false });
    const element = document.createElement("p");
    element.className = "hover:text-primary md:rounded-lg text-secondary rounded-md text-h1 flex";
    expect(adapter.resolve(element)).toEqual({
      color: { path: "color.text.secondary" },
      "border-radius": { path: "radius.default" },
      "border-top-left-radius": { path: "radius.default" },
      "border-top-right-radius": { path: "radius.default" },
      "border-bottom-right-radius": { path: "radius.default" },
      "border-bottom-left-radius": { path: "radius.default" },
      "font-size": { path: "typography.h1" },
      "line-height": { path: "typography.h1" },
      "font-weight": { path: "typography.h1" },
    });
    element.className = "!text-primary";
    expect(adapter.resolve(element)).toEqual({ color: { path: "color.text.primary" } });
  });

  it("lets narrower classes win longhands and drops a shorthand they split", () => {
    const adapter = tailwindTokens(table, { offToken: false });
    const element = document.createElement("div");
    element.className = "px-2 p-4";
    const usage = adapter.resolve(element) as Record<string, unknown>;
    expect(usage["padding-left"]).toEqual({ path: "spacing.px-2" });
    expect(usage["padding-top"]).toEqual({ path: "spacing.p-4" });
    expect(usage.padding).toBeUndefined();
    element.className = "p-4";
    expect((adapter.resolve(element) as Record<string, unknown>).padding).toEqual({ path: "spacing.p-4" });
  });

  it("reports allowlisted properties without a table class as off-token", () => {
    const adapter = tailwindTokens(table, { offToken: ["color", "background-color", "padding"] });
    const element = document.createElement("p");
    element.className = "text-primary px-2";
    element.style.backgroundColor = "rgb(1, 2, 3)";
    document.body.append(element);
    const usage = adapter.resolve(element) as Record<string, unknown>;
    expect(usage.color).toEqual({ path: "color.text.primary" });
    expect(usage["background-color"]).toEqual({ offToken: "rgb(1, 2, 3)" });
    // padding is partly tokenised by px-2, so komo is not told it is off-token.
    expect(usage.padding).toBeUndefined();
  });

  it("previews by swapping classes in place and restores the exact className", () => {
    const adapter = tailwindTokens(table);
    const element = document.createElement("p");
    const original = "  hover:text-primary text-secondary  text-h1 ";
    element.setAttribute("class", original);
    const undo = adapter.preview!(element, "color", token("color.text.primary"));
    expect(element.className).toBe("hover:text-primary text-primary text-h1");
    undo();
    expect(element.getAttribute("class")).toBe(original);
    undo();
    expect(element.getAttribute("class")).toBe(original);

    const bare = document.createElement("p");
    adapter.preview!(bare, "color", token("color.text.primary"))();
    expect(bare.hasAttribute("class")).toBe(false);
  });

  it("supersedes an inline important value without losing its original declaration or other properties", () => {
    const adapter = tailwindTokens(table);
    const element = document.createElement("p");
    element.className = "text-secondary rounded";
    element.style.setProperty("color", "rgb(239, 51, 64)", "important");
    element.style.setProperty("padding", "9px 12px", "important");
    document.body.append(element);
    const original = element.getAttribute("style");
    expect((adapter.resolve(element) as Record<string, unknown>).color).toEqual({ offToken: "rgb(239, 51, 64)" });
    const undo = adapter.preview!(element, "color", token("color.text.primary"));
    expect(element.style.color).toBe("");
    expect(element.style.padding).toBe("9px 12px");
    expect((adapter.resolve(element) as Record<string, unknown>).color).toEqual({ path: "color.text.primary" });
    undo();
    expect(element.getAttribute("style")).toBe(original);
    expect(element.style.getPropertyPriority("color")).toBe("important");
  });

  it("removes only classes the new token fully replaces", () => {
    const adapter = tailwindTokens(table);
    const element = document.createElement("div");
    element.className = "p-4 px-2 gap-2";
    const undo = adapter.preview!(element, "padding-left", token("spacing.px-6"));
    expect(element.className).toBe("p-4 px-6 gap-2");
    undo();
    const all = adapter.preview!(element, "padding", token("spacing.p-6"));
    expect(element.className).toBe("p-6 gap-2");
    all();
    expect(element.className).toBe("p-4 px-2 gap-2");
  });

  it("stacks previews on one element and undoes them in any order", () => {
    const adapter = tailwindTokens(table);
    const element = document.createElement("button");
    element.className = "text-secondary rounded";
    const color = adapter.preview!(element, "color", token("color.text.primary"));
    const radius = adapter.preview!(element, "border-radius", token("radius.lg"));
    const background = adapter.preview!(element, "background-color", token("color.bg.primary-interactive"));
    expect(element.className).toBe("text-primary rounded-lg bg-primary-interactive");
    color();
    expect(element.className).toBe("text-secondary rounded-lg bg-primary-interactive");
    background();
    expect(element.className).toBe("text-secondary rounded-lg");
    radius();
    expect(element.className).toBe("text-secondary rounded");
  });

  it("describes the source change", () => {
    const adapter = tailwindTokens(table);
    const element = document.createElement("p");
    element.className = "text-secondary rounded-md";
    expect(adapter.describe!(element, "color", { path: "color.text.secondary" }, token("color.text.primary"))).toBe('Replace class "text-secondary" with "text-primary"');
    expect(adapter.describe!(element, "border-radius", { path: "radius.default" }, token("radius.lg"))).toBe('Replace class "rounded-md" with "rounded-lg"');
    expect(adapter.describe!(element, "background-color", { offToken: "rgb(0, 0, 0)" }, token("color.bg.primary-interactive"))).toBe('Add class "bg-primary-interactive"');
    // While previewing, the description still refers to the source class.
    const undo = adapter.preview!(element, "color", token("color.text.primary"));
    expect(adapter.describe!(element, "color", { path: "color.text.secondary" }, token("color.text.primary"))).toBe('Replace class "text-secondary" with "text-primary"');
    undo();
  });

  it("maps tokens to their CSS variable to preview Tokens view values", () => {
    expect(tailwindTokens(table).previewValues).toBeUndefined();
    const channels = (value: string) => value.replace("#", "").match(/../g)!.map((pair) => parseInt(pair, 16)).join(" ");
    const adapter = tailwindTokens({ tokens: [
      { path: "color.bg.surface", type: "color", class: "bg-surface", properties: ["background-color"], values: { light: "#131213", dark: "#e6e6e6" }, cssVariable: "--color-surface", toCss: channels },
      { path: "color.bg.raised", type: "color", class: "bg-raised", properties: ["background-color"], value: "#222222", cssVariable: "--color-raised" },
      { path: "radius.md", type: "dimension", class: "rounded-md", properties: ["border-radius"], value: "6px" },
    ] }, { scopes: { dark: ".dark" } });
    const listed = adapter.list({ mode: "dark" }) as DesignToken[];
    expect(listed[0]).toMatchObject({ value: "#e6e6e6", cssVariable: "--color-surface" });
    expect(listed[0].toCss!("#ff8000")).toBe("255 128 0");
    const cleanup = adapter.previewValues!([
      { path: "color.bg.surface", value: "#ff8000", theme: "dark" },
      { path: "color.bg.raised", value: "#0f0f0f", alias: "color.bg.surface", theme: "light" },
      { path: "radius.md", value: "8px" },
    ]);
    const sheet = document.querySelector("style[data-komo-token-preview]");
    expect(sheet?.textContent).toBe(":is(.dark){--color-surface:255 128 0!important}:root:not(.dark){--color-raised:var(--color-surface)!important}");
    cleanup();
    expect(document.querySelector("style[data-komo-token-preview]")).toBeNull();
  });
});

describe("tailwindSpacing", () => {
  it("emits the 4px scale for each family", () => {
    const all = tailwindSpacing();
    expect(all.find((item) => item.class === "p-4")).toEqual({ path: "spacing.p-4", type: "dimension", class: "p-4", properties: ["padding"], value: "16px", group: "Padding", label: "p-4" });
    expect(all.find((item) => item.class === "px-0.5")).toMatchObject({ properties: ["padding-left", "padding-right"], value: "2px" });
    expect(all.find((item) => item.class === "gap-x-96")).toMatchObject({ properties: ["column-gap"], value: "384px", group: "Gap" });
    expect(all.find((item) => item.class === "mt-2")).toMatchObject({ properties: ["margin-top"], group: "Margin" });
    expect(new Set(all.map((item) => item.path)).size).toBe(all.length);
    expect(tailwindSpacing({ prefix: ["gap"], scale: 8, steps: [1, 2] })).toMatchObject([{ class: "gap-1", value: "8px" }, { class: "gap-2", value: "16px" }]);
    expect(() => tailwindSpacing({ prefix: ["space-x"] })).toThrow(/space-x/);
  });
});

describe("classTheme", () => {
  it("notifies external changes on its target and unsubscribes without unrelated updates", async () => {
    const root = document.createElement("div");
    const axis = classTheme({ id: "mode", target: () => root, options: [{ id: "light" }, { id: "dark", attribute: { "data-mode": "dark" } }] });
    let updates = 0;
    const stop = axis.subscribe!(() => updates++);
    root.setAttribute("data-unrelated", "value");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(updates).toBe(0);
    root.setAttribute("data-mode", "dark");
    await expect.poll(() => updates).toBe(1);
    stop();
    root.removeAttribute("data-mode");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(updates).toBe(1);
  });

  it("reads and switches classes on <html>, with color-scheme", () => {
    document.documentElement.className = "font-sans light";
    const mode = classTheme({ id: "mode", label: "Mode", options: [{ id: "light", label: "Light", class: "light" }, { id: "dark", label: "Dark", class: "dark" }], colorScheme: true });
    expect(mode).toMatchObject({ id: "mode", label: "Mode", options: [{ id: "light", label: "Light" }, { id: "dark", label: "Dark" }] });
    expect(mode.current()).toBe("light");
    mode.apply("dark");
    expect(document.documentElement.className).toBe("font-sans dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(mode.current()).toBe("dark");
    mode.apply("light");
    expect(document.documentElement.className).toBe("font-sans light");
    // The starting option restores the page's own inline color-scheme.
    expect(document.documentElement.style.colorScheme).toBe("");
    mode.apply("missing");
    expect(mode.current()).toBe("light");
  });

  it("reads and switches attributes on a custom target", () => {
    const root = document.createElement("div");
    root.setAttribute("data-theme", "docs");
    const product = classTheme({ id: "product", target: () => root, options: [{ id: "studio", attribute: { "data-theme": "studio" } }, { id: "docs", attribute: { "data-theme": "docs" } }] });
    expect(product.current()).toBe("docs");
    product.apply("studio");
    expect(root.getAttribute("data-theme")).toBe("studio");
    expect(product.current()).toBe("studio");
    expect(root.style.colorScheme).toBe("");
  });

  it("supports a marker-less default option and prefers the most specific match", () => {
    const axis = classTheme({ id: "contrast", options: [{ id: "normal" }, { id: "high", class: "contrast-high", attribute: { "data-contrast": "high" } }] });
    expect(axis.current()).toBe("normal");
    axis.apply("high");
    expect(document.documentElement.className).toBe("contrast-high");
    expect(axis.current()).toBe("high");
    axis.apply("normal");
    expect(document.documentElement.className).toBe("");
    expect(document.documentElement.hasAttribute("data-contrast")).toBe(false);
  });
});

describe("adapter entry points", () => {
  it("are exported with types and built as separate entries", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    const build = readFileSync(join(import.meta.dirname, "../scripts/build.mjs"), "utf8");
    for (const name of ["tailwind", "class-theme"]) {
      expect(pkg.exports[`./adapters/${name}`]).toEqual({ types: `./dist/adapters/${name}.d.ts`, import: `./dist/adapters/${name}.js` });
      expect(build).toContain(`"src/adapters/${name}.ts"`);
    }
  });

  it("are never imported by core", () => {
    for (const file of ["index.ts", "design-mode.ts", "design-panel.ts", "design-tokens.ts", "react.ts"])
      expect(readFileSync(join(import.meta.dirname, `../src/${file}`), "utf8")).not.toMatch(/adapters\//);
  });
});
