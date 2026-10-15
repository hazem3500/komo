// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesignMode } from "../src/design-mode.js";
import { cssVariableTokens, registerDesignTokenSource, type KomoDesignToken } from "../src/design-tokens.js";
import { createAdapterTokenControl, proposedDesignChanges } from "../src/react-props-panel.js";
import { closestToken, listTokens, resetTokenSwaps, tokenSwapChanges } from "../src/token-adapter.js";
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
    expect(field("color").querySelector(".design-token-chip")?.textContent).toBe("color.text.secondary");
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

  it("takes adapter swaps back when Design mode closes", async () => {
    await open({ tokens: classAdapter() });
    choose("color", "color.text.primary");
    expect(label.className).toBe("text-primary");
    controller.setActive(false);
    expect(label.className).toBe("text-secondary");
    controller.setActive(true);
    expect(tool("Undo").disabled).toBe(true);
    expect(proposedDesignChanges(label)).toBeUndefined();
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
    expect(field("color").querySelector(".design-token-chip")?.textContent).toBe("color.text.secondary");
    expect(adapter.list).toHaveBeenCalledTimes(1);
    expect(adapter.list).toHaveBeenCalledWith({ mode: "light" });
    await listTokens(adapter, { mode: "light" });
    expect(adapter.list).toHaveBeenCalledTimes(1);
    await listTokens(adapter, { mode: "dark" });
    expect(adapter.list).toHaveBeenCalledTimes(2);
  });
});
