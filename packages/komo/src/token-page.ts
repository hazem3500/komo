// Design mode's Tokens view: every token from the adapter's list(), edited
// page-wide with nothing selected. Values preview through the adapter's
// previewValues(); the edits become one page comment. Loaded on demand from the
// empty Design panel. It imports only chunks Design mode already loads, so the
// shared bundles keep their shape. Comments stay out of the CSS: they would ship.
import type { DesignEditChange, DesignSystem, DesignToken, TokenAdapter, TokenValueChange } from "./design-system.js";
import { textEntry } from "./dom.js";

/** What the Tokens view needs from Design mode. */
export interface TokenPageHost {
  root: ShadowRoot;
  design?: DesignSystem;
  onComment(element: Element, proposal?: string): void;
  /** Design mode's side of pending token edits; the returned callback runs after every change. */
  link?(tokens: PageTokens): () => void;
}

/**
 * Pending token edits as the element view sees them: they count in its footer,
 * share its chronological Undo through `steps`, and join Reset all and Comment.
 */
export interface PageTokens {
  readonly size: number;
  readonly steps: readonly object[];
  undo(): void;
  reset(): void;
  proposal(): string | undefined;
  open(): void;
}

/** One net token edit: the page's value (`from`), the proposed one (`to`) and what previews it. */
export interface TokenEdit extends TokenValueChange {
  from: string;
  to: string;
}

const keyOf = (path: string, theme?: string) => `${theme ?? ""} ${path}`;
const line = (value: string) => value.replace(/→/g, "->").replace(/\s+/g, " ").trim() || "(unset)";

/** The theme key edits apply to: the current option of each switchable axis, joined with "+". */
export function themeKey(design?: DesignSystem): string | undefined {
  const ids: string[] = [];
  for (const axis of Array.isArray(design?.themes) ? design.themes : []) {
    if (!Array.isArray(axis?.options) || axis.options.length < 2) continue;
    try { ids.push(String(axis.current())); } catch { /* An axis that throws is left out. */ }
  }
  return ids.length ? ids.join("+") : undefined;
}

/**
 * Token edits with chronological undo. `before()` reports Before; while it is on,
 * or with no edits, the adapter's preview is cleaned up. Every change, and a new
 * `theme()` key, runs the previous cleanup, then previews the full set again.
 */
export function tokenEdits(adapter: TokenAdapter, options: { before?(): boolean; theme?(): string | undefined } = {}) {
  const before = () => !!options.before?.();
  const edits = new Map<string, TokenEdit>();
  const steps: Array<{ key: string; edit?: TokenEdit }> = [];
  let cleanup: (() => void) | undefined;
  let applied = "";
  const run = (list: TokenEdit[]) => {
    const changes = list.map(({ path, value, theme, alias }): TokenValueChange => ({ path, value, ...(theme ? { theme } : {}), ...(alias ? { alias } : {}) }));
    const theme = options.theme?.();
    const key = changes.length ? JSON.stringify([theme, changes]) : "";
    if (key === applied) return;
    const undo = cleanup;
    cleanup = undefined;
    applied = key;
    try { undo?.(); } catch { /* The page keeps whatever the adapter restored. */ }
    if (changes.length && adapter.previewValues)
      try { cleanup = adapter.previewValues(changes, theme); } catch { /* An adapter that throws previews nothing. */ }
  };
  const sync = () => run(before() ? [] : [...edits.values()]);
  const others = (key: string) => [...edits].filter(([item]) => item !== key).map(([, edit]) => edit);
  return {
    get size() { return edits.size; },
    get canUndo() { return steps.length > 0; },
    /** One object per undo step, oldest first, so Design mode can interleave them with its own. */
    get steps(): readonly object[] { return steps; },
    list: () => [...edits.values()],
    get: (path: string, theme?: string) => edits.get(keyOf(path, theme)),
    /** Record an edit as one undo step; an edit back to the page's value removes it. */
    set(edit: TokenEdit): boolean {
      const key = keyOf(edit.path, edit.theme);
      const previous = edits.get(key);
      if ((previous?.to ?? edit.from) === edit.to) return false;
      steps.push({ key, edit: previous });
      if (edit.to === edit.from) edits.delete(key);
      else edits.set(key, edit);
      sync();
      return true;
    },
    /** A transient preview, e.g. while a picker row is active; the undo shows the recorded edits again. */
    preview(edit: TokenEdit): () => void {
      run(before() ? [] : [...others(keyOf(edit.path, edit.theme)), ...(edit.to === edit.from ? [] : [edit])]);
      return sync;
    },
    undo() {
      const step = steps.pop();
      if (!step) return;
      if (step.edit) edits.set(step.key, step.edit);
      else edits.delete(step.key);
      sync();
    },
    /** Return one token to the page's value; like Reset, it leaves no undo step. */
    reset(path: string, theme?: string) {
      const key = keyOf(path, theme);
      edits.delete(key);
      for (let index = steps.length; index--;) if (steps[index].key === key) steps.splice(index, 1);
      sync();
    },
    resetAll() {
      edits.clear();
      steps.length = 0;
      sync();
    },
    sync,
    /** Clean up the preview for good, e.g. when Design mode is destroyed. */
    stop() {
      edits.clear();
      steps.length = 0;
      run([]);
    },
  };
}

