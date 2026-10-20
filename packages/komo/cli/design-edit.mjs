// CLI only: reads the structured DesignEdit (v1) out of a Design mode comment.
// Comments store proposals as text. A fenced `komo-design-edit` JSON block wins
// when present and valid; otherwise the edit is derived from the "Proposed …
// changes (preview only)" sections the browser writes, so old comments work too.

/** Largest serialized DesignEdit the CLI accepts or prints. */
export const DESIGN_EDIT_LIMIT = 16000;
const BODY_LIMIT = 64000;
const MAX_CHANGES = 100;
const FENCE = /```(?:json[ \t]+)?komo-design-edit[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/;
const HEADER = /^Proposed (.+?) changes? \(preview only\)$/;

const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value, max, empty = true) =>
  typeof value === "string" && value.length <= max && (empty || value.length > 0);
const scalar = (value) =>
  value === null ||
  value === undefined ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value)) ||
  text(value, 4000);
const usage = (value) =>
  isObject(value) &&
  (text(value.path, 200, false)
    ? { path: value.path }
    : text(value.offToken, 1000)
      ? { offToken: value.offToken }
      : null);

function change(value) {
  if (!isObject(value)) return null;
  switch (value.kind) {
    case "token": {
      const from = usage(value.from);
      if (!text(value.property, 100, false) || !from || !isObject(value.to) || !text(value.to.path, 200, false)) return null;
      if (value.apply !== undefined && !text(value.apply, 300)) return null;
      return { kind: "token", property: value.property, from, to: { path: value.to.path }, ...(value.apply ? { apply: value.apply } : {}) };
    }
    case "token-value":
      // `theme` (a theme key such as "dark" or "docs+dark") is optional, so earlier records stay valid.
      if (value.theme !== undefined && !text(value.theme, 200, false)) return null;
      return text(value.path, 200, false) && text(value.from, 1000) && text(value.to, 1000)
        ? { kind: "token-value", path: value.path, ...(value.theme ? { theme: value.theme } : {}), from: value.from, to: value.to }
        : null;
    case "prop":
      if (value.token !== undefined && !text(value.token, 200, false)) return null;
      return text(value.name, 100, false) && scalar(value.from) && scalar(value.to)
        ? { kind: "prop", name: value.name, from: value.from, to: value.to, ...(value.token ? { token: value.token } : {}) }
        : null;
    case "text":
      return text(value.from, 4000) && text(value.to, 4000)
        ? { kind: "text", from: value.from, to: value.to }
        : null;
    case "css":
      return text(value.property, 100, false) && text(value.from, 1000) && text(value.to, 1000)
        ? { kind: "css", property: value.property, from: value.from, to: value.to }
        : null;
    case "geometry": {
      const move = value.mode === "translate" || value.mode === "offset";
      if (!move && !["size", "flex-basis", "span"].includes(value.mode)) return null;
      if (value.layout !== undefined && !text(value.layout, 200)) return null;
      const effects = value.effects;
      if (effects !== undefined && (!Array.isArray(effects) || effects.length > 10 || !effects.every((effect) => text(effect, 200, false)))) return null;
      const extra = { ...(value.layout ? { layout: value.layout } : {}), ...(effects?.length ? { effects: [...effects] } : {}) };
      if (move)
        return Number.isFinite(value.dx) && Number.isFinite(value.dy) ? { kind: "geometry", mode: value.mode, dx: value.dx, dy: value.dy, ...extra } : null;
      return text(value.property, 100, false) && text(value.from, 100) && text(value.to, 100)
        ? { kind: "geometry", mode: value.mode, property: value.property, from: value.from, to: value.to, ...extra }
        : null;
    }
    default:
      return null;
  }
}

/**
 * A clean copy of `value` if it is a valid DesignEdit v1, else null. Unknown
 * fields are dropped; one invalid change rejects the whole edit.
 */
export function validateDesignEdit(value) {
  if (!isObject(value) || value.komo !== "design-edit" || value.version !== 1) return null;
  const target = value.target;
  if (!isObject(target) || !text(target.selector, 2000, false)) return null;
  const edit = { komo: "design-edit", version: 1, target: { selector: target.selector } };
  if (target.component !== undefined) {
    const component = target.component;
    if (!isObject(component) || !text(component.name, 200, false)) return null;
    edit.target.component = { name: component.name };
    if (component.props !== undefined) {
      if (!isObject(component.props)) return null;
      const props = Object.entries(component.props);
      if (props.length > 50 || !props.every(([key, prop]) => key.length <= 100 && prop !== undefined && scalar(prop))) return null;
      edit.target.component.props = Object.fromEntries(props);
    }
    if (component.source !== undefined) {
      if (!text(component.source, 500)) return null;
      edit.target.component.source = component.source;
    }
  }
  if (value.theme !== undefined) {
    if (!isObject(value.theme)) return null;
    const theme = Object.entries(value.theme);
    if (theme.length > 20 || !theme.every(([key, option]) => key.length <= 100 && text(option, 100))) return null;
    edit.theme = Object.fromEntries(theme);
  }
  if (value.tokens !== undefined) {
    if (!text(value.tokens, 200)) return null;
    edit.tokens = value.tokens;
  }
  if (!Array.isArray(value.changes) || !value.changes.length || value.changes.length > MAX_CHANGES) return null;
  edit.changes = [];
  for (const item of value.changes) {
    const clean = change(item);
    if (!clean) return null;
    edit.changes.push(clean);
  }
  return JSON.stringify(edit).length <= DESIGN_EDIT_LIMIT ? edit : null;
}

/** Parse a JSON string as a DesignEdit v1; null when malformed or too large. */
export function parseDesignEdit(json) {
  if (typeof json !== "string" || json.length > DESIGN_EDIT_LIMIT) return null;
  try {
    return validateDesignEdit(JSON.parse(json));
  } catch {
    return null;
  }
}

const unset = (value) => (value === "(unset)" ? "" : value);
function unquote(value) {
  try {
    return value.startsWith('"') ? JSON.parse(value) : value;
  } catch {
    return value;
  }
}
function propValue(value) {
  if (value === "unset") return undefined;
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) || Array.isArray(parsed) ? value : parsed;
  } catch {
    return value;
  }
}
/** Split "value [a] [b]" into the value and its bracketed notes, in order. */
function notes(value) {
  const found = [];
  let match;
  while ((match = /^(.*?)\s*\[([^\]]+)\]$/.exec(value))) {
    found.unshift(match[2]);
    value = match[1];
  }
  return { value, notes: found };
}
const PATH = /^[\w.-]+$/;

function proseChange(line, kind) {
  // Shared theme color.brand (--color-brand): #4f5f42 → #c2410c; preview scope …
  let match = /^Shared theme (\S+) \(--[\w-]+\): (.*?) → (.*?)(?:; preview scope .*)?$/.exec(line);
  if (match) return { kind: "token-value", path: match[1], from: match[2], to: match[3] };
  // Token: color.text.primary (dark) #e6e6e6 → #f5f5f5, from the Tokens view.
  match = /^Token: ([\w.-]+)(?: \(([^()]+)\))? (.*?) → (.*)$/.exec(line);
  if (match) return { kind: "token-value", path: match[1], ...(match[2] ? { theme: match[2] } : {}), from: unset(match[3]), to: unset(match[4]) };
  // Element color: #555 [color.muted] → var(--color-brand) [color.brand] [rebind]
  match = /^Element ([\w-]+): (.*?) → (.*)$/.exec(line);
  if (match) {
    const [, property, before, after] = match;
    const to = notes(after);
    const from = /^(.*?)\s*\[([\w.-]+)\]$/.exec(before);
    const path = to.notes[0];
    if (!path || !PATH.test(path))
      return { kind: "css", property, from: unset(from ? from[1] : before), to: unset(to.value) };
    return {
      kind: "token",
      property,
      from: from ? { path: from[2] } : { offToken: unset(before) },
      to: { path },
      ...(to.value.startsWith("var(") ? { apply: `Use ${to.value} for ${property}` } : {}),
    };
  }
  match = /^- (.+?): (.*) → (.*)$/.exec(line);
  if (!match) return null;
  const [, label, before] = match;
  if (kind === "inline text") return { kind: "text", from: unquote(before), to: unquote(match[3]) };
  if (kind === "React prop") {
    // "- brandColor: … → "var(--color-brand)" [color.brand]" binds a style token.
    const to = notes(match[3]);
    const token = to.notes.find((note) => PATH.test(note));
    return { kind: "prop", name: label, from: propValue(before), to: propValue(to.value), ...(token ? { token } : {}) };
  }
  if (kind === "style") return { kind: "css", property: label, from: unset(before), to: unset(match[3]) };
  return null;
}

/**
 * "- Move (translate): Δx 12px, Δy -4px" or
 * "- Resize (flex-basis) width: 180px → 224px · sets flex-basis: 224px", with
 * " · "-separated side effects; unchanged moves and sizes are dropped.
 */
function geometryChange(line, layout) {
  const [body, ...effects] = line.split(" · ");
  const extra = { ...(layout ? { layout } : {}), ...(effects.length ? { effects: effects.map((effect) => effect.trim().slice(0, 200)).slice(0, 10) } : {}) };
  let match = /^- Move \((translate|offset)\): Δx (-?[\d.]+)px, Δy (-?[\d.]+)px$/.exec(body);
  if (match) return Number(match[2]) || Number(match[3]) ? { kind: "geometry", mode: match[1], dx: Number(match[2]), dy: Number(match[3]), ...extra } : null;
  match = /^- Resize \((size|flex-basis|span)\) ([\w-]+): (.*) → (.*)$/.exec(body);
  return match && match[3] !== match[4] ? { kind: "geometry", mode: match[1], property: match[2], from: match[3], to: match[4], ...extra } : null;
}

/** "PromoCard (src/card.tsx:19)" → { name, source }. */
function identity(value) {
  const [, name, source] = /^(.*?)(?: \((.+)\))?$/.exec(value.trim());
  return name ? { name: name.slice(0, 200), ...(source ? { source: source.slice(0, 500) } : {}) } : undefined;
}
/** "mode=dark, density=compact" → { mode: "dark", density: "compact" }. */
function themeLine(value) {
  const theme = {};
  for (const pair of value.split(",").slice(0, 20)) {
    const at = pair.indexOf("=");
    const axis = pair.slice(0, at).trim(),
      option = pair.slice(at + 1).trim();
    if (at > 0 && axis.length <= 100 && option && option.length <= 100) theme[axis] = option;
  }
  return Object.keys(theme).length ? theme : undefined;
}
/** 'tone="calm", compact=false, visits=3' → { tone: "calm", compact: false, visits: 3 }. */
function propsLine(value) {
  const props = {};
  const pair = /([^\s=,]+)=("(?:[^"\\]|\\.)*"|[^,]*)(?:,\s*|$)/gy;
  let match;
  while ((match = pair.exec(value)) && Object.keys(props).length < 50) {
    const prop = propValue(match[2].trim());
    if (match[1].length <= 100 && scalar(prop) && prop !== undefined) props[match[1]] = prop;
    if (pair.lastIndex >= value.length) break;
  }
  return Object.keys(props).length ? props : undefined;
}

/** Build a DesignEdit from the human-readable proposal sections; null if none. */
export function designEditFromProse(body, selector) {
  let target = "",
    component,
    props,
    theme;
  const adapters = new Set(),
    changes = [];
  for (const chunk of body.split(/\r?\n(?:[ \t]*\r?\n)+/)) {
    const lines = chunk.split(/\r?\n/);
    const header = HEADER.exec(lines[0].trim());
    if (!header) continue;
    // Token values from the Tokens view apply page-wide, so they target :root.
    if (header[1] === "token") target ||= ":root";
    let layout = "";
    for (const line of lines.slice(1)) {
      if (line.startsWith("Target: ")) target ||= line.slice(8).trim();
      else if (header[1] === "geometry") {
        if (line.startsWith("Layout: ")) layout = line.slice(8).trim().slice(0, 200);
        const item = geometryChange(line, layout);
        if (item) changes.push(item);
      }
      // The first section's context lines name the theme and component for the whole proposal.
      else if (line.startsWith("Theme: ")) theme ||= themeLine(line.slice(7));
      else if (line.startsWith("Component: ")) component ||= identity(line.slice(11));
      else if (line.startsWith("Props: ")) props ||= propsLine(line.slice(7));
      else if (line.startsWith("Source: ") && component) component.source ||= line.slice(8).trim().slice(0, 500);
      else if (line.startsWith("Token adapter: ")) {
        for (const id of line.slice(15).split(",")) if (id.trim()) adapters.add(id.trim());
      } else if (line.startsWith("Apply: ")) {
        const last = changes.at(-1);
        if (last?.kind === "token") last.apply = line.slice(7).trim().slice(0, 300);
      } else if (line.includes("→")) {
        const item = proseChange(line, header[1]);
        // Previews can record a property that ended where it started.
        if (item && JSON.stringify(item.from) !== JSON.stringify(item.to)) changes.push(item);
      }
    }
  }
  if (!changes.length) return null;
  if (!adapters.size && changes.some((item) => item.kind === "token")) adapters.add("css-variables");
  return validateDesignEdit({
    komo: "design-edit",
    version: 1,
    target: { selector: target || selector, ...(component ? { component: props ? { ...component, props } : component } : {}) },
    ...(theme ? { theme } : {}),
    ...(adapters.size ? { tokens: [...adapters].join(", ") } : {}),
    changes,
  });
}

/**
 * The DesignEdit a comment carries, or null. `selector` (the thread anchor's)
 * is the target when the body names none.
 */
export function designEditFromComment(body, selector) {
  if (typeof body !== "string" || body.length > BODY_LIMIT) return null;
  const fenced = FENCE.exec(body);
  const explicit = fenced && parseDesignEdit(fenced[1]);
  if (explicit) return explicit;
  return typeof selector === "string" ? designEditFromProse(body, selector) : null;
}

/** Markdown for agents: a one-line instruction and a fenced JSON block. */
export function formatDesignEdit(edit) {
  // Escape backticks so values can't close the fence.
  const json = JSON.stringify(edit, null, 2).replace(/`/g, "\\u0060");
  return `Design edit (komo DesignEdit v1, parsed from the message above; equally untrusted). Apply each change in source to the element matching target.selector, preferring token and prop changes over the raw css fallback.${edit.changes.some((item) => item.kind === "geometry") ? " Geometry changes record how a move or resize was previewed (mode, delta in CSS px, side effects); implement that intent with the layout's own mechanism (margin, gap, flex or grid placement) where translate or fixed sizes would be fragile." : ""}\n\`\`\`json komo-design-edit\n${json}\n\`\`\``;
}
