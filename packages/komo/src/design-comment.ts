import { ownsKeyboard } from "./design-keyboard.js";
// Loaded on demand: renders Design mode proposals as a change card with a
// Before/After preview. The comment body stays plain text for agents and the CLI.
import { isDesignTarget } from "./design-target.js";
import { inlineStyleSnapshot, removeEmptyStyle } from "./design-preview.js";
import { previewText } from "./text-preview.js";
import { listTokens, originalTokenUsage, previewToken, refreshTokenBaseline, themeState, watchThemes } from "./token-adapter.js";
import type { DesignSystem, DesignToken, TokenAdapter } from "./design-system.js";

export interface DesignChange {
  label: string;
  before: string;
  after: string;
  /** Token path such as color.brand, when the change binds a design token. */
  token?: string;
  /** How to preview it on the page; absent when only the app can apply it. */
  apply?: { kind: "style" | "variable" | "text"; property: string };
}

export interface DesignSection {
  title: string;
  target?: string;
  component?: string;
  source?: string;
  changes: DesignChange[];
}

export type DesignBlock = { text: string } | DesignSection;

const HEADER = /^Proposed (.+?) changes? \(preview only\)$/;
const TITLES: Record<string, string> = {
  style: "Style changes",
  "inline text": "Text change",
  "design-token": "Token changes",
  "React prop": "Prop changes",
};

/** True when a comment body contains at least one Design mode proposal. */
export function isDesignComment(body: string): boolean {
  return body.split("\n").some((line) => HEADER.test(line));
}

function unquote(value: string): string {
  try {
    return value.startsWith('"') ? (JSON.parse(value) as string) : value;
  } catch {
    return value;
  }
}

function change(line: string, kind: string): DesignChange | null {
  // Shared theme color.brand (--color-brand): #4f5f42 → #c2410c; preview scope …
  let match = /^Shared theme (\S+) \((--[\w-]+)\): (.*?) → (.*?)(?:; preview scope .*)?$/.exec(line);
  if (match)
    return { label: match[1], token: match[1], before: match[3], after: match[4], apply: { kind: "variable", property: match[2] } };
  // Element color: rgb(…) → var(--color-brand) [color.brand]
  match = /^Element ([\w-]+): (.*?) → (.*?)(?: \[([^\]]+)\])*$/.exec(line);
  if (match) {
    const token = /\[([\w.-]+)\]/.exec(line.slice(line.indexOf("→")))?.[1];
    return { label: match[1], before: match[2], after: match[3], ...(token && !token.includes(" ") ? { token } : {}), apply: { kind: "style", property: match[1] } };
  }
  match = /^- (.+?): (.*) → (.*?)(?: \[([^\]]+)\])?$/.exec(line);
  if (!match) return null;
  const [, label, before, after, note] = match;
  if (kind === "inline text" && label === "white-space") return { label, before, after, apply: { kind: "style", property: label } };
  if (kind === "inline text") return { label: "Text", before: unquote(before), after: unquote(after), apply: { kind: "text", property: "text" } };
  if (kind === "React prop") return { label, before: unquote(before), after: unquote(after), ...(note && note !== "custom value" ? { token: note } : {}) };
  return { label, before, after, apply: { kind: "style", property: label } };
}

/** Split a comment body into plain notes and recognised proposal sections. */
export function parseDesignComment(body: string): DesignBlock[] {
  const blocks: DesignBlock[] = [];
  for (const chunk of body.split(/\n{2,}/)) {
    const lines = chunk.split("\n");
    const header = HEADER.exec(lines[0] ?? "");
    if (!header) {
      if (chunk.trim()) blocks.push({ text: chunk.trim() });
      continue;
    }
    const kind = header[1];
    const section: DesignSection = { title: TITLES[kind] ?? `${kind[0].toUpperCase()}${kind.slice(1)} changes`, changes: [] };
    for (const line of lines.slice(1)) {
      if (line.startsWith("Target: ")) section.target = line.slice(8);
      else if (line.startsWith("Component: ")) {
        // "Component: PromoCard (src/card.tsx:19)" names the source in parentheses.
        const [, name, source] = /^(.*?)(?: \((.+)\))?$/.exec(line.slice(11))!;
        section.component = name;
        if (source) section.source = source;
      } else if (line.startsWith("Source: ")) section.source = line.slice(8);
      else {
        const item = line.includes("→") ? change(line, kind) : null;
        // Previews can record a property that ended where it started.
        if (item && item.before !== item.after) section.changes.push(item);
      }
    }
    if (section.changes.length) blocks.push(section);
    else blocks.push({ text: chunk.trim() });
  }
  return blocks;
}

