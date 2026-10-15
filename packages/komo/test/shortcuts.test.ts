// @vitest-environment jsdom
import { expect, it } from "vitest";
import { matchesShortcut, resolveShortcuts } from "../src/shortcuts";

const press = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

it("defaults to C, V, D, and Shift+K", () => {
  const shortcuts = resolveShortcuts();
  expect(shortcuts.comment?.label).toBe("C");
  expect(shortcuts.browse?.label).toBe("V");
  expect(shortcuts.design?.label).toBe("D");
  expect(shortcuts.restore?.label).toBe("Shift+K");
});

it("normalizes modifiers and disables shortcuts set to false", () => {
  const shortcuts = resolveShortcuts({
    comment: "shift+alt+m",
    browse: false,
    design: false,
    restore: "Shift++",
  });
  expect(shortcuts.design).toBeNull();
  expect(shortcuts.comment?.label).toBe("Alt+Shift+M");
  expect(shortcuts.browse).toBeNull();
  expect(shortcuts.restore?.label).toBe("Shift++");
});

it("rejects invalid, reserved, and duplicate shortcuts", () => {
  for (const comment of ["", "Hyper+C", "Shift+Shift+C", "Escape", "Shift+Tab"])
    expect(() => resolveShortcuts({ comment })).toThrow("Invalid komo shortcut");
  expect(() => resolveShortcuts({ comment: "V" })).toThrow("both use V");
  expect(() => resolveShortcuts({ comment: "D" })).toThrow("both use D");
  expect(resolveShortcuts({ comment: "D", design: false }).comment?.label).toBe("D");
});

it("matches modifiers exactly and falls back to the physical key", () => {
  const { comment, restore } = resolveShortcuts({ comment: "Alt+C" });
  expect(matchesShortcut(press({ key: "ç", code: "KeyC", altKey: true }), comment)).toBe(true);
  expect(matchesShortcut(press({ key: "c", code: "KeyC" }), comment)).toBe(false);
  expect(matchesShortcut(press({ key: "K", shiftKey: true }), restore)).toBe(true);
  expect(matchesShortcut(press({ key: "K", shiftKey: true, metaKey: true }), restore)).toBe(false);
  expect(matchesShortcut(press({ key: "k" }), null)).toBe(false);
});
