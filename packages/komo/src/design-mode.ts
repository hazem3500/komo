import { designModeStyles } from "./design-mode-styles.js";
import { el, icon } from "./dom.js";
import type { Control, PanelContext } from "./design-panel.js";
import type { InlineTextTools } from "./inline-text-editor.js";
import type { DesignSystem } from "./design-system.js";

export interface DesignModeOptions {
  root: ShadowRoot;
  /** Shared Komo sidebar surface; the inspector rides its morph. Tests may omit it. */
  panelRoot?: HTMLElement;
  host: HTMLElement;
  targetAt(x: number, y: number): Element | null;
  onComment(element: Element, proposal?: string): void;
  onExit(): void;
  /** Label of the shortcut that toggles Design mode, shown in the empty state. */
  exitKey?: string;
  /** Move the floating panel to the other side when it covers the target. */
  flip?(): void;
  /** The app's design-system adapters; `tokens` replaces CSS-variable token chips. */
  design?: DesignSystem;
}

type Edit = {
  kind: "style";
  element: HTMLElement;
  property: string;
  before: Original;
  after: Original;
};

type TextEdit = { kind: "text"; element: HTMLElement };
/** A token previewed through the app's adapter; its undo comes from `preview()`. */
type TokenSwap = { kind?: undefined; element: HTMLElement; undo(): void };

type Original = { value: string; priority: string; computed?: string };

/** A plain `type="button"` button; `el` keeps the class and text optional. */
const action = (className?: string, text?: string) => Object.assign(el("button", className, text), { type: "button" });
const media = (query: string) => typeof matchMedia === "function" && matchMedia(query).matches;
const calm = () => media("(prefers-reduced-motion: reduce)");

const glyph = (path: string) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;

