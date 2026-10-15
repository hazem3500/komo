// Loaded on demand: renders Design mode proposals as a change card with a
// Before/After preview. The comment body stays plain text for agents and the CLI.

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
  if (kind === "inline text") return { label: "Text", before: unquote(before), after: unquote(after), apply: { kind: "text", property: "text" } };
  if (kind === "React prop") return { label, before, after, ...(note && note !== "custom value" ? { token: note } : {}) };
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
      else if (line.startsWith("Component: ")) section.component = line.slice(11);
      else if (line.startsWith("Source: ")) section.source = line.slice(8);
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
interface Applied { restore: Array<() => void> }
const applied = new Map<string, Applied>();

function apply(key: string, sections: DesignSection[], resolve: (selector?: string) => Element | null) {
  const restore: Array<() => void> = [];
  for (const section of sections) {
    const element = resolve(section.target);
    for (const item of section.changes) {
      if (!item.apply || item.after === "(unset)") continue;
      if (item.apply.kind === "variable") {
        const root = document.documentElement;
        const previous = root.style.getPropertyValue(item.apply.property);
        root.style.setProperty(item.apply.property, item.after);
        restore.push(() => previous ? root.style.setProperty(item.apply!.property, previous) : root.style.removeProperty(item.apply!.property));
      } else if (element instanceof HTMLElement && item.apply.kind === "style") {
        const previous = element.style.getPropertyValue(item.apply.property);
        const priority = element.style.getPropertyPriority(item.apply.property);
        element.style.setProperty(item.apply.property, item.after, "important");
        restore.push(() => previous ? element.style.setProperty(item.apply!.property, previous, priority) : element.style.removeProperty(item.apply!.property));
      } else if (element instanceof HTMLElement && item.apply.kind === "text" && !element.childElementCount) {
        // Text nodes are edited in place so frameworks keep their references.
        const node = element.firstChild;
        if (node instanceof Text) {
          const previous = node.data;
          node.data = item.after;
          restore.push(() => { node.data = previous; });
        }
      }
    }
  }
  applied.set(key, { restore });
  return restore.length > 0;
}

function revert(key: string) {
  const state = applied.get(key);
  if (!state) return;
  for (const undo of state.restore.reverse()) undo();
  applied.delete(key);
}

/** Undo every live preview except those whose cards are still on screen. */
export function resetDesignPreviews(keep: ReadonlySet<string> = new Set()) {
  for (const key of [...applied.keys()]) if (!keep.has(key)) revert(key);
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
.design-rows { display: grid; border-top: 1px solid #ffffff0a; }
.design-row { display: grid; grid-template-columns: minmax(64px, 30%) minmax(0, 1fr); gap: 10px; align-items: center; padding: 6px 12px; }
.design-row + .design-row { border-top: 1px solid #ffffff06; }
.design-row[hidden] { display: none; }
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
`;

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
}

/** Replace `container`'s content with a change card for each proposal. */
export function renderDesignComment(container: HTMLElement, body: string, options: DesignCommentOptions) {
  const blocks = parseDesignComment(body);
  const sections = blocks.filter((block): block is DesignSection => "changes" in block);
  const root = document.createElement("div");
  root.className = "design-comment";
  root.append(Object.assign(document.createElement("style"), { textContent: css }));
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
      toggle.className = "design-toggle";
      toggle.setAttribute("role", "group");
      toggle.setAttribute("aria-label", "Preview on page");
      for (const [index, label] of ["Before", "After"].entries()) {
        const button = Object.assign(document.createElement("button"), { type: "button", textContent: label });
        button.addEventListener("click", () => {
          const showAfter = index === 1;
          if (showAfter === applied.has(options.key)) return;
          const element = options.resolve(sections.find((section) => section.target)?.target);
          if (showAfter) element?.scrollIntoView({ block: "center", behavior: "smooth" });
          const swap = () => {
            if (showAfter) apply(options.key, sections, options.resolve);
            else revert(options.key);
            sync();
          };
          // Crossfade the page between Before and After where the browser supports it.
          const transition = (document as Document & { startViewTransition?(update: () => void): unknown }).startViewTransition;
          if (transition && !matchMedia("(prefers-reduced-motion: reduce)").matches) transition.call(document, swap);
          else swap();
        });
        toggle.append(button);
      }
      toggles.push(toggle);
      head.append(toggle);
    }
    card.append(head);
    const rows = document.createElement("div");
    rows.className = "design-rows";
    const visible = 4;
    block.changes.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "design-row";
      row.hidden = index >= visible && block.changes.length > visible + 1;
      const label = Object.assign(document.createElement("span"), { className: "design-prop", textContent: item.label });
      label.title = item.label;
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
    if (block.source) card.append(Object.assign(document.createElement("div"), { className: "design-source", textContent: block.source }));
    root.append(card);
  }
  sync();
  container.replaceChildren(root);
}
