// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesignMode } from "../src/design-mode.js";
import {
  applyTokenToElement,
  declaredTokenFor,
  hasDesignTokenChanges,
  previewThemeToken,
  proposedDesignTokenChanges,
  registerDesignTokenSource,
  resetDesignTokens,
  tokenImpactCount,
  tokenSourceFor,
  undoDesignToken,
  canUndoDesignToken,
} from "../src/design-tokens.js";
import * as panelFields from "../src/design-panel.js";
import { createDesignThemePanel, createElementTokenControl, noteDesignTokenOverride } from "../src/react-props-panel.js";
import type { KomoDesignToken } from "../src/design-tokens.js";

const tokens: KomoDesignToken[] = [
  { path: "color.brand", cssVariable: "--brand", type: "color", properties: ["color", "background-color"], impactSelector: ".card[data-theme='brand']" },
  { path: "spacing.card", cssVariable: "--space-card", type: "dimension", properties: ["padding", "gap"], impactSelector: ".card" },
];

describe("explicit design-token preview bridge", () => {
  afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

  it("only registers unique allowlisted CSS vars and restores preview state on cleanup", () => {
    document.body.innerHTML = '<main><article class="card"></article></main>';
    const root = document.documentElement;
    root.style.setProperty("--brand", "#224466");
    const cleanup = registerDesignTokenSource(root, tokens);
    const card = document.querySelector<HTMLElement>(".card")!;
    expect(tokenSourceFor(card)?.tokens.map((token) => token.path)).toEqual(["color.brand", "spacing.card"]);
    expect(() => registerDesignTokenSource(root, [{ ...tokens[0], cssVariable: "--arbitrary", properties: ["content"] }])).toThrow();
    expect(applyTokenToElement(tokenSourceFor(card)!, card, tokenSourceFor(card)!.tokens[0], "background-color")).toBe(true);
    expect(card.style.getPropertyValue("background-color")).toBe("var(--brand)");
    cleanup();
    expect(card.style.getPropertyValue("background-color")).toBe("");
    expect(root.hasAttribute("data-komo-design-tokens")).toBe(false);
  });

  it("previews global values only on explicit action, reports scope, and supports undo/reset", () => {
    document.body.innerHTML = '<main><article class="card" data-theme="brand"></article><article class="card" data-theme="other"></article></main>';
    const root = document.documentElement;
    root.style.setProperty("--brand", "#224466");
    const cleanup = registerDesignTokenSource(root, tokens);
    const source = tokenSourceFor(document.querySelector(".card"))!;
    const brand = source.tokens[0];
    expect(tokenImpactCount(source, brand)).toBe(1);
    expect(source.root.style.getPropertyValue("--brand")).toBe("#224466");
    expect(previewThemeToken(source, brand, "#abcdef")).toBe(true);
    expect(source.root.style.getPropertyValue("--brand")).toBe("#abcdef");
    expect(proposedDesignTokenChanges(document.querySelector<HTMLElement>(".card")!)).toContain("Shared theme color.brand (--brand): #224466 → #abcdef; preview scope .card[data-theme='brand'] (1 matching elements)");
    const card = document.querySelector<HTMLElement>(".card")!;
    expect(hasDesignTokenChanges(card)).toBe(true);
    undoDesignToken(card);
    expect(root.style.getPropertyValue("--brand")).toBe("#224466");
    expect(hasDesignTokenChanges(card)).toBe(false);
    previewThemeToken(source, brand, "#abcdef");
    resetDesignTokens(card);
    expect(root.style.getPropertyValue("--brand")).toBe("#224466");
    cleanup();
  });

  it("keeps compatible token choices on the style knob and preserves explicit overrides", async () => {
    document.body.innerHTML = '<main><article class="card" data-theme="brand"></article><div id="komo"></div></main>';
    const root = document.documentElement;
    root.style.setProperty("--brand", "#224466");
    const cleanup = registerDesignTokenSource(root, tokens);
    const card = document.querySelector<HTMLElement>(".card")!;
    const source = tokenSourceFor(card)!;
    const panel = createDesignThemePanel(card, panelFields, () => {})!;
    const brandValue = panel.querySelector<HTMLInputElement>('[aria-label="Shared theme value for color.brand"]')!;
    brandValue.value = "#abcdef";
    brandValue.dispatchEvent(new Event("input"));
    expect(root.style.getPropertyValue("--brand")).toBe("#abcdef");
    const knob = document.createElement("label");
    knob.dataset.property = "background-color";
    const value = document.createElement("input");
    value.dataset.property = "background-color";
    value.value = "#abcdef";
    knob.append(value);
    document.body.append(knob);
    const tokenControl = createElementTokenControl(card, "background-color", () => {})!;
    knob.append(tokenControl);
    const chooser = tokenControl.querySelector<HTMLSelectElement>("select")!;
    expect([...chooser.options].map((item) => item.value)).toEqual(["custom", "color.brand"]);
    chooser.value = "color.brand";
    chooser.dispatchEvent(new Event("change"));
    expect(card.style.getPropertyValue("background-color")).toBe("var(--brand)");
    expect(proposedDesignTokenChanges(card)).toContain("Element background-color: (unset) → var(--brand) [color.brand]");
    expect(tokenControl.textContent).toContain("Linked to color.brand");
    expect(tokenControl.dataset.mode).toBe("token");
    value.value = "#345678";
    card.style.setProperty("background-color", value.value);
    noteDesignTokenOverride(card, "background-color", value.value);
    await vi.waitFor(() => expect(tokenControl.dataset.mode).toBe("custom"));
    expect(proposedDesignTokenChanges(card)).toContain("#345678 [custom value]");
    resetDesignTokens(card);
    expect(card.style.getPropertyValue("background-color")).toBe("");
    cleanup();
  });

  it("previews shared theme values live as one undo step, marks them changed and resets per row", () => {
    document.body.innerHTML = '<main><article class="card" data-theme="brand"></article></main>';
    const root = document.documentElement;
    root.style.setProperty("--brand", "#224466");
    root.style.setProperty("--space-card", "28px");
    const cleanup = registerDesignTokenSource(root, tokens);
    const card = document.querySelector<HTMLElement>(".card")!;
    const onEdit = vi.fn();
    const panel = createDesignThemePanel(card, panelFields, onEdit)!;
    expect(panel.open).toBe(false);
    expect(panel.textContent).toContain("Changes every element using these tokens");
    expect(panel.querySelector("button:not(.design-theme-reset)")).toBeNull();
    const row = (path: string) => panel.querySelector<HTMLInputElement>(`[aria-label="Shared theme value for ${path}"]`)!.closest<HTMLElement>(".design-theme-token")!;
    const brand = row("color.brand").querySelector<HTMLInputElement>("[data-property]")!;
    const swatch = row("color.brand").querySelector<HTMLInputElement>('input[type="color"]')!;
    const spacing = row("spacing.card").querySelector<HTMLInputElement>("[data-property]")!;
    expect(spacing.value).toBe("28px");
    expect(row("color.brand").querySelector<HTMLButtonElement>(".design-theme-reset")!.disabled).toBe(true);

    // Typing previews on every input but records one undo step per focus session.
    brand.dispatchEvent(new Event("focus"));
    for (const value of ["#abc", "#abcdef"]) {
      brand.value = value;
      brand.dispatchEvent(new Event("input"));
    }
    brand.dispatchEvent(new Event("blur"));
    expect(root.style.getPropertyValue("--brand")).toBe("#abcdef");
    expect(swatch.value).toBe("#abcdef");
    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(row("color.brand").hasAttribute("data-changed")).toBe(true);
    expect(row("spacing.card").hasAttribute("data-changed")).toBe(false);
    expect(proposedDesignTokenChanges(card)).toContain("Shared theme color.brand (--brand): #224466 → #abcdef");

    // Sizes keep their unit and step with the arrow keys.
    spacing.dispatchEvent(new Event("focus"));
    spacing.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    spacing.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true }));
    spacing.dispatchEvent(new Event("blur"));
    expect(root.style.getPropertyValue("--space-card")).toBe("39px");

    undoDesignToken(card);
    expect(root.style.getPropertyValue("--space-card")).toBe("28px");
    undoDesignToken(card);
    expect(root.style.getPropertyValue("--brand")).toBe("#224466");
    expect(canUndoDesignToken(card)).toBe(false);

    // Invalid values are flagged, then the field shows the live value again on blur.
    brand.dispatchEvent(new Event("focus"));
    brand.value = "not a color";
    brand.dispatchEvent(new Event("input"));
    expect(brand.getAttribute("aria-invalid")).toBe("true");
    brand.dispatchEvent(new Event("blur"));
    expect(brand.value).toBe("#224466");

    brand.value = "#123456";
    brand.dispatchEvent(new Event("input"));
    const reset = row("color.brand").querySelector<HTMLButtonElement>(".design-theme-reset")!;
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(root.style.getPropertyValue("--brand")).toBe("#224466");
    expect(brand.value).toBe("#224466");
    expect(row("color.brand").hasAttribute("data-changed")).toBe(false);
    expect(hasDesignTokenChanges(card)).toBe(false);
    expect(canUndoDesignToken(card)).toBe(false);
    cleanup();
  });

  it("marks a token changed again when undo reverses a return to the page value", () => {
    document.body.innerHTML = '<main><article class="card"></article></main>';
    const root = document.documentElement;
    root.style.setProperty("--brand", "#224466");
    const cleanup = registerDesignTokenSource(root, tokens);
    const card = document.querySelector<HTMLElement>(".card")!;
    const source = tokenSourceFor(card)!;
    previewThemeToken(source, tokens[0], "#abcdef");
    previewThemeToken(source, tokens[0], "#224466");
    expect(source.themeEdits.size).toBe(0);
    undoDesignToken(card);
    expect(root.style.getPropertyValue("--brand")).toBe("#abcdef");
    expect(source.themeEdits.get("color.brand")).toMatchObject({ before: "#224466", after: "#abcdef" });
    cleanup();
  });

  it("groups long token lists by their first path segment", () => {
    document.body.innerHTML = '<main><article class="card"></article></main>';
    const many: KomoDesignToken[] = ["a", "b", "c", "d"].flatMap((name) => [
      { path: `color.${name}`, cssVariable: `--color-${name}`, type: "color", properties: ["color"], impactSelector: ".card" },
      { path: `radius.${name}`, cssVariable: `--radius-${name}`, type: "dimension", properties: ["border-radius"], impactSelector: ".card" },
    ]);
    const cleanup = registerDesignTokenSource(document.documentElement, many);
    const panel = createDesignThemePanel(document.querySelector<HTMLElement>(".card")!, panelFields, () => {})!;
    expect([...panel.querySelectorAll(".design-theme-heading")].map((item) => item.textContent)).toEqual(["color", "radius"]);
    expect(panel.querySelector(".design-theme-token > span")!.textContent).toBe("a");
    cleanup();
  });

  it("shows the token section only for explicitly registered page roots", async () => {
    document.body.innerHTML = '<article class="card"></article><div id="komo"></div>';
    const host = document.querySelector<HTMLElement>("#komo")!;
    const card = document.querySelector<HTMLElement>(".card")!;
    const root = document.documentElement;
    root.style.setProperty("--brand", "#224466");
    const cleanup = registerDesignTokenSource(root, tokens);
    const shadow = host.attachShadow({ mode: "open" });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const controller = createDesignMode({ root: shadow, host, targetAt: () => card, onComment: vi.fn(), onExit: vi.fn() });
    controller.setActive(true);
    const event = new Event("pointerdown", { bubbles: true, cancelable: true, composed: true });
    Object.defineProperties(event, { clientX: { value: 20 }, clientY: { value: 20 }, button: { value: 0 } });
    card.dispatchEvent(event);
    await vi.waitFor(() => expect(shadow.querySelector(".design-theme-group")).not.toBeNull());
    expect(shadow.querySelector('[aria-label="Style token for padding"]')).not.toBeNull();
    controller.destroy();
    cleanup();
  });

  it("reports a connected token only when the winning declaration references it", () => {
    document.body.innerHTML = `<style>
      .card { padding: var(--space-card); gap: 28px; }
      main .card.loud { padding: var(--space-card, 4px); }
      .card.plain { padding: 12px; }
      .card[data-theme='brand'] { background: var(--brand); }
    </style><main><article class="card"></article><article class="card plain"></article><article class="card loud plain"></article><article class="card forced" data-theme="brand"></article></main>`;
    const root = document.documentElement;
    root.style.setProperty("--space-card", "28px");
    const cleanup = registerDesignTokenSource(root, tokens);
    const [card, plain, loud, forced] = [...document.querySelectorAll<HTMLElement>(".card")];
    const source = tokenSourceFor(card)!;
    expect(declaredTokenFor(source, card, "padding")).toMatchObject({ origin: "stylesheet", token: { path: "spacing.card" } });
    // A matching computed value is not a token reference.
    expect(declaredTokenFor(source, card, "gap")).toBeNull();
    // Higher specificity wins, then source order.
    expect(declaredTokenFor(source, plain, "padding")).toBeNull();
    expect(declaredTokenFor(source, loud, "padding")?.token.path).toBe("spacing.card");
    // Inline declarations win. (jsdom drops rule !important priority; the browser check covers it.)
    card.style.setProperty("padding", "40px");
    expect(declaredTokenFor(source, card, "padding")).toBeNull();
    card.style.setProperty("padding", "var(--space-card)");
    expect(declaredTokenFor(source, card, "padding")?.origin).toBe("inline");
    expect(declaredTokenFor(source, forced, "background-color")?.token.path).toBe("color.brand");
    cleanup();
  });

  it("keeps stylesheet token provenance through custom overrides and rebinding", async () => {
    document.body.innerHTML = '<style>.card { display: flex; padding: var(--space-card); }</style><main><article class="card"></article></main><div id="komo"></div>';
    const root = document.documentElement;
    root.style.setProperty("--space-card", "28px");
    const cleanup = registerDesignTokenSource(root, tokens);
    const host = document.querySelector<HTMLElement>("#komo")!;
    const card = document.querySelector<HTMLElement>(".card")!;
    const shadow = host.attachShadow({ mode: "open" });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const proposals: Array<string | undefined> = [];
    const controller = createDesignMode({ root: shadow, host, targetAt: () => card, onComment: (_, proposal) => proposals.push(proposal), onExit: vi.fn() });
    controller.setActive(true);
    const event = new Event("pointerdown", { bubbles: true, cancelable: true, composed: true });
    Object.defineProperties(event, { clientX: { value: 20 }, clientY: { value: 20 }, button: { value: 0 } });
    card.dispatchEvent(event);
    const chooser = await vi.waitFor(() => {
      const found = shadow.querySelector<HTMLSelectElement>('[aria-label="Style token for padding"]');
      expect(found).not.toBeNull();
      return found!;
    });
    const row = chooser.closest<HTMLElement>(".design-token-binding")!;
    expect(chooser.value).toBe("spacing.card");
    expect(row.dataset.mode).toBe("connected");
    expect(row.textContent).toContain("Connected from stylesheet");
    expect(shadow.querySelector('[aria-label="Style token for gap"]')?.closest<HTMLElement>(".design-token-binding")?.dataset.mode).toBe("custom");

    const padding = shadow.querySelector<HTMLInputElement>('input[data-property="padding"]')!;
    padding.dispatchEvent(new Event("focus"));
    padding.value = "40";
    padding.dispatchEvent(new Event("input", { bubbles: true }));
    padding.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(row.dataset.mode).toBe("override"));
    expect(row.textContent).toContain("Custom override · was spacing.card");
    expect(chooser.value).toBe("custom");
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:last-child")!.click();
    await vi.waitFor(() => expect(proposals).toHaveLength(1));
    expect(proposals[0]).toContain("Element padding: var(--space-card) [spacing.card] → 40px [custom override]");
    // Token-bound properties are described once, by provenance, not again as raw CSS.
    expect(proposals[0]).not.toContain("- padding:");

    chooser.value = "spacing.card";
    chooser.dispatchEvent(new Event("change"));
    expect(card.style.getPropertyValue("padding")).toBe("");
    await vi.waitFor(() => expect(row.dataset.mode).toBe("connected"));
    expect(proposedDesignTokenChanges(card)).toBeUndefined();
    controller.destroy();
    cleanup();
  });

  it("binds a token inline as a chip on the field and detaches it back to the raw value", async () => {
    document.body.innerHTML = '<main><article class="card">Card copy</article></main><div id="komo"></div>';
    const root = document.documentElement;
    root.style.setProperty("--brand", "#224466");
    const cleanup = registerDesignTokenSource(root, tokens);
    const host = document.querySelector<HTMLElement>("#komo")!;
    const card = document.querySelector<HTMLElement>(".card")!;
    card.style.backgroundColor = "#ff0000";
    const shadow = host.attachShadow({ mode: "open" });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const controller = createDesignMode({ root: shadow, host, targetAt: () => card, onComment: vi.fn(), onExit: vi.fn() });
    controller.setActive(true);
    const event = new Event("pointerdown", { bubbles: true, cancelable: true, composed: true });
    Object.defineProperties(event, { clientX: { value: 20 }, clientY: { value: 20 }, button: { value: 0 } });
    card.dispatchEvent(event);
    const chooser = await vi.waitFor(() => {
      const found = shadow.querySelector<HTMLSelectElement>('[data-field-property="background-color"] [aria-label="Style token for background-color"]');
      expect(found).not.toBeNull();
      return found!;
    });
    const field = chooser.closest<HTMLElement>(".design-field")!;
    // Unbound: no chip text and no "not connected" caption.
    expect(field.dataset.tokenMode).toBe("custom");
    expect(field.querySelector(".design-token-chip")?.textContent).toBe("");
    expect(field.textContent).not.toContain("Not connected");
    expect(field.querySelector('[data-property="background-color"]')).not.toBeNull();

    chooser.value = "color.brand";
    chooser.dispatchEvent(new Event("change"));
    expect(card.style.backgroundColor).toBe("var(--brand)");
    expect(field.dataset.tokenMode).toBe("token");
    expect(field.querySelector(".design-token-chip")?.textContent).toBe("color.brand");
    expect(shadow.querySelector(".design-inspector__count")?.textContent).toBe("1 change");

    field.querySelector<HTMLButtonElement>('[aria-label="Detach token from background-color"]')!.click();
    await vi.waitFor(() => expect(field.dataset.tokenMode).toBe("custom"));
    expect(card.style.backgroundColor).toBe("rgb(34, 68, 102)");
    expect(chooser.value).toBe("custom");
    expect(field.querySelector(".design-token-chip")?.textContent).toBe("");
    controller.destroy();
    cleanup();
  });
});