/** One-line summary for the sidebar, e.g. "Design change · 2 edits on h2". */
export function summarizeDesignComment(body: string): string {
  const blocks = parseDesignComment(body);
  const sections = blocks.filter((block): block is DesignSection => "changes" in block);
  const note = blocks.find((block): block is { text: string } => "text" in block)?.text;
  const count = sections.reduce((sum, section) => sum + section.changes.length, 0);
  const target = sections.find((section) => section.target)?.target;
  const summary = `Design change · ${count} ${count === 1 ? "edit" : "edits"}${target ? ` on ${shortTarget(target)}` : ""}`;
  return note ? `${note}\n${summary}` : summary;
}

/** The last step of a generated selector, without :nth-of-type noise. */
export function shortTarget(selector: string): string {
  return (selector.split(">").at(-1) ?? selector).trim().replace(/:nth-of-type\(\d+\)/g, "") || selector;
}

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\))$/i;

// Live previews, keyed by comment id, so a redrawn card shows the right state.
interface Applied {
  restore: Array<() => void>;
  /** Inline styles to hand back once a smooth revert has finished animating. */
  restoreStyles: Array<() => void>;
  /** Pin each changed style to its measured Before value, so reverting can animate. */
  pinBefore: Array<() => void>;
}
const applied = new Map<string, Applied>();
const lostPreviews = new Set<string>();
// Before/After switches that may still be on screen, newest last.
const visibleToggles = new Set<HTMLElement>();
const UNAVAILABLE = "Preview unavailable: the target or its text has changed.";

function loseTextPreview(key: string) {
  lostPreviews.add(key);
  revert(key);
  for (const toggle of visibleToggles) {
    if (toggle.dataset.previewKey !== key || !toggle.isConnected) continue;
    toggle.querySelectorAll("button").forEach((button, index) => {
      button.setAttribute("aria-pressed", String(index === 0));
      if (index === 1) button.disabled = true;
    });
    const status = toggle.closest(".design-comment")?.querySelector<HTMLElement>('[role="status"]');
    if (status) { status.textContent = UNAVAILABLE; status.hidden = false; }
  }
}
// Reverts that are still animating back, finished once their transition ends.
const settling = new Map<string, { timer: ReturnType<typeof setTimeout>; finish(): void }>();

function settle(key: string) {
  const pending = settling.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  settling.delete(key);
  pending.finish();
}

type DraftTokens = { adapter: TokenAdapter; tokens: readonly DesignToken[] };

function apply(key: string, sections: DesignSection[], resolve: (selector?: string) => Element | null, smooth = false, context?: DraftTokens) {
  if (lostPreviews.has(key)) return false;
  settle(key);
  const restore: Array<() => void> = [];
  const restoreStyles: Array<() => void> = [];
  const pinBefore: Array<() => void> = [];
  const styleless = new Set<Element>();
  let unavailable = false;
  for (const section of sections) {
    const element = resolve(section.target);
    for (const item of section.changes) {
      if (!item.apply || item.after === "(unset)") continue;
      if (item.apply.kind === "variable") {
        const root = document.documentElement;
        const previous = root.style.getPropertyValue(item.apply.property);
        root.style.setProperty(item.apply.property, item.after);
        restore.push(() => previous ? root.style.setProperty(item.apply!.property, previous) : root.style.removeProperty(item.apply!.property));
      } else if (isDesignTarget(element) && item.apply.kind === "style") {
        if (!element.hasAttribute("style")) styleless.add(element);
        const token = item.token && context?.tokens.find(token => token.path === item.token);
        if (token && context) {
          try { restore.push(previewToken(context.adapter, element, item.apply.property, token)); }
          catch { unavailable = true; }
          continue;
        }
        const previous = element.style.getPropertyValue(item.apply.property);
        const priority = element.style.getPropertyPriority(item.apply.property);
        const absent = !element.hasAttribute("style");
        const property = item.apply.property;
        const whitespace = property === "white-space" ? inlineStyleSnapshot(element, property) : undefined;
        const pin = () => {
          if (item.before === "(unset)") return false;
          element.style.setProperty(property, item.before, "important");
          return true;
        };
        // Browsers can't animate from keywords like auto, so start from the measured value.
        if (smooth && pin()) void getComputedStyle(element).getPropertyValue(property);
        element.style.setProperty(property, item.after, "important");
        pinBefore.push(pin);
        restoreStyles.push(() => {
          if (whitespace) { whitespace.restore(); return; }
          if (previous) element.style.setProperty(item.apply!.property, previous, priority);
          else element.style.removeProperty(item.apply!.property);
          if (absent) removeEmptyStyle(element);
        });
      } else if (item.apply.kind === "text") {
        const undo = element instanceof HTMLElement ? previewText(element, item.before, item.after, () => loseTextPreview(key)) : undefined;
        if (undo) restore.push(undo);
        else unavailable = true;
      } else if (item.apply.kind === "style") unavailable = true;
    }
  }
  if (styleless.size) restoreStyles.unshift(() => {
    for (const element of styleless) if (isDesignTarget(element)) removeEmptyStyle(element);
  });
  if (unavailable) {
    for (const undo of [...restore, ...restoreStyles].reverse()) undo();
    return false;
  }
  if (restore.length + restoreStyles.length) applied.set(key, { restore, restoreStyles, pinBefore });
  return restore.length + restoreStyles.length > 0;
}

