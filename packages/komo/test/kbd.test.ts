// @vitest-environment jsdom
import { expect, it } from "vitest";
import { renderKbd, shortcutKeys } from "../src/kbd.js";
import { resolveShortcuts } from "../src/shortcuts.js";

it("renders configured modifiers as native keycaps with spoken and ARIA names", () => {
  const shortcut = resolveShortcuts({ design: "Meta+Alt+Shift+D" }).design!;
  expect(shortcutKeys(shortcut, true)).toEqual({ keys: ["⌥", "⇧", "⌘", "D"], spoken: "Option + Shift + Command + D", aria: "Alt+Shift+Meta+D" });
  const caps = renderKbd(shortcut, true);
  expect([...caps.querySelectorAll("kbd")].map(node => node.textContent)).toEqual(["⌥", "⇧", "⌘", "D"]);
  expect(caps.getAttribute("aria-label")).toBe("Option + Shift + Command + D");
  expect(shortcutKeys(resolveShortcuts({ comment: "Ctrl+Shift+C" }).comment!, false).keys).toEqual(["Ctrl", "Shift", "C"]);
  expect(resolveShortcuts({ comment: false }).comment).toBeNull();
});

it("renders surface-aware filled keycaps by default and outlined caps on request", () => {
  const shortcut = resolveShortcuts({ design: "Shift+D" }).design!;
  expect(renderKbd(shortcut, true).dataset.variant).toBe("surface");
  expect(renderKbd(shortcut, true, "surface").dataset.variant).toBe("surface");
  const outline = renderKbd(shortcut, true, "outline");
  expect(outline.dataset.variant).toBe("outline");
  expect(outline.className).toBe("komo-kbd");
  expect([...outline.querySelectorAll("kbd")].map(node => node.textContent)).toEqual(["⇧", "D"]);
});

it("styles tooltips and keycaps from the shared surface and ink tokens", async () => {
  const { styles } = await import("../src/styles.js");
  const { morphingMenuStyles } = await import("../src/morphing-menu-styles.js");
  const from = (css: string, selector: string) => {
    const rule = css.slice(css.indexOf(selector));
    return rule.slice(0, rule.indexOf("}"));
  };
  const tooltip = from(morphingMenuStyles, ".morphing-menu__tooltip {");
  expect(tooltip).toContain("background: var(--mm-tooltip-surface, color-mix(in oklab, var(--mm-surface");
  expect(tooltip).toContain("color: var(--mm-ink");
  expect(tooltip).not.toContain("light-dark");
  expect(from(styles, ":host {")).toContain("--mm-tooltip-surface: color-mix(in oklab, var(--mm-surface) 88%, var(--mm-ink))");
  const caps = from(styles, ".komo-kbd kbd {");
  expect(caps).toContain("background:color-mix(in oklab, currentColor");
  expect(caps).not.toContain("border:");
});
