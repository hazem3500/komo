// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesignMode } from "../src/design-mode.js";
import {
  applyTokenToElement,
  hasDesignTokenChanges,
  previewThemeToken,
  proposedDesignTokenChanges,
  registerDesignTokenSource,
  resetDesignTokens,
  tokenImpactCount,
  tokenSourceFor,
  undoDesignToken,
} from "../src/design-tokens.js";
import { createDesignTokensPanel, installCommentCapture } from "../src/react-props-panel.js";
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

  it("preserves var references for local use and requires the shared-preview button", () => {
    document.body.innerHTML = '<main><article class="card" data-theme="brand"></article><div id="komo"></div></main>';
    const root = document.documentElement;
    root.style.setProperty("--brand", "#224466");
    const cleanup = registerDesignTokenSource(root, tokens);
    const card = document.querySelector<HTMLElement>(".card")!;
    const source = tokenSourceFor(card)!;
    const panel = createDesignTokensPanel(card, () => {})!;
    const brandValue = panel.querySelector<HTMLInputElement>('[aria-label="Shared theme value for color.brand"]')!;
    brandValue.value = "#abcdef";
    expect(root.style.getPropertyValue("--brand")).toBe("#224466");
    panel.querySelectorAll<HTMLButtonElement>(".design-token__controls button")[1].click();
    expect(root.style.getPropertyValue("--brand")).toBe("#abcdef");

    const fresh = createDesignTokensPanel(card, () => {})!;
    const firstToken = source.tokens[0];
    expect(applyTokenToElement(source, card, firstToken, "background-color")).toBe(true);
    expect(card.style.getPropertyValue("background-color")).toBe("var(--brand)");
    expect(proposedDesignTokenChanges(card)).toContain("Element background-color: (unset) → var(--brand) [color.brand]");
    const comment = document.createElement("button");
    const onComment = vi.fn();
    installCommentCapture(comment, () => card, onComment);
    comment.click();
    expect(onComment.mock.calls[0]?.[1]).toContain("var(--brand) [color.brand]");
    expect(fresh.textContent).toContain("Tokens & theme");
    resetDesignTokens(card);
    expect(card.style.getPropertyValue("background-color")).toBe("");
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
    await vi.waitFor(() => expect(shadow.querySelector(".design-token-group")).not.toBeNull());
    expect(shadow.querySelector(".design-token-group")?.textContent).toContain("color.brand");
    controller.destroy();
    cleanup();
  });
});