// Properties that animate when a theme token changes, since its users are unknown.
const TOKEN_PROPERTIES = ["color", "background-color", "border-color", "outline-color", "fill", "stroke", "box-shadow", "text-decoration-color"];
const EASE = "cubic-bezier(.22, 1, .36, 1)";
let morphing: { style: HTMLStyleElement; timer: ReturnType<typeof setTimeout> } | undefined;

/**
 * Morph the page between Before and After: for a moment, transition exactly
 * the properties this comment changes, so widths, spacing and colours ease to
 * their new values in place. Text can't interpolate, so it fades instead.
 */
function morph(sections: DesignSection[], resolve: (selector?: string) => Element | null) {
  const properties = new Set<string>();
  for (const section of sections)
    for (const item of section.changes) {
      if (item.apply?.kind === "style") properties.add(item.apply.property);
      else if (item.apply?.kind === "variable") TOKEN_PROPERTIES.forEach((property) => properties.add(property));
      else if (item.apply?.kind === "text") {
        const element = resolve(section.target);
        if (element instanceof HTMLElement)
          element.animate?.([{ opacity: 1 }, { opacity: 0.25, offset: 0.4 }, { opacity: 1 }], { duration: 360, easing: EASE });
      }
    }
  if (!properties.size) return;
  if (morphing) {
    clearTimeout(morphing.timer);
    morphing.style.remove();
  }
  const style = document.createElement("style");
  // Komo's own UI lives in a shadow root, so this only reaches the page.
  style.textContent = `*, *::before, *::after { transition-property: ${[...properties].join(", ")} !important; transition-duration: 420ms !important; transition-timing-function: ${EASE} !important; transition-delay: 0s !important; }`;
  document.head.append(style);
  // Leave the rule in place for the whole transition, then restore the page's own.
  morphing = { style, timer: setTimeout(() => { style.remove(); morphing = undefined; }, 480) };
}

function revert(key: string, smooth = false) {
  settle(key);
  const state = applied.get(key);
  if (!state) return;
  applied.delete(key);
  for (const undo of state.restore.reverse()) undo();
  const finish = () => { for (const undo of state.restoreStyles.reverse()) undo(); };
  if (!smooth || !state.pinBefore.length) return finish();
  // Animate back to the measured Before values, then hand the styles back to the page.
  for (const pin of state.pinBefore) pin();
  settling.set(key, { finish, timer: setTimeout(() => settle(key), 480) });
}

/** Whether a comment's After state is currently applied to the page. */
export function isPreviewing(key: string): boolean {
  return applied.has(key) || settling.has(key);
}

/** Undo every live preview except those whose cards are still on screen. */
export function resetDesignPreviews(keep: ReadonlySet<string> = new Set()) {
  if (!keep.has("draft")) {
    draftBody = undefined;
    draftRuntime?.events.abort();
    draftRuntime = undefined;
  }
  for (const key of [...settling.keys()]) if (!keep.has(key)) settle(key);
  for (const key of [...applied.keys()]) if (!keep.has(key)) revert(key);
  for (const key of lostPreviews) if (!keep.has(key)) lostPreviews.delete(key);
}

