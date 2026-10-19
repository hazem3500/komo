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
