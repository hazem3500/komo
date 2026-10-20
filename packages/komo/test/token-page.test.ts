// @vitest-environment jsdom
// The Tokens view: every listed token edited page-wide with nothing selected,
// previewed through the adapter's previewValues(), recorded as one page comment.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesignMode } from "../src/design-mode.js";
import { parseDesignComment, summarizeDesignComment } from "../src/design-comment.js";
import { themeKey, tokenEdits, tokenProposal, tokenValueChanges, type TokenEdit } from "../src/token-page.js";
import type { DesignSection } from "../src/design-comment.js";
import type { DesignToken, ThemeAxis, ThemeState, TokenAdapter, TokenValueChange } from "../src/design-system.js";
// @ts-expect-error CLI modules are plain JavaScript.
import { designEditFromComment } from "../cli/design-edit.mjs";

vi.stubGlobal("CSS", { supports: (property: string, value: string) => {
  const style = document.createElement("span").style;
  style.setProperty(property, value);
  return !!style.getPropertyValue(property);
}, escape: (value: string) => value });

const fake = (log: string[] = [], calls: Array<[TokenValueChange[], string | undefined]> = []): TokenAdapter => ({
  id: "fake",
  list: () => [],
  resolve: () => ({}),
  previewValues(changes, theme) {
    const n = calls.push([changes, theme]);
    log.push(`apply ${n}`);
    return () => log.push(`cleanup ${n}`);
  },
});
const change = (path: string, to: string, extra: Partial<TokenEdit> = {}): TokenEdit => ({ path, value: to, from: "#000000", to, ...extra });

describe("tokenEdits", () => {
  it("cleans up, then previews the full change set on every edit and theme switch", () => {
    const log: string[] = [], calls: Array<[TokenValueChange[], string | undefined]> = [];
    let theme = "light";
    const edits = tokenEdits(fake(log, calls), { theme: () => theme });
    edits.set(change("color.a", "#111111", { theme: "light" }));
    edits.set(change("color.b", "#222222", { theme: "light" }));
    expect(calls.at(-1)).toEqual([[{ path: "color.a", value: "#111111", theme: "light" }, { path: "color.b", value: "#222222", theme: "light" }], "light"]);
    expect(log).toEqual(["apply 1", "cleanup 1", "apply 2"]);
    edits.sync();
    expect(log).toHaveLength(3);
    theme = "dark";
    edits.sync();
    expect(calls.at(-1)?.[1]).toBe("dark");
    expect(log.slice(3)).toEqual(["cleanup 2", "apply 3"]);
  });

  it("undoes chronologically, resets one token without an undo step, and resets all", () => {
    const calls: Array<[TokenValueChange[], string | undefined]> = [];
    const edits = tokenEdits(fake([], calls));
    edits.set(change("color.a", "#111111"));
    edits.set(change("color.b", "#222222"));
    edits.set(change("color.a", "#333333"));
    expect(edits.list().map((edit) => edit.to)).toEqual(["#333333", "#222222"]);
    edits.undo();
    expect(edits.get("color.a")?.to).toBe("#111111");
    edits.reset("color.a");
    expect(edits.get("color.a")).toBeUndefined();
    expect(edits.size).toBe(1);
    edits.undo();
    expect(edits.size).toBe(0);
    expect(edits.canUndo).toBe(false);
    edits.set(change("color.a", "#111111"));
    edits.resetAll();
    expect([edits.size, edits.canUndo]).toEqual([0, false]);
    expect(calls).toHaveLength(6);
  });

  it("drops an edit back to the page value and ignores repeats", () => {
    const log: string[] = [];
    const edits = tokenEdits(fake(log));
    expect(edits.set(change("color.a", "#000000"))).toBe(false);
    expect(edits.set(change("color.a", "#111111"))).toBe(true);
    expect(edits.set(change("color.a", "#111111"))).toBe(false);
    expect(edits.set(change("color.a", "#000000"))).toBe(true);
    expect(edits.size).toBe(0);
    expect(log).toEqual(["apply 1", "cleanup 1"]);
  });

  it("cleans up for Before, previews again for After, and previews transiently", () => {
    const log: string[] = [], calls: Array<[TokenValueChange[], string | undefined]> = [];
    let before = false;
    const edits = tokenEdits(fake(log, calls), { before: () => before });
    edits.set(change("color.a", "#111111"));
    before = true;
    edits.sync();
    expect(log).toEqual(["apply 1", "cleanup 1"]);
    before = false;
    edits.sync();
    const restore = edits.preview(change("color.b", "#222222", { alias: "color.c" }));
    expect(calls.at(-1)?.[0]).toEqual([{ path: "color.a", value: "#111111" }, { path: "color.b", value: "#222222", alias: "color.c" }]);
    restore();
    expect(calls.at(-1)?.[0]).toEqual([{ path: "color.a", value: "#111111" }]);
    const back = edits.preview(change("color.a", "#000000"));
    expect(log.at(-1)).toMatch(/^cleanup/);
    back();
    expect(calls.at(-1)?.[0]).toEqual([{ path: "color.a", value: "#111111" }]);
    edits.stop();
    expect(log.at(-1)).toMatch(/^cleanup/);
    expect(edits.size).toBe(0);
  });

  it("keys themes by each switchable axis's current option", () => {
    const axis = (id: string, current: string, options = ["a", "b"]): ThemeAxis => ({ id, options: options.map((option) => ({ id: option })), current: () => current, apply() {} });
    expect(themeKey()).toBeUndefined();
    expect(themeKey({ themes: [axis("mode", "dark")] })).toBe("dark");
    expect(themeKey({ themes: [axis("product", "docs"), axis("only", "x", ["x"]), axis("mode", "dark")] })).toBe("docs+dark");
    expect(themeKey({ themes: [{ ...axis("mode", "dark"), current() { throw new Error("unavailable"); } }] })).toBeUndefined();
  });
});

