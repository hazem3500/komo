import { createTextPreviewHistory, holdText, lockedText, restoreText, snapshotText, type TextSnapshot } from "./text-preview.js";
import { inlineStyleSnapshot } from "./design-preview.js";
export { createTextPreviewHistory } from "./text-preview.js";
export type { TextSnapshot, TextPreviewHistory } from "./text-preview.js";

export interface ReactTextBridge {
  beginReactTextEdit(element: HTMLElement): { propName: string; before: string } | null;
  previewReactTextEdit(element: HTMLElement, propName: string, value: string): boolean;
  finishReactTextEdit(element: HTMLElement, propName: string, before: string, after: string): void;
  cancelReactTextEdit(element: HTMLElement, propName: string, before: string): void;
}

export interface InlineTextEditResult {
  element: HTMLElement;
  before: string;
  after: string;
  reactProp?: string;
  /** Text node values before the edit, for elements with nested markup. */
  nodes?: TextSnapshot;
}

/** Restore text without touching markup: nested elements keep their nodes, so React keeps its references. */
function setText(element: HTMLElement, text: string, nodes?: TextSnapshot) {
  if (nodes) restoreText(nodes, element);
  else if (element.firstChild instanceof Text && !element.childElementCount) element.firstChild.data = text;
}

export interface InlineTextEditor {
  readonly element: HTMLElement;
  finish(cancel?: boolean): void;
  handleKey(event: KeyboardEvent): boolean;
}

export interface InlineTextEditorOptions {
  accent?: string;
  loadReactBridge(): Promise<ReactTextBridge>;
  onFinish(result: InlineTextEditResult, cancel: boolean): void;
}

export interface InlineTextToolsOptions {
  button: HTMLButtonElement;
  status: HTMLElement;
  selected(): HTMLElement | null;
  active(): boolean;
  onChange(): void;
  onCommit(element: HTMLElement): void;
}

export interface InlineTextTools {
  readonly element: HTMLElement | null;
  readonly busy: boolean;
  isEditing(element: HTMLElement | null): boolean;
  /** Start or finish editing; a point inside the text places the caret there. */
  toggle(point?: { clientX: number; clientY: number }): Promise<void>;
  finish(cancel?: boolean): void;
  handleKey(event: KeyboardEvent): boolean;
  hasChanges(element: HTMLElement): boolean;
  undo(): HTMLElement | null;
  reset(element: HTMLElement): void;
  reconcile(element: HTMLElement, text: string): void;
  proposal(element: HTMLElement): string | undefined;
  restoreAll(): void;
  /** Show the page's original text, or put the edits back. */
  showBefore(on: boolean, retain?: boolean): void;
}

export function createInlineTextTools(options: InlineTextToolsOptions): InlineTextTools {
  const history = createTextPreviewHistory();
  let editor: InlineTextEditor | null = null;
  let starting = false;

  function finish(cancel = false) {
    const current = editor;
    if (!current) return;
    editor = null;
    current.finish(cancel);
    history.resume(current.element);
    options.onChange();
  }

  async function toggle(point?: { clientX: number; clientY: number }) {
    const element = options.selected();
    if (editor && editor.element === element) {
      finish();
      return;
    }
    if (!element || !options.active() || starting || editor) return;
    const blocker = textEditBlocker(element);
    if (blocker) {
      options.status.textContent = blocker;
      return;
    }
    starting = true;
    history.pause(element);
    options.status.textContent = "Loading inline text editor…";
    options.onChange();
    try {
      const next = await startInlineTextEditor(element, {
        accent: getComputedStyle(options.button).getPropertyValue("--accent").trim() || "#bda6ef",
        async loadReactBridge() {
          return await import("./react-props-panel.js") as ReactTextBridge;
        },
        onFinish(result, cancelled) {
          if (!cancelled && !result.reactProp && result.before !== result.after) {
            history.record(result);
            options.onCommit(element);
            options.status.textContent = "Text preview · resets on exit";
          } else if (result.reactProp) options.status.textContent = "React state preview · resets on exit";
        },
      });
      if (!next) options.status.textContent = "This text couldn't be connected to its component prop.";
      else if (options.active() && options.selected() === element) {
        editor = next;
        if (point) caretAtPoint(element, point.clientX, point.clientY);
        options.status.textContent = element.hasAttribute("data-komo-text-prop")
          ? "React state preview · resets on exit"
          : "Editing text · preview only";
      }
      else next.finish(true);
    } catch {
      options.status.textContent = "Inline text editing is unavailable.";
    } finally {
      starting = false;
      if (!editor) history.resume(element);
      options.onChange();
    }
  }

  return {
    get element() { return editor?.element ?? null; },
    get busy() { return starting; },
    isEditing(element) { return !!editor && editor.element === element; },
    toggle,
    finish,
    handleKey(event) {
      if (!editor || !event.composedPath().includes(editor.element) || !editor.handleKey(event)) return false;
      const element = editor.element;
      finish(event.key === "Escape");
      element.blur();
      return true;
    },
    hasChanges(element) { return history.original(element) !== undefined; },
    undo() { const element = history.undo(); options.onChange(); return element; },
    reset(element) { history.reset(element); options.onChange(); },
    reconcile(element, text) { history.reconcile(element, text); options.onChange(); },
    proposal(element) { return history.proposal(element); },
    restoreAll() { history.restoreAll(); },
    showBefore: history.showBefore,
  };
}

