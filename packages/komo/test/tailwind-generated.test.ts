// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { tailwindSpacing, tailwindTokens, type TailwindToken } from "../src/adapters/tailwind.js";
import type { DesignToken } from "../src/design-system.js";

const token = (name: string, extra: Partial<TailwindToken> = {}): TailwindToken => ({ path: `t.${name}`, type: "dimension", class: name, properties: ["padding"], value: "1px", ...extra });
const paths = (tokens: TailwindToken[], options: Parameters<typeof tailwindTokens>[1] = { onlyGenerated: true }) =>
  (tailwindTokens({ tokens }, options).list({}) as DesignToken[]).map((item) => item.path);
const style = (css: string) => {
  const element = document.createElement("style");
  element.textContent = css;
  document.head.append(element);
  return element;
};

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("tailwindTokens onlyGenerated", () => {
  it("lists only tokens whose canonical class has a rule, and everything without the option", () => {
    style(".p-4{padding:16px}.m-2{margin:8px}");
    const tokens = tailwindSpacing({ prefix: ["p", "m"], steps: [2, 4, 9] });
    expect(paths(tokens)).toEqual(["spacing.p-4", "spacing.m-2"]);
    expect(paths(tokens, {})).toHaveLength(6);
    // Aliases are recognised, but previews add the first class, so that is the one that must exist.
    expect(paths([token("rounded", { class: ["rounded-sm", "m-2"] }), token("alias", { class: ["m-2", "rounded-sm"] })])).toEqual(["t.alias"]);
  });

  it("matches escaped names, negative and arbitrary values exactly", () => {
    style(String.raw`.p-1\.5{padding:6px}.w-1\/2{width:50%}.-mt-4{margin-top:-16px}.p-\[13px\]{padding:13px}.\32 xl-box{padding:1px}.gap-\[calc\(1rem\+2px\)\]{gap:1px}`);
    const names = ["p-1.5", "w-1/2", "-mt-4", "p-[13px]", "2xl-box", "gap-[calc(1rem+2px)]", "p-1", "w-1", "mt-4", "p-[14px]", "p-1\\.5"];
    expect(paths(names.map((name) => token(name)))).toEqual(["p-1.5", "w-1/2", "-mt-4", "p-[13px]", "2xl-box", "gap-[calc(1rem+2px)]"].map((name) => `t.${name}`));
  });

  it("treats variant and important classes as different classes from the base utility", () => {
    style(String.raw`@media (min-width:768px){.md\:p-6{padding:24px}}.\!p-8{padding:32px!important}.hover\:p-10:hover{padding:40px}.p-12\!{padding:48px!important}`);
    expect(paths(["p-6", "p-8", "p-10", "p-12"].map((name) => token(name)))).toEqual([]);
    expect(paths(["md:p-6", "!p-8", "hover:p-10", "p-12!"].map((name) => token(name)))).toEqual(["t.md:p-6", "t.!p-8", "t.hover:p-10", "t.p-12!"]);
  });

  it("finds rules inside @media, @layer, @supports, @container, nested style rules and selector lists", () => {
    style(`@layer utilities{@media (min-width:1px){.p-1{padding:4px}}}@supports (display:grid){.p-2{padding:8px}}@container (min-width:1px){.p-3{padding:12px}}.card{&.p-5{padding:20px}}.x > .p-6, .y:not(.p-7)::before{padding:24px}`);
    expect(paths(["p-1", "p-2", "p-3", "p-4", "p-5", "p-6", "p-7", "card", "x", "y"].map((name) => token(name)))).toEqual(
      ["p-1", "p-2", "p-3", "p-5", "p-6", "p-7", "card", "x", "y"].map((name) => `t.${name}`),
    );
  });

  it("re-scans after a stylesheet is added, its text changes, it gains rules, or it is removed", () => {
    const tokens = [token("p-9"), token("p-11")];
    const adapter = tailwindTokens({ tokens }, { onlyGenerated: true });
    const list = () => (adapter.list({}) as DesignToken[]).map((item) => item.path);
    expect(list()).toEqual([]);
    const late = style(".p-9{padding:36px}");
    expect(list()).toEqual(["t.p-9"]);
    late.textContent = ".p-11{padding:44px}";
    expect(list()).toEqual(["t.p-11"]);
    (late.sheet as CSSStyleSheet).insertRule(".p-9{padding:36px}");
    expect(list()).toEqual(["t.p-9", "t.p-11"]);
    late.remove();
    expect(list()).toEqual([]);
  });

  it("hides nothing while a stylesheet is unreadable or a <link> stylesheet has not loaded", () => {
    style(".p-4{padding:16px}");
    const tokens = [token("p-4"), token("p-9")];
    expect(paths(tokens)).toEqual(["t.p-4"]);
    // A cross-origin sheet without CORS throws on cssRules.
    const real = [...document.styleSheets];
    const unreadable = { get cssRules(): CSSRuleList { throw new DOMException("cross-origin", "SecurityError"); } } as CSSStyleSheet;
    Object.defineProperty(document, "styleSheets", { configurable: true, get: () => [...real, unreadable] });
    try {
      expect(paths(tokens)).toEqual(["t.p-4", "t.p-9"]);
    } finally {
      delete (document as { styleSheets?: unknown }).styleSheets;
    }
    expect(paths(tokens)).toEqual(["t.p-4"]);
    // jsdom never loads <link> stylesheets, so this one stays pending; a disabled link is ignored.
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: "https://cdn.example.com/app.css" });
    link.setAttribute("disabled", "");
    document.head.append(link);
    expect(paths(tokens)).toEqual(["t.p-4"]);
    link.removeAttribute("disabled");
    expect(paths(tokens)).toEqual(["t.p-4", "t.p-9"]);
  });

  it("filters with a hook, alone or with onlyGenerated, and still resolves hidden classes", () => {
    style(".p-4{padding:16px}.m-4{margin:16px}");
    const tokens = tailwindSpacing({ prefix: ["p", "m"], steps: [4, 9] });
    const filter = (item: TailwindToken) => item.group !== "Margin";
    expect(paths(tokens, { filter })).toEqual(["spacing.p-4", "spacing.p-9"]);
    expect(paths(tokens, { filter, onlyGenerated: true })).toEqual(["spacing.p-4"]);
    const adapter = tailwindTokens({ tokens }, { filter, onlyGenerated: true, offToken: false });
    const element = document.createElement("div");
    element.className = "p-9 m-4";
    document.body.append(element);
    expect(adapter.resolve(element)).toMatchObject({ padding: { path: "spacing.p-9" }, margin: { path: "spacing.m-4" } });
  });
});