export function createDesignMode(options: DesignModeOptions) {
  const style = el("style");
  style.textContent = designModeStyles;
  // Property controls are a separate chunk, fetched as soon as Design mode loads.
  let panelModule: typeof import("./design-panel.js") | null = null;
  const ready = import("./design-panel.js").then((module) => {
    style.textContent += module.designPanelStyles;
    panelModule = module;
  }, () => { status.textContent = "Design controls unavailable · try again"; });
  const panel = el("aside", "design-inspector");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Design mode inspector");
  panel.setAttribute("aria-hidden", "true");
  panel.hidden = true;
  const outline = el("div", "design-outline");
  outline.setAttribute("aria-hidden", "true");
  const heading = el("div", "design-inspector__heading");
  const parent = action("design-inspector__parent");
  parent.hidden = true;
  const title = el("span", "design-inspector__target");
  const subtitle = el("small");
  const close = action("design-inspector__close");
  close.setAttribute("aria-label", "Exit design mode");
  close.append(icon("close"));
  // Compact screens only: fold the sheet so page elements under it stay reachable.
  const fold = action("design-inspector__fold");
  fold.append(icon("chevron"));
  const identity = el("div", "design-inspector__identity");
  identity.append(parent, title, subtitle);
  heading.append(identity, fold, close);

  const controls = el("div", "design-inspector__controls");
  const bar = el("div", "design-inspector__bar");
  const count = el("span", "design-inspector__count");
  count.title = "Preview only · resets on exit";
  const status = el("p", "design-inspector__status");
  status.setAttribute("role", "status");
  const actions = el("div", "design-inspector__actions");
  const tool = (label: string, markup: string) => {
    const button = action("design-inspector__tool");
    button.dataset.tip = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = markup;
    return button;
  };
  const undo = tool("Undo", glyph("M5.5 3.5 2.5 6.5l3 3m-3-3h7a4 4 0 0 1 0 8h-2"));
  const reset = tool("Reset", glyph("M2.5 2.5v3h3M3 5.5a5.5 5.5 0 1 1-.5 2.5"));
  const copy = tool("Copy CSS", "");
  copy.append(icon("copy"));
  const comment = action("", "Comment");
  const editText = action("design-text-edit", "Edit text");
  editText.title = "Edit text";
  editText.setAttribute("aria-label", "Edit selected text inline");
  actions.append(undo, reset, copy, comment);
  // Before shows the page without this session's edits; After puts them back.
  const compare = el("div", "design-inspector__compare");
  compare.setAttribute("role", "group");
  compare.setAttribute("aria-label", "Compare with the page");
  const sides = ["Before", "After"].map((label, index) => {
    const button = action("", label);
    button.dataset.tip = `${label} · ${index ? "→" : "←"} or B`;
    button.setAttribute("aria-pressed", String(!!index));
    button.addEventListener("click", () => showBefore(!index));
    compare.append(button);
    return button;
  });
  bar.append(count, compare, status, actions);
  panel.append(heading, controls, bar);
  options.root.append(style, outline);
  (options.panelRoot ?? options.root).append(panel);

  let active = false;
  let closeTimer = 0;
  let selected: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let textTools: InlineTextTools | null = null;
  let frame = 0;
  let flipTimer = 0;
  let flipFor: HTMLElement | null = null;
  let flipKind = "";
  let reactPanelModule: typeof import("./react-props-panel.js") | null = null;
  let reactPanelPromise: Promise<typeof import("./react-props-panel.js")> | null = null;
  const originals = new Map<HTMLElement, Map<string, Original>>();
  const changed = new Map<HTMLElement, Map<string, string>>();
  const starts = new WeakMap<Control, Original>();
  const pending = new WeakMap<Control, Edit>();
  const listeners = new AbortController();
  const exporter = () => import("./design-export.js");
  // Footer tooltips load with the export helpers on the bar's first hover or focus;
  // a tip waits 400ms before it shows, so the chunk is in by then.
  let tips: Promise<void> | undefined;
  const loadTips = (event: Event) => {
    tips ??= exporter().then(({ footerTips }) => footerTips(bar, options.root, listeners.signal, event), () => { tips = undefined; });
  };
  bar.addEventListener("pointerover", loadTips);
  bar.addEventListener("focusin", loadTips);
  const collapsed = new Set<string>();
  const history: Array<Edit | TextEdit | TokenSwap> = [];

  function remember(element: HTMLElement, property: string, value = element.style.getPropertyValue(property), priority = element.style.getPropertyPriority(property)) {
    let values = originals.get(element);
    if (!values) originals.set(element, (values = new Map()));
    if (!values.has(property)) values.set(property, { value, priority, computed: getComputedStyle(element).getPropertyValue(property).trim() });
  }
  function track(element: HTMLElement, property: string) {
    let values = changed.get(element);
    if (!values) changed.set(element, (values = new Map()));
    const value = element.style.getPropertyValue(property);
    if (value === (originals.get(element)?.get(property)?.value ?? "")) values.delete(property);
    else values.set(property, value);
    if (!values.size) changed.delete(element);
    outlineFor(selected, "selected");
  }
  /** The bar shows a change count and its tools only once the selection has changes. Returns the count. */
  function syncBar() {
    const element = selected;
    const total = element
      ? (changed.get(element)?.size ?? 0) + Number(!!textTools?.hasChanges(element)) + Number(!!reactPanelModule?.hasReactPropChanges(element)) ||
        Number(!!reactPanelModule?.hasDesignTokenEdit(element))
      : 0;
    count.textContent = total ? `${total} change${total > 1 ? "s" : ""}` : "";
    bar.toggleAttribute("data-changes", total > 0 || !undo.disabled);
    compare.hidden = !total && !showingBefore;
    return total;
  }
  // Status messages show briefly in the bar, then give way to the change count.
  let statusTimer = 0;
  new MutationObserver(() => {
    const text = status.textContent ?? "";
    status.title = text;
    bar.toggleAttribute("data-message", !!text);
    clearTimeout(statusTimer);
    if (text) statusTimer = window.setTimeout(function clear() {
      if (textTools?.element) statusTimer = window.setTimeout(clear, 2600);
      else status.textContent = "";
    }, 2600);
  }).observe(status, { childList: true, characterData: true, subtree: true });
  let showingBefore = false;
  function showBefore(on: boolean) {
    if (on === showingBefore) return;
    if (on && textTools?.element) finishTextEdit();
    showingBefore = on;
    // Morph like design comments: animate exactly the changed properties, then hand them back.
    const smooth = !calm();
    for (const [element, values] of changed) {
      const transition = element.style.transition;
      if (smooth) element.style.transition = [...values.keys()].map((property) => `${property} .3s cubic-bezier(.22,1,.36,1)`).join();
      for (const [property, value] of values) {
        const original = originals.get(element)?.get(property);
        if (on) restore(element, property, original);
        else element.style.setProperty(property, value, original?.priority);
      }
      if (smooth) window.setTimeout(() => (element.style.transition = transition), 320);
    }
    textTools?.showBefore(on);
    reactPanelModule?.showDesignBefore(on);
    sides.forEach((button, index) => button.setAttribute("aria-pressed", String(!index === on)));
    panel.toggleAttribute("data-before", on);
    updateActions();
  }
  function restore(element: HTMLElement, property: string, original?: Original) {
    if (original?.value) element.style.setProperty(property, original.value, original.priority);
    else element.style.removeProperty(property);
  }
  function preview(control: Control, property: string, value: string | null) {
    if (!selected) return;
    control.setAttribute("aria-invalid", String(value === null));
    if (value === null) return;
    remember(selected, property);
    // Record token provenance before the override hides the page's own reference.
    reactPanelModule?.noteDesignTokenOverride(selected, property, value);
    selected.style.setProperty(property, value, originals.get(selected)?.get(property)?.priority);
    track(selected, property);
    updateActions();
  }
  function commit(control: Control, property: string, final = true) {
    if (!selected) return;
    const after = {
      value: selected.style.getPropertyValue(property),
      priority: selected.style.getPropertyPriority(property),
    };
    const edit = pending.get(control);
    const before = edit?.before ?? starts.get(control) ?? { value: "", priority: "" };
    if (after.value === before.value && after.priority === before.priority) {
      if (edit) history.splice(history.indexOf(edit), 1);
      pending.delete(control);
    } else if (edit) edit.after = after;
    else {
      const next: Edit = { kind: "style", element: selected, property, before, after };
      history.push(next);
      pending.set(control, next);
    }
    if (final) {
      starts.set(control, after);
      pending.delete(control);
    }
    updateActions();
  }
  function renderControls() {
    controls.replaceChildren();
    syncEmpty();
    if (!selected) {
      const empty = el("div", "design-inspector__empty");
      const heading = el("strong", "", "Select an element");
      const hints = el("ul");
      // Odd parts are keycaps: "", "Click", " to inspect".
      const hint = (...parts: string[]) => {
        const line = el("li");
        parts.forEach((part, index) => {
          if (index % 2 === 0) line.append(part);
          else line.append(el("kbd", "", part));
        });
        hints.append(line);
      };
      hint("", "Click", " to inspect");
      hint("", "Double-click", " text to edit");
      if (options.exitKey) hint("", "Esc", " or ", options.exitKey, " to exit");
      else hint("", "Esc", " to exit");
      empty.append(icon("design"), heading, hints);
      controls.append(empty);
      // Compact screens fold the sheet to its heading, so the title stays there.
      title.textContent = "Select an element";
      subtitle.textContent = "";
      parent.hidden = true;
      return;
    }
    const identity = `${selected.tagName.toLowerCase()}${selected.id ? `#${selected.id}` : ""}`;
    title.textContent = identity;
    subtitle.textContent = selected instanceof HTMLIFrameElement
      ? "Frame only · contents are isolated"
      : (selected.classList.length ? `.${[...selected.classList].slice(0, 2).join(".")}` : "");
    const up = selected.parentElement;
    parent.hidden = !up || up === document.body || up === document.documentElement;
    parent.textContent = up?.tagName.toLowerCase() ?? "";
    parent.setAttribute("aria-label", `Select parent ${parent.textContent}`);
    const element = selected;
    const panelControls = panelModule;
    if (!panelControls) {
      void ready.then(() => { if (active && selected === element) renderControls(); });
      return;
    }
    panelControls.renderPanel(controls, {
      element,
      changed: changed.get(element),
      collapsed,
      editText,
      begin: (control, property) => starts.set(control, {
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
      }),
      apply: preview,
      commit,
      rerender: renderControls,
    } satisfies PanelContext);
    // Any design-system adapter needs the token and props controls, not only registered elements.
    if (options.design || element.closest("[data-komo-inspectable], [data-komo-design-tokens]")) {
      reactPanelPromise ??= import("./react-props-panel.js").then((module) => reactPanelModule = module).catch((error: unknown) => {
        reactPanelPromise = null;
        throw error;
      });
      void reactPanelPromise.then((module) => {
        if (!active || selected !== element || controls.querySelector(".design-react-group, .design-theme-group")) return;
        const styleRoot = options.root;
        // Switching a theme re-renders the selection, so tokens, values and the outline follow it.
        module.attachThemeSwitcher(controls, options.design, () => select(element), styleRoot);
        const props = module.createReactPropsPanel(element, () => {
          status.textContent = "React state preview · resets on exit";
          updateActions();
        }, styleRoot, select);
        if (props) controls.append(props);
        module.attachStyleTokenControls(element, panelControls.fields, controls, (field, input, before) => {
          remember(element, field.property, before);
          track(element, field.property);
          starts.set(input, { value: before, priority: element.style.getPropertyPriority(field.property) });
          commit(input, field.property);
        }, styleRoot, panelControls.valueFor, panelControls.toHex, options.design, (undo) => {
          history.push({ element, undo });
          updateActions();
        });
        const theme = module.createDesignThemePanel(element, panelControls, updateActions, styleRoot);
        if (theme) controls.append(theme);
      }).catch(() => {});
    }
  }
  /** With nothing selected, the inspector drops its footer and the sidebar fits the empty state. */
  function syncEmpty() {
    panel.toggleAttribute("data-empty", (comment.hidden = !selected));
    panel.parentElement?.toggleAttribute("data-design-empty", active && !selected);
  }
  /** Draw the outline; only a newly picked or hovered target (`retarget`) may move the panel. */
  function outlineFor(element: HTMLElement | null, kind: "hover" | "selected", retarget = false) {
    if (!active || !element?.isConnected) {
      outline.hidden = true;
      return;
    }
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      outline.hidden = true;
      return;
    }
    outline.hidden = false;
    outline.dataset.kind = kind;
    // Flip once per target, only when it sits under the panel and would be clear on the other side.
    // Resizes, edits and Before/After redraw the outline but never move the panel.
    if (retarget && (element !== flipFor || kind !== flipKind)) {
      flipFor = element;
      flipKind = kind;
      clearTimeout(flipTimer);
      const box = panel.getBoundingClientRect();
      const covers = (left: number) => rect.left < left + box.width && rect.right > left && rect.top < box.bottom && rect.bottom > box.top;
      if (options.flip && box.width && covers(box.left) && !covers(document.documentElement.clientWidth - box.right))
        flipTimer = window.setTimeout(options.flip, kind === "hover" ? 350 : 0);
    }
    Object.assign(outline.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }
  function scheduleOutline() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      outlineFor(selected ?? hovered, selected ? "selected" : "hover");
    });
  }
  // Style edits resize the selection; the outline follows it.
  const resized = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleOutline) : null;
  function select(element: Element | null) {
    if (!(element instanceof HTMLElement) || options.host.contains(element)) return;
    if (textTools?.element && textTools.element !== element) finishTextEdit();
    resized?.disconnect();
    resized?.observe(element);
    selected = element;
    hovered = element;
    renderControls();
    outlineFor(element, "selected", true);
    updateActions();
  }
  const compact = () => media("(max-width:520px)");
  function setFolded(value: boolean) {
    panel.toggleAttribute("data-folded", value && compact());
    fold.setAttribute("aria-expanded", String(!panel.hasAttribute("data-folded")));
    fold.setAttribute("aria-label", panel.hasAttribute("data-folded") ? "Expand inspector" : "Collapse inspector");
  }
  /** On compact screens the inspector is a bottom sheet; keep the selection above it. */
  function reveal(element: HTMLElement) {
    setFolded(false);
    if (!compact()) return;
    requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect();
      const limit = panel.getBoundingClientRect().top - 12;
      if (rect.top >= 12 && rect.bottom <= limit) return;
      window.scrollBy({
        top: rect.top - Math.max(12, (limit - rect.height) / 2),
        behavior: calm() ? "auto" : "smooth",
      });
    });
  }
  function updateActions() {
    // Every edit, undo and reset lands here; re-measure after it applies.
    scheduleOutline();
    undo.disabled = !history.length && !reactPanelModule?.canUndoReactProp(selected) && !reactPanelModule?.canUndoDesignTokenEdit(selected);
    reset.disabled = !syncBar();
    copy.disabled = !selected || !(changed.get(selected)?.size);
    comment.disabled = !selected;
    // Nested markup is never editable; the editor checks privacy and interactivity on use.
    editText.disabled = !!textTools?.busy || !selected?.isConnected;
    editText.textContent = textTools?.isEditing(selected) ? "Done editing" : "Edit text";
    editText.setAttribute("aria-label", textTools?.isEditing(selected) ? "Finish inline text editing" : "Edit selected text inline");
  }
  function finishTextEdit(cancel = false) {
    textTools?.finish(cancel);
    updateActions();
  }
  editText.addEventListener("click", (event) => {
    if (textTools) return;
    if (!selected) return;
    status.textContent = "Loading inline text editor…";
    void import("./inline-text-editor.js").then((module) => {
      if (textTools || !selected || !active) return;
      textTools = module.bindInlineTextTools({
        button: editText,
        status,
        selected: () => selected,
        active: () => active,
        onChange: updateActions,
        onCommit(result) {
          history.push({ kind: "text", element: result });
        },
      });
      void textTools.toggle(event);
    }).catch(() => { status.textContent = "Inline text editing is unavailable."; });
  });
  function onMove(event: PointerEvent) {
    if (!active || event.composedPath().includes(options.host)) return;
    const element = options.targetAt(event.clientX, event.clientY);
    if (!(element instanceof HTMLElement) || options.host.contains(element)) return;
    hovered = element;
    if (!selected) outlineFor(hovered, "hover", true);
  }
  function onDown(event: PointerEvent) {
    if (!active || event.composedPath().includes(options.host)) return;
    const element = options.targetAt(event.clientX, event.clientY);
    if (!(element instanceof HTMLElement) || options.host.contains(element)) return;
    if (textTools?.element && (element === textTools.element || textTools.element.contains(element))) return;
    if (textTools?.element) finishTextEdit();
    event.preventDefault();
    event.stopImmediatePropagation();
    select(element);
  }
  function onClick(event: MouseEvent) {
    if (!active || event.composedPath().includes(options.host)) return;
    // Cancelling pointerdown alone does not cancel a link's click navigation.
    event.preventDefault();
    event.stopImmediatePropagation();
    // Unfold and scroll only once the tap has finished, so the sheet never lands under the finger.
    if (selected) reveal(selected);
    // The second pointerdown of a double-click already selected the target; edit it where it was clicked.
    if (event.detail === 2 && selected?.contains(event.target as Node) && !editText.disabled && !textTools?.element) editText.dispatchEvent(new MouseEvent("click", event));
  }
  function onKey(event: KeyboardEvent) {
    if (textTools?.handleKey(event)) {
      editText.focus({ preventScroll: true });
      return;
    }
    // ← Before, → After, B flips, as on design comments; never while typing in a field.
    const key = event.key.toLowerCase();
    const origin = event.composedPath()[0];
    if (
      active && !compare.hidden && !event.metaKey && !event.ctrlKey && !event.altKey &&
      (key === "b" || key === "arrowleft" || key === "arrowright") &&
      !(origin instanceof HTMLElement && (origin.isContentEditable || origin.matches("input, textarea, select")))
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showBefore(key === "b" ? !showingBefore : key === "arrowleft");
      return;
    }
    if (active && !textTools?.element && (event.key === "Enter" || event.key === " ") && !event.composedPath().includes(options.host)) {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== document.body && focused !== document.documentElement) {
        event.preventDefault();
        event.stopImmediatePropagation();
        select(focused);
        reveal(focused);
        return;
      }
    }
    if (active && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      setActive(false);
      options.onExit();
    }
  }
  function setActive(value: boolean) {
    // Leaving Design mode, Comment included, restores the page; posted comments preview with Before/After.
    if (!value) {
      showBefore(false);
      textTools?.finish();
      for (const [element, properties] of originals)
        for (const [property, original] of properties) restore(element, property, original);
      originals.clear();
      changed.clear();
      history.length = 0;
      textTools?.restoreAll();
      reactPanelModule?.resetPreviews();
      updateActions();
    }
    clearTimeout(closeTimer);
    closeTimer = 0;
    active = value;
    syncEmpty();
    if (value) {
      panel.hidden = false;
      panel.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => {
        if (active) panel.dataset.state = "active";
      });
      outline.hidden = !selected;
      renderControls();
      setFolded(!selected);
      outlineFor(selected, "selected");
      close.focus({ preventScroll: true });
    } else {
      outline.hidden = true;
      panel.setAttribute("aria-hidden", "true");
      panel.dataset.state = "closing";
      if (calm()) {
        panel.hidden = true;
        delete panel.dataset.state;
      } else {
        closeTimer = window.setTimeout(() => {
          closeTimer = 0;
          if (!active) {
            panel.hidden = true;
            delete panel.dataset.state;
          }
        }, 250);
      }
    }
  }

  fold.addEventListener("click", () => setFolded(!panel.hasAttribute("data-folded")));
  parent.addEventListener("click", () => select(selected?.parentElement ?? null));
  close.addEventListener("click", () => {
    if (textTools?.element) finishTextEdit();
    setActive(false);
    options.onExit();
  });
  undo.addEventListener("click", () => {
    const edit = history.pop();
    if (!edit) {
      if (selected) {
        reactPanelModule?.undoDesignTokenEdit(selected);
        reactPanelModule?.undoReactProp(selected);
        renderControls();
      }
      status.textContent = "React state preview · resets on exit";
    } else if (!edit.kind) {
      edit.undo();
      renderControls();
    } else if (edit.kind === "text") {
      if (selected === (textTools?.undo() ?? edit.element)) renderControls();
    } else {
      restore(edit.element, edit.property, edit.before);
      reactPanelModule?.syncDesignTokenBinding(edit.element, edit.property);
      track(edit.element, edit.property);
      if (selected === edit.element) renderControls();
      outlineFor(selected ?? hovered, selected ? "selected" : "hover");
    }
    updateActions();
    (undo.disabled ? close : undo).focus({ preventScroll: true });
  });
  reset.addEventListener("click", () => {
    if (!selected) return;
    if (textTools?.isEditing(selected)) finishTextEdit(true);
    const values = changed.get(selected);
    const hasTextValue = textTools?.hasChanges(selected) ?? false;
    const hasReactValues = reactPanelModule?.hasReactPropChanges(selected) ?? false;
    const hasTokenValues = reactPanelModule?.hasDesignTokenEdit(selected) ?? false;
    if (!values?.size && !hasTextValue && !hasReactValues && !hasTokenValues) return;
    if (hasTextValue) textTools?.reset(selected);
    for (const property of values?.keys() ?? []) restore(selected, property, originals.get(selected)?.get(property));
    changed.delete(selected);
    if (hasReactValues) reactPanelModule?.resetReactProps(selected);
    if (hasTokenValues) reactPanelModule?.resetDesignTokenEdits(selected);
    for (let index = history.length - 1; index >= 0; index--)
      if (history[index].element === selected) history.splice(index, 1);
    renderControls();
    outlineFor(selected, "selected");
    updateActions();
    close.focus({ preventScroll: true });
  });
  copy.addEventListener("click", () => {
    const element = selected;
    const values = element ? changed.get(element) : undefined;
    if (!element || !values?.size) return;
    void exporter().then(async ({ cssText }) => {
      const css = cssText(element, values);
      try {
        await navigator.clipboard.writeText(css);
        status.textContent = "CSS copied";
      } catch {
        status.textContent = css;
      }
    });
  });
  comment.addEventListener("click", () => {
    const element = selected;
    if (!element) return;
    if (textTools?.isEditing(element)) finishTextEdit();
    void exporter().then(({ designProposal }) => options.onComment(element, designProposal(
      element,
      changed.get(element),
      (property) => originals.get(element)?.get(property)?.computed,
      reactPanelModule?.tokenBoundProperties(element),
      [textTools?.proposal(element), reactPanelModule?.proposedDesignChanges(element)],
      reactPanelModule?.designContext(element, options.design),
    )), () => { status.textContent = "Comment unavailable · try again"; });
  });
  // Editing anything, Undo, Reset or Comment first returns to After.
  const toAfter = () => showBefore(false);
  for (const node of [controls, actions, editText])
    for (const type of ["pointerdown", "focusin", "click"]) node.addEventListener(type, toAfter, true);
  document.addEventListener("pointermove", onMove, { capture: true, signal: listeners.signal });
  document.addEventListener("pointerdown", onDown, { capture: true, signal: listeners.signal });
  document.addEventListener("click", onClick, { capture: true, signal: listeners.signal });
  document.addEventListener("keydown", onKey, { capture: true, signal: listeners.signal });
  window.addEventListener("scroll", scheduleOutline, { capture: true, passive: true, signal: listeners.signal });
  window.addEventListener("resize", scheduleOutline, { passive: true, signal: listeners.signal });

  return {
    setActive,
    mountPanel(parent: HTMLElement) {
      if (panel.parentElement !== parent) {
        panel.parentElement?.removeAttribute("data-design-empty");
        parent.append(panel);
        syncEmpty();
      }
    },
    get active() { return active; },
    /** Resolves once the property controls have loaded. */
    ready,
    destroy() {
      textTools?.finish(true);
      setActive(false);
      clearTimeout(closeTimer);
      clearTimeout(statusTimer);
      clearTimeout(flipTimer);
      resized?.disconnect();
      listeners.abort();
      cancelAnimationFrame(frame);
      panel.remove();
      outline.remove();
      style.remove();
    },
  };
}