export function bindInlineTextTools(options: InlineTextToolsOptions): InlineTextTools {
  const tools = createInlineTextTools(options);
  options.button.addEventListener("click", (event) => { void tools.toggle(event); });
  return tools;
}

function caretAtPoint(element: HTMLElement, x: number, y: number) {
  const position = document.caretPositionFromPoint?.(x, y);
  const range = position ? document.createRange() : document.caretRangeFromPoint?.(x, y);
  if (position && range) range.setStart(position.offsetNode, position.offset);
  if (!range || !element.contains(range.startContainer)) return;
  range.collapse(true);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Why an element's text can't be edited inline, or null when it can. */
export function textEditBlocker(element: HTMLElement): string | null {
  if (element.matches("input,textarea,select")) return "Form fields can't be edited as text.";
  if (element.matches("script,style,svg,canvas,video,audio,iframe")) return "Graphics, media, and frames can't be edited.";
  if (element.closest("[data-private],[data-sensitive]")) return "This text is marked private, so it stays read-only.";
  if (element.closest("[contenteditable]")) return "This text is already editable on the page.";
  if (!snapshotText(element).some(([node]) => node.data.trim() && !node.parentElement?.closest(lockedText)))
    return "No text here. Double-click the text itself.";
  return null;
}

export function canEditText(element: HTMLElement): boolean {
  return !textEditBlocker(element);
}

function caretOffset(element: HTMLElement): number {
  const current = element.textContent ?? "";
  const selection = document.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !element.contains(range.commonAncestorContainer)) return -1;
  return range.startContainer === element
    ? Math.min([...element.childNodes].slice(0, range.startOffset).reduce((sum, node) => sum + (node.textContent?.length ?? 0), 0), current.length)
    : range.startContainer.nodeType === Node.TEXT_NODE
      ? Math.min(range.startOffset, current.length)
      : current.length;
}