/** The comment section: `Token: color.text.primary (dark) #e6e6e6 → #f5f5f5`, one line per edit. */
export function tokenProposal(edits: readonly TokenEdit[], adapter: string): string | undefined {
  if (!edits.length) return undefined;
  return [
    "Proposed token changes (preview only)",
    ...edits.map((edit) => `Token: ${edit.path}${edit.theme ? ` (${edit.theme})` : ""} ${line(edit.from)} → ${line(edit.to)}`),
    `Token adapter: ${adapter}`,
  ].join("\n");
}

/** Hook for structured proposals: each edit as a `DesignEdit` change. */
export function tokenValueChanges(edits: readonly TokenEdit[]): DesignEditChange[] {
  return edits.map(({ path, theme, from, to }) => ({ kind: "token-value", path, ...(theme ? { theme } : {}), from, to }));
}

const typeProperty: Partial<Record<DesignToken["type"], string>> = {
  color: "color",
  dimension: "width",
  fontFamily: "font-family",
  fontWeight: "font-weight",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
  shadow: "box-shadow",
  typography: "font",
  duration: "transition-duration",
};
/** The CSS property the editor validates against; custom properties accept anything. */
const propertyOf = (token: DesignToken) => token.properties?.[0] ?? typeProperty[token.type] ?? "--token";

const css = `.design-inspector[data-tokens] .design-inspector__identity{visibility:visible}.design-inspector[data-tokens] .design-inspector__controls{display:flex;flex-direction:column;place-items:stretch;overflow:hidden}.design-inspector[data-tokens] .design-inspector__parent{display:none}.design-inspector[data-tokens]>.design-inspector__bar:not(.design-token-bar),.design-inspector[data-tokens] .design-inspector__pending,.design-inspector:not([data-tokens])>.design-token-bar{display:none}.design-token-page{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;height:min(520px,calc(100dvh - 190px))}:host([data-sidebar=background]) .design-token-page{height:auto}.design-token-page>.komo-tokens__bar{flex:none;padding:0 12px 8px;background:none;border:0}.design-token-page>p{margin:0 12px 8px;color:#e7c27d;font-size:11px}.design-token-page>p[hidden]{display:none}.design-token-page__list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:0 8px 8px}.design-token-page__list small{position:sticky;top:0;z-index:1;display:block;padding:8px 8px 4px;background:#0d0d0d;color:#77736f;font-size:10px;font-weight:500}.design-token-page__list>p{margin:0;padding:12px 8px;color:#77736f}.design-token-row{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 24px;align-items:center;gap:2px;border-radius:7px}.design-token-row:hover{background:#ffffff0a}.design-token-row>button{border:0;background:none;color:inherit;font:inherit}.design-token-row>button:first-child{display:grid;grid-template-columns:20px minmax(0,1fr) auto;align-items:center;gap:8px;min-width:0;min-height:32px;padding:6px 8px;border-radius:7px;color:#d9d6d1;text-align:left}.design-token-row b{overflow:hidden;font-weight:500;text-overflow:ellipsis;white-space:nowrap}.design-token-row i{max-width:110px;overflow:hidden;color:#77736f;font-style:normal;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}.design-token-row[data-changed] b{color:#e6dcfb}.design-token-row[data-changed]::before{content:'';position:absolute;top:calc(50% - 2px);left:-2px;width:4px;height:4px;border-radius:50%;background:#bda6ef}.design-token-row>button+button{display:grid;place-items:center;width:24px;height:24px;padding:0;border-radius:5px;color:#77736f}.design-token-row>button+button:disabled{visibility:hidden}.design-token-row>button+button:hover{background:#ffffff14;color:#f1efeb}.design-token-row svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}.design-token-row .komo-tokens{font-size:11px}@media (pointer:coarse){.design-token-row>button:first-child{min-height:44px}.design-token-row>button+button{width:32px;height:32px}}`;
const glyph = (path: string) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
const resetIcon = glyph("M2.5 2.5v3h3M3 5.5a5.5 5.5 0 1 1-.5 2.5");
const undoIcon = glyph("M5.5 3.5 2.5 6.5l3 3m-3-3h7a4 4 0 0 1 0 8h-2");

