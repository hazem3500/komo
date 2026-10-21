import { textEntry } from "./dom.js";
// Loaded on demand: renders Design mode proposals as a change card with a
// Before/After preview. The comment body stays plain text for agents and the CLI.
import { isDesignTarget } from "./design-target.js";
import { elementLabel } from "./element-label.js";
import { isHTMLElement, onFrame, previewTarget } from "./frame-target.js";
import { inlineStyleSnapshot, removeEmptyStyle } from "./design-preview.js";
import { previewText } from "./text-preview.js";
import { sourceInfo, sourceInfoStyles, type SourceHref } from "./source-info.js";
import { listTokens, originalTokenUsage, previewToken, refreshTokenBaseline, themeState, watchThemes } from "./token-adapter.js";
import type { DesignSystem, DesignToken, TokenAdapter, TokenValueChange } from "./design-system.js";

export interface DesignChange {
  label: string;
  before: string;
  after: string;
  /** Token path such as color.brand, when the change binds a design token. */
  token?: string;
  /** How to preview it on the page; absent when only the app can apply it. */
  apply?: {
    kind: "style" | "variable" | "text" | "token" | "prop" | "move"; property: string; theme?: string;
    /** Styles a resize also sets, such as flex-basis. */
    also?: string[][];
    /** A structural move's places, and a prop's recorded value as written. */
    from?: Place; to?: Place; value?: string;
  };
}

/** Where a moved box sits: its parent's selector and its index among the laid-out children. */
export type Place = { parent: string; index: number };

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
  token: "Token changes",
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
  if (kind === "geometry") {
    // "- Resize (size) width: 180px → 224px · sets flex-basis: 224px": the size and what it also sets.
    let match = /^- Resize \([\w-]+\) ([\w-]+): (.*?) → (.*?)((?: · .*)?)$/.exec(line);
    if (match) return { label: match[1], before: match[2], after: match[3],
      apply: { kind: "style", property: match[1], also: [...match[4].matchAll(/ · sets ([\w-]+): ([^·]*[^\s·])/g)].map(([, property, value]) => [property, value]) } };
    // "- Move Link “Approvals”: from NavList (3rd) → NavList (2nd)"; its From/To lines locate both places.
    match = /^- Move (.+): from (.+) \((\d+\w+)\) → (.+) \((\d+\w+)\)$/.exec(line);
    if (match) return { label: match[1], before: `${match[2]} · ${match[3]}`, after: match[4] === match[2] ? match[5] : `${match[4]} · ${match[5]}`, apply: { kind: "move", property: "" } };
    match = /^- Move \(translate\): Δx (\S+), Δy ([^\s·]+)/.exec(line);
    if (match) return { label: "translate", before: "none", after: `${match[1]} ${match[2]}`, apply: { kind: "style", property: "translate" } };
    const [, label, before = "", after] = /^- (.+?): (?:(.*) → )?(.*)$/.exec(line) ?? [];
    return label ? { label, before, after } : null;
  }
  // Shared theme color.brand (--color-brand): #4f5f42 → #c2410c; preview scope …
  let match = /^Shared theme (\S+) \((--[\w-]+)\): (.*?) → (.*?)(?:; preview scope .*)?$/.exec(line);
  if (match)
    return { label: match[1], token: match[1], before: match[3], after: match[4], apply: { kind: "variable", property: match[2] } };
  // Token: color.text.primary (dark) #e6e6e6 → #f5f5f5, from the Tokens view.
  match = /^Token: ([\w.-]+)(?: \(([^()]+)\))? (.*?) → (.*)$/.exec(line);
  // Its preview goes through the adapter's previewValues(), like the Tokens view's footer.
  if (match) return { label: match[2] ? `${match[1]} (${match[2]})` : match[1], token: match[1], before: match[3], after: match[4], apply: { kind: "token", property: match[1], ...(match[2] ? { theme: match[2] } : {}) } };
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
  if (kind === "React prop") return { label, before: unquote(before), after: unquote(after), ...(note && note !== "custom value" ? { token: note } : {}), apply: { kind: "prop", property: label, value: after } };
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
      else if (/^(From|To): /.test(line)) {
        // "From: main > nav · index 2 · before": the selector and index of the move above.
        const move = [...section.changes].reverse().find(item => item.apply?.kind === "move")?.apply;
        const [parent, index] = line.slice(line.indexOf(" ") + 1).split(" · ");
        if (move) move[line[0] === "F" ? "from" : "to"] = { parent, index: parseInt(index?.slice(6)) || 0 };
      } else {
        const item = line.includes("→") || kind === "geometry" ? change(line, kind) : null;
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
  // Page-wide token edits have no target: "Token changes · 3 edits".
  const title = !target && sections.length && sections.every((section) => section.title === TITLES.token) ? TITLES.token : "Design change";
  const summary = `${title} · ${count} ${count === 1 ? "edit" : "edits"}${target ? ` on ${shortTarget(target)}` : ""}`;
  return note ? `${note}\n${summary}` : summary;
}