describe("token proposals", () => {
  const edits: TokenEdit[] = [
    { path: "color.text.primary", theme: "dark", value: "#f5f5f5", from: "#e6e6e6", to: "#f5f5f5" },
    { path: "color.accent", value: "#7c3aed", alias: "color.violet.500", from: "{color.blue.500}", to: "{color.violet.500}" },
  ];
  const body = "Proposed token changes (preview only)\nToken: color.text.primary (dark) #e6e6e6 → #f5f5f5\nToken: color.accent {color.blue.500} → {color.violet.500}\nToken adapter: css-variables";

  it("writes one Token line per edit and the matching token-value changes", () => {
    expect(tokenProposal([], "css-variables")).toBeUndefined();
    expect(tokenProposal(edits, "css-variables")).toBe(body);
    expect(tokenValueChanges(edits)).toEqual([
      { kind: "token-value", path: "color.text.primary", theme: "dark", from: "#e6e6e6", to: "#f5f5f5" },
      { kind: "token-value", path: "color.accent", from: "{color.blue.500}", to: "{color.violet.500}" },
    ]);
  });

  it("reads back as a page-level DesignEdit and a Token changes card", () => {
    expect(designEditFromComment(`Warmer text in dark mode.\n\n${body}`, "body")).toEqual({
      komo: "design-edit", version: 1, target: { selector: ":root" }, tokens: "css-variables", changes: tokenValueChanges(edits),
    });
    const [note, section] = parseDesignComment(`Warmer text in dark mode.\n\n${body}`);
    expect(note).toEqual({ text: "Warmer text in dark mode." });
    expect((section as DesignSection).title).toBe("Token changes");
    expect((section as DesignSection).changes).toEqual([
      { label: "color.text.primary (dark)", token: "color.text.primary", before: "#e6e6e6", after: "#f5f5f5" },
      { label: "color.accent", token: "color.accent", before: "{color.blue.500}", after: "{color.violet.500}" },
    ]);
    expect(summarizeDesignComment(body)).toBe("Token changes · 2 edits");
  });
});