const css = `
.design-comment { display: grid; gap: 8px; margin: 2px 0 6px; }
.design-note { margin: 0; white-space: pre-wrap; }
.design-card { border-radius: 10px; background: #ffffff08; box-shadow: inset 0 0 0 1px #ffffff0d; overflow: hidden; font-size: 12px; }
.design-card-head { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 7px 8px 7px 12px; }
.design-card-label { display: grid; min-width: 0; gap: 1px; }
.design-card-title { font-weight: 600; color: #eee; white-space: nowrap; }
.design-card-target { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #8a8a8a; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; }
.design-toggle { margin-left: auto; display: inline-flex; padding: 2px; border-radius: 7px; background: #ffffff0a; flex: none; }
.design-toggle button { border: 0; padding: 0 8px; height: 22px; border-radius: 5px; font: inherit; font-size: 11px; color: #9a9a9a; background: none; cursor: pointer; }
.design-toggle button[aria-pressed="true"] { color: #fff; background: #ffffff1a; }
.design-toggle button:disabled { opacity: .45; cursor: not-allowed; }
.design-rows { display: grid; border-top: 1px solid #ffffff0a; }
.design-row { display: grid; grid-template-columns: minmax(64px, 30%) minmax(0, 1fr); gap: 10px; align-items: center; padding: 6px 12px; }
.design-row + .design-row { border-top: 1px solid #ffffff06; }
.design-row[hidden] { display: none; }
.design-row-prose { grid-template-columns: 1fr; gap: 3px; }
.design-diff { margin: 0; line-height: 1.5; color: #ddd; overflow-wrap: anywhere; }
.design-diff del, .design-diff ins { border-radius: 3px; padding: 0 2px; }
.design-diff del { color: #f6a19a; background: #f28b8224; text-decoration-color: #f6a19a99; }
.design-diff ins { color: #b9e6ad; background: #8fd69424; text-decoration: none; }
.design-prop { color: #9a9a9a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.design-values { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; color: #eee; }
.design-before { color: #858585; text-decoration: line-through; text-decoration-color: #85858599; }
.design-arrow { color: #666; }
.design-value { display: inline-flex; align-items: center; gap: 5px; min-width: 0; overflow-wrap: anywhere; }
.design-swatch { width: 12px; height: 12px; flex: none; border-radius: 3px; box-shadow: inset 0 0 0 1px #ffffff26; }
.design-token { padding: 1px 6px; border-radius: 5px; color: var(--accent, #bda6ef); background: color-mix(in srgb, var(--accent, #bda6ef) 14%, transparent); }
.design-more { border: 0; width: 100%; padding: 7px 12px; text-align: left; font: inherit; font-size: 11px; color: #9a9a9a; background: none; border-top: 1px solid #ffffff06; cursor: pointer; }
.design-more:hover, .design-toggle button:hover { color: #fff; }
.design-source { padding: 0 12px 8px; color: #777; font-size: 11px; }
[data-compact] { gap: 6px; margin: 11px 0 0; }
[data-compact] .design-card-head, [data-compact] .design-row, [data-compact] > .design-source { min-height: 0; padding: 4px 10px; }
[data-compact]:hover > .design-source { color: #eee; text-decoration: underline; }
`;

/** Sentences read better as one line with the edit marked than as two columns. */
function isProse(item: DesignChange): boolean {
  if (item.apply?.kind === "text") return true;
  // CSS values like "22px 24px" stay in two columns; only prop strings read as prose.
  if (item.apply || item.token || COLOR.test(item.before) || COLOR.test(item.after)) return false;
  return /\s/.test(item.before + item.after) || item.before.length + item.after.length > 32;
}

/** The shared text once, with the removed part struck and the added part highlighted. */
function diff(before: string, after: string): HTMLElement {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  // Widen to whole words so "page" → "pages" reads as a word swap, not a stray "s".
  while (start > 0 && !/\s/.test(before[start - 1])) start--;
  while (end > 0 && !/\s/.test(before[before.length - end])) end--;
  const prefix = before.slice(0, start);
  const suffix = before.slice(before.length - end);
  const line = document.createElement("p");
  line.className = "design-diff";
  // Keep long unchanged context short around the edit.
  line.append(prefix.length > 48 ? `…${prefix.slice(-40)}` : prefix);
  const removed = before.slice(start, before.length - end);
  const added = after.slice(start, after.length - end);
  if (removed) line.append(Object.assign(document.createElement("del"), { textContent: removed }));
  if (added) line.append(Object.assign(document.createElement("ins"), { textContent: added }));
  line.append(suffix.length > 48 ? `${suffix.slice(0, 40)}…` : suffix);
  return line;
}

