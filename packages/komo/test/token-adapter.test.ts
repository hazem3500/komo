// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesignMode } from "../src/design-mode.js";
import { cssVariableTokens, registerDesignTokenSource, type KomoDesignToken } from "../src/design-tokens.js";
import { createAdapterTokenControl, proposedDesignChanges } from "../src/react-props-panel.js";
import { closestToken, listTokens, originalTokenStyle, refreshTokenSwaps, rememberTokenUsage, resetTokenSwaps, showTokenSwapsBefore, swapToken, tokenSwapChanges, watchTokenList } from "../src/token-adapter.js";
import { tailwindTokens } from "../src/adapters/tailwind.js";
import { parseDesignComment } from "../src/design-comment.js";
import type { DesignSystem, DesignToken, TokenAdapter, TokenUsage } from "../src/design-system.js";
// @ts-expect-error CLI modules are plain JavaScript.
import { designEditFromComment } from "../cli/design-edit.mjs";

// A class-based adapter like a Tailwind setup: tokens are utility classes.
const classTokens: DesignToken[] = [
  { path: "color.text.primary", type: "color", value: "#1f1f1f", properties: ["color"], group: "Text", label: "Text primary", ref: "text-primary" },
  { path: "color.text.secondary", type: "color", value: "#6b6b6b", properties: ["color"], group: "Text", ref: "text-secondary" },
  { path: "color.bg.interactive", type: "color", value: "#f4f0ff", properties: ["background-color"], group: "Background", ref: "bg-interactive", states: ["hover", "active"] },
  { path: "space.md", type: "dimension", value: "16px", properties: ["padding", "gap"], group: "Spacing", ref: "p-md" },
];
const prefix: Record<string, string> = { color: "text-", "background-color": "bg-", padding: "p-" };

describe("semantic inline baseline declarations", () => {
  it.each([
    ["color", "var(--base)", "#cccccc", "#555555"],
    ["color", "currentcolor", "#cccccc", "#555555"],
    ["padding", "1em", "16px", "20px"],
    ["border-radius", "25%", "16px", "20px"],
    ["width", "calc(50% - 4px)", "12px", "20px"],
  ])("retains the %s reference/expression %s through theme refresh and Undo", (property, value, before, after) => {
    const parent = document.createElement("main"), target = document.createElement("p");
    parent.style.cssText = "color:#cccccc;font-size:16px;width:32px";
    parent.style.setProperty("--base", "#cccccc");
    target.style.setProperty(property, value, "important");
    target.style.setProperty("margin", "3px", "important");
    parent.append(target);
    document.body.append(parent);
    const original = target.style.getPropertyValue(property);
    const priority = target.style.getPropertyPriority(property);
    const tokens: DesignToken[] = [{ path: "base", type: "other", properties: [property], value: before }, { path: "accent", type: "other", properties: [property], value: property === "color" ? "#eeeeee" : "8px" }];
    const adapter: TokenAdapter = { id: "relative-baseline", list: () => tokens, resolve: () => ({ [property]: { path: "base" } }) };
    try {
      rememberTokenUsage(target, property, { path: "base" }, adapter, tokens);
      const snapshot = originalTokenStyle(target, property);
      const undo = swapToken(adapter, target, property, tokens[1], { path: "base" }, tokens[0]);
      parent.style.color = "#555555";
      parent.style.fontSize = "20px";
      parent.style.width = "48px";
      parent.style.setProperty("--base", "#555555");
      refreshTokenSwaps(adapter, [{ ...tokens[0], value: after }, tokens[1]]);
      showTokenSwapsBefore(true);
      expect(originalTokenStyle(target, property)).toBe(snapshot);
      expect(snapshot?.value).toBe(original);
      expect(target.style.getPropertyValue(property)).toBe(original);
      expect(target.style.getPropertyPriority(property)).toBe(priority);
      showTokenSwapsBefore(false);
      undo();
      expect(target.style.getPropertyValue(property)).toBe(original);
      expect(target.style.getPropertyPriority(property)).toBe(priority);
      expect(target.style.margin).toBe("3px");
      expect(target.style.getPropertyPriority("margin")).toBe("important");
    } finally {
      showTokenSwapsBefore(false);
      resetTokenSwaps(target);
      parent.remove();
    }
  });
});