describe("Tokens view in Design mode", () => {
  let shadow: ShadowRoot;
  let host: HTMLElement;
  let controller: ReturnType<typeof createDesignMode>;
  let comments: Array<[Element, string | undefined]>;
  let active: TokenValueChange[] | null;
  let applied: TokenValueChange[][];
  let mode: string;

  const listed = (theme?: ThemeState): DesignToken[] => [
    { path: "color.gray.900", type: "color", value: "#131213", group: "Gray", label: "Gray 900", properties: ["color"] },
    { path: "color.gray.700", type: "color", value: "#444444", group: "Gray", label: "Gray 700", properties: ["color"] },
    { path: "color.text.primary", type: "color", value: theme?.mode === "dark" ? "#e6e6e6" : "#131213", group: "Text", label: "Primary", alias: theme?.mode === "dark" ? undefined : "color.gray.900", properties: ["color"] },
    { path: "space.md", type: "dimension", value: "8px", group: "Space", properties: ["padding"] },
  ];
  const adapter = (live = true): TokenAdapter => ({
    id: "fixture",
    list: listed,
    resolve: () => ({}),
    ...(live ? {
      previewValues(changes: TokenValueChange[]) {
        active = changes;
        applied.push(changes);
        return () => { if (active === changes) active = null; };
      },
    } : {}),
  });
  const axis: ThemeAxis = { id: "mode", options: [{ id: "light" }, { id: "dark" }], current: () => mode, apply(id) { mode = id; } };

  function start(tokens: TokenAdapter, themes?: ThemeAxis[]) {
    controller?.destroy();
    controller = createDesignMode({
      root: shadow,
      host,
      targetAt: () => document.querySelector("#hero"),
      onComment: (element, proposal) => comments.push([element, proposal]),
      onExit() {},
      design: { tokens, ...(themes ? { themes } : {}) },
    });
    controller.setActive(true);
    return controller.ready;
  }
  const $ = <T extends Element = HTMLElement>(selector: string) => shadow.querySelector<T>(selector)!;
  const rowFor = (label: string) => [...shadow.querySelectorAll<HTMLElement>(".design-token-row")].find((row) => row.querySelector("b")?.textContent === label)!;
  const button = (scope: ParentNode, name: string) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === name || item.getAttribute("aria-label") === name)!;
  async function openView() {
    button($(".design-inspector__empty"), "Edit tokens").click();
    await vi.waitFor(() => expect(shadow.querySelectorAll(".design-token-row").length).toBeGreaterThan(0));
  }
  const exact = '.komo-custom input[aria-label="CSS value"], .komo-custom input[aria-label="Color value"]';
  async function custom(label: string, value: string) {
    rowFor(label).querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() => expect(shadow.querySelector(exact)).not.toBeNull());
    const input = $<HTMLInputElement>(exact);
    input.value = value;
    input.dispatchEvent(new Event("input"));
    return () => button($(".komo-custom"), "Apply custom").click();
  }
  const bar = () => $(".design-token-bar");
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(async () => {
    document.body.innerHTML = '<main><button id="hero">Hello</button></main><div id="komo"></div>';
    host = document.querySelector("#komo")!;
    shadow = host.attachShadow({ mode: "open" });
    comments = [];
    active = null;
    applied = [];
    mode = "light";
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    await start(adapter());
  });
  afterEach(() => {
    controller.destroy();
    vi.unstubAllGlobals();
    vi.stubGlobal("CSS", { supports: () => true, escape: (value: string) => value });
    document.body.replaceChildren();
  });

  it("lists every token in sticky groups from the empty panel, with search", async () => {
    await openView();
    const panel = $(".design-inspector");
    expect(panel.hasAttribute("data-tokens")).toBe(true);
    expect($(".design-inspector__target").textContent).toBe("Tokens");
    expect([...shadow.querySelectorAll(".design-token-page__list small")].map((heading) => heading.textContent)).toEqual(["Gray", "Text", "Space"]);
    expect(rowFor("Primary").querySelector("i")?.textContent).toBe("Gray 900");
    expect(rowFor("md").querySelector(".komo-tokens__pv .komo-tokens__dim")).not.toBeNull();
    const search = $<HTMLInputElement>('.design-token-page input[aria-label="Search tokens"]');
    search.value = "gray 7";
    search.dispatchEvent(new Event("input"));
    expect([...shadow.querySelectorAll(".design-token-row b")].map((name) => name.textContent)).toEqual(["Gray 700"]);
  });

  it("edits a raw value in Custom with a live preview, a dot, Reset, Undo and Reset all", async () => {
    await openView();
    const apply = await custom("md", "12px");
    expect(shadow.querySelector(".komo-tokens__tabs button")).toBeNull();
    expect(active).toEqual([{ path: "space.md", value: "12px" }]);
    apply();
    expect(active).toEqual([{ path: "space.md", value: "12px" }]);
    expect(rowFor("md").hasAttribute("data-changed")).toBe(true);
    expect(rowFor("md").querySelector("i")?.textContent).toBe("12px");
    expect($(".design-token-bar .design-inspector__count").textContent).toBe("1 change");
    expect(bar().hasAttribute("data-changes")).toBe(true);
    const reset = rowFor("md").querySelector<HTMLButtonElement>('[aria-label="Reset space.md"]')!;
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(active).toBeNull();
    expect(button(bar(), "Undo").disabled).toBe(true);
    (await custom("md", "12px"))();
    (await custom("Gray 900", "#ff0000"))();
    expect(active).toEqual([{ path: "space.md", value: "12px" }, { path: "color.gray.900", value: "#ff0000" }]);
    button(bar(), "Undo").click();
    expect(active).toEqual([{ path: "space.md", value: "12px" }]);
    button(bar(), "Reset all").click();
    expect(active).toBeNull();
    expect($(".design-token-bar .design-inspector__count").textContent).toBe("");
  });

  it("repoints an alias to another token", async () => {
    await openView();
    rowFor("Primary").querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() => expect(shadow.querySelector('.komo-tokens [role="option"]')).not.toBeNull());
    expect(button($(".komo-tokens__tabs"), "Tokens").getAttribute("aria-pressed")).toBe("true");
    const options = [...shadow.querySelectorAll<HTMLElement>('.komo-tokens [role="option"]')];
    expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    options[1].click();
    expect(active).toEqual([{ path: "color.text.primary", value: "#444444", alias: "color.gray.700" }]);
    expect(rowFor("Primary").querySelector("i")?.textContent).toBe("Gray 700");
    button(bar(), "Comment").click();
    expect(comments).toEqual([[document.body, "Proposed token changes (preview only)\nToken: color.text.primary {color.gray.900} → {color.gray.700}\nToken adapter: fixture"]]);
    expect(active).toBeNull();
  });

  it("edits per theme option, and the preview follows the theme switcher", async () => {
    await start(adapter(), [axis]);
    await openView();
    (await custom("Gray 900", "#000000"))();
    button($(".design-theme-switch"), "Dark").click();
    await vi.waitFor(() => expect(rowFor("Primary").querySelector("i")?.textContent).toBe("#e6e6e6"));
    expect(rowFor("Gray 900").hasAttribute("data-changed")).toBe(false);
    (await custom("Primary", "#f5f5f5"))();
    expect(active).toEqual([
      { path: "color.gray.900", value: "#000000", theme: "light" },
      { path: "color.text.primary", value: "#f5f5f5", theme: "dark" },
    ]);
    button($(".design-theme-switch"), "Light").click();
    await vi.waitFor(() => expect(rowFor("Gray 900").hasAttribute("data-changed")).toBe(true));
    expect(rowFor("Primary").hasAttribute("data-changed")).toBe(false);
    button(bar(), "Comment").click();
    expect(comments[0][1]).toBe("Proposed token changes (preview only)\nToken: color.gray.900 (light) #131213 → #000000\nToken: color.text.primary (dark) #e6e6e6 → #f5f5f5\nToken adapter: fixture");
  });

  it("flips the whole preview with Before/After and B", async () => {
    await openView();
    (await custom("md", "12px"))();
    const [before, after] = [...bar().querySelectorAll<HTMLButtonElement>(".design-inspector__compare button")];
    before.click();
    expect(active).toBeNull();
    expect($(".design-inspector").hasAttribute("data-before")).toBe(true);
    expect(before.getAttribute("aria-pressed")).toBe("true");
    after.click();
    expect(active).toEqual([{ path: "space.md", value: "12px" }]);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true, composed: true }));
    expect(active).toBeNull();
    // Design mode owns ← and → while Before shows; the view follows its data-before.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }));
    await flush();
    expect(active).toEqual([{ path: "space.md", value: "12px" }]);
    expect(after.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps edits previewed when an element is picked, and cleans up on exit and destroy", async () => {
    await openView();
    (await custom("md", "12px"))();
    document.querySelector("#hero")!.dispatchEvent(Object.assign(new Event("pointerdown", { bubbles: true, cancelable: true, composed: true }), { button: 0 }));
    await flush();
    expect($(".design-inspector").hasAttribute("data-tokens")).toBe(false);
    expect(active).toEqual([{ path: "space.md", value: "12px" }]);
    controller.clearSelection();
    expect(button($(".design-inspector__empty"), "Edit tokens · 1 change")).toBeTruthy();
    controller.setActive(false);
    await flush();
    expect(active).toBeNull();
    controller.setActive(true);
    await flush();
    expect(active).toEqual([{ path: "space.md", value: "12px" }]);
    controller.destroy();
    await flush();
    expect(active).toBeNull();
    expect(applied.at(-1)).toEqual([{ path: "space.md", value: "12px" }]);
  });

  it("without previewValues, records proposals labelled No live preview", async () => {
    await start(adapter(false));
    await openView();
    const note = $(".design-token-page > p");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("No live preview");
    (await custom("md", "12px"))();
    expect(applied).toEqual([]);
    expect(rowFor("md").hasAttribute("data-changed")).toBe(true);
    expect(bar().querySelector<HTMLElement>(".design-inspector__compare")!.hidden).toBe(true);
    button(bar(), "Comment").click();
    expect(comments[0][1]).toContain("Token: space.md 8px → 12px");
  });
});
