// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { designKeyboard } from "../src/design-keyboard.js";
import { designCommands } from "../src/design-commands.js";
import { renderKbd } from "../src/kbd.js";
import { type DesignTarget } from "../src/design-target.js";

function fixture() {
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
  const handle = designKeyboard({ host, compare, selected: () => selected, select, compareBefore, help, reserved: () => reserved });
  const handled: boolean[] = [];
  document.addEventListener("keydown", event => { handled.push(handle(event)); }, { signal: cleanup.signal });
  const press = (key: string, target: Element = document.body, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  return { root, compare, select, compareBefore, help, press, handled, selected: () => selected, reserve: () => { reserved = true; } };
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

it("moves among eligible same-parent siblings, including SVG roots and inner shapes, without wrapping", () => {
  const f = fixture();
  expect(f.press("ArrowLeft").defaultPrevented).toBe(true);
  expect(f.select).not.toHaveBeenCalled();
  f.press("ArrowRight");
  expect(f.selected().id).toBe("icon");
  f.press("ArrowDown", document.body, { altKey: true });
  expect(f.selected().id).toBe("p");
  f.press("ArrowRight");
  expect(f.selected().id).toBe("q");
  f.press("ArrowRight");
  expect(f.selected().id).toBe("q");
  f.press("ArrowUp", document.body, { altKey: true });
  f.press("ArrowRight");
  expect(f.selected().id).toBe("last");
  f.press("ArrowRight");
  expect(f.selected().id).toBe("last");
  expect(f.compareBefore).not.toHaveBeenCalled();
});

it.each(['input', 'textarea', 'select', 'button', '[contenteditable]', 'slider', 'radio', 'spinbutton', 'tree', 'treeitem', 'listbox', 'option', 'combobox', 'menu', 'menuitem', 'dialog', 'tab', 'grid', 'textbox', 'switch', 'checkbox'])('leaves %s and descendants alone', kind => {
  const f = fixture();
  const native = ['input', 'textarea', 'select', 'button'].includes(kind);
  const widget = document.createElement(native ? kind : 'div');
  if (kind === '[contenteditable]') widget.setAttribute('contenteditable', 'true');
  else if (!native) widget.setAttribute('role', kind);
  const child = document.createElement('span');
  widget.append(child);
  document.body.append(widget);
  for (const target of [widget, child]) for (const key of ['ArrowLeft', 'ArrowRight', 'b']) expect(f.press(key, target).defaultPrevented).toBe(false);
  expect(f.select).not.toHaveBeenCalled();
  expect(f.compareBefore).not.toHaveBeenCalled();
});

it("only compares arrows on its controls, leaves owned surfaces alone and respects configured bindings/composition", () => {
  const f = fixture();
  f.press("ArrowLeft", f.compare.querySelector('button')!);
  expect(f.compareBefore).toHaveBeenLastCalledWith(true);
  f.press("b");
  expect(f.compareBefore).toHaveBeenLastCalledWith(undefined);
  for (const target of [f.root.querySelector('input')!, f.root.querySelector('span')!]) expect(f.press('ArrowRight', target).defaultPrevented).toBe(false);
  expect(f.press('ArrowRight', document.body, { isComposing: true }).defaultPrevented).toBe(false);
  f.reserve();
  expect(f.press('ArrowRight').defaultPrevented).toBe(false);
  expect(f.select).not.toHaveBeenCalled();
});

it("does not recover unrelated selection after owner loss", () => {
  const f = fixture();
  f.selected().remove();
  expect(f.press('ArrowRight').defaultPrevented).toBe(false);
  expect(f.select).not.toHaveBeenCalled();
});

it("shares scoped Help semantics with platform-correct keycaps", () => {
  const commands = designCommands(true);
  const parent = commands.find(command => command.label === 'Parent element')!;
  expect(renderKbd(parent.shortcut, true).getAttribute('aria-label')).toBe('Option + ArrowUp');
  expect(renderKbd(parent.shortcut, true).textContent).toBe('⌥↑');
  expect(renderKbd(commands.find(command => command.label === 'Post comment or proposal')!.shortcut, true).getAttribute('aria-label')).toBe('Command + Enter');
  expect(commands.filter(command => command.group === 'Focused comparison controls').map(command => command.shortcut.key)).toEqual(['ArrowLeft', 'ArrowRight']);
  const resize = commands.find(command => command.label.startsWith('Resize width'))!;
  expect(renderKbd(resize.shortcut, true).getAttribute('aria-label')).toBe('Command + ArrowRight');
  expect(renderKbd(designCommands(false).find(command => command.label.startsWith('Resize height'))!.shortcut, false).getAttribute('aria-label')).toBe('Control + ArrowDown');
});

it("leaves Escape to the nearest property field", () => {
  const f = fixture();
  const field = document.createElement('div');
  field.dataset.fieldProperty = 'width';
  field.innerHTML = '<input>';
  f.root.append(field);
  expect(f.press('Escape', field.firstElementChild!).defaultPrevented).toBe(false);
  expect(f.select).not.toHaveBeenCalled();
});

it("keeps field Escape out of canvas exit after komo's host isolation has prevented it", () => {
  const f = fixture();
  const field = document.createElement('div');
  field.dataset.fieldProperty = 'color';
  field.innerHTML = '<input>';
  f.root.append(field);
  // Mirrors isolateEscape: window capture prevents every Escape inside komo's host.
  addEventListener("keydown", event => { if (event.key === "Escape") event.preventDefault(); }, { capture: true, signal: cleanup.signal });
  f.press('Escape', field.firstElementChild!);
  expect(f.handled).toEqual([true]);
  expect(f.select).not.toHaveBeenCalled();
});