function value(text: string, token?: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "design-value";
  const variable = /^var\((--[\w-]+)\)$/.exec(text);
  if (token && variable) {
    wrap.append(Object.assign(document.createElement("span"), { className: "design-token", textContent: token }));
    return wrap;
  }
  if (COLOR.test(text)) {
    const swatch = document.createElement("span");
    swatch.className = "design-swatch";
    swatch.style.background = text;
    wrap.append(swatch);
  }
  wrap.append(text);
  return wrap;
}

export interface DesignCommentOptions {
  /** Stable id for this comment, used to keep its preview state across redraws. */
  key: string;
  /** Element the change applies to; falls back to the comment's anchor. */
  resolve(selector?: string): Element | null;
  /** Render plain notes with the widget's normal link handling. */
  note(element: HTMLElement, text: string): void;
  /** Read-only summary for hover cards: at most three rows, no Before/After switch. */
  compact?: boolean;
  /** Called once a Before/After switch has settled, e.g. to move a dialog off a resized element. */
  onSwitch?(): void;
  /** Current semantic values for an unsaved draft; saved comments keep their recorded values. */
  tokens?: DraftTokens;
}

/** Replace `container`'s content with a change card for each proposal. */
export function renderDesignComment(container: HTMLElement, body: string, options: DesignCommentOptions) {
  const blocks = parseDesignComment(body);
  const sections = blocks.filter((block): block is DesignSection => "changes" in block);
  const root = document.createElement("div");
  root.className = "design-comment";
  root.append(Object.assign(document.createElement("style"), { textContent: css }));
  const unavailable = document.createElement("p");
  unavailable.className = "design-source";
  unavailable.setAttribute("role", "status");
  unavailable.hidden = !lostPreviews.has(options.key);
  unavailable.textContent = UNAVAILABLE;
  const compact = !!options.compact;
  if (compact) root.dataset.compact = "";
  // Compact cards show the first three rows across all sections and count the rest.
  let room = compact ? 3 : Infinity;
  let extra = 0;
  const previewable = sections.some((section) => section.changes.some((item) => item.apply));
  const toggles: HTMLElement[] = [];
  const sync = () => {
    const on = applied.has(options.key);
    for (const toggle of toggles)
      toggle.querySelectorAll("button").forEach((button, index) => button.setAttribute("aria-pressed", String(index === 1 ? on : !on)));
  };

  for (const block of blocks) {
    if ("text" in block) {
      const note = document.createElement("p");
      note.className = "design-note";
      options.note(note, block.text);
      root.append(note);
      continue;
    }
    if (room <= 0) {
      extra += block.changes.length;
      continue;
    }
    const card = document.createElement("section");
    card.className = "design-card";
    const head = document.createElement("div");
    head.className = "design-card-head";
    const label = document.createElement("div");
    label.className = "design-card-label";
    label.append(Object.assign(document.createElement("span"), { className: "design-card-title", textContent: block.title }));
    const where = block.target ? shortTarget(block.target) : block.component;
    if (where) {
      const target = Object.assign(document.createElement("span"), { className: "design-card-target", textContent: where });
      if (block.target) target.title = block.target;
      label.append(target);
    }
    head.append(label);
    // One Before/After switch for the whole comment, shown on its first previewable card.
    if (previewable && !toggles.length && block.changes.some((item) => item.apply)) {
      const toggle = document.createElement("div");
      toggle.dataset.previewKey = options.key;
      toggle.className = "design-toggle";
      toggle.setAttribute("role", "group");
      toggle.setAttribute("aria-label", "Preview on page");
      for (const [index, label] of ["Before", "After"].entries()) {
        const button = Object.assign(document.createElement("button"), { type: "button", textContent: label, title: `${label} · ${index ? "→" : "←"} or B` });
        if (index === 1) button.disabled = lostPreviews.has(options.key);
        button.addEventListener("click", () => {
          const showAfter = index === 1;
          if (showAfter === applied.has(options.key)) return;
          const element = options.resolve(sections.find((section) => section.target)?.target);
          if (showAfter) element?.scrollIntoView({ block: "center", behavior: "smooth" });
          const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (!reduced) morph(sections, options.resolve);
          if (showAfter) {
            unavailable.hidden = apply(options.key, sections, options.resolve, !reduced, options.tokens);
            unavailable.textContent = UNAVAILABLE;
          }
          else revert(options.key, !reduced);
          if (options.onSwitch) setTimeout(options.onSwitch, reduced ? 0 : 480);
          sync();
        });
        toggle.append(button);
      }
      toggles.push(toggle);
      for (const item of visibleToggles) if (!item.isConnected) visibleToggles.delete(item);
      visibleToggles.add(toggle);
      head.append(toggle);
    }
    card.append(head);
    const rows = document.createElement("div");
    rows.className = "design-rows";
    const visible = 4;
    block.changes.forEach((item, index) => {
      if (room <= 0) return void extra++;
      if (compact) room--;
      const row = document.createElement("div");
      row.className = "design-row";
      row.hidden = !compact && index >= visible && block.changes.length > visible + 1;
      const label = Object.assign(document.createElement("span"), { className: "design-prop", textContent: item.label });
      label.title = item.label;
      if (isProse(item)) {
        row.classList.add("design-row-prose");
        row.append(label, diff(item.before, item.after));
        rows.append(row);
        return;
      }
      const values = document.createElement("span");
      values.className = "design-values";
      const before = value(item.before);
      before.classList.add("design-before");
      values.append(before, Object.assign(document.createElement("span"), { className: "design-arrow", textContent: "→" }), value(item.after, item.token));
      row.append(label, values);
      rows.append(row);
    });
    card.append(rows);
    const hidden = rows.querySelectorAll("[hidden]").length;
    if (hidden) {
      const more = Object.assign(document.createElement("button"), { type: "button", className: "design-more", textContent: `Show ${hidden} more` });
      more.addEventListener("click", () => {
        rows.querySelectorAll<HTMLElement>("[hidden]").forEach((row) => (row.hidden = false));
        more.remove();
      });
      card.append(more);
    }
    if (block.source && !compact) card.append(Object.assign(document.createElement("div"), { className: "design-source", textContent: block.source }));
    root.append(card);
  }
  if (extra) root.append(Object.assign(document.createElement("span"), { className: "design-source", textContent: `+${extra} more` }));
  root.append(unavailable);
  sync();
  container.replaceChildren(root);
  if (toggles.length) listenForShortcut();
}