type Modules = [typeof import("./token-picker.js"), typeof import("./react-props-panel.js"), typeof import("./design-export.js")];
const pages = new WeakMap<HTMLElement, { open(): void }>();

/** Open the Tokens view in the empty inspector `panel`; edits persist while Design mode lives. */
export async function openTokenPage(panel: HTMLElement, host: TokenPageHost): Promise<void> {
  const modules: Modules = await Promise.all([import("./token-picker.js"), import("./react-props-panel.js"), import("./design-export.js")]);
  let page = pages.get(panel);
  if (!page) pages.set(panel, (page = createPage(panel, host, modules)));
  page.open();
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createPage(panel: HTMLElement, host: TokenPageHost, [picker, props, exporter]: Modules) {
  const adapter = host.design?.tokens ?? props.cssVariableTokens();
  const live = typeof adapter.previewValues === "function";
  const isBefore = () => panel.hasAttribute("data-before");
  const edits = tokenEdits(adapter, { before: isBefore, theme: () => themeKey(host.design) });
  const style = make("style");
  style.textContent = css;
  host.root.append(style);
  picker.stylePicker(panel);

  const view = make("section", "design-token-page");
  view.setAttribute("aria-label", "Tokens");
  const note = make("p", "", "No live preview · edits are recorded as proposals");
  note.hidden = live;
  const searchBar = make("div", "komo-tokens__bar");
  const search = make("input");
  search.type = "search";
  search.placeholder = "Search tokens";
  search.autocomplete = "off";
  search.spellcheck = false;
  search.setAttribute("aria-label", "Search tokens");
  searchBar.append(search);
  const list = make("div", "design-token-page__list");
  view.append(note, searchBar, list);

  // The footer is Design mode's bar: change count, Before/After, Undo, Reset all and Comment.
  const bar = make("div", "design-inspector__bar design-token-bar");
  const count = make("span", "design-inspector__count");
  const compare = make("div", "design-inspector__compare");
  compare.setAttribute("role", "group");
  compare.setAttribute("aria-label", "Compare with the page");
  const sides = ["Before", "After"].map((label, index) => {
    const button = make("button", "", label);
    button.type = "button";
    button.dataset.tip = `${label} · ${index ? "→" : "←"} or B`;
    button.addEventListener("click", () => show(!index));
    compare.append(button);
    return button;
  });
  const status = make("p", "design-inspector__status");
  status.setAttribute("role", "status");
  const actions = make("div", "design-inspector__actions");
  const tool = (label: string, icon: string, run: () => void) => {
    const button = make("button", "design-inspector__tool");
    button.type = "button";
    button.dataset.tip = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon;
    button.addEventListener("click", () => {
      show(false);
      run();
      refresh();
    });
    return button;
  };
  const undo = tool("Undo", undoIcon, () => edits.undo());
  const reset = tool("Reset all", resetIcon, () => edits.resetAll());
  const comment = make("button", "", "Comment");
  comment.type = "button";
  const proposal = () => tokenProposal(edits.list(), adapter.id);
  const resetAll = () => { edits.resetAll(); refresh(); };
  comment.addEventListener("click", () => {
    const text = proposal();
    if (!text) return;
    resetAll();
    host.onComment(document.body, text);
  });
  actions.append(undo, reset, comment);
  bar.append(count, compare, status, actions);

  let tokens: DesignToken[] = [];
  let request = 0;
  let events: AbortController | undefined;
  const rows = new Map<string, () => void>();

  /** Before and After belong to Design mode, so element previews flip with the tokens. */
  function show(before: boolean) {
    if (before !== isBefore())
      panel.querySelectorAll<HTMLButtonElement>(".design-inspector__bar:not(.design-token-bar) .design-inspector__compare button")[before ? 0 : 1]?.click();
    edits.sync();
    syncBar();
  }
  function syncBar() {
    const total = edits.size;
    count.textContent = total ? `${total} change${total > 1 ? "s" : ""}` : "";
    bar.toggleAttribute("data-changes", total > 0 || edits.canUndo);
    undo.disabled = !edits.canUndo;
    reset.disabled = comment.disabled = !total;
    compare.hidden = !live || (!total && !isBefore());
    sides.forEach((button, index) => button.setAttribute("aria-pressed", String(!index === isBefore())));
    if (total) panel.dataset.tokenEdits = String(total);
    else delete panel.dataset.tokenEdits;
    changed?.();
  }
  function refresh() {
    for (const update of rows.values()) update();
    syncBar();
  }
  const labelOf = (path: string) => {
    const token = tokens.find((item) => item.path === path);
    return token ? picker.tokenLabel(token) : path;
  };

  function edit(token: DesignToken, trigger: HTMLElement) {
    const theme = themeKey(host.design);
    const current = edits.get(token.path, theme);
    const from = token.alias ? `{${token.alias}}` : token.value;
    const change = (value: string, alias?: string): TokenEdit => ({
      path: token.path, value, from, to: alias ? `{${alias}}` : value,
      ...(theme ? { theme } : {}), ...(alias ? { alias } : {}),
    });
    const commit = (next: TokenEdit) => { if (edits.set(next)) refresh(); };
    // Only an alias can be repointed; other tokens open straight in Custom.
    const targets = token.alias ? tokens.filter((other) => other.type === token.type && other.path !== token.path && other.alias !== token.path) : [];
    picker.openTokenPicker({
      trigger,
      tokens: targets,
      property: propertyOf(token),
      current: current ? current.alias : token.alias,
      onPreview: (target) => edits.preview(change(target.value, target.path)),
      onSelect: (target) => commit(change(target.value, target.path)),
      custom: {
        value: current?.value ?? token.value,
        onPreview: (value) => edits.preview(change(value)),
        onSelect: (value) => commit(change(value)),
      },
    }, true);
  }

  /** The latest listed token per path: rows keep their elements (and an open popup) when values change. */
  const latest = new Map<string, DesignToken>();
  function row(listed: DesignToken): HTMLElement {
    const current = () => latest.get(listed.path) ?? listed;
    const item = make("div", "design-token-row");
    const main = make("button");
    main.type = "button";
    main.setAttribute("aria-haspopup", "dialog");
    const name = make("b", "", picker.tokenLabel(listed));
    const value = make("i");
    const back = make("button");
    back.type = "button";
    back.title = "Reset to page value";
    back.setAttribute("aria-label", `Reset ${listed.path}`);
    back.innerHTML = resetIcon;
    item.append(main, back);
    const update = () => {
      const token = current();
      name.textContent = picker.tokenLabel(token);
      const edited = edits.get(token.path, themeKey(host.design));
      const alias = edited ? edited.alias : token.alias;
      const shown = edited?.value ?? token.value;
      value.textContent = alias ? labelOf(alias) : shown;
      main.replaceChildren(picker.tokenPreview({ ...token, value: shown }), name, value);
      main.title = [token.path, token.ref, alias ? `${alias} · ${shown}` : shown, token.description].filter(Boolean).join(" · ");
      main.setAttribute("aria-label", `${name.textContent}, ${value.textContent}${edited ? ", edited" : ""}`);
      item.toggleAttribute("data-changed", !!edited);
      back.disabled = !edited;
    };
    main.addEventListener("click", () => edit(current(), main));
    back.addEventListener("click", () => {
      show(false);
      edits.reset(listed.path, themeKey(host.design));
      refresh();
      main.focus({ preventScroll: true });
    });
    rows.set(listed.path, update);
    update();
    return item;
  }

  let shape = "";
  function render() {
    for (const token of tokens) latest.set(token.path, token);
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const groups = new Map<string, DesignToken[]>([["", []]]);
    for (const token of tokens) {
      const shown = edits.get(token.path, themeKey(host.design))?.to ?? token.value;
      const text = `${picker.tokenLabel(token)} ${token.path} ${token.ref ?? ""} ${shown}`.toLowerCase();
      if (!terms.every((term) => text.includes(term))) continue;
      const group = token.group ?? "";
      groups.set(group, [...groups.get(group) ?? [], token]);
    }
    // The same rows in the same order update in place, so a row's open popup stays open.
    const next = JSON.stringify([...groups].map(([group, members]) => [group, members.map((token) => token.path)]));
    if (next === shape && rows.size) return refresh();
    shape = next;
    rows.clear();
    list.replaceChildren();
    let index = 0;
    for (const [group, members] of groups) {
      if (!members.length) continue;
      let box: HTMLElement = list;
      if (group) {
        box = make("div");
        box.setAttribute("role", "group");
        const heading = make("small", "", group);
        heading.id = `design-token-group-${++index}`;
        box.setAttribute("aria-labelledby", heading.id);
        box.append(heading);
        list.append(box);
      }
      for (const token of members) box.append(row(token));
    }
    if (!rows.size) list.append(make("p", "", terms.length ? "No matching tokens" : "No tokens"));
    const subtitle = panel.querySelector(".design-inspector__identity small");
    if (subtitle) subtitle.textContent = `${tokens.length} token${tokens.length === 1 ? "" : "s"}`;
    syncBar();
  }

  async function load() {
    const at = ++request;
    let next: DesignToken[] = [];
    try { next = await props.listTokens(adapter, props.themeState(host.design)); } catch { status.textContent = "Tokens unavailable · try again"; }
    edits.sync();
    if (at !== request || !view.isConnected) return;
    tokens = next;
    render();
  }

  function close() {
    events?.abort();
    events = undefined;
    panel.removeAttribute("data-tokens");
    bar.remove();
  }

  // Design mode's Before/After, closing (which shows Before and hides the panel) and destroy
  // all land here. Closing also puts back a theme switched from this view's header.
  const life = new AbortController();
  new MutationObserver((_records, observer) => {
    if (panel.getAttribute("aria-hidden") === "true") props.restoreThemes(panel);
    if (panel.isConnected) {
      edits.sync();
      return syncBar();
    }
    observer.disconnect();
    life.abort();
    close();
    edits.stop();
    changed?.();
    style.remove();
    pages.delete(panel);
  }).observe(panel, { attributes: true, attributeFilter: ["data-before", "aria-hidden"] });
  // Adapters that cannot scope a value to its theme preview the current theme's edits.
  host.root.addEventListener("komo-theme-change", () => edits.sync(), { signal: life.signal });

  search.addEventListener("input", render);

  const page = {
    open() {
      const controls = panel.querySelector(".design-inspector__controls");
      if (!controls) return;
      if (!view.isConnected) {
        events = new AbortController();
        const { signal } = events;
        panel.toggleAttribute("data-tokens", true);
        controls.replaceChildren(view);
        panel.append(bar);
        const title = panel.querySelector(".design-inspector__target");
        if (title) title.textContent = "Tokens";
        // A render that replaces the view, such as picking an element, closes it; edits stay previewed.
        const watch = new MutationObserver(() => { if (!view.isConnected) close(); });
        watch.observe(controls, { childList: true });
        signal.addEventListener("abort", () => watch.disconnect(), { once: true });
        props.attachThemeSwitcher(view, host.design, () => void load(), host.root, signal);
        host.root.addEventListener("komo-theme-change", () => void load(), { signal });
        let tips = false;
        const loadTips = (event: Event) => {
          if (!tips) exporter.footerTips(bar, host.root, signal, event);
          tips = true;
        };
        bar.addEventListener("pointerover", loadTips, { signal });
        bar.addEventListener("focusin", loadTips, { signal });
        // ← Before, → After, B flips, as in Design mode. B pauses only in a text field; the
        // arrows also leave fields, sliders and radios their own.
        document.addEventListener("keydown", (event) => {
          const key = event.key.toLowerCase();
          const origin = event.composedPath()[0];
          if (compare.hidden || event.metaKey || event.ctrlKey || event.altKey || !["b", "arrowleft", "arrowright"].includes(key) ||
            textEntry(origin) || key !== "b" && (origin as Element).matches?.("input,select,[role=slider],[role=radio]")) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          show(key === "b" ? !isBefore() : key === "arrowleft");
        }, { capture: true, signal });
        render();
        void load();
      }
      if (!globalThis.matchMedia?.("(pointer:coarse)")?.matches) search.focus({ preventScroll: true });
    },
  };
  const changed = host.link?.({
    get size() { return edits.size; },
    get steps() { return edits.steps; },
    undo() { edits.undo(); refresh(); },
    reset: resetAll, proposal, open: page.open,
  });
  return page;
}