function placeCaret(element: HTMLElement, offset: number) {
  const node = element.firstChild;
  const selection = document.getSelection();
  if (!node || !selection) return;
  const range = document.createRange();
  range.setStart(node, Math.min(offset, node.textContent?.length ?? 0));
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function plainTextAtCaret(element: HTMLElement, text: string) {
  const offset = caretOffset(element);
  if (offset < 0) return;
  const current = element.textContent ?? "";
  const insertion = text.slice(0, Math.max(0, 500 - current.length));
  setText(element, current.slice(0, offset) + insertion + current.slice(offset));
  placeCaret(element, offset + insertion.length);
}

export async function startInlineTextEditor(
  element: HTMLElement,
  options: InlineTextEditorOptions,
): Promise<InlineTextEditor | null> {
  if (!canEditText(element)) return null;
  let bridge: ReactTextBridge | null = null;
  let reactText: { propName: string; before: string } | null = null;
  if (element.dataset.komoTextProp) {
    bridge = await options.loadReactBridge();
    reactText = bridge.beginReactTextEdit(element);
    if (!reactText) return null;
  }
  const before = reactText?.before ?? (element.textContent ?? "").slice(0, 500);
  // With nested markup, edit text nodes in place and never let the structure change.
  const rich = !reactText && element.childElementCount > 0;
  const nodes = reactText ? undefined : snapshotText(element);
  const editing = nodes?.map(([node, value]) => [node, value] as [Text, string]);
  const capture = () => { for (const pair of editing ?? []) pair[1] = pair[0].data; };
  const stopText = editing ? holdText(element, editing) : () => {};
  const focusStyles = ["outline", "outline-offset", "box-shadow", "white-space"].map(property => inlineStyleSnapshot(element, property));
  const original = {
    role: element.getAttribute("role"),
    label: element.getAttribute("aria-label"),
    multiline: element.getAttribute("aria-multiline"),
    spellcheck: element.getAttribute("spellcheck"),
  };
  const listeners = new AbortController();
  let finished = false;

  function restoreAttributes() {
    element.removeAttribute("contenteditable");
    element.removeAttribute("data-komo-inline-editing");
    for (const [name, value] of [["role", original.role], ["aria-label", original.label], ["aria-multiline", original.multiline], ["spellcheck", original.spellcheck]] as const) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  }

  // React replaces the edited text when it rerenders, which drops the caret to
  // the start; put it back where the person was typing.
  let caret = -1;
  const keepCaret = new MutationObserver(() => {
    if (caret >= 0) placeCaret(element, caret);
  });
  const input = () => {
    capture();
    if (rich) return;
    if ((element.textContent ?? "").length > 500) setText(element, (element.textContent ?? "").slice(0, 500));
    if (reactText && bridge) {
      caret = caretOffset(element);
      if (!bridge.previewReactTextEdit(element, reactText.propName, element.textContent ?? "")) setText(element, before);
    }
  };
  /** Replace a range that sits inside one editable text node; anything that would cross markup is ignored. */
  const replace = (range: StaticRange, text: string) => {
    const node = range.startContainer;
    if (node !== range.endContainer || !(node instanceof Text) || !element.contains(node) || node.parentElement?.closest(lockedText)) return;
    const removed = range.endOffset - range.startOffset;
    const insertion = text.replace(/[\r\n]+/g, " ").slice(0, Math.max(0, 500 - (element.textContent ?? "").length + removed));
    node.replaceData(range.startOffset, removed, insertion);
    capture();
    const caretRange = document.createRange();
    caretRange.setStart(node, range.startOffset + insertion.length);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(caretRange);
  };
  const beforeInput = (event: InputEvent) => {
    caret = -1;
    // IME composition cannot be cancelled; it edits the focused text node itself.
    if (reactText || event.inputType === "insertCompositionText") return;
    event.preventDefault();
    const range = event.getTargetRanges()[0] as StaticRange | undefined;
    const type = event.inputType;
    if (range && (type.startsWith("delete") || type === "insertText" || type === "insertReplacementText"))
      replace(range, type.startsWith("delete") ? "" : event.data ?? event.dataTransfer?.getData("text/plain") ?? "");
  };
  const paste = (event: ClipboardEvent) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    const selection = document.getSelection();
    if (rich) {
      if (selection?.rangeCount) replace(selection.getRangeAt(0), text);
      return;
    }
    plainTextAtCaret(element, text.replace(/[\r\n]+/g, " ").slice(0, 500));
    input();
  };
  const drop = (event: DragEvent) => event.preventDefault();
  // The browser's own insertion is observed before "input"; only restore after it.
  element.addEventListener("beforeinput", beforeInput, { signal: listeners.signal });
  element.addEventListener("input", input, { signal: listeners.signal });
  if (reactText) keepCaret.observe(element, { childList: true, characterData: true, subtree: true });
  element.addEventListener("paste", paste, { signal: listeners.signal });
  element.addEventListener("drop", drop, { signal: listeners.signal });
  element.setAttribute("contenteditable", "true");
  element.setAttribute("role", "textbox");
  element.setAttribute("aria-label", "Inline text preview");
  element.setAttribute("aria-multiline", "false");
  element.dataset.komoInlineEditing = "true";
  element.spellcheck = false;
  element.style.setProperty("outline", `2px solid ${options.accent ?? "#bda6ef"}`, "important");
  element.style.setProperty("outline-offset", "2px", "important");
  element.style.setProperty("box-shadow", "none", "important");
  element.style.setProperty("white-space", "pre-wrap", "important");
  element.focus({ preventScroll: true });
  const selection = document.getSelection();
  const range = document.createRange();
  const last = snapshotText(element).reverse().find(([node]) => !node.parentElement?.closest(lockedText))?.[0];
  if (last) range.setStart(last, last.length);
  else range.selectNodeContents(element);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const editor: InlineTextEditor = {
    element,
    finish(cancel = false) {
      if (finished) return;
      finished = true;
      listeners.abort();
      keepCaret.disconnect();
      stopText();
      for (const style of focusStyles.reverse()) style.restore();
      const after = (element.textContent ?? "").slice(0, 500);
      restoreAttributes();
      if (cancel) {
        if (reactText && bridge) bridge.cancelReactTextEdit(element, reactText.propName, before);
        setText(element, before, nodes);
      } else if (reactText && bridge) {
        bridge.finishReactTextEdit(element, reactText.propName, before, after);
      }
      options.onFinish({ element, before, after, nodes, ...(reactText ? { reactProp: reactText.propName } : {}) }, cancel);
    },
    handleKey(event) {
      if (event.isComposing) return false;
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
      return false;
    },
  };
  return editor;
}
