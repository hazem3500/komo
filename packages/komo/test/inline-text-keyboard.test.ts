// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { startInlineTextEditor } from "../src/inline-text-editor.js";
import { insertText } from "../src/text-preview.js";

afterEach(() => document.body.replaceChildren());
it("defers Enter and Escape until IME composition ends, including legacy 229", async () => {
  document.body.innerHTML = '<p>Hello</p>';
  const element = document.querySelector('p')!;
  const finish = vi.fn();
  const editor = (await startInlineTextEditor(element, { loadReactBridge: async () => null as never, onFinish: finish }))!;
  element.dispatchEvent(new CompositionEvent('compositionstart'));
  for (const key of ['Enter', 'Escape']) expect(editor.handleKey(new KeyboardEvent('keydown', { key }))).toBe(false);
  element.dispatchEvent(new CompositionEvent('compositionend'));
  expect(editor.handleKey(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229 }))).toBe(false);
  expect(editor.handleKey(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))).toBe(false);
  expect(finish).not.toHaveBeenCalled();
  expect(editor.handleKey(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true);
  editor.finish();
  expect(finish).toHaveBeenCalledOnce();
});

it("sends inserted newlines through the renderer text bridge, and restores exact focus attributes", async () => {
  document.body.innerHTML = '<p data-komo-text-prop="label" role="heading" aria-label="Title" spellcheck="true">Hello</p>';
  const element = document.querySelector('p')!;
  const original = element.outerHTML;
  const bridge = { beginReactTextEdit: () => ({ propName: 'label', before: 'Hello' }), previewReactTextEdit: vi.fn(() => true), finishReactTextEdit: vi.fn(), cancelReactTextEdit: vi.fn() };
  const editor = (await startInlineTextEditor(element, { loadReactBridge: async () => bridge, onFinish() {} }))!;
  const range = document.createRange();
  range.setStart(element.firstChild!, 5);
  range.collapse(true);
  const event = new InputEvent('beforeinput', { inputType: 'insertLineBreak', cancelable: true });
  Object.defineProperty(event, 'getTargetRanges', { value: () => [range] });
  element.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(bridge.previewReactTextEdit).toHaveBeenLastCalledWith(element, 'label', 'Hello\n');
  editor.finish();
  expect(bridge.finishReactTextEdit).toHaveBeenCalledWith(element, 'label', 'Hello', 'Hello\n');
  expect(element.outerHTML).toBe(original.replace('Hello', 'Hello\n'));
});

it("keeps exact nested nodes and refuses cross-markup or private insertions", () => {
  document.body.innerHTML = '<p><svg><title>Icon</title></svg><strong>Hello</strong> world</p>';
  const element = document.querySelector('p')!;
  const strong = element.querySelector('strong')!;
  const node = strong.firstChild!;
  const range = document.createRange();
  range.setStart(node, 5); range.collapse(true);
  insertText(element, range, '\nnew');
  expect(strong.firstChild).toBe(node);
  expect(strong.textContent).toBe('Hello\nnew');
  range.setEnd(element.lastChild!, 2);
  expect(insertText(element, range, 'bad')).toBeNull();
  range.selectNodeContents(element.querySelector('title')!.firstChild!);
  expect(insertText(element, range, 'bad')).toBeNull();
});
