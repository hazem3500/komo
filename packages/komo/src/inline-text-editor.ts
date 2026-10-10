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
  toggle(): Promise<void>;
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
  const edits: Array<{ element: HTMLElement; before: string; after: string }> = [];
  return {
    record(result) {
      if (!result.reactProp && result.before !== result.after) {
        if (!originals.has(result.element)) originals.set(result.element, result.before);
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
      if (value !== undefined) element.textContent = value;
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
      for (const [element, value] of originals) element.textContent = value;
    },
    undo() {
      const edit = edits.pop();
      if (!edit) return null;
      edit.element.textContent = edit.before;
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

  async function toggle() {
    const element = options.selected();
    if (editor && editor.element === element) {
      finish();
      return;
    }
    if (!element || !options.active() || starting || editor) return;
    if (!canEditLeafText(element)) {
      options.status.textContent = "Select plain leaf text; nested, private, and interactive content stays read-only.";
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
      if (!next) options.status.textContent = "This text is not a safe editable leaf or registered string prop.";
      else if (options.active() && options.selected() === element) {
        editor = next;
        options.status.textContent = element.hasAttribute("data-komo-text-prop")
          ? "React state preview · resets on refresh"
          : "Editing leaf text · preview only";
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
  options.button.addEventListener("click", () => { void tools.toggle(); });
  return tools;
}

export function canEditLeafText(element: HTMLElement): boolean {
  if (
    element.childElementCount > 0 ||
    element.matches("input,textarea,select,button,a,script,style,svg,canvas,video,audio,[contenteditable]") ||
    element.closest('[data-private],[data-sensitive],[aria-hidden="true"],input[type="password"],[autocomplete="current-password"],[contenteditable]')
  ) return false;
  const owner = element.closest<HTMLElement>("[data-komo-inspectable]");
  if (owner && (owner !== element || !element.dataset.komoTextProp)) return false;
  return true;
}

function plainTextAtCaret(element: HTMLElement, text: string) {
  const selection = document.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return;
  const current = element.textContent ?? "";
  const offset = range.startContainer === element
    ? Math.min([...element.childNodes].slice(0, range.startOffset).reduce((sum, node) => sum + (node.textContent?.length ?? 0), 0), current.length)
    : range.startContainer.nodeType === Node.TEXT_NODE
      ? Math.min(range.startOffset, current.length)
      : current.length;
  const insertion = text.slice(0, Math.max(0, 500 - current.length));
  element.textContent = current.slice(0, offset) + insertion + current.slice(offset);
  const node = element.firstChild;
  if (!node) return;
  range.setStart(node, offset + insertion.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export async function startInlineTextEditor(
  element: HTMLElement,
  options: InlineTextEditorOptions,
): Promise<InlineTextEditor | null> {
  if (!canEditLeafText(element)) return null;
  let bridge: ReactTextBridge | null = null;
  let reactText: { propName: string; before: string } | null = null;
  if (element.dataset.komoTextProp) {
    bridge = await options.loadReactBridge();
    reactText = bridge.beginReactTextEdit(element);
    if (!reactText) return null;
  }
  const before = reactText?.before ?? (element.textContent ?? "").slice(0, 500);
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

  const input = () => {
    if (element.childElementCount) element.textContent = element.textContent ?? "";
    if ((element.textContent ?? "").length > 500) element.textContent = (element.textContent ?? "").slice(0, 500);
    if (reactText && bridge && !bridge.previewReactTextEdit(element, reactText.propName, element.textContent ?? "")) {
      element.textContent = before;
    }
  };
  const paste = (event: ClipboardEvent) => {
    event.preventDefault();
    plainTextAtCaret(element, (event.clipboardData?.getData("text/plain") ?? "").replace(/[\r\n]+/g, " ").slice(0, 500));
    input();
  };
  const drop = (event: DragEvent) => event.preventDefault();
  element.addEventListener("input", input, { signal: listeners.signal });
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
      if (element.childElementCount) element.textContent = element.textContent ?? "";
      const after = (element.textContent ?? "").slice(0, 500);
      restoreAttributes();
      if (cancel) {
        if (reactText && bridge) bridge.cancelReactTextEdit(element, reactText.propName, before);
        element.textContent = before;
      } else if (reactText && bridge) {
        bridge.finishReactTextEdit(element, reactText.propName, before, after);
      }
      options.onFinish({ element, before, after, ...(reactText ? { reactProp: reactText.propName } : {}) }, cancel);
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
