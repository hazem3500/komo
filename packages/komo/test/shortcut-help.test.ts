// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { showShortcutHelp } from "../src/shortcut-help.js";
import { resolveShortcuts } from "../src/shortcuts.js";

let root: ShadowRoot;
beforeEach(() => {
  const host = document.createElement("div");
  document.body.append(host);
  root = host.attachShadow({ mode: "open" });
  // jsdom has no modal dialogs: open focuses the autofocus control, close fires "close".
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.open = true;
      this.querySelector<HTMLElement>("[autofocus]")?.focus();
    },
    close(this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      this.dispatchEvent(new Event("close"));
    },
  });
});
afterEach(() => {
  root.querySelectorAll("dialog").forEach(dialog => dialog.close());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};
const dialog = () => root.querySelector<HTMLDialogElement>("dialog.komo-shortcuts");
const headings = () => [...root.querySelectorAll("h3")].map(node => node.textContent);
const visibleRows = () => [...root.querySelectorAll<HTMLElement>(".komo-shortcuts__row")].filter(row => !row.hidden).map(row => row.firstChild!.textContent);

it("labels the dialog by its pinned title and lists only bound commands, with gestures as text", () => {
  const shortcuts = resolveShortcuts({ design: "Meta+Alt+Shift+D", comment: false });
  showShortcutHelp(root, [
    { label: "Design mode", shortcut: shortcuts.design, group: "General" },
    { label: "Disabled comment", shortcut: shortcuts.comment, group: "Empty" },
    { label: "No binding", group: "Empty" },
    { label: "No gesture", keys: [], group: "Empty" },
  ], true);
  const help = dialog()!;
  expect(help.getAttribute("aria-modal")).toBe("true");
  expect(help.querySelector(`#${help.getAttribute("aria-labelledby")}`)?.textContent).toBe("Keyboard shortcuts");
  expect(help.querySelector("header h2")?.textContent).toBe("Keyboard shortcuts");
  const close = help.querySelector<HTMLButtonElement>("header button")!;
  expect(close.getAttribute("aria-label")).toBe("Close");
  expect(close.hasAttribute("title")).toBe(false);
  expect(close.querySelector("svg")).not.toBeNull();
  expect(help.querySelector(".komo-shortcuts__tip")?.getAttribute("aria-hidden")).toBe("true");
  expect([...help.querySelectorAll("button")].map(node => node.textContent)).not.toContain("Close help");
  expect(headings()).toEqual(["General", "Comments", "Design canvas", "Experimental geometry", "Text editing", "Compare"]);
  expect(help.querySelector(".komo-shortcuts__row")?.getAttribute("aria-keyshortcuts")).toBe("Alt+Shift+Meta+D");
  expect(help.textContent).not.toMatch(/Disabled comment|No binding|No gesture|·/);
  const row = (label: string) => [...help.querySelectorAll(".komo-shortcuts__row")].find(node => node.firstChild?.textContent === label)!;
  const click = row("Inspect element");
  expect(click.querySelectorAll("kbd")).toHaveLength(0);
  expect(click.querySelector(".komo-kbd")?.getAttribute("aria-label")).toBe("Click");
  expect(click.querySelector(".komo-kbd span")?.textContent).toBe("Click");
  expect([...row("Select inner element").querySelectorAll("kbd")].map(node => node.textContent)).toHaveLength(1);
  expect(row("Select inner element").querySelector(".komo-kbd span")?.textContent).toBe("Click");
  expect(row("Edit text").querySelectorAll("kbd")).toHaveLength(0);
  expect(help.querySelector(".komo-shortcuts__body")?.lastElementChild?.textContent).toBe("Shortcuts pause while typing in a text field.");
  expect(root.activeElement).toBe(help.querySelector(".komo-shortcuts__body"));
});

it("puts the current mode's groups first", () => {
  const shortcuts = resolveShortcuts();
  const commands = [
    { label: "Add comment", shortcut: shortcuts.comment, group: "General" },
    { label: "All comments", shortcut: shortcuts.comments, group: "Comments" },
  ];
  showShortcutHelp(root, commands, true, "design");
  expect(headings()).toEqual(["Design canvas", "Experimental geometry", "Text editing", "Compare", "General", "Comments"]);
  dialog()!.close();
  showShortcutHelp(root, commands, true, "comment");
  expect(headings()).toEqual(["Comments", "General", "Design canvas", "Experimental geometry", "Text editing", "Compare"]);
  dialog()!.close();
  showShortcutHelp(root, commands, false);
  expect(headings()).toEqual(["General", "Comments"]);
});

it("shows configured keys with platform glyphs", () => {
  const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const shortcuts = resolveShortcuts({ restore: "Shift+J", design: "Alt+D" });
  const commands = [
    { label: "Restore feedback", shortcut: shortcuts.restore, group: "General" },
    { label: "Design mode", shortcut: shortcuts.design, group: "General" },
  ];
  const keys = (label: string) => [...root.querySelectorAll(".komo-shortcuts__row")].find(node => node.firstChild?.textContent === label)!.querySelector(".komo-kbd")!;
  showShortcutHelp(root, commands, true);
  expect(keys("Restore feedback").textContent).toBe("⇧J");
  expect(keys("Design mode").textContent).toBe("⌥D");
  expect(keys("Design mode").getAttribute("aria-label")).toBe("Option + D");
  expect(keys("Select inner element").textContent).toBe("⌘Click");
  dialog()!.close();
  platform.mockReturnValue("Win32");
  showShortcutHelp(root, commands, true);
  expect([...keys("Design mode").querySelectorAll("kbd")].map(node => node.textContent)).toEqual(["Alt", "D"]);
  expect(keys("Design mode").getAttribute("aria-label")).toBe("Alt + D");
  expect(keys("Select inner element").textContent).toBe("CtrlClick");
  expect(keys("Select inner element").getAttribute("aria-label")).toBe("Control + Click");
});

it("filters rows by label or key and says when nothing matches", () => {
  showShortcutHelp(root, [{ label: "Restore feedback", shortcut: resolveShortcuts().restore, group: "General" }], true);
  const filter = root.querySelector<HTMLInputElement>('input[aria-label="Filter shortcuts"]')!;
  const type = (value: string) => { filter.value = value; filter.dispatchEvent(new Event("input")); };
  type("parent");
  expect(visibleRows()).toEqual(["Parent element"]);
  expect(headings().filter((_, index) => !root.querySelectorAll("section")[index]!.hidden)).toEqual(["Design canvas"]);
  type("shift k");
  expect(visibleRows()).toEqual(["Restore feedback"]);
  type("escape");
  expect(visibleRows()).toEqual(["Exit Design mode", "Cancel text edit"]);
  expect(root.querySelector<HTMLElement>('[role="status"]')!.hidden).toBe(true);
  type("nothing like this");
  expect(visibleRows()).toEqual([]);
  expect(root.querySelector<HTMLElement>('[role="status"]')!.hidden).toBe(false);
  type("");
  expect(visibleRows().length).toBeGreaterThan(10);
});

it("closes at once from the close button, Escape, ?, a backdrop click and a close from elsewhere, restoring focus", () => {
  const invoker = document.createElement("button");
  root.append(invoker);
  const paths: [string, () => void][] = [
    ["button", () => dialog()!.querySelector<HTMLButtonElement>("header button")!.click()],
    ["escape", () => expect(press(root.activeElement!, "Escape").defaultPrevented).toBe(true)],
    ["question", () => press(root.activeElement!, "?", { shiftKey: true })],
    ["backdrop", () => {
      const help = dialog()!;
      help.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300, x: 100, y: 100, toJSON() {} });
      help.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
      help.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
    }],
    ["? with focus outside", () => press(document.body, "?", { shiftKey: true })],
    ["elsewhere", () => dialog()!.close()],
  ];
  for (const [name, close] of paths) {
    invoker.focus();
    showShortcutHelp(root, []);
    expect(dialog(), name).not.toBeNull();
    expect(root.activeElement, name).not.toBe(invoker);
    close();
    expect(dialog(), name).toBeNull();
    expect(root.activeElement, name).toBe(invoker);
  }
});

