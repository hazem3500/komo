// @vitest-environment jsdom
// The Tokens view: every listed token edited page-wide with nothing selected,
// previewed through the adapter's previewValues(), recorded as one page comment.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesignMode } from "../src/design-mode.js";
import { parseDesignComment, renderDesignComment, resetDesignPreviews, summarizeDesignComment } from "../src/design-comment.js";
import { themeKey, tokenEdits, tokenProposal, tokenValueChanges, type TokenEdit } from "../src/token-page.js";
import type { DesignSection } from "../src/design-comment.js";
import type { DesignSystem, DesignToken, ThemeAxis, ThemeState, TokenAdapter, TokenValueChange } from "../src/design-system.js";
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

  it("redoes undone token steps in order, and a new edit clears them", () => {
    const edits = tokenEdits(fake());
    edits.set(change("color.a", "#111111"));
    edits.set(change("color.a", "#333333"));
    edits.undo();
    edits.undo();
    expect(edits.size).toBe(0);
    edits.redo();
    expect(edits.get("color.a")?.to).toBe("#111111");
    edits.redo();
    expect(edits.get("color.a")?.to).toBe("#333333");
    expect(edits.steps).toHaveLength(2);
    edits.undo();
    edits.set(change("color.b", "#222222"));
    edits.redo();
    expect(edits.get("color.a")?.to).toBe("#111111");
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
      { label: "color.text.primary (dark)", token: "color.text.primary", before: "#e6e6e6", after: "#f5f5f5", apply: { kind: "token", property: "color.text.primary", theme: "dark" } },
      { label: "color.accent", token: "color.accent", before: "{color.blue.500}", after: "{color.violet.500}", apply: { kind: "token", property: "color.accent" } },
    ]);
    expect(summarizeDesignComment(body)).toBe("Token changes · 2 edits");
  });

  // The page-level card flips like the footer: Before runs previewValues()'s cleanup, After previews again.
  describe("card", () => {
    const tokens: DesignToken[] = [
      { path: "color.text.primary", type: "color", value: "#e6e6e6", label: "Text primary" },
      { path: "color.violet.500", type: "color", value: "#7c3aed" },
    ];
    function render(design?: DesignSystem, tip?: (node: HTMLElement) => void) {
      const container = document.createElement("div");
      document.body.append(container);
      renderDesignComment(container, body, { key: `card-${Math.random()}`, resolve: () => document.body, note: (node, text) => node.append(text), design, tip,
        ...(design?.tokens ? { tokens: { adapter: design.tokens, tokens } } : {}) });
      const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>(".design-toggle button")].find((item) => item.textContent === name);
      return { container, button };
    }
    afterEach(() => { resetDesignPreviews(); document.body.replaceChildren(); });

    it("has Before/After that removes and re-applies the token preview", () => {
      const calls: Array<[TokenValueChange[], string | undefined]> = [];
      let live = 0;
      const adapter: TokenAdapter = { id: "fixture", list: () => tokens, resolve: () => ({}), previewValues(changes, theme) { calls.push([changes, theme]); live++; return () => { live--; }; } };
      const axis: ThemeAxis = { id: "mode", options: [{ id: "light" }, { id: "dark" }], current: () => "dark", apply() {} };
      const { button } = render({ tokens: adapter, themes: [axis] });
      expect(button("Before")!.getAttribute("aria-pressed")).toBe("true");
      button("After")!.click();
      expect(live).toBe(1);
      expect(calls).toEqual([[[
        { path: "color.text.primary", value: "#f5f5f5", theme: "dark" },
        { path: "color.accent", value: "#7c3aed", alias: "color.violet.500" },
      ], "dark"]]);
      expect(button("After")!.getAttribute("aria-pressed")).toBe("true");
      button("Before")!.click();
      expect(live).toBe(0);
    });

    it("keeps After off, with a reason, without an adapter that previews values", () => {
      for (const design of [undefined, { tokens: { id: "plain", list: () => tokens, resolve: () => ({}) } }]) {
        const after = render(design).button("After")!;
        expect(after.disabled).toBe(true);
        expect(after.title).toBe("This change can't be previewed here");
      }
    });

    it("names each token by its label, else the path's last part, with the full path and theme in komo's tooltip", () => {
      const tipped: string[] = [];
      const adapter: TokenAdapter = { id: "fixture", list: () => tokens, resolve: () => ({}), previewValues: () => () => {} };
      const { container } = render({ tokens: adapter }, (node) => tipped.push(node.getAttribute("aria-label")!));
      const labels = [...container.querySelectorAll<HTMLElement>(".design-prop")];
      expect(labels.map((label) => label.textContent)).toEqual(["Text primary", "accent"]);
      expect(labels.map((label) => label.getAttribute("aria-label"))).toEqual(["color.text.primary (dark)", "color.accent"]);
      expect(tipped).toEqual(["color.text.primary (dark)", "color.accent"]);
    });
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
  const exact = '.komo-custom input[aria-label="CSS value"], .komo-color input[aria-label="Hex"]';
  // Every Custom editor applies live: typing previews and the popup keeps the value when it closes.
  async function custom(label: string, value: string) {
    rowFor(label).querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() => expect(shadow.querySelector(exact)).not.toBeNull());
    const input = $<HTMLInputElement>(exact);
    input.value = input.closest(".komo-color") ? value.replace("#", "") : value;
    input.dispatchEvent(new Event("input"));
    return () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
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
    // One popup: the alias targets first, then Custom value; no tabs.
    expect(shadow.querySelector(".komo-tokens__tabs")).toBeNull();
    expect($(".komo-tokens__head").textContent).toBe("Primary");
    expect($<HTMLElement>(".komo-tokens__label").hidden).toBe(false);
    expect($(".komo-tokens").hasAttribute("data-merged")).toBe(true);
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
    // A light/dark pair is one switch in the Tokens header, as in the Design panel.
    const toggle = $(".design-inspector__heading .design-theme-toggle") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-label")).toBe("Theme: Light");
    expect(toggle.dataset.tip).toBe("Switch to Dark");
    toggle.click();
    await vi.waitFor(() => expect(rowFor("Primary").querySelector("i")?.textContent).toBe("#e6e6e6"));
    expect(toggle.getAttribute("aria-label")).toBe("Theme: Dark");
    expect(rowFor("Gray 900").hasAttribute("data-changed")).toBe(false);
    (await custom("Primary", "#f5f5f5"))();
    expect(active).toEqual([
      { path: "color.gray.900", value: "#000000", theme: "light" },
      { path: "color.text.primary", value: "#f5f5f5", theme: "dark" },
    ]);
    toggle.click();
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

  // Escape keeps element previews pending (Before while closed, After again on return); token edits do the same, visibly.
  describe("pending token edits in the element view", () => {
    const hero = () => document.querySelector<HTMLElement>("#hero")!;
    const pick = async () => {
      hero().dispatchEvent(Object.assign(new Event("pointerdown", { bubbles: true, cancelable: true, composed: true }), { button: 0 }));
      await flush();
    };
    // Layout is untouched by the fixture's tokens, so its edit is the element's own.
    const layout = (value: string) => {
      const field = $<HTMLSelectElement>('[data-property="display"]');
      field.dispatchEvent(new Event("focus"));
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.dispatchEvent(new Event("blur"));
    };
    const elementBar = () => $(".design-inspector__bar:not(.design-token-bar)");
    const count = () => elementBar().querySelector(".design-inspector__count")!.textContent;
    const chip = () => $<HTMLButtonElement>(".design-inspector__token-chip");
    async function pendingAfterExit() {
      await openView();
      (await custom("md", "12px"))();
      controller.setActive(false);
      await flush();
      expect(active).toBeNull();
      controller.setActive(true);
      await flush();
      expect(active).toEqual([{ path: "space.md", value: "12px" }]);
    }

    it("counts them beside the element's own changes behind a chip that opens the Tokens view", async () => {
      await pendingAfterExit();
      expect($(".design-inspector__pending p").textContent).toBe("1 token change has pending runtime previews. Undo, Reset or reload to restore.");
      await pick();
      expect(count()).toBe("1 change");
      expect(chip().hidden).toBe(false);
      expect(chip().textContent).toBe("Token changes · 1");
      expect(chip().tagName).toBe("BUTTON");
      layout("flex");
      expect(count()).toBe("2 changes");
      // Reset is the element's own; the token edit stays pending behind the chip.
      button(elementBar(), "Reset").click();
      expect(hero().style.display).toBe("");
      expect(count()).toBe("1 change");
      chip().click();
      await flush();
      expect($(".design-inspector").hasAttribute("data-tokens")).toBe(true);
      expect($(".design-inspector__target").textContent).toBe("Tokens");
      expect(rowFor("md").hasAttribute("data-changed")).toBe(true);
      expect(chip().hidden).toBe(true);
    });

    it("shares one chronological Undo with element edits", async () => {
      await pendingAfterExit();
      await pick();
      layout("flex");
      button(elementBar(), "Undo").click();
      expect(hero().style.display).toBe("");
      expect(active).toEqual([{ path: "space.md", value: "12px" }]);
      button(elementBar(), "Undo").click();
      expect(active).toBeNull();
      expect(chip().hidden).toBe(true);
      expect(count()).toBe("");
      expect(button(elementBar(), "Undo").disabled).toBe(true);
    });

    it("flips with Before/After, and Reset all previews clears both", async () => {
      await pendingAfterExit();
      await pick();
      layout("flex");
      button(elementBar(), "Before").click();
      await flush();
      expect([active, hero().style.display]).toEqual([null, ""]);
      // Fields wait out the Before/After morph, then show the page's value.
      const field = () => $<HTMLSelectElement>('[data-property="display"]').value;
      expect(field()).toBe("flex");
      await vi.waitFor(() => expect(field()).not.toBe("flex"));
      button(elementBar(), "After").click();
      await flush();
      expect([active, hero().style.display]).toEqual([[{ path: "space.md", value: "12px" }], "flex"]);
      await vi.waitFor(() => expect(field()).toBe("flex"));
      controller.clearSelection();
      controller.setActive(false);
      controller.setActive(true);
      await flush();
      expect($(".design-inspector__pending p").textContent).toBe("1 element and 1 token change have pending runtime previews. Undo, Reset or reload to restore.");
      button($(".design-inspector__pending"), "Reset all previews").click();
      expect([active, hero().style.display]).toEqual([null, ""]);
      expect($(".design-inspector__pending").hidden).toBe(true);
      expect(button($(".design-inspector__empty"), "Edit tokens")).toBeTruthy();
    });

    it("comments the element's changes with the token section, then clears both", async () => {
      await pendingAfterExit();
      await pick();
      layout("flex");
      button(elementBar(), "Comment").click();
      await vi.waitFor(() => expect(comments).toHaveLength(1));
      const [target, body] = comments[0];
      expect(target).toBe(hero());
      expect(body).toMatch(/^Proposed style changes \(preview only\)\nTarget: #hero\n- display: .* → flex/);
      expect(body).toContain("\n\nProposed token changes (preview only)\nToken: space.md 8px → 12px\nToken adapter: fixture");
      expect(parseDesignComment(body!).filter((block) => "changes" in block).map((block) => (block as DesignSection).title)).toEqual(["Style changes", "Token changes"]);
      expect([active, hero().style.display]).toEqual([null, ""]);
      expect(chip().hidden).toBe(true);
    });
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