function classAdapter(options: { async?: boolean } = {}): TokenAdapter & { list: ReturnType<typeof vi.fn> } {
  const wrap = <T,>(value: T) => (options.async ? new Promise<T>((done) => setTimeout(() => done(value), 5)) : value);
  return {
    id: "classes",
    list: vi.fn(() => wrap(classTokens)),
    resolve(element) {
      const usage: Record<string, TokenUsage> = {};
      for (const [property, start] of Object.entries(prefix)) {
        const token = classTokens.find((item) => item.ref?.startsWith(start) && element.classList.contains(item.ref));
        usage[property] = token ? { path: token.path } : { offToken: getComputedStyle(element).getPropertyValue(property) || "13px" };
      }
      return wrap(usage);
    },
    preview(element, property, token) {
      const old = [...element.classList].find((name) => name.startsWith(prefix[property]));
      if (old) element.classList.remove(old);
      element.classList.add(token.ref!);
      return () => {
        element.classList.remove(token.ref!);
        if (old) element.classList.add(old);
      };
    },
    describe: (_element, _property, from, to) =>
      `Replace class "${classTokens.find((item) => "path" in from && item.path === from.path)?.ref}" with "${to.ref}"`,
  } as TokenAdapter & { list: ReturnType<typeof vi.fn> };
}

describe("built-in css-variables token adapter", () => {
  const tokens: KomoDesignToken[] = [
    { path: "color.brand", cssVariable: "--brand", type: "color", properties: ["color", "background-color"], impactSelector: ".card" },
    { path: "spacing.card", cssVariable: "--space-card", type: "dimension", properties: ["padding"], impactSelector: ".card" },
  ];
  afterEach(() => document.body.replaceChildren());

  it("lists registered variables, resolves declared tokens, flags the rest and previews with undo", () => {
    document.head.innerHTML = "<style>.card{color:var(--brand)}</style>";
    document.body.innerHTML = '<article class="card" style="padding:12px"></article>';
    document.documentElement.style.setProperty("--brand", "#224466");
    const cleanup = registerDesignTokenSource(document.documentElement, tokens);
    const adapter = cssVariableTokens();
    const card = document.querySelector<HTMLElement>(".card")!;
    expect(adapter.id).toBe("css-variables");
    expect(adapter.list()).toEqual([
      expect.objectContaining({ path: "color.brand", ref: "--brand", value: "#224466", properties: ["color", "background-color"], group: "color" }),
      expect.objectContaining({ path: "spacing.card", ref: "--space-card" }),
    ]);
    const usage = adapter.resolve(card) as Record<string, TokenUsage>;
    expect(usage.color).toEqual({ path: "color.brand" });
    expect(usage.padding).toEqual({ offToken: "12px" });
    expect(usage).not.toHaveProperty("font-size");
    const undo = adapter.preview!(card, "background-color", (adapter.list() as DesignToken[])[0]);
    expect(card.style.getPropertyValue("background-color")).toBe("var(--brand)");
    expect((adapter.resolve(card) as Record<string, TokenUsage>)["background-color"]).toEqual({ path: "color.brand" });
    undo();
    expect(card.style.getPropertyValue("background-color")).toBe("");
    expect(adapter.describe!(card, "padding", { offToken: "12px" }, (adapter.list() as DesignToken[])[1])).toBe("Set padding to var(--space-card)");
    cleanup();
    document.head.replaceChildren();
  });
});