it("keeps the dialog open for clicks inside it and drags that end outside", () => {
  showShortcutHelp(root, []);
  const help = dialog()!;
  help.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300, x: 100, y: 100, toJSON() {} });
  help.querySelector("h2")!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 200, clientY: 120 }));
  help.querySelector("h2")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 120 }));
  help.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
  expect(dialog()).toBe(help);
});

it("types ? into the filter instead of closing, and traps Tab inside the dialog", () => {
  showShortcutHelp(root, []);
  const help = dialog()!;
  const close = help.querySelector<HTMLButtonElement>("header button")!;
  const filter = help.querySelector("input")!;
  const body = help.querySelector<HTMLElement>(".komo-shortcuts__body")!;
  filter.focus();
  expect(press(filter, "?", { shiftKey: true }).defaultPrevented).toBe(false);
  expect(dialog()).toBe(help);
  const order: Element[] = [];
  for (let step = 0; step < 4; step++) {
    press(root.activeElement!, "Tab");
    order.push(root.activeElement!);
  }
  expect(order).toEqual([body, close, filter, body]);
  press(root.activeElement!, "Tab", { shiftKey: true });
  expect(root.activeElement).toBe(filter);
});

it("owns its keys, leaves host shortcuts alone after closing, and releases its listener", () => {
  const invoker = document.createElement("button");
  root.append(invoker);
  invoker.focus();
  showShortcutHelp(root, []);
  const hostAction = vi.fn();
  document.addEventListener("keydown", hostAction);
  press(root.activeElement!, "D", { shiftKey: true });
  expect(dialog()?.open).toBe(true);
  expect(hostAction).not.toHaveBeenCalled();
  press(root.activeElement!, "Escape");
  expect(dialog()).toBeNull();
  expect(hostAction).not.toHaveBeenCalled();
  press(invoker, "D");
  press(invoker, "Escape");
  expect(hostAction).toHaveBeenCalledTimes(2);
  document.removeEventListener("keydown", hostAction);
});

it("leaves a nearer dialog's Escape to that dialog", () => {
  showShortcutHelp(root, []);
  const help = dialog()!;
  const nested = document.createElement("dialog");
  nested.open = true;
  help.append(nested);
  press(nested, "Escape");
  expect(help.open).toBe(true);
});

it("does not mutate the caller's commands or duplicate rows on reopening", () => {
  const commands = [{ label: "Design mode", shortcut: resolveShortcuts().design, group: "General" }];
  showShortcutHelp(root, commands, true);
  const count = root.querySelectorAll(".komo-shortcuts__row").length;
  dialog()!.close();
  showShortcutHelp(root, commands, true);
  const help = dialog()!;
  showShortcutHelp(root, commands, true);
  expect(dialog()).toBe(help);
  expect(help.open).toBe(true);
  expect(commands).toHaveLength(1);
  expect(root.querySelectorAll("dialog")).toHaveLength(1);
  expect(root.querySelectorAll(".komo-shortcuts__row")).toHaveLength(count);
});
