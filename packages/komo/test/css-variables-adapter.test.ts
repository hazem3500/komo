// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { discoverCssTokens } from "../src/adapters/css-variables.js";
import type { DesignToken } from "../src/design-system.js";

const css = `
  @media all { :root, :host {
    --color-brand: #e57cd8; --color-ink: rgb(10, 10, 10);
    --spacing: 0.25rem; --spacing-card: 24px; --radius-lg: 12px;
    --text-lg: 1.125rem; --font-sans: ui-sans-serif, system-ui; --font-weight-bold: 700;
    --tw-ring: 0 0 #0000; --shadow-x: none; --opaque: 5;
  } }
  .card { padding: var(--spacing-card); background: var(--color-brand); border-radius: 4px; }
  #hero .card { border-radius: var(--radius-lg); }
  .plain { color: #123456; }
  .card.warn { background-color: var(--color-ink); }
`;

function mount(html: string) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  document.body.innerHTML = html;
}
afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("discoverCssTokens", () => {
  it("discovers :root variables, typed by Tailwind namespace, and skips internals", async () => {
    mount("<div></div>");
    const tokens = (await discoverCssTokens().list()) as DesignToken[];
    const byPath = Object.fromEntries(tokens.map((token) => [token.path, token]));
    expect(Object.keys(byPath).sort()).toEqual(
      ["color.brand", "color.ink", "font-weight.bold", "font.sans", "radius.lg", "spacing", "spacing.card", "text.lg"].sort(),
    );
    expect(byPath["color.brand"]).toMatchObject({ type: "color", ref: "--color-brand", properties: ["color", "background-color", "border-color"], group: "Color" });
    expect(byPath["radius.lg"]).toMatchObject({ type: "dimension", properties: ["border-radius"], value: "12px" });
    expect(byPath["font-weight.bold"]).toMatchObject({ type: "fontWeight", properties: ["font-weight"] });
    expect(byPath["font.sans"].type).toBe("fontFamily");
  });

  it("honours include and limit", () => {
    mount("<div></div>");
    expect(discoverCssTokens({ include: (name) => name.startsWith("--color-") }).list()).toHaveLength(2);
    expect(discoverCssTokens({ limit: 3 }).list()).toHaveLength(3);
  });

  it("resolves a token only when the winning declaration references it", async () => {
    mount('<div id="hero"><p class="card">a</p><p class="card warn">b</p><p class="plain">c</p></div>');
    const adapter = discoverCssTokens();
    adapter.list();
    const [card, warn, plain] = Array.from(document.querySelectorAll("p"));
    const usage = await adapter.resolve(card);
    expect(usage.padding).toEqual({ path: "spacing.card" });
    expect(usage["background-color"]).toEqual({ path: "color.brand" });
    // #hero .card out-ranks .card even though .card has a later declaration order.
    expect(usage["border-radius"]).toEqual({ path: "radius.lg" });
    expect(await adapter.resolve(warn)).toMatchObject({ "background-color": { path: "color.ink" } });
    const off = await adapter.resolve(plain);
    expect(off.color).toEqual({ offToken: expect.any(String) });
    expect(off.padding).toEqual({ offToken: expect.any(String) });
  });

  it("ignores rules inside media queries that do not apply", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: !query.includes("99999") })) as typeof window.matchMedia;
    try {
      mount('<p class="card">a</p>');
      const extra = document.createElement("style");
      extra.textContent = "@media (min-width: 99999px) { .card { padding: 1px } }";
      document.head.append(extra);
      const adapter = discoverCssTokens();
      adapter.list();
      expect((await adapter.resolve(document.querySelector("p")!)).padding).toEqual({ path: "spacing.card" });
    } finally {
      window.matchMedia = original;
    }
  });

  it("prefers inline var() and ignores inline literals that merely equal a token", async () => {
    mount('<p class="card" style="padding: var(--spacing)">a</p><p class="card" style="padding: 24px">b</p>');
    const adapter = discoverCssTokens();
    adapter.list();
    const [a, b] = Array.from(document.querySelectorAll("p"));
    expect((await adapter.resolve(a)).padding).toEqual({ path: "spacing" });
    // The literal wins the cascade, so the element is off-token even though the value equals spacing.card.
    expect((await adapter.resolve(b)).padding).toEqual({ offToken: expect.any(String) });
  });

  it("previews var() references and restores the element", () => {
    mount('<p class="plain" style="color: red">a</p>');
    const adapter = discoverCssTokens();
    const brand = (adapter.list() as DesignToken[]).find((token) => token.path === "color.brand")!;
    const el = document.querySelector("p") as HTMLElement;
    const undo = adapter.preview!(el, "color", brand);
    expect(el.style.getPropertyValue("color")).toBe("var(--color-brand)");
    undo();
    expect(el.style.getPropertyValue("color")).toBe("red");
  });

  it("describes the change as a var() reference", () => {
    mount("<p></p>");
    const adapter = discoverCssTokens();
    const [brand, ink] = ["color.brand", "color.ink"].map((path) => (adapter.list() as DesignToken[]).find((token) => token.path === path)!);
    const el = document.querySelector("p")!;
    expect(adapter.describe!(el, "color", { offToken: "#123" }, brand)).toBe("Set color to var(--color-brand)");
    expect(adapter.describe!(el, "color", { path: "color.ink" }, brand)).toBe("Replace var(--color-ink) with var(--color-brand) for color");
    expect(adapter.describe!(el, "color", { path: "color.ink" }, ink)).toBe("Keep color: var(--color-ink)");
  });
});

