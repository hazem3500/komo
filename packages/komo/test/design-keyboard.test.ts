// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { designKeyboard } from "../src/design-keyboard.js";
import { designCommands } from "../src/design-commands.js";
import { renderKbd } from "../src/kbd.js";
import { resolveDesignKeys } from "../src/shortcuts.js";
import { type DesignTarget } from "../src/design-target.js";

function fixture(keys: Record<string, string | false> = {}) {
  document.body.innerHTML = '<main><div id="first"></div><script></script><div style="display:none"></div><div style="visibility:hidden"></div><svg id="icon"><title>Icon</title><path id="p"/><path id="q"/></svg><div hidden></div><p id="last"></p></main><aside id="host"></aside>';
  const host = document.querySelector<HTMLElement>("#host")!;
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<div id="compare"><button>Before</button><button>After</button></div><input><div role="menu"><span>Item</span></div>';
  const compare = root.querySelector<HTMLElement>("#compare")!;
  let selected = document.querySelector<DesignTarget>("#first")!;
  const select = vi.fn((element: DesignTarget) => { selected = element; });
  const compareBefore = vi.fn();
  const help = vi.fn();
  let reserved = false;
  const buttons = { undo: document.createElement("button"), redo: document.createElement("button") };
  const { before, after, ...select_ } = keys;
  const handle = designKeyboard({ host, compare, selected: () => selected, select, compareBefore, help, reserved: () => reserved, ...buttons, root,
    keys: resolveDesignKeys({ compare: { before, after }, select: select_ }) });
  const handled: boolean[] = [];
  document.addEventListener("keydown", event => { handled.push(handle(event)); }, { signal: cleanup.signal });
  const press = (key: string, target: Element = document.body, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  return { root, compare, select, compareBefore, help, press, handled, buttons, selected: () => selected, reserve: () => { reserved = true; } };
}

it("opens shortcut help with ? on the canvas, but not from fields or reserved bindings", () => {
  const f = fixture();
  expect(f.press("?", document.body, { shiftKey: true }).defaultPrevented).toBe(true);
  expect(f.help).toHaveBeenCalledTimes(1);
  f.press("?", f.root.querySelector("input")!, { shiftKey: true });
  f.press("?", document.body, { ctrlKey: true });
  expect(f.help).toHaveBeenCalledTimes(1);
  f.reserve();
  expect(f.press("?", document.body, { shiftKey: true }).defaultPrevented).toBe(false);
  expect(f.help).toHaveBeenCalledTimes(1);
});
let cleanup = new AbortController();
afterEach(() => { cleanup.abort(); cleanup = new AbortController(); document.body.replaceChildren(); });

it("walks siblings with Tab and Shift+Tab, goes in with Alt+↓ and out with Shift+Enter or Alt+↑, without wrapping", () => {
  const f = fixture();
  expect(f.press("Tab", document.body, { shiftKey: true }).defaultPrevented).toBe(true);
  expect(f.select).not.toHaveBeenCalled();
  f.press("Tab");
  expect(f.selected().id).toBe("icon");
  f.press("ArrowDown", document.body, { altKey: true });
  expect(f.selected().id).toBe("p");
  f.press("Tab");
  expect(f.selected().id).toBe("q");
  expect(f.press("Tab").defaultPrevented).toBe(true);
  expect(f.selected().id).toBe("q");
  f.press("Enter", document.body, { shiftKey: true });
  expect(f.selected().id).toBe("icon");
  f.press("ArrowDown", document.body, { altKey: true });
  expect(f.selected().id).toBe("p");
  f.press("ArrowUp", document.body, { altKey: true });
  f.press("Tab");
  expect(f.selected().id).toBe("last");
  expect(f.compareBefore).not.toHaveBeenCalled();
});

it("keeps Tab and Enter for the panel's own focus and buttons", () => {
  const f = fixture();
  const button = f.root.appendChild(document.createElement("button"));
  for (const key of ["Tab", "Enter"]) expect(f.press(key, button).defaultPrevented).toBe(false);
  expect(f.select).not.toHaveBeenCalled();
});

// ← Before and → After anywhere in Design mode; text entry, open lists, sliders and the
// focused selection keep their arrows. B pauses only in text entry.
const typing = ["input", "textarea", "[contenteditable]", "listbox", "textbox"];
const arrows = [...typing, "slider", "range"];
it.each(["input", "textarea", "select", "button", "[contenteditable]", "slider", "range", "radio", "tree", "listbox", "menu", "dialog", "tab", "grid", "textbox", "switch", "checkbox", "frame"])("compares with arrows and B from %s unless it edits with them", kind => {
  const f = fixture();
  const native = ["input", "textarea", "select", "button"].includes(kind);
  const widget = document.createElement(native ? kind : kind === "range" ? "input" : "div");
  if (kind === "[contenteditable]") widget.setAttribute("contenteditable", "true");
  else if (kind === "range") widget.setAttribute("type", "range");
  else if (kind === "frame") widget.className = "design-geometry__frame";
  else if (!native) widget.setAttribute("role", kind);
  f.root.append(widget);
  expect(f.press("ArrowLeft", widget).defaultPrevented).toBe(!arrows.includes(kind) && kind !== "frame");
  expect(f.press("ArrowRight", widget).defaultPrevented).toBe(!arrows.includes(kind) && kind !== "frame");
  expect(f.press("b", widget).defaultPrevented).toBe(!typing.includes(kind));
  const calls = f.compareBefore.mock.calls.map(([before]) => before);
  expect(calls).toEqual([...(arrows.includes(kind) || kind === "frame" ? [] : [true, false]), ...(typing.includes(kind) ? [] : [undefined])]);
  expect(f.select).not.toHaveBeenCalled();
});

it("compares on the canvas with the selection, follows configured keys, and leaves composition alone", () => {
  const f = fixture({ before: "Shift+B", after: "Shift+N", next: "J", prev: false });
  f.press("ArrowLeft");
  expect(f.compareBefore).not.toHaveBeenCalled();
  f.press("B", document.body, { shiftKey: true });
  expect(f.compareBefore).toHaveBeenLastCalledWith(true);
  f.press("N", document.body, { shiftKey: true });
  expect(f.compareBefore).toHaveBeenLastCalledWith(false);
  f.press("j");
  expect(f.selected().id).toBe("icon");
  expect(f.press("Tab", document.body, { shiftKey: true }).defaultPrevented).toBe(false);
  expect(f.press("ArrowRight", document.body, { isComposing: true }).defaultPrevented).toBe(false);
  f.reserve();
  expect(f.press("j").defaultPrevented).toBe(false);
});

it("does not recover unrelated selection after owner loss", () => {
  const f = fixture();
  f.selected().remove();
  expect(f.press("Tab").defaultPrevented).toBe(false);
  expect(f.select).not.toHaveBeenCalled();
});

it("undoes and redoes from the canvas and any panel control, and leaves text fields their own", () => {
  const mac = navigator.platform;
  for (const platform of ["MacIntel", "Win32"]) {
    Object.defineProperty(navigator, "platform", { configurable: true, get: () => platform });
    const f = fixture();
    const undo = vi.fn(), redo = vi.fn();
    f.buttons.undo.addEventListener("click", undo);
    f.buttons.redo.addEventListener("click", redo);
    const meta = platform === "MacIntel" ? { metaKey: true } : { ctrlKey: true };
    const button = f.root.appendChild(document.createElement("button"));
    for (const target of [document.body, button]) {
      expect(f.press("z", target, meta).defaultPrevented).toBe(true);
      expect(f.press("z", target, { ...meta, shiftKey: true }).defaultPrevented).toBe(true);
    }
    expect(f.press("y", document.body, { ctrlKey: true }).defaultPrevented).toBe(platform !== "MacIntel");
    expect([undo.mock.calls.length, redo.mock.calls.length]).toEqual([2, platform === "MacIntel" ? 2 : 3]);
    const input = f.root.querySelector("input")!;
    expect(f.press("z", input, meta).defaultPrevented).toBe(false);
    expect(f.press("z", input, { ...meta, shiftKey: true }).defaultPrevented).toBe(false);
    f.buttons.redo.disabled = true;
    expect(f.press("z", document.body, { ...meta, shiftKey: true }).defaultPrevented).toBe(false);
    cleanup.abort();
    cleanup = new AbortController();
  }
  Object.defineProperty(navigator, "platform", { configurable: true, get: () => mac });
});

it("lists configured keys in shortcut help, with platform keycaps", () => {
  const commands = designCommands(true);
  const parent = commands.find(command => command.label === "Parent element (alternative)")!;
  expect(renderKbd(parent.shortcut!, true).getAttribute("aria-label")).toBe("Option + ArrowUp");
  expect(renderKbd(parent.shortcut!, true).textContent).toBe("⌥↑");
  expect(renderKbd(parent.shortcut!, false).textContent).toBe("Alt↑");
  expect(commands.filter(command => command.group === "Compare").map(command => command.shortcut!.label)).toEqual(["B", "ArrowLeft", "ArrowRight"]);
  expect(renderKbd(commands.find(command => command.label === "Next sibling")!.shortcut!, true).textContent).toBe("Tab");
  expect(renderKbd(commands.find(command => command.label === "Parent element")!.shortcut!, true).textContent).toBe("⇧↵");
  expect(renderKbd(commands.find(command => command.label === "Post comment")!.shortcut!, true).textContent).toBe("↵");
  expect(commands.find(command => command.label === "Inspect focused element, with nothing selected")).toBeUndefined();
  expect(renderKbd(commands.find(command => command.label === "First child")!.shortcut!, true).getAttribute("aria-label")).toBe("Option + ArrowDown");
  expect(renderKbd(commands.find(command => command.label === "Redo last undo")!.shortcut!, true).textContent).toBe("⇧⌘Z");
  expect(designCommands(false).filter(command => command.label === "Redo last undo").map(command => renderKbd(command.shortcut!, false).textContent)).toEqual(["CtrlShiftZ", "CtrlY"]);
  const configured = designCommands(true, null, resolveDesignKeys({ compare: { before: "Shift+B" }, select: { next: false } }));
  expect(configured.find(command => command.label === "Show before")!.shortcut!.label).toBe("Shift+B");
  expect(configured.find(command => command.label === "Next sibling")!.shortcut).toBeNull();
  const resize = commands.find(command => command.label.startsWith("Resize width"))!;
  expect(renderKbd(resize.shortcut!, true).getAttribute("aria-label")).toBe("Command + ArrowRight");
  // Shift steps 10px for resize only; help and the focused selection's label name the same keys.
  expect(renderKbd(commands.find(command => command.label === "Resize by 10px")!.shortcut!, true).textContent).toBe("⇧⌘→");
  expect(commands.filter(command => command.label.startsWith("Move ")).map(command => renderKbd(command.shortcut!, true).textContent)).toEqual(["⌥↑", "⌥↓", "⌥⇧↑", "⌥⇧↓"]);
});

it("closes only a field's edit with Escape in its text input, blurs other text fields, and otherwise lets Design mode exit", async () => {
  const f = fixture();
  const field = document.createElement("div");
  field.dataset.fieldProperty = "width";
  field.innerHTML = "<input><select><option>a</option></select>";
  f.root.append(field);
  f.press("Escape", field.querySelector("input")!);
  f.press("Escape", field.querySelector("select")!);
  const search = f.root.querySelector<HTMLInputElement>("input")!;
  search.focus();
  expect(f.press("Escape", search).defaultPrevented).toBe(true);
  expect(f.root.activeElement).toBeNull();
  const popup = f.root.appendChild(document.createElement("div"));
  popup.setAttribute("popover", "manual");
  const inside = popup.appendChild(document.createElement("button"));
  f.press("Escape", inside);
  f.press("Escape", document.body);
  // Handled (true) keeps Design mode; false lets it exit in this one press.
  expect(f.handled).toEqual([true, false, true, true, false]);
  expect(f.select).not.toHaveBeenCalled();
});
