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

export type TextSnapshot = Array<[Text, string]>;

// Text inside these stays read-only, even within an editable element.
const lockedText = 'script,style,svg,input,textarea,select,[data-private],[data-sensitive],[aria-hidden="true"]';

function textNodes(element: HTMLElement): Text[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

/** Restore text without touching markup: nested elements keep their nodes, so React keeps its references. */
function setText(element: HTMLElement, text: string, nodes?: TextSnapshot) {
  if (nodes && element.childElementCount) for (const [node, value] of nodes) node.data = value;
  else element.textContent = text;
}

export interface InlineTextEditor {
  readonly element: HTMLElement;
  finish(cancel?: boolean): void;
  handleKey(event: KeyboardEvent): boolean;
}

export interface InlineTextEditorOptions {
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
}

export interface TextPreviewHistory {
  record(result: InlineTextEditResult): void;
  remember(element: HTMLElement, before: string): void;
  original(element: HTMLElement): string | undefined;
  reconcile(element: HTMLElement, text: string): void;
  reset(element: HTMLElement): void;
  proposal(element: HTMLElement): string | undefined;
  restoreAll(): void;
  undo(): HTMLElement | null;
}

export function createTextPreviewHistory(): TextPreviewHistory {
  const originals = new Map<HTMLElement, string>();
  const snapshots = new Map<HTMLElement, TextSnapshot | undefined>();
  const edits: InlineTextEditResult[] = [];
  return {
    record(result) {
      if (!result.reactProp && result.before !== result.after) {
        if (!originals.has(result.element)) {
          originals.set(result.element, result.before);
          snapshots.set(result.element, result.nodes);
        }
        edits.push(result);
      }
    },
    remember(element, before) {
      if (!originals.has(element)) originals.set(element, before);
    },
    original(element) { return originals.get(element); },
    reconcile(element, text) {
      if (originals.get(element) === text) originals.delete(element);
    },
    reset(element) {
      const value = originals.get(element);
      if (value !== undefined) setText(element, value, snapshots.get(element));
      originals.delete(element);
      for (let index = edits.length - 1; index >= 0; index--)
        if (edits[index].element === element) edits.splice(index, 1);
    },
    proposal(element) {
      const before = originals.get(element);
      const after = element.textContent ?? "";
      return before !== undefined && before !== after
        ? `Proposed inline text change (preview only)\n- Text: ${JSON.stringify(before)} → ${JSON.stringify(after)}\n- Source markup is unchanged; refresh resets this preview.`
        : undefined;
    },
    restoreAll() {
      for (const [element, value] of originals) setText(element, value, snapshots.get(element));
    },
    undo() {
      const edit = edits.pop();
      if (!edit) return null;
      setText(edit.element, edit.before, edit.nodes);
      if (originals.get(edit.element) === edit.before) originals.delete(edit.element);
      return edit.element;
    },
  };
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
    options.onChange();
  }

  async function toggle(point?: { clientX: number; clientY: number }) {
    const element = options.selected();
    if (editor && editor.element === element) {
      finish();
      return;
    }
    if (!element || !options.active() || starting || editor) return;
    if (!canEditText(element)) {
      options.status.textContent = "This text is private or not editable; it stays read-only.";
      return;
    }
    starting = true;
    options.status.textContent = "Loading inline text editor…";
    options.onChange();
    try {
      const next = await startInlineTextEditor(element, {
        async loadReactBridge() {
          return await import("./react-props-panel.js") as ReactTextBridge;
        },
        onFinish(result, cancelled) {
          if (!cancelled && !result.reactProp && result.before !== result.after) {
            history.record(result);
            options.onCommit(element);
            options.status.textContent = "Text preview · resets on refresh";
          } else if (result.reactProp) options.status.textContent = "React state preview · resets on refresh";
        },
      });
      if (!next) options.status.textContent = "This text is not editable or a registered string prop.";
      else if (options.active() && options.selected() === element) {
        editor = next;
        if (point) caretAtPoint(element, point.clientX, point.clientY);
        options.status.textContent = element.hasAttribute("data-komo-text-prop")
          ? "React state preview · resets on refresh"
          : "Editing text · preview only";
      }
      else next.finish(true);
    } catch {
      options.status.textContent = "Inline text editing is unavailable.";
    } finally {
      starting = false;
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

/** Any element with visible text, including nested markup, links, and buttons; private and form text stays read-only. */
export function canEditText(element: HTMLElement): boolean {
  if (
    element.matches("input,textarea,select,script,style,svg,canvas,video,audio,iframe,[contenteditable]") ||
    element.closest('[data-private],[data-sensitive],[aria-hidden="true"],[contenteditable]') ||
    !textNodes(element).some((node) => node.data.trim() && !node.parentElement?.closest(lockedText))
  ) return false;
  const owner = element.closest<HTMLElement>("[data-komo-inspectable]");
  if (owner && (owner !== element || !element.dataset.komoTextProp)) return false;
  return true;
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
  element.textContent = current.slice(0, offset) + insertion + current.slice(offset);
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
  const nodes: TextSnapshot | undefined = rich ? textNodes(element).map((node) => [node, node.data]) : undefined;
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
    if (rich) return;
    if (element.childElementCount) element.textContent = element.textContent ?? "";
    if ((element.textContent ?? "").length > 500) element.textContent = (element.textContent ?? "").slice(0, 500);
    if (reactText && bridge) {
      caret = caretOffset(element);
      if (!bridge.previewReactTextEdit(element, reactText.propName, element.textContent ?? "")) element.textContent = before;
    }
  };
  /** Replace a range that sits inside one editable text node; anything that would cross markup is ignored. */
  const replace = (range: StaticRange, text: string) => {
    const node = range.startContainer;
    if (node !== range.endContainer || !(node instanceof Text) || !element.contains(node) || node.parentElement?.closest(lockedText)) return;
    const removed = range.endOffset - range.startOffset;
    const insertion = text.replace(/[\r\n]+/g, " ").slice(0, Math.max(0, 500 - (element.textContent ?? "").length + removed));
    node.replaceData(range.startOffset, removed, insertion);
    const caretRange = document.createRange();
    caretRange.setStart(node, range.startOffset + insertion.length);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(caretRange);
  };
  const beforeInput = (event: InputEvent) => {
    caret = -1;
    // IME composition cannot be cancelled; it edits the focused text node itself.
    if (!rich || event.inputType === "insertCompositionText") return;
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
  element.focus({ preventScroll: true });
  const selection = document.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const editor: InlineTextEditor = {
    element,
    finish(cancel = false) {
      if (finished) return;
      finished = true;
      listeners.abort();
      keepCaret.disconnect();
      if (!rich && element.childElementCount) element.textContent = element.textContent ?? "";
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