describe("discoverCssTokens previewValues", () => {
  const themed = `
    :root { --color-gray-900: #131213; --color-gray-700: #444444; --color-text: var(--color-gray-900); --color-surface: 19 18 19; --radius-md: 6px; }
    .dark { --color-text: var(--color-gray-700); }
  `;
  function page() {
    const style = document.createElement("style");
    style.textContent = themed;
    document.head.append(style);
    document.documentElement.setAttribute("style", "--radius-md: 4px");
  }
  const sheet = () => document.querySelector<HTMLStyleElement>("style[data-komo-token-preview]");
  afterEach(() => {
    document.documentElement.removeAttribute("style");
    document.documentElement.className = "";
  });

  it("lists aliases, the variable, and raw channels as hex with a toCss transform", () => {
    page();
    const tokens = discoverCssTokens({ scopes: { dark: ".dark" } }).list({ mode: "light" }) as DesignToken[];
    const byPath = Object.fromEntries(tokens.map((token) => [token.path, token]));
    expect(byPath["color.text"]).toMatchObject({ alias: "color.gray-900", cssVariable: "--color-text" });
    expect(byPath["color.gray-900"].alias).toBeUndefined();
    expect(byPath["color.surface"].value).toBe("#131213");
    expect(byPath["color.surface"].toCss!("#ff8000")).toBe("255 128 0");
    // The dark scope's own declaration names a different alias.
    const dark = discoverCssTokens({ scopes: { dark: ".dark" } }).list({ mode: "dark" }) as DesignToken[];
    expect(dark.find((token) => token.path === "color.text")?.alias).toBe("color.gray-700");
  });

  it("writes one removable stylesheet, scoped per theme option, and tears down exactly", () => {
    page();
    const before = document.documentElement.outerHTML.replace(/<body[\s\S]*$/, "");
    const adapter = discoverCssTokens({ scopes: { dark: ".dark" } });
    adapter.list();
    const cleanup = adapter.previewValues!([
      { path: "radius.md", value: "10px" },
      { path: "color.surface", value: "#ff8000", theme: "light" },
      { path: "color.text", value: "#444444", alias: "color.gray-700", theme: "dark" },
      { path: "color.text", value: "{color.unknown}" },
    ]);
    expect(sheet()?.textContent).toBe(
      ":root{--radius-md:10px!important}:root:not(.dark){--color-surface:255 128 0!important}:is(.dark){--color-text:var(--color-gray-700)!important}",
    );
    expect(getComputedStyle(document.documentElement).getPropertyValue("--radius-md").trim()).toBe("10px");
    cleanup();
    expect(sheet()).toBeNull();
    expect(document.documentElement.outerHTML.replace(/<body[\s\S]*$/, "")).toBe(before);
    expect(document.documentElement.getAttribute("style")).toBe("--radius-md: 4px");
  });

  it("without scopes, previews only the current theme's edits", () => {
    page();
    const adapter = discoverCssTokens();
    adapter.list();
    const changes = [{ path: "radius.md", value: "10px", theme: "light" }, { path: "radius.md", value: "12px", theme: "dark" }];
    const cleanup = adapter.previewValues!(changes, "dark");
    expect(sheet()?.textContent).toBe(":root{--radius-md:12px!important}");
    cleanup();
    expect(adapter.previewValues!(changes, "contrast")).toBeTypeOf("function");
    expect(sheet()).toBeNull();
  });
});