describe("custom token adapter in Design mode", () => {
  let shadow: ShadowRoot;
  let host: HTMLElement;
  let label: HTMLElement;
  let controller: ReturnType<typeof createDesignMode>;
  let proposals: Array<string | undefined>;

  async function open(design: DesignSystem) {
    document.body.innerHTML = '<main><p id="label" class="text-secondary">Hello</p></main><div id="komo"></div>';
    label = document.querySelector("#label")!;
    host = document.querySelector("#komo")!;
    shadow = host.attachShadow({ mode: "open" });
    proposals = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    controller = createDesignMode({
      root: shadow,
      host,
      design,
      targetAt: () => label,
      onComment: (_element, proposal) => { proposals.push(proposal); },
      onExit: () => {},
    });
    controller.setActive(true);
    await controller.ready;
    const event = new Event("pointerdown", { bubbles: true, cancelable: true, composed: true });
    Object.defineProperties(event, { clientX: { value: 10 }, clientY: { value: 10 }, button: { value: 0 } });
    label.dispatchEvent(event);
    await vi.waitFor(() => expect(field("color").querySelector(".design-token-binding")).not.toBeNull());
  }
  const field = (property: string) => shadow.querySelector<HTMLElement>(`[data-field-property="${property}"]`)!;
  const picker = (property: string) => field(property).querySelector<HTMLSelectElement>(".design-token-binding select")!;
  const choose = (property: string, path: string) => {
    picker(property).value = path;
    picker(property).dispatchEvent(new Event("change"));
  };
  const tool = (name: string) => shadow.querySelector<HTMLButtonElement>(`.design-inspector__actions [aria-label="${name}"]`)!;

  beforeEach(() => resetTokenSwaps(document.body));
  afterEach(() => {
    controller?.destroy();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("shows the resolved token, suggests tokens for the property grouped by group, and keeps states in the tooltip", async () => {
    await open({ tokens: classAdapter() });
    expect(field("color").dataset.tokenMode).toBe("connected");
    expect(field("color").querySelector(".design-token-chip")?.textContent).toBe("Uses color.text.secondary");
    const options = [...picker("color").querySelectorAll("optgroup")].map((group) => [group.label, [...group.querySelectorAll("option")].map((option) => option.textContent)]);
    expect(options).toEqual([["Text", ["Text primary · text-primary", "color.text.secondary · text-secondary"]]]);
    const fill = classAdapter();
    const control = createAdapterTokenControl(fill, label, "background-color", classTokens, undefined, () => {})!;
    const option = control.querySelector<HTMLOptionElement>('option[value="color.bg.interactive"]')!;
    expect(option.title).toContain("States: hover, active");
    expect(option.textContent).not.toContain("hover");
  });

  it("flags off-token values and names an exact match", async () => {
    await open({ tokens: classAdapter() });
    const control = createAdapterTokenControl(classAdapter(), label, "padding", classTokens, { offToken: "16px" }, () => {})!;
    const dot = control.querySelector<HTMLElement>(".design-token-off")!;
    expect(dot.hidden).toBe(false);
    expect(dot.title).toBe("Not from a token · 16px · matches space.md");
    expect(control.querySelector('option[value="space.md"]')?.textContent).toContain("same value");
    const odd = createAdapterTokenControl(classAdapter(), label, "padding", classTokens, { offToken: "13px" }, () => {})!;
    expect(odd.querySelector<HTMLElement>(".design-token-off")!.title).toBe("Not from a token · 13px");
    expect(closestToken(classTokens, "rgb(31, 31, 31)")?.path).toBe("color.text.primary");
    // A resolved token is never flagged.
    expect(field("color").querySelector<HTMLElement>(".design-token-off")!.hidden).toBe(true);
  });

  it("previews through the adapter, undoes with its undo, and compares Before/After", async () => {
    await open({ tokens: classAdapter() });
    choose("color", "color.text.primary");
    expect(label.className).toBe("text-primary");
    expect(field("color").dataset.tokenMode).toBe("token");
    const compare = shadow.querySelector<HTMLElement>(".design-inspector__compare")!;
    expect(compare.hidden).toBe(false);
    compare.querySelector<HTMLButtonElement>("button")!.click();
    expect(label.className).toBe("text-secondary");
    compare.querySelectorAll<HTMLButtonElement>("button")[1].click();
    expect(label.className).toBe("text-primary");
    tool("Undo").click();
    expect(label.className).toBe("text-secondary");
    expect(tool("Undo").disabled).toBe(true);
    await vi.waitFor(() => expect(picker("color").value).toBe("color.text.secondary"));
    choose("color", "color.text.primary");
    tool("Reset").click();
    expect(label.className).toBe("text-secondary");
  });

  it("detaches raw edits, supersedes their inline values with tokens, and undoes in chronological order", async () => {
    await open({ tokens: classAdapter() });
    const raw = () => field("color").querySelector<HTMLInputElement>('input[data-property="color"]')!;
    const edit = (value: string) => {
      raw().focus();
      raw().value = value;
      raw().dispatchEvent(new Event("input", { bubbles: true }));
      raw().dispatchEvent(new Event("change", { bubbles: true }));
      raw().blur();
    };
    edit("#ef3340");
    await vi.waitFor(() => expect(field("color").dataset.tokenMode).toBe("custom"));
    expect(tokenSwapChanges(label)).toEqual([]);
    choose("color", "color.text.primary");
    expect(label.style.color).toBe("");
    expect(label.className).toBe("text-primary");
    expect(field("color").dataset.tokenMode).toBe("token");
    edit("#2468ff");
    await vi.waitFor(() => expect(field("color").dataset.tokenMode).toBe("custom"));
    expect(label.style.getPropertyPriority("color")).toBe("important");
    expect(tokenSwapChanges(label)).toEqual([]);
    tool("Undo").click();
    expect(label.style.color).toBe("");
    await vi.waitFor(() => expect(field("color").dataset.tokenMode).toBe("token"));
    tool("Undo").click();
    expect(label.style.color).toBe("rgb(239, 51, 64)");
    await vi.waitFor(() => expect(field("color").dataset.tokenMode).toBe("custom"));
    tool("Undo").click();
    expect(label.style.color).toBe("");
    expect(label.className).toBe("text-secondary");
    await vi.waitFor(() => expect(field("color").dataset.tokenMode).toBe("connected"));
  });

  it("suspends adapter swaps while inactive and resumes them with Undo intact", async () => {
    await open({ tokens: classAdapter() });
    choose("color", "color.text.primary");
    expect(label.className).toBe("text-primary");
    controller.setActive(false);
    expect(label.className).toBe("text-secondary");
    controller.setActive(true);
    expect(label.className).toBe("text-primary");
    expect(tool("Undo").disabled).toBe(false);
    expect(proposedDesignChanges(label)).toContain("color.text.primary");
    tool("Undo").click();
    expect(label.className).toBe("text-secondary");
    expect(proposedDesignChanges(label)).toBeUndefined();
  });

  it("coalesces raw color input and never reconnects an equal literal automatically", async () => {
    await open({ tokens: classAdapter() });
    const swatch = field("color").querySelector<HTMLInputElement>('input[type="color"]')!;
    swatch.dispatchEvent(new Event("focus"));
    for (const value of ["#ef3340", "#2468ff", "#6b6b6b"]) {
      swatch.value = value;
      swatch.dispatchEvent(new Event("input", { bubbles: true }));
    }
    swatch.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(field("color").dataset.tokenMode).toBe("custom"));
    expect(tokenSwapChanges(label)).toEqual([]);
    tool("Undo").click();
    expect(label.getAttribute("style")).toBeNull();
    expect(tool("Undo").disabled).toBe(true);
    await vi.waitFor(() => expect(field("color").dataset.tokenMode).toBe("connected"));
  });

  it("keeps transient picker previews out of proposals and commits exactly one undo step", async () => {
    await open({ tokens: classAdapter() });
    const trigger = picker("color");
    trigger.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", button: 0 }));
    await vi.waitFor(() => expect(shadow.querySelector(".komo-tokens")).not.toBeNull());
    const search = shadow.querySelector<HTMLInputElement>(".komo-tokens input")!;
    const press = (key: string) => search.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true }));
    const primary = shadow.querySelector<HTMLElement>('.komo-tokens [role="option"][title*="text-primary"]')!;
    expect(shadow.querySelectorAll('.komo-tokens [role="option"]')).toHaveLength(2);
    expect(shadow.querySelector('.komo-tokens [aria-selected="true"]')?.getAttribute("title")).toContain("text-secondary");
    for (let i = 0; i < 12; i++) {
      primary.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
      expect(label.className).toBe("text-primary");
      expect(proposedDesignChanges(label)).toBeUndefined();
      expect(tool("Undo").disabled).toBe(true);
      press("ArrowDown");
      expect(label.className).toBe("text-secondary");
    }
    press("ArrowUp");
    press("Enter");
    expect(label.className).toBe("text-primary");
    expect(proposedDesignChanges(label)).toContain("color.text.primary");
    expect(shadow.querySelector(".komo-tokens")).toBeNull();
    tool("Undo").click();
    expect(label.className).toBe("text-secondary");
    expect(tool("Undo").disabled).toBe(true);
  });

  it("cancels transient previews before a mode transition suspends committed bindings", async () => {
    await open({ tokens: classAdapter() });
    choose("color", "color.text.primary");
    picker("color").dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", button: 0 }));
    await vi.waitFor(() => expect(shadow.querySelector(".komo-tokens")).not.toBeNull());
    shadow.querySelectorAll<HTMLElement>('.komo-tokens [role="option"]')[1]
      .dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(label.className).toBe("text-secondary");
    controller.setActive(false);
    expect(shadow.querySelector(".komo-tokens")).toBeNull();
    expect(label.className).toBe("text-secondary");
    controller.setActive(true);
    expect(label.className).toBe("text-primary");
    tool("Undo").click();
    expect(label.className).toBe("text-secondary");
  });

  it("falls back to an inline value without preview()", async () => {
    const { preview: _preview, ...adapter } = classAdapter();
    await open({ tokens: adapter });
    choose("color", "color.text.primary");
    expect(label.style.color).toBe("rgb(31, 31, 31)");
    expect(label.className).toBe("text-secondary");
    tool("Undo").click();
    expect(label.style.color).toBe("");
  });

  it("records describe() text in a proposal the comment card still parses", async () => {
    await open({ tokens: classAdapter() });
    choose("color", "color.text.primary");
    const text = proposedDesignChanges(label)!;
    expect(text).toContain("Element color: #6b6b6b [color.text.secondary] → #1f1f1f [color.text.primary]");
    expect(text).toContain('Apply: Replace class "text-secondary" with "text-primary"');
    expect(text).toContain("Token adapter: classes");
    expect(tokenSwapChanges(label)).toEqual([{
      kind: "token", property: "color", from: { path: "color.text.secondary" }, to: { path: "color.text.primary" },
      apply: 'Replace class "text-secondary" with "text-primary"',
    }]);
    // The CLI reads the same structured change back out of the comment text.
    expect(designEditFromComment(text, "label")).toEqual({
      komo: "design-edit", version: 1, target: { selector: "label" }, tokens: "classes", changes: tokenSwapChanges(label),
    });
    const [section] = parseDesignComment(text);
    expect(section).toMatchObject({ changes: [{ label: "color", token: "color.text.primary", after: "#1f1f1f", apply: { kind: "style", property: "color" } }] });
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:last-child")!.click();
    await vi.waitFor(() => expect(proposals[0]).toContain("Element color:"));
    // Choosing the original token again is no change.
    choose("color", "color.text.secondary");
    expect(proposedDesignChanges(label)).toBeUndefined();
  });

  it("loads async list() and resolve() without blocking, and caches list() per theme state", async () => {
    const adapter = classAdapter({ async: true });
    let mode = "light";
    await open({ tokens: adapter, themes: [{ id: "mode", options: [{ id: "light" }, { id: "dark" }], current: () => mode, apply: (id) => { mode = id; } }] });
    expect(field("color").querySelector(".design-token-chip")?.textContent).toBe("Uses color.text.secondary");
    expect(adapter.list).toHaveBeenCalledTimes(1);
    expect(adapter.list).toHaveBeenCalledWith({ mode: "light" });
    await listTokens(adapter, { mode: "light" });
    expect(adapter.list).toHaveBeenCalledTimes(1);
    await listTokens(adapter, { mode: "dark" });
    expect(adapter.list).toHaveBeenCalledTimes(2);
  });
  it("refreshes semantic preview DOM, binding details and proposal values when the host theme changes", async () => {
    const root = document.documentElement;
    const styles = document.createElement("style");
    styles.textContent = '[data-review-mode="dark"] .text-secondary{color:#cccccc}[data-review-mode="light"] .text-secondary{color:#555555}';
    document.head.append(styles);
    root.setAttribute("data-review-mode", "dark");
    const values = { dark: ["#eeeeee", "#cccccc"], light: ["#222222", "#555555"] };
    const adapter: TokenAdapter = {
      id: "theme-values",
      list(theme) {
        const colors = values[(theme?.mode ?? root.getAttribute("data-review-mode")) as keyof typeof values];
        return classTokens.slice(0, 2).map((token, index) => ({ ...token, value: colors[index] }));
      },
      resolve: () => ({ color: { path: "color.text.secondary" } }),
    };
    try {
      await open({ tokens: adapter, themes: [{ id: "mode", options: [{ id: "light" }, { id: "dark" }], current: () => root.getAttribute("data-review-mode")!, apply: id => root.setAttribute("data-review-mode", id) }] });
      choose("color", "color.text.primary");
      expect(getComputedStyle(label).color).toBe("rgb(238, 238, 238)");
      root.setAttribute("data-review-mode", "light");
      await vi.waitFor(() => expect(getComputedStyle(label).color).toBe("rgb(34, 34, 34)"));
      expect(picker("color").title).toContain("#222222");
      expect(picker("color").title).not.toContain("#eeeeee");
      expect(proposedDesignChanges(label)).toContain("#555555 [color.text.secondary] → #222222 [color.text.primary]");
      tool("Undo").click();
      expect(label.style.color).toBe("");
      expect(getComputedStyle(label).color).toBe("rgb(85, 85, 85)");
    } finally {
      styles.remove();
      root.removeAttribute("data-review-mode");
    }
  });

  it("refreshes the focused Text color hex field when the host theme changes", async () => {
    const root = document.documentElement;
    const styles = document.createElement("style");
    styles.textContent = '[data-review-mode="dark"] .text-secondary{color:#cccccc;transition:color .25s}[data-review-mode="light"] .text-secondary{color:#555555;transition:color .25s}';
    document.head.append(styles);
    root.setAttribute("data-review-mode", "dark");
    const values = { dark: ["#eeeeee", "#cccccc"], light: ["#222222", "#555555"] };
    const adapter: TokenAdapter = {
      id: "field-theme-values",
      list(theme) {
        const colors = values[(theme?.mode ?? root.getAttribute("data-review-mode")) as keyof typeof values];
        return classTokens.slice(0, 2).map((token, index) => ({ ...token, value: colors[index] }));
      },
      resolve: () => ({ color: { path: "color.text.secondary" } }),
    };
    try {
      await open({ tokens: adapter, themes: [{ id: "mode", options: [{ id: "light" }, { id: "dark" }], current: () => root.getAttribute("data-review-mode")!, apply: id => root.setAttribute("data-review-mode", id) }] });
      expect(field("color").dataset.tokenMode).toBe("connected");
      const raw = field("color").querySelector<HTMLInputElement>('input[data-property="color"]')!;
      const swatch = field("color").querySelector<HTMLInputElement>('input[type="color"]')!;
      expect(raw.value).toBe("#cccccc");
      raw.focus();
      root.setAttribute("data-review-mode", "light");
      await vi.waitFor(() => expect(getComputedStyle(label).color).toBe("rgb(85, 85, 85)"));
      await vi.waitFor(() => expect(raw.value).toBe("#555555"));
      expect(swatch.value).toBe("#555555");
      expect(tool("Undo").disabled).toBe(true);
    } finally {
      styles.remove();
      root.removeAttribute("data-review-mode");
    }
  });

  it("keeps an open picker and its transient option current across an external theme change", async () => {
    const root = document.documentElement;
    root.setAttribute("data-review-mode", "dark");
    const values = { dark: ["#eeeeee", "#cccccc"], light: ["#222222", "#555555"] };
    let releaseLight: (() => void) | undefined;
    try {
      await open({ tokens: {
        id: "open-theme-values",
        list(theme) {
          const tokens = classTokens.slice(0, 2).map((token, index) => ({ ...token, value: values[(theme?.mode ?? "dark") as keyof typeof values][index] }));
          return theme?.mode === "light" ? new Promise<DesignToken[]>(resolve => { releaseLight = () => resolve(tokens); }) : tokens;
        },
        resolve: () => ({ color: { path: "color.text.secondary" } }),
      }, themes: [{ id: "mode", options: [{ id: "light" }, { id: "dark" }], current: () => root.getAttribute("data-review-mode")!, apply: id => root.setAttribute("data-review-mode", id) }] });
      choose("color", "color.text.primary");
      picker("color").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }));
      await vi.waitFor(() => expect(shadow.querySelector(".komo-tokens")).not.toBeNull());
      const popup = shadow.querySelector(".komo-tokens")!;
      const search = popup.querySelector<HTMLInputElement>("input")!;
      search.value = "text";
      search.dispatchEvent(new Event("input"));
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }));
      expect(getComputedStyle(label).color).toBe("rgb(204, 204, 204)");
      await vi.waitFor(() => expect(releaseLight).toBeTypeOf("function"));
      root.setAttribute("data-review-mode", "light");
      await new Promise(resolve => setTimeout(resolve, 0));
      for (const key of ["ArrowUp", "ArrowDown"]) search.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true }));
      releaseLight!();
      await vi.waitFor(() => expect(getComputedStyle(label).color).toBe("rgb(85, 85, 85)"));
      expect(shadow.querySelector(".komo-tokens")).toBe(popup);
      expect(popup.querySelector("input")).toBe(search);
      expect(search.value).toBe("text");
      expect(popup.querySelector("[data-active]")?.getAttribute("aria-label")).toContain("#555555");
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
      expect(getComputedStyle(label).color).toBe("rgb(34, 34, 34)");
      tool("Undo").click();
      expect(label.getAttribute("style")).toBeNull();
    } finally { root.removeAttribute("data-review-mode"); }
  });

  it("refreshes semantic history while retaining literal overrides and suspended Before state", async () => {
    const root = document.documentElement;
    const styles = document.createElement("style");
    styles.textContent = '[data-review-mode="dark"] .text-secondary{color:#cccccc}[data-review-mode="light"] .text-secondary{color:#555555}';
    document.head.append(styles);
    root.setAttribute("data-review-mode", "dark");
    const values = { dark: ["#eeeeee", "#cccccc", "#dddddd"], light: ["#222222", "#555555", "#333333"] };
    const listeners = new Set<() => void>();
    const axis = {
      id: "mode", options: [{ id: "light" }, { id: "dark" }],
      current: () => root.getAttribute("data-review-mode")!,
      apply(id: string) { root.setAttribute("data-review-mode", id); listeners.forEach(listener => listener()); },
      subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    const adapter: TokenAdapter = {
      id: "history-theme-values",
      list: theme => [...classTokens.slice(0, 2), { ...classTokens[0], path: "color.text.alternate" }].map((token, index) => ({ ...token, value: values[(theme?.mode ?? "dark") as keyof typeof values][index] })),
      resolve: () => ({ color: { path: "color.text.secondary" } }),
    };
    try {
      await open({ tokens: adapter, themes: [axis] });
      choose("color", "color.text.primary");
      choose("color", "color.text.alternate");
      axis.apply("light");
      await vi.waitFor(() => expect(getComputedStyle(label).color).toBe("rgb(51, 51, 51)"));
      tool("Undo").click();
      expect(getComputedStyle(label).color).toBe("rgb(34, 34, 34)");
      const raw = field("color").querySelector<HTMLInputElement>('input[data-property="color"]')!;
      raw.focus(); raw.value = "#ef3340";
      raw.dispatchEvent(new Event("input", { bubbles: true }));
      raw.dispatchEvent(new Event("change", { bubbles: true }));
      raw.blur();
      axis.apply("dark");
      await vi.waitFor(() => expect(picker("color").querySelector('option[value="color.text.primary"]')?.getAttribute("title")).toContain("#eeeeee"));
      expect(getComputedStyle(label).color).toBe("rgb(239, 51, 64)");
      expect(field("color").dataset.tokenMode).toBe("custom");
      tool("Undo").click();
      expect(getComputedStyle(label).color).toBe("rgb(238, 238, 238)");
      const sides = () => shadow.querySelectorAll<HTMLButtonElement>(".design-inspector__compare button");
      sides()[0].click();
      axis.apply("light");
      await vi.waitFor(() => expect(picker("color").title).toContain("#222222"));
      expect(getComputedStyle(label).color).toBe("rgb(85, 85, 85)");
      sides()[1].click();
      expect(getComputedStyle(label).color).toBe("rgb(34, 34, 34)");
      controller.setActive(false);
      axis.apply("dark");
      await vi.waitFor(() => expect(picker("color").title).toContain("#eeeeee"));
      expect(getComputedStyle(label).color).toBe("rgb(204, 204, 204)");
      controller.setActive(true);
      expect(getComputedStyle(label).color).toBe("rgb(238, 238, 238)");
      tool("Reset").click();
      expect(label.getAttribute("style")).toBeNull();
      controller.destroy();
      expect(listeners.size).toBe(0);
    } finally { styles.remove(); root.removeAttribute("data-review-mode"); }
  });

  it("keeps a custom literal while its semantic baseline in a new proposal follows the theme", async () => {
    const root = document.documentElement;
    root.setAttribute("data-review-mode", "dark");
    try {
      await open({ tokens: {
        id: "custom-theme-baseline",
        list: theme => classTokens.slice(0, 2).map((token, index) => ({ ...token, value: (theme?.mode === "light" ? ["#222222", "#555555"] : ["#eeeeee", "#cccccc"])[index] })),
        resolve: () => ({ color: { path: "color.text.secondary" } }),
      }, themes: [{ id: "mode", options: [{ id: "light" }, { id: "dark" }], current: () => root.getAttribute("data-review-mode")!, apply: id => root.setAttribute("data-review-mode", id) }] });
      const raw = field("color").querySelector<HTMLInputElement>('input[data-property="color"]')!;
      raw.focus(); raw.value = "#ef3340";
      raw.dispatchEvent(new Event("input", { bubbles: true }));
      raw.dispatchEvent(new Event("change", { bubbles: true })); raw.blur();
      root.setAttribute("data-review-mode", "light");
      await vi.waitFor(() => expect(picker("color").querySelector('option[value="color.text.secondary"]')?.getAttribute("title")).toContain("#555555"));
      expect(getComputedStyle(label).color).toBe("rgb(239, 51, 64)");
      [...shadow.querySelectorAll<HTMLButtonElement>(".design-inspector__bar button")].find(button => button.textContent === "Comment")!.click();
      await vi.waitFor(() => expect(proposals[0]).toContain("- color: #555555 → rgb(239, 51, 64)"));
      expect(proposals[0]).not.toContain("#cccccc");
    } finally { root.removeAttribute("data-review-mode"); }
  });

  const accent: DesignToken = { path: "color.text.accent", type: "color", value: "#123456", properties: ["color"], group: "Text", label: "Text accent", ref: "text-accent" };
  async function openPicker() {
    picker("color").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }));
    await vi.waitFor(() => expect(shadow.querySelector(".komo-tokens [role=option]")).not.toBeNull());
    const popup = shadow.querySelector<HTMLElement>(".komo-tokens")!;
    const search = popup.querySelector<HTMLInputElement>("input")!;
    search.value = "text";
    search.dispatchEvent(new Event("input"));
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }));
    return { popup, search, active: () => popup.querySelector("[data-active]")?.getAttribute("aria-label") };
  }

  it("refreshes an open picker in place when a subscribed adapter reports a new token set", async () => {
    let tokens = classTokens.slice(0, 2);
    const listeners = new Set<() => void>();
    const adapter = {
      id: "live-list",
      list: vi.fn(() => tokens),
      resolve: () => ({ color: { path: "color.text.secondary" } }),
      subscribe: vi.fn((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
    } satisfies TokenAdapter;
    await open({ tokens: adapter });
    expect(adapter.subscribe).toHaveBeenCalledTimes(1);
    const calls = adapter.list.mock.calls.length;
    const { popup, search, active } = await openPicker();
    const row = active();
    const previewed = getComputedStyle(label).color;
    expect(row).toBeTruthy();
    expect(popup.textContent).not.toContain("Text accent");
    tokens = [...tokens, accent];
    listeners.forEach(listener => listener());
    await vi.waitFor(() => expect(popup.textContent).toContain("Text accent"));
    expect(adapter.list.mock.calls.length).toBe(calls + 1);
    expect(shadow.querySelector(".komo-tokens")).toBe(popup);
    expect(popup.querySelector("input")).toBe(search);
    expect(search.value).toBe("text");
    expect(active()).toBe(row);
    expect(getComputedStyle(label).color).toBe(previewed);
    expect(picker("color").querySelector('option[value="color.text.accent"]')).not.toBeNull();
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    expect(label.getAttribute("style")).toBeNull();
    controller.destroy();
    expect(listeners.size).toBe(0);
  });

  it("shows a class from a late <style> in an already-open onlyGenerated Tailwind picker", async () => {
    const styles = document.createElement("style");
    styles.textContent = ".text-primary{color:#1f1f1f}.text-secondary{color:#6b6b6b}";
    document.head.append(styles);
    const late = document.createElement("style");
    try {
      await open({ tokens: tailwindTokens({ tokens: [
        { path: "color.text.primary", type: "color", class: "text-primary", properties: ["color"], value: "#1f1f1f", label: "Text primary" },
        { path: "color.text.secondary", type: "color", class: "text-secondary", properties: ["color"], value: "#6b6b6b", label: "Text secondary" },
        { path: "color.text.accent", type: "color", class: "text-accent", properties: ["color"], value: "#123456", label: "Text accent" },
      ] }, { onlyGenerated: true }) });
      const { popup, search, active } = await openPicker();
      const row = active();
      expect(popup.textContent).not.toContain("Text accent");
      late.textContent = ".text-accent{color:#123456}";
      document.head.append(late);
      await vi.waitFor(() => expect(popup.textContent).toContain("Text accent"));
      expect(shadow.querySelector(".komo-tokens")).toBe(popup);
      expect(search.value).toBe("text");
      expect(active()).toBe(row);
      late.remove();
      await vi.waitFor(() => expect(popup.textContent).not.toContain("Text accent"));
      expect(search.value).toBe("text");
    } finally { styles.remove(); late.remove(); }
  });

});

