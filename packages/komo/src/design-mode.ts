import { isDesignTarget, pickDesignTarget, type DesignTarget } from "./design-target.js";
import { previewMessage, changePreviewStyles, createStyleEdits, inlineStyleSnapshot, removeEmptyStyle, restoreStyle, type StyleEdit, type StyleOriginal } from "./design-preview.js";
import { designModeStyles } from "./design-mode-styles.js";
import { el, icon } from "./dom.js";
import { isMac } from "./kbd.js";
import { drawHighlight, watchHighlight } from "./highlight.js";
import { clientPoint, isHTMLElement, onFrame, screenRect } from "./frame-target.js";
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
  /** Opens komo's shortcut help; the empty state links to it and `?` opens it. */
  shortcutHelp?(): void;
  reservedKey?(event: KeyboardEvent): boolean;
  /** Move the floating panel to the other side when it covers the target. */
  flip?(): void;
  /** The app's design-system adapters; `tokens` replaces CSS-variable token chips. */
  design?: DesignSystem;
  /** The comments visibility shortcut; in Design mode experimental geometry uses it to hide its overlays. */
  visibility?: import("./shortcuts.js").Shortcut | null;
  /** Configured Before/After and selection keys. */
  keys?: import("./shortcuts.js").DesignKeys;
  page?(): string;
  bounds?(element: Element): { left: number; top: number; right: number; bottom: number } | undefined;
  /** Link for a component's repository-relative source, e.g. through `sourceUrl`. */
  sourceHref?(path: string, line?: number): string | undefined;
}

type TextEdit = { kind: "text"; element: DesignTarget };
/** A token previewed through the app's adapter; its undo comes from `preview()`. Entries may redo themselves. */
type TokenSwap = { kind?: undefined; element: DesignTarget; undo(): void; redo?(): void; props?: boolean };
/** One step of the Tokens view's page-wide edits, in the same chronological history. */
type TokenStep = { kind: "token"; element?: undefined; step: object };

type Original = StyleOriginal;

