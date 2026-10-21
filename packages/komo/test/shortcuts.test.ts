// @vitest-environment jsdom
import { expect, it } from "vitest";
import { matchesShortcut, resolveDesignKeys, resolveShortcuts } from "../src/shortcuts";

const press = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

it("defaults to C, V, D, Shift+K, and L", () => {
  const shortcuts = resolveShortcuts();
  expect(shortcuts.comment?.label).toBe("C");
  expect(shortcuts.browse?.label).toBe("V");
  expect(shortcuts.design?.label).toBe("D");
  expect(shortcuts.restore?.label).toBe("Shift+K");
  expect(shortcuts.comments?.label).toBe("L");
});

it("matches modified letters by physical key and bare letters by layout", () => {
  const { comment, comments, browse } = resolveShortcuts({
    comment: "Shift+C",
    comments: "Alt+L",
    browse: "1",
  });
  const bare = resolveShortcuts().comment;
  const plus = resolveShortcuts({ comment: "+" }).comment;
  // Caps Lock, a non-US layout, and macOS Alt characters.
  expect(matchesShortcut(press({ key: "C", code: "KeyC", shiftKey: true }), comment)).toBe(true);
  expect(matchesShortcut(press({ key: "c", code: "KeyC", shiftKey: true }), comment)).toBe(true);
  expect(matchesShortcut(press({ key: "Ç", code: "KeyC", shiftKey: true }), comment)).toBe(true);
  expect(matchesShortcut(press({ key: "¬", code: "KeyL", altKey: true }), comments)).toBe(true);
  expect(matchesShortcut(press({ key: "Ç", code: "KeyC", altKey: true, shiftKey: true }), comment)).toBe(false);
  // Bare letters follow the layout, wherever the key sits.
  expect(matchesShortcut(press({ key: "C", code: "KeyC" }), bare)).toBe(true);
  expect(matchesShortcut(press({ key: "c", code: "KeyB" }), bare)).toBe(true);
  expect(matchesShortcut(press({ key: "j", code: "KeyC" }), bare)).toBe(false);
  // Non-Latin layouts fall back to the physical key.
  expect(matchesShortcut(press({ key: "с", code: "KeyC" }), bare)).toBe(true);
  // Digits on a layout that needs Shift for them.
  expect(matchesShortcut(press({ key: "1", code: "Digit1" }), browse)).toBe(true);
  expect(matchesShortcut(press({ key: "&", code: "Digit1" }), browse)).toBe(true);
  expect(matchesShortcut(press({ key: "+", code: "Equal" }), plus)).toBe(true);
  expect(matchesShortcut(press({ key: "=", code: "Equal" }), plus)).toBe(false);
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

it("resolves Design mode's Before/After and selection keys, Tab included, and rejects clashes", () => {
  const keys = resolveDesignKeys();
  expect(Object.fromEntries(Object.entries(keys).map(([action, key]) => [action, key?.label]))).toEqual({
    before: "ArrowLeft", after: "ArrowRight", next: "Tab", prev: "Shift+Tab", parent: "Shift+Enter", child: "Enter",
  });
  expect(matchesShortcut(press({ key: "Tab", shiftKey: true }), keys.prev)).toBe(true);
  expect(matchesShortcut(press({ key: "Enter" }), keys.parent)).toBe(false);
  const custom = resolveDesignKeys({ compare: { before: "Alt+ArrowLeft", after: false }, select: { next: "J" } });
  expect([custom.before?.label, custom.after, custom.next?.label]).toEqual(["Alt+ArrowLeft", null, "J"]);
  expect(() => resolveDesignKeys({ select: { next: "Enter" } })).toThrow(/child and next|next and child/);
  expect(() => resolveDesignKeys({ compare: { before: "Escape" } })).toThrow(/Invalid/);
  // Tab stays reserved for the review shortcuts.
  expect(() => resolveShortcuts({ comment: "Tab" })).toThrow(/Invalid/);
});