// B flips the open design comment between Before and After, unless typing.
let shortcutBound = false;
function listenForShortcut() {
  if (shortcutBound) return;
  shortcutBound = true;
  document.addEventListener("keydown", (event) => {
    // B toggles; ← shows Before and → shows After.
    const key = event.key === "ArrowLeft" ? 0 : event.key === "ArrowRight" ? 1 : event.key.toLowerCase() === "b" ? -1 : null;
    if (event.defaultPrevented || key === null || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return;
    const path = event.composedPath();
    const focused = [...visibleToggles].find(item => item.isConnected && path.includes(item));
    if (!focused && (key !== -1 || ownsKeyboard(event))) return;
    const toggle = focused ?? [...visibleToggles].reverse().find(item => item.isConnected);
    const buttons = toggle?.querySelectorAll<HTMLButtonElement>("button");
    const next = key === -1 ? toggle?.querySelector<HTMLButtonElement>('button[aria-pressed="false"]') : buttons?.[key];
    if (!next) return;
    event.preventDefault();
    next.click();
  });
}

// The proposal last shown in the composer, so redraws keep its Before/After choice.
let draftBody: string | undefined;
let draftRuntime: {
  source: string;
  body: string;
  container: HTMLElement;
  resolve: DesignCommentOptions["resolve"];
  options: DraftOptions;
  context?: DraftTokens;
  events: AbortController;
  refresh(): Promise<void>;
} | undefined;

interface DraftOptions {
  design?: DesignSystem;
  onUpdate?(body: string): void;
}

function currentDraftBody(body: string, tokens: readonly DesignToken[], design: DesignSystem, resolve: DesignCommentOptions["resolve"]): string {
  const state = Object.entries(themeState(design)).map(([axis, option]) => `${axis}=${option}`.replace(/\s+/g, " ").replace(/→/g, "->")).join(", ");
  return body.split(/(\n{2,})/).map(chunk => {
    const lines = chunk.split("\n");
    if (!HEADER.test(lines[0])) return chunk;
    const target = resolve(lines.find(line => line.startsWith("Target: "))?.slice(8));
    return lines.map(line => {
      if (line.startsWith("Theme: ") && state) return `Theme: ${state}`;
      if (lines[0].startsWith("Proposed style ")) {
        const match = /^- ([\w-]+): (.*?) → (.*)$/.exec(line);
        const usage = match && originalTokenUsage(target, match[1]);
        const token = usage && "path" in usage && tokens.find(token => token.path === usage.path);
        return match && token ? `- ${match[1]}: ${token.value} → ${match[3]}` : line;
      }
      if (!lines[0].startsWith("Proposed design-token ")) return line;
      const match = /^Element ([\w-]+): (.*?) → (.*?) \[([^\]]+)\]$/.exec(line);
      if (!match) return line;
      const [, property, before, , path] = match;
      const next = tokens.find(token => token.path === path);
      if (!next) return line;
      const fromPath = /\[([^\]]+)\]$/.exec(before)?.[1];
      const from = fromPath && tokens.find(token => token.path === fromPath);
      return `Element ${property}: ${from ? `${from.value} [${from.path}]` : before} → ${next.value} [${path}]`;
    }).join("\n");
  }).join("");
}