describe("token list invalidation", () => {
  const paths = (tokens: DesignToken[]) => tokens.map(token => token.path);

  it("reuses list() until a subscribed adapter reports a change, and unsubscribes on abort", async () => {
    let version = 0;
    const listeners = new Set<() => void>();
    const adapter = {
      id: "versioned",
      list: vi.fn(() => [{ path: `t.${version}`, type: "other" as const, value: "" }]),
      resolve: () => ({}),
      subscribe: vi.fn((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
    } satisfies TokenAdapter;
    expect(paths(await listTokens(adapter))).toEqual(["t.0"]);
    version = 1;
    expect(paths(await listTokens(adapter))).toEqual(["t.0"]);
    expect(adapter.list).toHaveBeenCalledTimes(1);
    const first = new AbortController(), second = new AbortController();
    const one = vi.fn(), two = vi.fn();
    watchTokenList(adapter, one, first.signal);
    watchTokenList(adapter, two, second.signal);
    expect(adapter.subscribe).toHaveBeenCalledTimes(2);
    // A change made before anyone subscribed is not served from the old cache.
    expect(paths(await listTokens(adapter))).toEqual(["t.1"]);
    await listTokens(adapter);
    expect(adapter.list).toHaveBeenCalledTimes(2);
    version = 2;
    listeners.forEach(listener => listener());
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
    expect(paths(await listTokens(adapter, { mode: "dark" }))).toEqual(["t.2"]);
    expect(paths(await listTokens(adapter))).toEqual(["t.2"]);
    first.abort();
    expect(listeners.size).toBe(1);
    listeners.forEach(listener => listener());
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(2);
    second.abort();
    expect(listeners.size).toBe(0);
    // An adapter whose subscribe() throws or returns no function changes nothing.
    const broken = { ...adapter, list: vi.fn(() => []), subscribe: () => { throw new Error("no"); } };
    const odd = { ...adapter, list: vi.fn(() => []), subscribe: () => undefined as unknown as () => void };
    for (const item of [broken, odd]) {
      const controller = new AbortController();
      watchTokenList(item, one, controller.signal);
      controller.abort();
    }
  });

  it("costs nothing for an adapter without subscribe()", async () => {
    const adapter = classAdapter();
    await listTokens(adapter);
    const update = vi.fn();
    watchTokenList(adapter, update, new AbortController().signal);
    await listTokens(adapter);
    expect(adapter.list).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
});
