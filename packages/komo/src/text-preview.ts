import type { InlineTextEditResult } from "./inline-text-editor.js";

export type TextSnapshot = Array<[Text, string]>;
export const lockedText = "script,style,svg,input,textarea,select,[data-private],[data-sensitive]";

export function snapshotText(element: HTMLElement): TextSnapshot {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: TextSnapshot = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push([node, node.data]);
  }
  return nodes;
}

export function restoreText(nodes: TextSnapshot, owner: HTMLElement) {
  for (const [node, value] of nodes)
    if ((!node.isConnected || owner.contains(node)) && !node.parentElement?.closest(lockedText) && node.data !== value) node.data = value;
}

/** Keep a visual preview on the same nodes through host text updates; never adopt replacement markup. */
export function holdText(element: HTMLElement, nodes: TextSnapshot, onLost?: () => void): () => void {
  restoreText(nodes, element);
  const observer = new MutationObserver(() => {
    if (!element.isConnected || nodes.some(([node]) => !element.contains(node))) { observer.disconnect(); onLost?.(); }
    else { restoreText(nodes, element); watch(); }
  });
  const watch = () => {
    observer.disconnect();
    observer.observe(element, { childList: true, characterData: true, subtree: true });
    // An owner can disappear without changing its subtree; follow attachment through shadow hosts too.
    for (let parent: Node | null = element.parentNode; parent; parent = parent.parentNode ?? (parent instanceof ShadowRoot ? parent.host : null))
      observer.observe(parent, { childList: true });
  };
  watch();
  return () => observer.disconnect();
}

/** Apply only the changed character range, retaining every element and text node. */
export function previewText(element: HTMLElement, before: string, after: string, onLost?: () => void): (() => void) | undefined {
  if (!element.isConnected) return;
  const original = snapshotText(element);
  if (original.map(([, value]) => value).join("") !== before) return;
  let start = 0, end = before.length;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (end > start && after.length - (before.length - end) > start && before[end - 1] === after[after.length - (before.length - end) - 1]) end--;
  const insertion = after.slice(start, after.length - (before.length - end));
  const values: TextSnapshot = [];
  let offset = 0, inserted = false;
  for (const [node, value] of original) {
    const limit = offset + value.length;
    const contains = start === end ? !inserted && start >= offset && start <= limit && !node.parentElement?.closest(lockedText) : start < limit && end > offset;
    if (contains) {
      if (node.parentElement?.closest(lockedText)) return;
      const left = Math.max(0, start - offset);
      const right = Math.min(value.length, Math.max(left, end - offset));
      values.push([node, value.slice(0, left) + (inserted ? "" : insertion) + value.slice(right)]);
      inserted = true;
    } else values.push([node, value]);
    offset = limit;
  }
  if (!inserted) return;
  const stop = holdText(element, values, onLost);
  return () => { stop(); restoreText(original, element); };
}

export interface TextPreviewHistory {
  record(result: InlineTextEditResult): void;
  remember(element: HTMLElement, before: string): void;
  original(element: HTMLElement): string | undefined;
  reconcile(element: HTMLElement, text: string): void;
  reset(element: HTMLElement): void;
  proposal(element: HTMLElement): string | undefined;
  restoreAll(): void;
  showBefore(on: boolean, retain?: boolean): void;
  undo(): HTMLElement | null;
  pause(element: HTMLElement): void;
  resume(element: HTMLElement): void;
}

export function createTextPreviewHistory(): TextPreviewHistory {
  const originals = new Map<HTMLElement, { text: string; nodes: TextSnapshot }>();
  const edits: InlineTextEditResult[] = [];
  const previews = new Map<HTMLElement, () => void>();
  const current = new Map<HTMLElement, TextSnapshot>();
  const pause = (element: HTMLElement) => { previews.get(element)?.(); previews.delete(element); };
  const show = (element: HTMLElement, nodes: TextSnapshot) => { pause(element); previews.set(element, holdText(element, nodes)); };
  const clear = (element: HTMLElement) => { pause(element); originals.delete(element); current.delete(element); };
  return {
    pause,
    resume(element) { const nodes = current.get(element); if (nodes) show(element, nodes); },
    record(result) {
      if (result.reactProp || result.before === result.after) return;
      if (!originals.has(result.element)) originals.set(result.element, { text: result.before, nodes: result.nodes ?? snapshotText(result.element) });
      edits.push(result);
      const nodes = snapshotText(result.element);
      current.set(result.element, nodes);
      show(result.element, nodes);
    },
    remember(element, text) {
      if (!originals.has(element)) originals.set(element, { text, nodes: snapshotText(element) });
    },
    original(element) { return originals.get(element)?.text; },
    reconcile(element, text) { if (originals.get(element)?.text === text) clear(element); },
    reset(element) {
      pause(element);
      restoreText(originals.get(element)?.nodes ?? [], element);
      clear(element);
      for (let index = edits.length - 1; index >= 0; index--)
        if (edits[index].element === element) edits.splice(index, 1);
    },
    proposal(element) {
      const before = originals.get(element)?.text;
      const after = current.get(element)?.map(([, value]) => value).join("") ?? element.textContent ?? "";
      return before !== undefined && before !== after
        ? `Proposed inline text change (preview only)\n- Text: ${JSON.stringify(before)} → ${JSON.stringify(after)}\n- Source markup is unchanged; refresh resets this preview.`
        : undefined;
    },
    restoreAll() {
      for (const element of previews.keys()) pause(element);
      for (const [element, { nodes }] of originals) restoreText(nodes, element);
      originals.clear();
      current.clear();
      edits.length = 0;
    },
    showBefore(on, retain = true) {
      for (const [element, original] of originals) {
        if (on && !retain) { pause(element); restoreText(original.nodes, element); }
        else show(element, on ? original.nodes : current.get(element) ?? original.nodes);
      }
    },
    undo() {
      const edit = edits.pop();
      if (!edit) return null;
      pause(edit.element);
      restoreText(edit.nodes ?? [], edit.element);
      if (originals.get(edit.element)?.text === edit.before) clear(edit.element);
      else {
        const nodes = snapshotText(edit.element);
        current.set(edit.element, nodes);
        show(edit.element, nodes);
      }
      return edit.element;
    },
  };
}