/**
 * A proposal being written. Design mode has already restored the page, so the
 * card starts on After; posting or closing the composer resets it.
 */
export function renderDraftProposal(container: HTMLElement, body: string, resolve: DesignCommentOptions["resolve"], options: DraftOptions = {}): void | Promise<void> {
  const design = options.design, adapter = design?.tokens;
  if (design && adapter) {
    if (draftRuntime && draftRuntime.options.design === design && (body === draftRuntime.source || body === draftRuntime.body)) {
      draftRuntime.container = container;
      draftRuntime.options = options;
      renderDesignComment(container, draftRuntime.body, { key: "draft", resolve: draftRuntime.resolve, tokens: draftRuntime.context, note: (element, text) => element.append(text) });
      return;
    }
    draftRuntime?.events.abort();
    revert("draft");
    lostPreviews.delete("draft");
    draftBody = body;
    const events = new AbortController();
    const targets = new Map(parseDesignComment(body).filter((block): block is DesignSection => "changes" in block).map(section => [section.target, resolve(section.target)]));
    const retained = (selector?: string) => { const target = targets.get(selector); return target?.isConnected ? target : null; };
    let request = 0, initial = true;
    const runtime = draftRuntime = {
      source: body, body, container, resolve: retained, options, events,
      context: undefined as DraftTokens | undefined,
      async refresh() {
        const at = ++request;
        const tokens = await listTokens(adapter!, themeState(design));
        if (events.signal.aborted || at !== request) return;
        const after = initial || applied.has("draft");
        initial = false;
        revert("draft");
        runtime.context = { adapter: adapter!, tokens };
        runtime.body = currentDraftBody(runtime.source, tokens, design!, runtime.resolve);
        draftBody = runtime.body;
        runtime.options.onUpdate?.(runtime.body);
        const sections = parseDesignComment(runtime.body).filter((block): block is DesignSection => "changes" in block);
        for (const section of sections) {
          const element = runtime.resolve(section.target);
          if (element) refreshTokenBaseline(element, adapter!, tokens, section.changes.flatMap(item => item.apply?.kind === "style" ? [item.apply.property] : []));
        }
        if (after) apply("draft", sections, runtime.resolve, false, runtime.context);
        const focused = runtime.container.querySelector<HTMLButtonElement>(".design-toggle button:focus")?.textContent;
        renderDesignComment(runtime.container, runtime.body, { key: "draft", resolve: runtime.resolve, tokens: runtime.context, note: (element, text) => element.append(text) });
        if (focused) [...runtime.container.querySelectorAll<HTMLButtonElement>(".design-toggle button")].find(button => button.textContent === focused)?.focus({ preventScroll: true });
      },
    };
    watchThemes(design, container.ownerDocument, () => { void runtime.refresh().catch(() => {}); }, events.signal);
    return runtime.refresh();
  }
  draftRuntime?.events.abort();
  draftRuntime = undefined;
  if (draftBody !== body) {
    revert("draft");
    lostPreviews.delete("draft");
    draftBody = body;
    apply("draft", parseDesignComment(body).filter((block): block is DesignSection => "changes" in block), resolve);
  }
  renderDesignComment(container, body, { key: "draft", resolve, note: (element, text) => element.append(text) });
}