/** The last step of a generated selector, without :nth-of-type noise. */
export function shortTarget(selector: string): string {
  return (selector.split(">").at(-1) ?? selector).trim().replace(/:nth-of-type\(\d+\)/g, "") || selector;
}

/**
 * What a reviewer calls the target: the component name, else its role and
 * accessible name or short text ("Heading “Plan”"), else the bare tag.
 * Selectors and class chains stay in the recorded proposal.
 */
export function targetLabel(section: Pick<DesignSection, "component" | "target" | "changes">, element: Element | null): string {
  if (section.component) return section.component;
  const tag = element?.localName ?? /(?:^|[\s>])([a-z][\w-]*)[^\s>]*$/i.exec(section.target ?? "")?.[1]?.toLowerCase() ?? "";
  return elementLabel(element, tag, section.changes.find(item => item.apply?.kind === "text")?.before);
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
// What an applied After left out, shown under its card until it reverts.
const notes = new Map<string, string>();
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

/** The adapter, its current list (empty for saved comments) and the theme key page token previews use. */
type DraftTokens = { adapter: TokenAdapter; tokens: readonly DesignToken[]; theme?: string };

/** Laid-out element children, without preview stand-ins or `skip`, as moves count them. */
const kids = (parent: Element, skip?: Element) => [...parent.children].filter(child => child !== skip && !child.hasAttribute(CLONE) &&
  !child.matches("script,style,template") && !/^(none|contents)$/.test(getComputedStyle(child).display));
const indexOf = (element: Element, parent: Element) => kids(parent, element).filter(child => child.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).length;
const CLONE = "data-komo-move-clone";

/**
 * A recorded move, shown with a stand-in at its destination while the element itself
 * is hidden. A reason instead when either place no longer matches the proposal.
 */
function movable(element: Element, { from, to }: NonNullable<DesignChange["apply"]>) {
  const source = element.parentElement, target = to && document.querySelector(to.parent);
  if (!isDesignTarget(element) || !from || !to || !source || !target) return "Destination not found on this page";
  if (document.querySelector(from.parent) !== source || indexOf(element, source) !== from.index)
    return target === source && indexOf(element, source) === to.index ? "Already moved on this page" : "This element has moved since";
  return "";
}
function previewMove(element: Element, move: NonNullable<DesignChange["apply"]>) {
  const why = movable(element, move);
  if (why || !isDesignTarget(element)) return why;
  const source = element.parentElement!, target = document.querySelector(move.to!.parent)!, to = move.to!;
  const box = element.getBoundingClientRect(), anchor = source.getBoundingClientRect();
  const clone = element.cloneNode(true) as Element;
  for (const node of [clone, ...clone.querySelectorAll("[id]")]) node.removeAttribute("id");
  clone.setAttribute(CLONE, "");
  clone.setAttribute("aria-hidden", "true");
  (clone as HTMLElement).inert = true;
  target.insertBefore(clone, kids(target, element)[to.index] ?? null);
  const display = inlineStyleSnapshot(element, "display");
  element.style.setProperty("display", "none", "important");
  return {
    clone,
    undo() { clone.remove(); display.restore(); },
    // The origin rides with its parent, so scrolling and reflow keep it in place.
    origin() { const now = source.getBoundingClientRect(); return new DOMRect(box.left + now.left - anchor.left, box.top + now.top - anchor.top, box.width, box.height); },
  };
}

/** A recorded prop value through the app's component editor; undefined when it has none. */
function previewProp(element: Element, name: string, raw = "", design?: DesignSystem) {
  try {
    const components = design?.components, identity = components?.identify(element);
    const editor = identity && components!.editor?.(identity);
    if (!editor || editor.available?.() === false || !editor.schema.some(prop => prop.name === name && prop.kind !== "unsupported")) return;
    let value: string | number | boolean | undefined;
    try { value = raw === "unset" ? undefined : JSON.parse(raw); } catch { value = raw; }
    const before = editor.read();
    editor.apply({ ...before, [name]: value });
    return () => { try { editor.apply(before); editor.release?.([name]); } catch { /* The instance is gone with its preview. */ } };
  } catch { return; }
}

/** Outline what After changed in the selection colour, and a moved box's origin faintly. */
function mark(root: Node, boxes: Array<{ box(): DOMRect | null; origin?: boolean }>, color = "var(--komo-selection,#0c93f5)") {
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  const nodes = boxes.map(({ origin }) => layer.appendChild(Object.assign(document.createElement("div"), {
    className: "design-mark",
    style: `position:fixed;z-index:1;pointer-events:none;box-sizing:border-box;border-radius:4px;outline:${origin ? `1px dashed ${color};opacity:.6` : `2px solid ${color}`};outline-offset:2px`,
  })));
  (root instanceof ShadowRoot ? root : document.body).append(layer);
  let frame = 0;
  const draw = () => {
    boxes.forEach(({ box }, index) => {
      const rect = box(), node = nodes[index];
      node.hidden = !rect?.width && !rect?.height;
      if (rect) Object.assign(node.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    });
    frame = requestAnimationFrame(draw);
  };
  draw();
  return () => { cancelAnimationFrame(frame); layer.remove(); };
}

/** Why After can't be shown for these sections, checked before it is offered; empty when it can. */
function blocker(sections: DesignSection[], resolve: (selector?: string) => Element | null, can: (item: DesignChange) => boolean) {
  for (const section of sections) {
    const rows = section.changes.filter(item => can(item) && item.apply!.kind !== "token" && item.apply!.kind !== "variable");
    if (!rows.length) continue;
    const element = resolve(section.target);
    if (!element) return "Element not found on this page";
    for (const item of rows) if (item.apply!.kind === "move") { const why = movable(element, item.apply!); if (why) return why; }
  }
  return sections.some(section => section.changes.some(can)) ? "" : "This change can't be previewed here";
}

/** Where After is shown: Design mode's colour and the shadow root that draws its outlines. */
type Show = { design?: DesignSystem; root?: Node };

/**
 * Apply a comment's After. Rows that can't preview are skipped and named, so the rest still
 * switch; nothing on the page means After is off, with the reason.
 */
function apply(key: string, sections: DesignSection[], resolve: (selector?: string) => Element | null, smooth = false, context?: DraftTokens, show: Show = {}): [on: boolean, message: string] {
  if (lostPreviews.has(key)) return [false, UNAVAILABLE];
  settle(key);
  const restore: Array<() => void> = [];
  const restoreStyles: Array<() => void> = [];
  const pinBefore: Array<() => void> = [];
  const styleless = new Set<Element>();
  const values: TokenValueChange[] = [];
  const boxes: Array<{ box(): DOMRect | null; origin?: boolean }> = [];
  let reason = "";
  const skipped = new Set<string>();
  const skip = (item: DesignChange, why: string) => { reason ||= why; skipped.add(item.label); };
  for (const section of sections) {
    const element = resolve(section.target);
    let shown: Element | null = element;
    for (const item of section.changes) {
      if (!item.apply || item.after === "(unset)") continue;
      if (item.apply.kind === "token") {
        // "{color.violet.500}" repoints an alias; the adapter resolves the reference.
        const alias = /^\{(.+)\}$/.exec(item.after)?.[1];
        values.push({ path: item.apply.property, value: alias ? context?.tokens.find(token => token.path === alias)?.value ?? "" : item.after,
          ...(item.apply.theme ? { theme: item.apply.theme } : {}), ...(alias ? { alias } : {}) });
      } else if (item.apply.kind === "variable") {
        const root = previewTarget().root;
        const previous = root.style.getPropertyValue(item.apply.property);
        root.style.setProperty(item.apply.property, item.after);
        restore.push(() => previous ? root.style.setProperty(item.apply!.property, previous) : root.style.removeProperty(item.apply!.property));
      } else if (!element) skip(item, "Element not found on this page");
      else if (item.apply.kind === "move") {
        const moved = previewMove(element, item.apply);
        if (typeof moved === "string") skip(item, moved);
        else {
          restore.push(moved.undo);
          boxes.push({ box: moved.origin, origin: true });
          shown = moved.clone;
        }
      } else if (item.apply.kind === "prop") {
        const undo = previewProp(element, item.apply.property, item.apply.value, show.design);
        if (undo) restore.push(undo);
        else skip(item, "This component can't preview props here");
      } else if (isDesignTarget(element) && item.apply.kind === "style") {
        if (!element.hasAttribute("style")) styleless.add(element);
        const token = item.token && context?.tokens.find(token => token.path === item.token);
        if (token && context) {
          try { restore.push(previewToken(context.adapter, element, item.apply.property, token)); }
          catch { skip(item, UNAVAILABLE); }
          continue;
        }
        for (const [property, after, before] of [[item.apply.property, item.after, item.before], ...item.apply.also ?? []]) {
          // Hands back the declaration, and the page's own style attribute text once nothing else changed.
          const original = inlineStyleSnapshot(element, property);
          const pin = () => {
            if (!before || before === "(unset)") return false;
            element.style.setProperty(property, before, "important");
            return true;
          };
          // Browsers can't animate from keywords like auto, so start from the measured value.
          if (smooth && pin()) void getComputedStyle(element).getPropertyValue(property);
          element.style.setProperty(property, after, "important");
          pinBefore.push(pin);
          restoreStyles.push(original.restore);
        }
      } else if (item.apply.kind === "text") {
        const undo = isHTMLElement(element) ? previewText(element, item.before, item.after, () => loseTextPreview(key)) : undefined;
        if (undo) restore.push(undo);
        else skip(item, UNAVAILABLE);
      } else skip(item, UNAVAILABLE);
    }
    if (shown && section.changes.some(item => item.apply)) boxes.push({ box: () => shown!.isConnected ? shown!.getBoundingClientRect() : null });
  }
  // One preview for every token row; its cleanup removes the adapter's stylesheet for Before.
  if (values.length) {
    try { restore.push(context!.adapter.previewValues!(values, context!.theme)); }
    catch { reason ||= UNAVAILABLE; values.forEach(value => skipped.add(value.path)); }
  }
  if (styleless.size) restoreStyles.unshift(() => {
    for (const element of styleless) if (isDesignTarget(element)) removeEmptyStyle(element);
  });
  if (!restore.length && !restoreStyles.length) return [false, reason || UNAVAILABLE];
  if (show.root && boxes.length) restore.push(mark(show.root, boxes, show.design?.selectionColor));
  applied.set(key, { restore, restoreStyles, pinBefore });
  notes.set(key, skipped.size ? `Not previewed: ${[...skipped].join(", ")}` : "");
  return [true, skipped.size ? `Not previewed: ${[...skipped].join(", ")}` : ""];
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
      else if (item.apply?.kind === "variable" || item.apply?.kind === "token") TOKEN_PROPERTIES.forEach((property) => properties.add(property));
      else if (item.apply?.kind === "text") {
        const element = resolve(section.target);
        if (isHTMLElement(element))
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
  (previewTarget().document.head ?? previewTarget().root).append(style);
  // Leave the rule in place for the whole transition, then restore the page's own.
  morphing = { style, timer: setTimeout(() => { style.remove(); morphing = undefined; }, 480) };
}

function revert(key: string, smooth = false) {
  settle(key);
  const state = applied.get(key);
  if (!state) return;
  applied.delete(key);
  notes.delete(key);
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
.design-comment { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; min-width: 0; margin: 2px 0 6px; }
.design-note { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.design-card { min-width: 0; border-radius: 10px; background: #ffffff08; box-shadow: inset 0 0 0 1px #ffffff0d; font-size: 12px; }
.design-card-head { display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 40px; padding: 7px 8px 7px 12px; }
.design-card-label { display: grid; flex: 1; min-width: 0; gap: 1px; }
.design-card-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: #eee; }
.design-card-target { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #8a8a8a; font-size: 11px; }
.design-toggle { display: inline-flex; padding: 2px; border-radius: 7px; background: #ffffff0a; flex: none; }
.design-toggle button { display: inline-flex; align-items: center; gap: 4px; border: 0; padding: 0 7px; height: 22px; border-radius: 5px; font: inherit; font-size: 11px; color: #9a9a9a; background: none; cursor: pointer; }
.design-toggle svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; }
.design-toggle button[aria-pressed="true"] { color: #fff; background: #ffffff1a; }
.design-toggle button:disabled { opacity: .45; cursor: not-allowed; }
.design-rows { display: grid; grid-template-columns: minmax(0, 1fr); border-top: 1px solid #ffffff0a; }
.design-row { display: grid; grid-template-columns: minmax(64px, 30%) minmax(0, 1fr); gap: 10px; align-items: center; padding: 6px 12px; }
.design-row + .design-row { border-top: 1px solid #ffffff06; }
.design-row[hidden] { display: none; }
.design-row-prose { grid-template-columns: 1fr; gap: 3px; }
.design-diff { margin: 0; line-height: 1.5; color: #ddd; overflow-wrap: anywhere; }
.design-diff del, .design-diff ins { border-radius: 3px; padding: 0 2px; }
.design-diff del { color: #e3a29c; background: #f28b8214; text-decoration-color: #e3a29c80; }
.design-diff ins { color: #add8a3; background: #8fd69414; text-decoration: none; }
.design-prop { color: #9a9a9a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.design-values { display: flex; align-items: center; gap: 4px 6px; min-width: 0; color: #eee; }
.design-before { color: #858585; text-decoration: line-through; text-decoration-color: #85858599; }
.design-arrow { color: #666; }
.design-also { grid-column: 2; color: #858585; font-size: 11px; overflow-wrap: anywhere; }
.design-value { display: inline-flex; flex: 0 1 auto; align-items: center; gap: 5px; min-width: 0; }
.design-values { flex-wrap: wrap; }
.design-value-text { min-width: 0; overflow-wrap: anywhere; }
.design-token { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-compact] .design-value-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.design-swatch { width: 12px; height: 12px; flex: none; border-radius: 3px; box-shadow: inset 0 0 0 1px #ffffff26; }
.design-token { max-width: 100%; padding: 1px 6px; border-radius: 5px; color: var(--accent, #bda6ef); background: color-mix(in srgb, var(--accent, #bda6ef) 14%, transparent); }
.design-more { border: 0; width: 100%; padding: 7px 12px; text-align: left; font: inherit; font-size: 11px; color: #9a9a9a; background: none; border-top: 1px solid #ffffff06; cursor: pointer; }
.design-more:hover, .design-toggle button:hover { color: #fff; }
.design-source { margin: 0; padding: 0 12px 8px; color: #777; font-size: 11px; overflow-wrap: anywhere; }
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
  // Widen to whole words so "page" → "pages" reads as a word swap, not a stray "s";
  // added or removed punctuation alone ("Plan" → "Plan!!") stays a plain insertion.
  if (/[\p{L}\p{N}]/u.test(before.slice(start, before.length - end) + after.slice(start, after.length - end))) {
    while (start > 0 && !/\s/.test(before[start - 1])) start--;
    while (end > 0 && !/\s/.test(before[before.length - end])) end--;
  }
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
    wrap.append(Object.assign(document.createElement("span"), { className: "design-token", textContent: token, title: token }));
    return wrap;
  }
  if (COLOR.test(text)) {
    const swatch = document.createElement("span");
    swatch.className = "design-swatch";
    swatch.style.background = text;
    wrap.append(swatch);
  }
  wrap.append(Object.assign(document.createElement("span"), { className: "design-value-text", textContent: text, title: text }));
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
  /** Link for a recorded source path, shown behind the card's ⓘ. */
  sourceHref?: SourceHref;
  /** The app's design system: its token adapter previews page token rows. */
  design?: DesignSystem;
  /** Give a node komo's tooltip, which reads its aria-label. */
  tip?(node: HTMLElement): void;
  /** Why After can't be shown right now, such as pending Design mode edits; checked on each switch. */
  blocked?(): string | undefined;
}

const icon = (path: string) => `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="${path}"/></svg>`;
const ICONS = [icon("M2.5 6.5a3.5 3.5 0 1 0 1.2-2.6M3 1.8v2.4h2.4"), icon("M1 6s1.8-3.5 5-3.5S11 6 11 6s-1.8 3.5-5 3.5S1 6 1 6Zm5 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z")];

/** The theme key token edits use: the current option of each switchable axis, joined with "+". */
const themeKeyOf = (design?: DesignSystem) => (design?.themes ?? []).filter(axis => axis.options?.length > 1).map(axis => themeState(design)[axis.id]).join("+") || undefined;

/** Replace `container`'s content with a change card for each proposal. */
export function renderDesignComment(container: HTMLElement, body: string, options: DesignCommentOptions) {
  const blocks = parseDesignComment(body);
  const sections = blocks.filter((block): block is DesignSection => "changes" in block);
  const root = document.createElement("div");
  root.className = "design-comment";
  root.append(Object.assign(document.createElement("style"), { textContent: css + sourceInfoStyles }));
  const unavailable = document.createElement("p");
  unavailable.className = "design-source";
  unavailable.setAttribute("role", "status");
  const compact = !!options.compact;
  if (compact) root.dataset.compact = "";
  // Compact cards show the first three rows across all sections and count the rest.
  let room = compact ? 3 : Infinity;
  let extra = 0;
  const adapter = options.tokens?.adapter ?? options.design?.tokens;
  const context = adapter && { adapter, tokens: options.tokens?.tokens ?? [], theme: themeKeyOf(options.design) };
  // Page token rows preview only through an adapter with previewValues().
  const can = (item: DesignChange) => !!item.apply && (item.apply.kind !== "token" || !!adapter?.previewValues);
  // After is offered only when it can be shown; the reason stays beside the text diff.
  const why = () => lostPreviews.has(options.key) ? UNAVAILABLE : options.blocked?.() || blocker(sections, options.resolve, can);
  const reason = applied.has(options.key) ? notes.get(options.key) ?? "" : why();
  unavailable.textContent = reason;
  unavailable.hidden = !reason;
  const show = { design: options.design, root: container.getRootNode() };
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
    // A move reads as one sentence: "Moved Link “Approvals”", then "NavList · 3rd → 2nd".
    const move = block.changes.find(item => item.apply?.kind === "move");
    label.append(Object.assign(document.createElement("span"), { className: "design-card-title", textContent: move ? `Moved ${move.label}` : block.title }));
    const component = block.component ?? sections.find(section => section.target === block.target && section.component)?.component;
    const where = move ? `${move.before} → ${move.after}` : block.target || component ? targetLabel({ ...block, component }, options.resolve(block.target)) : "";
    if (where) label.append(Object.assign(document.createElement("span"), { className: "design-card-target", textContent: where, title: where }));
    head.append(label);
    if (block.source && !compact) head.append(sourceInfo(block.component || where || "Change", block.source, options.sourceHref));
    // One Before/After switch for the whole comment, top right of its first card.
    if (!toggles.length) {
      const toggle = document.createElement("div");
      toggle.dataset.previewKey = options.key;
      toggle.className = "design-toggle";
      toggle.setAttribute("role", "group");
      toggle.setAttribute("aria-label", "Preview on page");
      for (const [index, label] of ["Before", "After"].entries()) {
        const button = Object.assign(document.createElement("button"), { type: "button", title: `${label} · ${index ? "→" : "←"} or B` });
        button.innerHTML = ICONS[index];
        button.append(label);
        if (index === 1 && reason && !applied.has(options.key)) {
          button.disabled = true;
          button.title = reason;
        }
        button.addEventListener("click", () => {
          const showAfter = index === 1;
          if (showAfter === applied.has(options.key)) return;
          const blocked = showAfter && why();
          if (blocked) {
            unavailable.textContent = blocked;
            unavailable.hidden = false;
            return;
          }
          // A page-wide token card has no element to bring into view.
          const target = sections.find((section) => section.target)?.target;
          if (showAfter && target) options.resolve(target)?.scrollIntoView({ block: "center", behavior: "smooth" });
          const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (!reduced) morph(sections, options.resolve);
          if (showAfter) {
            const [, message] = apply(options.key, sections, options.resolve, !reduced, context, show);
            unavailable.hidden = !message;
            unavailable.textContent = message;
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
      if (item === move) return;
      if (room <= 0) return void extra++;
      if (compact) room--;
      const row = document.createElement("div");
      row.className = "design-row";
      row.hidden = !compact && index >= visible && block.changes.length > visible + 1;
      // A token row names the token (its label, else the path's last part); the full path and theme are its tooltip.
      const token = item.apply?.kind === "token" && item.token;
      const short = token && (context?.tokens.find(entry => entry.path === token)?.label || token.split(".").pop());
      const label = Object.assign(document.createElement("span"), { className: "design-prop", textContent: short || item.label });
      label.title = item.label;
      if (short) {
        label.setAttribute("aria-label", item.label);
        options.tip?.(label);
      }
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
      // A resize also sets flex-basis or flex-grow; say so under its values.
      if (item.apply?.also?.length) row.append(Object.assign(document.createElement("span"), { className: "design-also", textContent: item.apply.also.map(([property, to]) => `sets ${property}: ${to}`).join(" · ") }));
      rows.append(row);
    });
    if (rows.childElementCount) card.append(rows);
    const hidden = rows.querySelectorAll("[hidden]").length;
    if (hidden) {
      const more = Object.assign(document.createElement("button"), { type: "button", className: "design-more", textContent: `Show ${hidden} more` });
      more.addEventListener("click", () => {
        rows.querySelectorAll<HTMLElement>("[hidden]").forEach((row) => (row.hidden = false));
        more.remove();
      });
      card.append(more);
    }
    root.append(card);
  }
  if (extra) root.append(Object.assign(document.createElement("span"), { className: "design-source", textContent: `+${extra} more` }));
  root.append(unavailable);
  sync();
  container.replaceChildren(root);
  if (toggles.length) listenForShortcut();
}

// B flips the open design comment between Before and After from anywhere but a text field.
let shortcutBound = false;
function listenForShortcut() {
  if (shortcutBound) return;
  shortcutBound = true;
  const flip = (event: KeyboardEvent) => {
    // B toggles; ← shows Before and → shows After.
    const key = event.key === "ArrowLeft" ? 0 : event.key === "ArrowRight" ? 1 : event.key.toLowerCase() === "b" ? -1 : null;
    if (event.defaultPrevented || key === null || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) return;
    const path = event.composedPath();
    const focused = [...visibleToggles].find(item => item.isConnected && path.includes(item));
    if (!focused && (key !== -1 || textEntry(path[0]))) return;
    const toggle = focused ?? [...visibleToggles].reverse().find(item => item.isConnected);
    const buttons = toggle?.querySelectorAll<HTMLButtonElement>("button");
    const next = key === -1 ? toggle?.querySelector<HTMLButtonElement>('button[aria-pressed="false"]') : buttons?.[key];
    if (!next) return;
    event.preventDefault();
    next.click();
  };
  document.addEventListener("keydown", flip);
  // Also with focus inside Frame's viewport iframe.
  onFrame("keydown", flip);
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
  sourceHref?: SourceHref;
  onUpdate?(body: string): void;
  tip?(node: HTMLElement): void;
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
      renderDesignComment(container, draftRuntime.body, { ...options, key: "draft", resolve: draftRuntime.resolve, tokens: draftRuntime.context, note: (element, text) => element.append(text) });
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
        runtime.context = { adapter: adapter!, tokens, theme: themeKeyOf(design) };
        runtime.body = currentDraftBody(runtime.source, tokens, design!, runtime.resolve);
        draftBody = runtime.body;
        runtime.options.onUpdate?.(runtime.body);
        const sections = parseDesignComment(runtime.body).filter((block): block is DesignSection => "changes" in block);
        for (const section of sections) {
          const element = runtime.resolve(section.target);
          if (element) refreshTokenBaseline(element, adapter!, tokens, section.changes.flatMap(item => item.apply?.kind === "style" ? [item.apply.property] : []));
        }
        if (after) apply("draft", sections, runtime.resolve, false, runtime.context, { design, root: runtime.container.getRootNode() });
        const focused = runtime.container.querySelector<HTMLButtonElement>(".design-toggle button:focus")?.textContent;
        renderDesignComment(runtime.container, runtime.body, { ...runtime.options, key: "draft", resolve: runtime.resolve, tokens: runtime.context, note: (element, text) => element.append(text) });
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
    apply("draft", parseDesignComment(body).filter((block): block is DesignSection => "changes" in block), resolve, false, undefined, { design: options.design, root: container.getRootNode() });
  }
  renderDesignComment(container, body, { ...options, key: "draft", resolve, note: (element, text) => element.append(text) });
}