/** A plain `type="button"` button; `el` keeps the class and text optional. */
const action = (className?: string, text?: string) => Object.assign(el("button", className, text), { type: "button" });
const media = (query: string) => typeof matchMedia === "function" && matchMedia(query).matches;
const calm = () => media("(prefers-reduced-motion: reduce)");

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
  const prospective = el("div", "design-outline design-outline--prospective");
  prospective.setAttribute("aria-hidden", "true");
  prospective.dataset.kind = "hover";
  prospective.hidden = true;
  const heading = el("div", "design-inspector__heading");
  let returnAction: { label: string; run(): void } | null = null;
  const back = action("design-inspector__back");
  back.hidden = true;
  back.append(icon("chevron"));
  back.addEventListener("click", () => returnAction?.run());
  const parent = action("design-inspector__parent");
  parent.hidden = true;
  const title = el("span", "design-inspector__target");
  // Focus falls back here, never to Exit, when the control that had it is gone after a redraw.
  title.tabIndex = -1;
  const subtitle = el("small");
  const close = action("design-inspector__close");
  close.setAttribute("aria-label", "Exit design mode");
  close.append(icon("close"));
  // Compact screens only: fold the sheet so page elements under it stay reachable.
  const fold = action("design-inspector__fold");
  fold.append(icon("chevron"));
  const identity = el("div", "design-inspector__identity");
  identity.append(parent, title, subtitle);
  heading.append(back, identity, fold, close);

  const controls = el("div", "design-inspector__controls");
  const bar = el("div", "design-inspector__bar");
  const count = el("span", "design-inspector__count");
  count.title = previewMessage;
  const status = el("p", "design-inspector__status");
  status.setAttribute("role", "status");
  const actions = el("div", "design-inspector__actions");
  const tool = (label: string) => {
    const button = action("design-inspector__tool");
    button.dataset.tip = label;
    button.setAttribute("aria-label", label);
    return button;
  };
  const undo = tool("Undo");
  const redo = tool("Redo");
  undo.dataset.tip = `Undo · ${isMac() ? "⌘Z" : "Ctrl+Z"}`;
  redo.dataset.tip = `Redo · ${isMac() ? "⌘⇧Z" : "Ctrl+Y"}`;
  const reset = tool("Reset");
  const copy = tool("Copy CSS");
  copy.append(icon("copy"));
  const comment = action("", "Comment");
  const editText = action("design-text-edit", "Edit text");
  editText.title = "Edit text";
  editText.setAttribute("aria-label", "Edit selected text inline");
  actions.append(undo, redo, reset, copy, comment);
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
  const pendingSlot = el("div");
  let views: ReturnType<typeof import("./design-export.js")["selectionViews"]> | undefined;
  panel.append(heading, pendingSlot, controls, bar);
  options.root.append(style, outline, prospective);
  (options.panelRoot ?? options.root).append(panel);

  let active = false;
  let resume: [DesignTarget, string] | null = null;
  // Editing stays undecorated until the canvas is targeted again.
  let decorating = true;
  let closeTimer = 0;
  let selected: DesignTarget | null = null;
  let hovered: DesignTarget | null = null;
  const page = () => options.page?.() ?? location.pathname;
  let selectionPage = page();
  const previewTargets = new Map<DesignTarget, string>();
  let textTools: InlineTextTools | null = null;
  let frame = 0;
  let flipTimer = 0;
  let flipFor: DesignTarget | null = null;
  let flipKind = "";
  let reactPanelModule: typeof import("./react-props-panel.js") | null = null;
  let reactPanelPromise: Promise<typeof import("./react-props-panel.js")> | null = null;
  const originals = new Map<DesignTarget, Map<string, Original>>();
  const styleless = new WeakSet<DesignTarget>();
  const changed = new Map<DesignTarget, Map<string, string>>();
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
  type Entry = StyleEdit | TextEdit | TokenSwap | TokenStep;
  const history: Entry[] = [];
  // Undone entries with how to put each back; any new edit, from any module, clears them.
  // A restored Discard all is one too, though it never joins the history.
  const future: Array<[Entry | { kind: "discard" }, () => void]> = [];
  let redoing = false;
  const record = history.push.bind(history);
  history.push = (...items) => { if (!redoing) future.length = 0; return record(...items); };
  const styleEdits = createStyleEdits(history);
  let geometry: ReturnType<typeof import("./design-geometry.js")["bindGeometry"]> | undefined;
  if (options.design?.experimentalGeometry) void import("./design-geometry.js").then(module => {
    if (listeners.signal.aborted) return;
    geometry = module.bindGeometry({
      options, signal: listeners.signal, selected: () => selected,
      enabled: () => active && decorating && !showingBefore && !textTools?.element,
      remember, track, history, update: updateActions, select,
      tokens: () => reactPanelModule, panel: () => controls,
      before: () => showingBefore,
      pick(x, y) {
        const element = pickDesignTarget(options.targetAt(x, y));
        if (element && !options.host.contains(element)) { decorating = true; choose(element); }
      },
    });
  });

  function remember(element: DesignTarget, property: string, value = element.style.getPropertyValue(property), priority = element.style.getPropertyPriority(property)) {
    const token = reactPanelModule?.originalDesignTokenStyle(element, property);
    let values = originals.get(element);
    if (!values) {
      originals.set(element, (values = new Map()));
      if (token?.absent || !element.hasAttribute("style")) styleless.add(element);
    }
    if (!values.has(property)) values.set(property, token ?? { ...inlineStyleSnapshot(element, property), value, priority });
  }
  function track(element: DesignTarget, property: string) {
    let values = changed.get(element);
    if (!values) changed.set(element, (values = new Map()));
    const value = element.style.getPropertyValue(property);
    if (value === (originals.get(element)?.get(property)?.value ?? "")) values.delete(property);
    else values.set(property, value);
    if (!values.size) changed.delete(element);
    renderOutlines();
  }
  /**
   * The bar shows a change count and its tools only once the selection has changes.
   * Pending token edits count too, behind their chip. Returns the selection's own count, for Reset.
   */
  function syncBar() {
    const element = selected;
    const own = element ? changeCount(element) : 0;
    const total = own + (element && views?.tokens?.size || 0);
    count.textContent = total ? `${total} change${total > 1 ? "s" : ""}` : "";
    bar.toggleAttribute("data-changes", total > 0 || !undo.disabled);
    // Discarded changes wait in Before until ⌘Z brings them back, so they can't be flipped.
    compare.hidden = !!views?.parked || !total && !showingBefore;
    return own;
  }
  /** The footer's count for one element; the pending card lists the same number. */
  function changeCount(element: DesignTarget) {
    return (changed.get(element)?.size ?? 0) + Number(isHTMLElement(element) && !!textTools?.hasChanges(element)) + Number(!!reactPanelModule?.hasReactPropChanges(element)) ||
      Number(!!reactPanelModule?.hasDesignTokenEdit(element));
  }
  let showingBefore = false;
  let suspendedBefore: boolean | undefined;
  let fieldsSettling = 0;
  function showBefore(on: boolean, animate = true) {
    geometry?.cancel();
    decorating = false;
    renderOutlines();
    if (on === showingBefore) return;
    if (on && textTools?.element) finishTextEdit();
    showingBefore = on;
    if (on) reactPanelModule?.showDesignBefore(true);
    // Morph like design comments: animate exactly the changed properties, then hand them back.
    const smooth = animate && !calm();
    for (const [element, properties] of originals) {
      const values = changed.get(element);
      changePreviewStyles(element, properties.keys(), () => {
        for (const property of properties.keys()) {
          const original = originals.get(element)?.get(property);
          if (on) restore(element, property, original);
          else if (values?.has(property)) element.style.setProperty(property, values.get(property)!, original?.priority);
        }
      }, smooth, styleless.has(element));
    }
    // Fields read computed values, so they wait out the morph.
    if (smooth) {
      clearTimeout(fieldsSettling);
      fieldsSettling = window.setTimeout(() => { fieldsSettling = 0; updateActions(); }, 330);
    }
    textTools?.showBefore(on, animate);
    if (!on) reactPanelModule?.showDesignBefore(false);
    sides.forEach((button, index) => button.setAttribute("aria-pressed", String(!index === on)));
    panel.toggleAttribute("data-before", on);
    updateActions();
  }
  function restore(element: DesignTarget, property: string, original?: Original) {
    restoreStyle(element, property, original);
    if (styleless.has(element)) removeEmptyStyle(element);
  }
  function preview(control: Control, property: string, value: string | null) {
    if (!selected) return;
    control.setAttribute("aria-invalid", String(value === null));
    if (value === null) return;
    remember(selected, property);
    // Record token provenance before the override hides the page's own reference.
    const binding = reactPanelModule?.noteDesignTokenOverride(selected, property, value);
    styleEdits.override(control, binding?.undo);
    selected.style.setProperty(property, value, binding?.priority ?? originals.get(selected)?.get(property)?.priority);
    track(selected, property);
    updateActions();
  }
  function commit(control: Control, property: string, final = true) {
    if (!selected) return;
    styleEdits.commit(control, selected, property, final);
    updateActions();
  }
  /** The inspector's title names the selection; focus lands there when its control is gone. */
  const focusSelection = () => title.focus({ preventScroll: true });
  let refocus: ((fallback: boolean) => void) | undefined;
  let keepFocus: typeof import("./design-keyboard.js")["keepFocus"] | undefined;
  let drawn: DesignTarget | null = null;
  function renderControls(retainedProps?: HTMLElement) {
    const focused = (panel.getRootNode() as Document | ShadowRoot).activeElement;
    // Only a redraw of the same selection keeps focus; a pick on the page leaves the panel (choose).
    const keep = focused && selected === drawn && controls.contains(focused) && keepFocus;
    drawn = selected;
    if (keep) refocus?.(false);
    cancelPreview();
    controls.replaceChildren();
    // Undo, Reset, Before/After and theme switches redraw; focus returns to the same control, else the selection.
    if (keep) refocus = keep(controls, focused, () => { refocus = undefined; }, () => { if (active && selected) focusSelection(); });
    syncEmpty();
    if (!selected) {
      if (views) controls.append(views.empty);
      // Compact screens fold the sheet to its heading, so the title stays there.
      title.textContent = "Select an element";
      subtitle.textContent = "";
      parent.hidden = true;
      return;
    }
    const identity = `${selected.tagName.toLowerCase()}${selected.id ? `#${selected.id}` : ""}`;
    title.textContent = identity;
    subtitle.textContent = selected.localName === "iframe"
      ? "Frame only · contents are isolated"
      : (selected.classList.length ? `.${[...selected.classList].slice(0, 2).join(".")}` : "");
    const up = selected.parentElement;
    parent.hidden = !up || up === selected.ownerDocument.body || up === selected.ownerDocument.documentElement;
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
      begin: (control, property) => styleEdits.begin(control, inlineStyleSnapshot(element, property)),
      apply: preview,
      commit,
      cancel(control, property) {
        styleEdits.cancel(control, element, property);
        track(element, property);
        updateActions();
      },
      rerender: renderControls,
      reserved: options.reservedKey,
    } satisfies PanelContext);
    if (retainedProps) controls.prepend(retainedProps);
    // Any design-system adapter needs the token and props controls, not only registered elements.
    if (options.design?.tokens || options.design?.themes || options.design?.components || element.closest("[data-komo-inspectable], [data-komo-design-tokens]")) {
      reactPanelPromise ??= import("./react-props-panel.js").then((module) => reactPanelModule = module).catch((error: unknown) => {
        reactPanelPromise = null;
        throw error;
      });
      void reactPanelPromise.then((module) => {
        if (!active || selected !== element) return;
        module.attachDesignSystemControls(element, controls, panelControls, options, {
          signal: listeners.signal,
          select, refresh: renderControls, retainedProps, updateActions,
          history,
          isFieldDirty: styleEdits.isDirty,
          syncStyles() { for (const property of originals.get(element)?.keys() ?? []) track(element, property); },
          onStyleEdit(field, input, before) {
            remember(element, field.property, before);
            track(element, field.property);
            styleEdits.begin(input, { value: before, priority: element.style.getPropertyPriority(field.property) });
            commit(input, field.property);
          },
        });
      }).catch(() => {});
    }
  }
  /** With nothing selected, the inspector drops its footer and the sidebar fits the empty state. */
  function syncEmpty() {
    panel.toggleAttribute("data-empty", (comment.hidden = !selected));
    panel.parentElement?.toggleAttribute("data-design-empty", active && !selected);
    views?.update(!!selected);
  }
  function hasChanges(element: DesignTarget) {
    return !!(changed.get(element)?.size || (isHTMLElement(element) && textTools?.hasChanges(element)) || reactPanelModule?.hasReactPropChanges(element) || reactPanelModule?.hasDesignTokenEdit(element));
  }
  function clearSelection() {
    finishTextEdit();
    resized?.disconnect();
    selected = null;
    hovered = null;
    outline.hidden = prospective.hidden = true;
    renderControls();
    updateActions();
  }
  /** Draw the outline; only a newly picked or hovered target (`retarget`) may move the panel. */
  function outlineFor(element: DesignTarget | null, kind: "hover" | "selected", retarget = false, marker = outline) {
    if (!active || !decorating || !element?.isConnected) {
      marker.hidden = true;
      return;
    }
    const rect = screenRect(element);
    if (!rect.width || !rect.height) {
      marker.hidden = true;
      return;
    }
    marker.dataset.kind = kind;
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
    marker.hidden = !drawHighlight(marker, rect, element, options.bounds?.(element));
  }
  // The pending card's hovered row outlines its element like a selection.
  let peek: DesignTarget | null = null;
  function renderOutlines(retarget = false) {
    geometry?.render();
    outlineFor(selected ?? hovered ?? peek, selected || !hovered ? "selected" : "hover", retarget);
    outlineFor(selected && hovered !== selected ? hovered : null, "hover", false, prospective);
  }
  function scheduleOutline() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (selected && (selectionPage !== page() || (!selected.isConnected && !retainSelection()))) clearSelection();
      if (hovered && !hovered.isConnected) hovered = null;
      renderOutlines();
    });
  }
  function retainSelection(): boolean {
    const previous = selected;
    if (!previous || selectionPage !== page()) return false;
    const retained = reactPanelModule?.retainReactPropSelection(previous, controls, options, history, textTools, (next, panel) => {
      selected = next;
      hovered = next;
      resized?.disconnect();
      resized?.observe(next);
      if (!hasChanges(previous)) previewTargets.delete(previous);
      previewTargets.set(next, selectionPage);
      renderControls(panel);
    });
    if (!retained) return false;
    updateActions();
    return true;
  }
  // Style edits resize the selection; the outline follows it.
  const resized = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleOutline) : null;
  function select(element: Element | null) {
    if (!isDesignTarget(element) || !element.isConnected || options.host.contains(element)) return;
    views?.settle();
    if (textTools?.element && textTools.element !== element) finishTextEdit();
    resized?.disconnect();
    resized?.observe(element);
    selected = element;
    hovered = element;
    selectionPage = page();
    previewTargets.set(element, selectionPage);
    renderControls();
    renderOutlines(true);
    updateActions();
  }
  const compact = () => media("(max-width:520px)");
  function setFolded(value: boolean) {
    panel.toggleAttribute("data-folded", value && compact());
    fold.setAttribute("aria-expanded", String(!panel.hasAttribute("data-folded")));
    fold.setAttribute("aria-label", panel.hasAttribute("data-folded") ? "Expand inspector" : "Collapse inspector");
  }
  /** On compact screens the inspector is a bottom sheet; keep the selection above it. */
  function reveal(element: DesignTarget) {
    setFolded(false);
    if (!compact()) return;
    requestAnimationFrame(() => {
      const rect = screenRect(element);
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
    undo.disabled = !views?.parked && !history.length && !reactPanelModule?.canUndoReactProp(selected) && !reactPanelModule?.canUndoDesignTokenEdit(selected);
    redo.disabled = !future.length;
    reset.disabled = !syncBar();
    copy.disabled = !selected || !(changed.get(selected)?.size);
    comment.disabled = !selected;
    // Nested markup is never editable; the editor checks privacy and interactivity on use.
    editText.disabled = !!textTools?.busy || !selected?.isConnected || !(isHTMLElement(selected));
    editText.textContent = textTools?.isEditing(isHTMLElement(selected) ? selected : null) ? "Done editing" : "Edit text";
    editText.setAttribute("aria-label", textTools?.isEditing(isHTMLElement(selected) ? selected : null) ? "Finish inline text editing" : "Edit selected text inline");
    // Resizes, Undo, Reset and Before/After change declarations behind the fields; show them.
    if (selected && !fieldsSettling) panelModule?.syncFields(controls, styleEdits.isDirty);
    syncEmpty();
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
        selected: () => isHTMLElement(selected) ? selected : null,
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
    if (!active) return;
    if (event.composedPath().includes(options.host)) {
      hovered = null;
      renderOutlines();
      return;
    }
    const point = clientPoint(event);
    const element = pickDesignTarget(options.targetAt(point.x, point.y), event.metaKey || event.ctrlKey);
    hovered = element && !options.host.contains(element) ? element : null;
    if (hovered) decorating = true;
    renderOutlines(!selected);
  }
  function onDown(event: PointerEvent) {
    if (!active || event.button !== 0) return;
    const path = event.composedPath();
    // The backdrop around Frame's viewport is canvas too.
    if (path.includes(options.host)) return void (isHTMLElement(path[0]) && path[0].matches(".frame-stage") && clearSelection());
    const point = clientPoint(event);
    const element = pickDesignTarget(options.targetAt(point.x, point.y), event.metaKey || event.ctrlKey);
    // Empty canvas deselects, Figma-style.
    if (!element || element === element.ownerDocument.body || element === element.ownerDocument.documentElement) {
      if (!textTools?.element) clearSelection();
      return;
    }
    if (options.host.contains(element)) return;
    decorating = true;
    if (textTools?.element && (element === textTools.element || textTools.element.contains(element))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    choose(element);
  }
  function choose(element: DesignTarget) {
    if (textTools?.element) finishTextEdit();
    select(element);
    const focused = options.root.activeElement ?? document.activeElement;
    if (isHTMLElement(focused)) focused.blur();
    refocus?.(false);
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
  let keyboard: ((event: KeyboardEvent) => boolean) | undefined;
  function onKey(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if (textTools?.handleKey(event)) {
      editText.focus({ preventScroll: true });
      return;
    }
    if (active && keyboard?.(event)) return;
    if (event.composedPath().includes(options.host)) escape(event);
  }
  function escape(event: KeyboardEvent) {
    if (!active || event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
    if (event.defaultPrevented && !event.composedPath().includes(options.host)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // One press leaves; the selection comes back on the next entry, as do pending previews.
    resume = selected && [selected, page()];
    clearSelection();
    setActive(false);
    options.onExit();
  }
  function setActive(value: boolean) {
    if (!value) {
      cancelPreview();
      textTools?.finish();
      if (active) {
        suspendedBefore = showingBefore;
        showBefore(true, false);
      }
      reactPanelModule?.restoreThemes(panel);
    }
    if (value && !active && suspendedBefore !== undefined) {
      const before = suspendedBefore;
      suspendedBefore = undefined;
      showBefore(before, false);
    }
    if (value && selected && (selectionPage !== page() || (!selected.isConnected && !retainSelection()))) clearSelection();
    if (value && !active && !selected && resume?.[0].isConnected && resume[1] === page()) select(resume[0]);
    if (value) resume = null;
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
      renderControls();
      setFolded(!selected);
      renderOutlines();
      close.focus({ preventScroll: true });
    } else {
      hovered = null;
      outline.hidden = prospective.hidden = true;
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
    clearSelection();
    setActive(false);
    options.onExit();
  });
  function resetAll() {
    cancelPreview();
    showBefore(false, false);
    reactPanelModule?.resetPreviews();
    for (const [element, properties] of originals) {
      changePreviewStyles(element, properties.keys(), () => {
        for (const [property, original] of properties) restore(element, property, original);
      }, false, styleless.has(element));
      styleless.delete(element);
    }
    originals.clear();
    changed.clear();
    history.length = future.length = 0;
    textTools?.restoreAll();
    views?.tokens?.reset();
    previewTargets.clear();
    updateActions();
  }
  function cancelPreview() {
    geometry?.cancel();
    options.root.dispatchEvent(new Event("komo-preview-cancel"));
  }
  /** Style rows to propose or copy; a structural move's hidden original is not a `display` change. */
  function styles(element: DesignTarget) {
    const values = changed.get(element);
    return values && geometry?.moved(element) ? new Map([...values].filter(([property]) => property !== "display")) : values;
  }
  function proposalFor(element: DesignTarget, create: typeof import("./design-export.js")["designProposal"]) {
    return create(element, styles(element), property => originals.get(element)?.get(property)?.computed,
      reactPanelModule?.tokenBoundProperties(element),
      [(isHTMLElement(element) ? textTools?.proposal(element) : undefined), reactPanelModule?.proposedDesignChanges(element), geometry?.proposal(element)],
      reactPanelModule?.designContext(element, options.design));
  }
  undo.addEventListener("click", () => {
    // Undo after Discard all brings the whole set back; Redo discards it again.
    if (views?.restore()) {
      future.push([{ kind: "discard" }, () => views?.discard()]);
      return updateActions();
    }
    const edit = history.pop();
    if (!edit) {
      if (selected) {
        reactPanelModule?.undoDesignTokenEdit(selected);
        reactPanelModule?.undoReactProp(selected);
        renderControls();
      }
      status.textContent = previewMessage;
    } else if (!edit.kind) {
      // Props redo through their own stack; other entries without redo get their inline style back.
      const style = edit.element.getAttribute("style");
      edit.undo();
      future.push([edit, edit.redo ?? (edit.props ? () => reactPanelModule?.redoReactProp(edit.element)
        : () => style === null ? edit.element.removeAttribute("style") : edit.element.setAttribute("style", style))]);
      renderControls();
    } else if (edit.kind === "text") {
      if (selected === (textTools?.undo() ?? edit.element)) renderControls();
      future.push([edit, () => textTools?.redo()]);
    } else if (edit.kind === "token") {
      views?.tokens?.undo();
      future.push([edit, () => views?.tokens?.redo()]);
    } else {
      future.push([edit, () => {
        restoreStyle(edit.element, edit.property, edit.after);
        reactPanelModule?.syncDesignTokenBinding(edit.element, edit.property);
        track(edit.element, edit.property);
      }]);
      restore(edit.element, edit.property, edit.before);
      edit.before.bindingUndo?.();
      reactPanelModule?.syncDesignTokenBinding(edit.element, edit.property);
      track(edit.element, edit.property);
      if (selected === edit.element) renderControls();
      renderOutlines();
    }
    updateActions();
    options.root.dispatchEvent(new CustomEvent("komo-announce", { detail: "Undone" }));
    // A redrawn field gets its focus back (refocus); a control still shown keeps it. Otherwise focus
    // goes to Undo, or to the selection once nothing is left to undo, never to Exit.
    const now = options.root.activeElement;
    if (!refocus && (!now || now === undo || !now.getClientRects().length)) undo.disabled ? focusSelection() : undo.focus({ preventScroll: true });
  });
  redo.addEventListener("click", () => {
    const next = future.pop();
    if (!next) return;
    redoing = true;
    // Back in history first, so a move's stand-in counts it as live; token steps return through the Tokens view's own sync.
    if (next[0].kind !== "token" && next[0].kind !== "discard") history.push(next[0]);
    next[1]();
    redoing = false;
    renderControls();
    renderOutlines();
    updateActions();
    options.root.dispatchEvent(new CustomEvent("komo-announce", { detail: "Redone" }));
    // As for Undo: a redrawn field gets its focus back, a control still shown keeps it; otherwise
    // Redo, or the selection once nothing is left to redo, never Exit.
    const now = options.root.activeElement;
    if (!refocus && (!now || now === redo || !now.getClientRects().length)) redo.disabled ? focusSelection() : redo.focus({ preventScroll: true });
  });
  function resetElement(element: DesignTarget) {
    if (textTools?.isEditing(isHTMLElement(element) ? element : null)) finishTextEdit(true);
    const values = changed.get(element);
    const hasTextValue = (isHTMLElement(element) && textTools?.hasChanges(element)) ?? false;
    const hasReactValues = reactPanelModule?.hasReactPropChanges(element) ?? false;
    const hasTokenValues = reactPanelModule?.hasDesignTokenEdit(element) ?? false;
    if (!values?.size && !hasTextValue && !hasReactValues && !hasTokenValues) return;
    if (hasTextValue && isHTMLElement(element)) textTools?.reset(element);
    if (hasTokenValues) reactPanelModule?.resetDesignTokenEdits(element);
    changePreviewStyles(element, values?.keys() ?? [], () => {
      for (const property of values?.keys() ?? []) restore(element, property, originals.get(element)?.get(property));
    }, false, styleless.has(element));
    changed.delete(element);
    originals.delete(element);
    styleless.delete(element);
    previewTargets.delete(element);
    if (hasReactValues) reactPanelModule?.resetReactProps(element);
    for (let index = history.length - 1; index >= 0; index--)
      if (history[index].element === element) history.splice(index, 1);
    future.length = 0;
  }
  reset.addEventListener("click", () => {
    if (!selected) return;
    resetElement(selected);
    renderControls();
    renderOutlines();
    updateActions();
    if (!refocus) focusSelection();
  });
  copy.addEventListener("click", () => {
    const element = selected;
    const values = element ? styles(element) : undefined;
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
    if (textTools?.isEditing(isHTMLElement(element) ? element : null)) finishTextEdit();
    void exporter().then(({ designProposal }) => {
      if (!active || selected !== element || !element.isConnected) return;
      // The comment carries everything the count shows, pending token edits included; both are then cleared.
      const proposal = [proposalFor(element, designProposal), views?.tokens?.proposal()].filter(Boolean).join("\n\n") || undefined;
      resetElement(element);
      views?.tokens?.reset();
      updateActions();
      options.onComment(element, proposal);
    }, () => { status.textContent = "Comment unavailable · try again"; });
  });
  // Editing anything, Undo, Reset or Comment first returns to After.
  const toAfter = () => showBefore(false);
  for (const node of [controls, actions, editText])
    for (const type of ["pointerdown", "focusin", "click", "input"]) node.addEventListener(type, toAfter, true);
  // Moves, Undo and applied tokens announce in komo's one polite live region (index.ts).
  options.root.addEventListener("komo-announce", event => {
    const live = options.root.querySelector(".sr-only[aria-live]");
    if (live) live.textContent = (event as CustomEvent<string>).detail;
  }, { signal: listeners.signal });
  document.addEventListener("pointermove", onMove, { capture: true, signal: listeners.signal });
  document.addEventListener("pointerdown", onDown, { capture: true, signal: listeners.signal });
  document.addEventListener("click", onClick, { capture: true, signal: listeners.signal });
  document.addEventListener("keydown", onKey, { capture: true, signal: listeners.signal });
  window.addEventListener("keydown", escape, { signal: listeners.signal });
  window.addEventListener("scroll", scheduleOutline, { capture: true, passive: true, signal: listeners.signal });
  window.addEventListener("resize", scheduleOutline, { passive: true, signal: listeners.signal });
  // Frame's viewport iframe gets its own events: picking, keys and scrolling inside it.
  for (const [type, listener, window] of [["pointermove", onMove], ["pointerdown", onDown], ["click", onClick], ["keydown", onKey], ["keydown", escape, 1], ["scroll", scheduleOutline, 1], ["resize", scheduleOutline, 1]] as const)
    onFrame(type, listener, { capture: type !== "resize" && !(window && type === "keydown"), passive: type === "scroll" || type === "resize", signal: listeners.signal }, window ? "window" : "document");
  watchHighlight(options.host, () => active ? [selected ?? hovered, hovered] : [], scheduleOutline, listeners.signal, () => { if (!retainSelection()) clearSelection(); });
  const selectionReady = exporter().then(module => {
    if (listeners.signal.aborted) return;
    keepFocus = module.keepFocus;
    const show = (element: DesignTarget) => { decorating = true; select(element); reveal(element); };
    keyboard = module.designKeyboard({
      host: options.host, compare, reserved: options.reservedKey, root: options.root, undo, redo, keys: options.keys, signal: listeners.signal,
      selected: () => selectionPage === page() ? selected : null,
      comment() {
        if (!selected || comment.disabled) return false;
        comment.click();
        return true;
      },
      select: show,
      compareBefore(before) { showBefore(before ?? !showingBefore); },
      help: options.shortcutHelp,
    });
    module.watchDesignStatus(status, bar, () => !!textTools?.element, listeners.signal);
    views = module.selectionViews({
      help: options.shortcutHelp,
      select: show,
      peek(element) { peek = element; decorating = true; renderOutlines(); },
      // Discard all and its Undo flip Before; older undone steps can't be redone on top.
      before(on) { future.length = 0; showBefore(on); },
      reset: resetAll,
      items: () => [...previewTargets].filter(([element]) => hasChanges(element)).map(([element, at]) => ({
        element, here: at === page() && element.isConnected, count: changeCount(element), proposal: proposalFor(element, module.designProposal),
      })),
      message: text => { status.textContent = text; },
      mode: options, signal: listeners.signal,
      history, update: updateActions, clear: clearSelection,
    });
    bar.before(views.chip);
    style.textContent += views.styles;
    undo.innerHTML = views.icons.undo;
    redo.innerHTML = views.icons.redo;
    reset.innerHTML = views.icons.reset;
    pendingSlot.append(views.pending);
    if (active) renderControls();
    else syncEmpty();
  }, () => { status.textContent = "Selection tools unavailable · try again"; });

  return {
    setActive,
    select,
    clearSelection,
    setReturnAction(action: { label: string; run(): void } | null) {
      returnAction = action;
      back.hidden = !action;
      if (action) {
        back.setAttribute("aria-label", action.label);
        back.title = action.label;
      }
    },
    mountPanel(parent: HTMLElement) {
      if (panel.parentElement !== parent) {
        panel.parentElement?.removeAttribute("data-design-empty");
        parent.append(panel);
        syncEmpty();
      }
    },
    get active() { return active; },
    get selected() { return selected; },
    /** Resolves once the property controls and selection keys have loaded; the panel then carries data-ready. */
    ready: Promise.all([ready, selectionReady]).then(() => { panel.dataset.ready = ""; }),
    destroy() {
      textTools?.finish(true);
      setActive(false);
      resetAll();
      clearTimeout(closeTimer);
      clearTimeout(flipTimer);
      clearTimeout(fieldsSettling);
      resized?.disconnect();
      listeners.abort();
      cancelAnimationFrame(frame);
      panel.remove();
      outline.remove();
      prospective.remove();
      style.remove();
    },
  };
}
