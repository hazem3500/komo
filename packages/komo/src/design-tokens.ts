/** Explicit bridge from a site's named CSS custom properties into Design mode. */
export type KomoDesignTokenType =
  | "color"
  | "dimension"
  | "fontFamily"
  | "fontWeight"
  | "lineHeight";

export interface KomoDesignToken {
  /** Stable DTCG-style token path, e.g. "color.brand.primary". */
  path: string;
  /** Existing CSS custom property that supplies this token. */
  cssVariable: string;
  /** DTCG scalar type; composite types remain unsupported. */
  type: KomoDesignTokenType;
  /** Explicit CSS properties that may use this token on the selected element. */
  properties: string[];
  /** Explicit scope used only to estimate global theme impact. */
  impactSelector: string;
}

export interface RegisteredDesignTokenSource {
  root: HTMLElement;
  tokens: KomoDesignToken[];
  themeEdits: Map<string, { before: string; after: string; inlineBefore: string }>;
  elementOriginals: Map<HTMLElement, Map<string, { value: string; priority: string }>>;
  elementBindings: Map<HTMLElement, Map<string, ElementTokenBinding>>;
  previousMarker: string | null;
}

export interface ElementTokenBinding {
  tokenPath: string;
  initialValue: string;
  initialPriority: string;
  mode: "token" | "custom";
  customValue?: string;
  /** Token the element used before Komo changed it, from its inline style or stylesheet. */
  declaredPath?: string;
}

/** A token reference the page itself declares for one element property. */
export interface DeclaredTokenReference {
  token: KomoDesignToken;
  origin: "inline" | "stylesheet";
}

type TokenEdit =
  | { kind: "element"; element: HTMLElement; property: string; before: string; priority: string; after: string }
  | { kind: "theme"; source: RegisteredDesignTokenSource; token: KomoDesignToken; before: string; after: string; inlineBefore: string };

const sources = new Set<RegisteredDesignTokenSource>();
const byRoot = new WeakMap<HTMLElement, RegisteredDesignTokenSource>();
const elementEdits = new WeakMap<HTMLElement, TokenEdit[]>();
const history = new WeakMap<RegisteredDesignTokenSource, TokenEdit[]>();

const propertiesByType: Record<KomoDesignTokenType, ReadonlySet<string>> = {
  color: new Set(["color", "background-color", "border-color"]),
  dimension: new Set(["gap", "padding", "margin", "border-radius", "font-size", "width", "height"]),
  fontFamily: new Set(["font-family"]),
  fontWeight: new Set(["font-weight"]),
  lineHeight: new Set(["line-height"]),
};

function safeToken(token: KomoDesignToken): boolean {
  return !!token && typeof token.path === "string" && token.path.length <= 160 &&
    /^--[a-zA-Z0-9_-]+$/.test(token.cssVariable) &&
    !!propertiesByType[token.type] && Array.isArray(token.properties) && token.properties.length > 0 &&
    token.properties.every((property) => propertiesByType[token.type].has(property)) &&
    typeof token.impactSelector === "string" && token.impactSelector.length <= 200;
}

export function registerDesignTokenSource(
  root: HTMLElement,
  tokens: readonly KomoDesignToken[],
): () => void {
  if (tokens.length > 100 || tokens.some((token) => !safeToken(token)))
    throw new Error("Komo design tokens must use supported, explicit CSS-variable metadata");
  const paths = new Set(tokens.map((token) => token.path));
  const variables = new Set(tokens.map((token) => token.cssVariable));
  if (paths.size !== tokens.length || variables.size !== tokens.length)
    throw new Error("Komo design token paths and CSS variables must be unique");
  for (const token of tokens) root.querySelectorAll(token.impactSelector);
  const source: RegisteredDesignTokenSource = {
    root,
    tokens: tokens.map((token) => ({ ...token, properties: [...token.properties] })),
    themeEdits: new Map(),
    elementOriginals: new Map(),
    elementBindings: new Map(),
    previousMarker: root.getAttribute("data-komo-design-tokens"),
  };
  byRoot.set(root, source);
  sources.add(source);
  history.set(source, []);
  root.setAttribute("data-komo-design-tokens", String(tokens.length));
  return () => {
    if (byRoot.get(root) !== source) return;
    for (const [path, edit] of source.themeEdits) {
      const token = source.tokens.find((item) => item.path === path);
      if (!token) continue;
      if (edit.inlineBefore) root.style.setProperty(token.cssVariable, edit.inlineBefore);
      else root.style.removeProperty(token.cssVariable);
    }
    for (const [element, properties] of source.elementOriginals) {
      for (const [property, original] of properties) {
        if (original.value) element.style.setProperty(property, original.value, original.priority);
        else element.style.removeProperty(property);
      }
    }
    source.elementBindings.clear();
    sources.delete(source);
    byRoot.delete(root);
    if (source.previousMarker === null) root.removeAttribute("data-komo-design-tokens");
    else root.setAttribute("data-komo-design-tokens", source.previousMarker);
  };
}

export function tokenSourceFor(target: Element | null): RegisteredDesignTokenSource | null {
  if (!target) return null;
  let match: RegisteredDesignTokenSource | null = null;
  for (const source of sources) {
    if ((source.root === target || source.root.contains(target)) &&
      (!match || match.root.contains(source.root))) match = source;
  }
  return match;
}

export function tokenValue(source: RegisteredDesignTokenSource, token: KomoDesignToken): string {
  return source.root.ownerDocument.defaultView?.getComputedStyle(source.root)
    .getPropertyValue(token.cssVariable).trim() ?? "";
}

export function tokenImpactCount(source: RegisteredDesignTokenSource, token: KomoDesignToken): number {
  try { return source.root.querySelectorAll(token.impactSelector).length; }
  catch { return 0; }
}

function validTokenValue(source: RegisteredDesignTokenSource, token: KomoDesignToken, value: string): boolean {
  if (!value || value.length > 160 || /[{};]/.test(value) || /(?:url|expression)\s*\(/i.test(value)) return false;
  const view = source.root.ownerDocument.defaultView;
  const css = view?.CSS;
  return !css?.supports || token.properties.some((property) => css.supports(property, value));
}

export function previewThemeToken(
  source: RegisteredDesignTokenSource,
  token: KomoDesignToken,
  value: string,
): boolean {
  if (!source.tokens.some((item) => item === token || item.path === token.path) || !validTokenValue(source, token, value)) return false;
  const before = tokenValue(source, token);
  const prior = source.themeEdits.get(token.path);
  const inlineBefore = source.root.style.getPropertyValue(token.cssVariable);
  const baselineInline = prior?.inlineBefore ?? inlineBefore;
  const edits = history.get(source) ?? [];
  if (before === value) return true;
  source.root.style.setProperty(token.cssVariable, value);
  if (value === (prior?.before ?? before)) source.themeEdits.delete(token.path);
  else source.themeEdits.set(token.path, { before: prior?.before ?? before, after: value, inlineBefore: baselineInline });
  edits.push({ kind: "theme", source, token, before, after: value, inlineBefore });
  history.set(source, edits);
  return true;
}

export function applyTokenToElement(
  source: RegisteredDesignTokenSource,
  element: HTMLElement,
  token: KomoDesignToken,
  property: string,
  options: { recordHistory?: boolean } = {},
): boolean {
  if (!source.tokens.some((item) => item.path === token.path) || !token.properties.includes(property)) return false;
  let originals = source.elementOriginals.get(element);
  if (!originals) source.elementOriginals.set(element, (originals = new Map()));
  if (!originals.has(property)) originals.set(property, { value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) });
  const before = element.style.getPropertyValue(property);
  const priority = element.style.getPropertyPriority(property);
  const after = `var(${token.cssVariable})`;
  let bindings = source.elementBindings.get(element);
  if (!bindings) source.elementBindings.set(element, (bindings = new Map()));
  const priorBinding = bindings.get(property);
  bindings.set(property, {
    tokenPath: token.path,
    initialValue: priorBinding?.initialValue ?? before,
    initialPriority: priorBinding?.initialPriority ?? priority,
    mode: "token",
    declaredPath: priorBinding ? priorBinding.declaredPath : declaredTokenFor(source, element, property)?.token.path,
  });
  element.style.setProperty(property, after, priority);
  if (options.recordHistory === false) return true;
  const edit: TokenEdit = { kind: "element", element, property, before, priority, after };
  const edits = history.get(source) ?? [];
  edits.push(edit);
  history.set(source, edits);
  const own = elementEdits.get(element) ?? [];
  own.push(edit);
  elementEdits.set(element, own);
  return true;
}

/** Keep the token reference as provenance when the user types a custom override. */
export function noteElementTokenOverride(
  source: RegisteredDesignTokenSource,
  element: HTMLElement,
  property: string,
  value: string,
): void {
  let bindings = source.elementBindings.get(element);
  let binding = bindings?.get(property);
  if (!binding) {
    // Call before the override is written so the page's own reference is still visible.
    const declared = declaredTokenFor(source, element, property);
    if (!declared) return;
    if (!bindings) source.elementBindings.set(element, (bindings = new Map()));
    binding = {
      tokenPath: declared.token.path,
      initialValue: element.style.getPropertyValue(property),
      initialPriority: element.style.getPropertyPriority(property),
      mode: "custom",
      declaredPath: declared.token.path,
    };
    bindings.set(property, binding);
  }
  binding.mode = "custom";
  binding.customValue = value;
}

/** Reconcile token provenance after the style editor's undo restores a declaration. */
export function syncElementTokenBinding(
  source: RegisteredDesignTokenSource,
  element: HTMLElement,
  property: string,
): void {
  const binding = source.elementBindings.get(element)?.get(property);
  if (!binding) return;
  const value = element.style.getPropertyValue(property);
  if (value === binding.initialValue && element.style.getPropertyPriority(property) === binding.initialPriority) {
    source.elementBindings.get(element)?.delete(property);
    return;
  }
  const token = source.tokens.find((item) =>
    item.path === binding.tokenPath && item.properties.includes(property) && value === `var(${item.cssVariable})`,
  );
  if (token) {
    binding.mode = "token";
    delete binding.customValue;
  } else {
    binding.mode = "custom";
    binding.customValue = value;
  }
}

export function elementTokenBindingFor(
  source: RegisteredDesignTokenSource,
  element: HTMLElement,
  property: string,
): ElementTokenBinding | null {
  const binding = source.elementBindings.get(element)?.get(property);
  return binding ? { ...binding } : null;
}

/** Shorthands whose declared var() feeds the inspected longhand. */
const shorthands: Record<string, string[]> = {
  "background-color": ["background"],
  "border-color": ["border"],
  "font-family": ["font"],
  "font-size": ["font"],
  "font-weight": ["font"],
  "line-height": ["font"],
};

function referencedToken(
  source: RegisteredDesignTokenSource,
  property: string,
  value: string,
  exact: boolean,
): KomoDesignToken | undefined {
  const names = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);
  if (!names.length || (exact && !/^var\(\s*--[\w-]+\s*(?:,[^;{}]*)?\)$/.test(value.trim()))) return undefined;
  const matches = source.tokens.filter((token) => token.properties.includes(property) && names.includes(token.cssVariable));
  return matches.length === 1 ? matches[0] : undefined;
}

function specificity(selector: string): number {
  const plain = selector.replace(/:(?:where)\([^)]*\)/g, "").replace(/"[^"]*"|'[^']*'/g, "");
  const ids = plain.match(/#[\w-]+/g)?.length ?? 0;
  const classes = plain.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g)?.length ?? 0;
  const types = plain.match(/(?:^|[\s>+~(])[a-z][\w-]*/gi)?.length ?? 0;
  return ids * 10000 + classes * 100 + types;
}

function splitSelectors(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Report the token a property is connected to only when the winning declared
 * value references it. Equal computed values are never treated as a token.
 * Cross-origin sheets are skipped; cascade layers and scoping are not ranked.
 */
export function declaredTokenFor(
  source: RegisteredDesignTokenSource,
  element: HTMLElement,
  property: string,
  inline = element.style.getPropertyValue(property),
  inlinePriority = element.style.getPropertyPriority(property),
): DeclaredTokenReference | null {
  const view = element.ownerDocument.defaultView;
  let best: { value: string; property: string; rank: number; order: number } | null = null;
  let order = 0;
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      order++;
      const media = (rule as CSSMediaRule).media;
      if (media && view?.matchMedia && media.mediaText && !view.matchMedia(media.mediaText).matches) continue;
      const style = (rule as CSSStyleRule).style;
      const selectorText = (rule as CSSStyleRule).selectorText;
      if (style && selectorText) {
        for (const name of [property, ...(shorthands[property] ?? [])]) {
          const value = style.getPropertyValue(name).trim();
          if (!value) continue;
          let rank = -1;
          for (const selector of splitSelectors(selectorText)) {
            try { if (element.matches(selector)) rank = Math.max(rank, specificity(selector)); }
            catch { /* Unsupported selectors cannot be ranked. */ }
          }
          if (rank < 0) continue;
          rank += style.getPropertyPriority(name) ? 1e9 : 0;
          if (!best || rank > best.rank || (rank === best.rank && order >= best.order)) best = { value, property: name, rank, order };
          break;
        }
      }
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested && !style) visit(nested);
    }
  };
  for (const sheet of element.ownerDocument.styleSheets) {
    try { if (!sheet.disabled) visit(sheet.cssRules); }
    catch { /* Cross-origin stylesheets are not inspectable. */ }
  }
  const winner = best as { value: string; property: string; rank: number } | null;
  if (inline && !(winner && winner.rank >= 1e9 && !inlinePriority)) {
    const token = referencedToken(source, property, inline, true);
    return token ? { token, origin: "inline" } : null;
  }
  if (!winner) return null;
  const token = referencedToken(source, property, winner.value, winner.property === property);
  return token ? { token, origin: "stylesheet" } : null;
}

/** Drop Komo's element preview for one property and return to the page's own value. */
export function restoreElementProperty(
  source: RegisteredDesignTokenSource,
  element: HTMLElement,
  property: string,
): void {
  const binding = source.elementBindings.get(element)?.get(property);
  const original = source.elementOriginals.get(element)?.get(property);
  const value = binding?.initialValue ?? original?.value ?? "";
  const priority = binding?.initialPriority ?? original?.priority ?? "";
  if (value) element.style.setProperty(property, value, priority);
  else element.style.removeProperty(property);
  source.elementBindings.get(element)?.delete(property);
}

export function compatibleTokens(
  source: RegisteredDesignTokenSource,
  property: string,
): KomoDesignToken[] {
  return source.tokens.filter((token) => token.properties.includes(property));
}

export function hasDesignTokenChanges(element: HTMLElement): boolean {
  const source = tokenSourceFor(element);
  return !!source && (source.themeEdits.size > 0 || !!elementEdits.get(element)?.length || !!source.elementBindings.get(element)?.size);
}

export function canUndoDesignToken(element: HTMLElement | null): boolean {
  const source = tokenSourceFor(element);
  return !!source && !!history.get(source)?.length;
}

export function undoDesignToken(element: HTMLElement): void {
  const source = tokenSourceFor(element);
  const edit = source && history.get(source)?.pop();
  if (!source || !edit) return;
  if (edit.kind === "theme") {
    if (edit.inlineBefore) source.root.style.setProperty(edit.token.cssVariable, edit.inlineBefore);
    else source.root.style.removeProperty(edit.token.cssVariable);
    const state = source.themeEdits.get(edit.token.path);
    if (state && state.after === edit.after) {
      if (state.before === edit.before) source.themeEdits.delete(edit.token.path);
      else source.themeEdits.set(edit.token.path, { ...state, after: edit.before });
    }
    return;
  }
  if (edit.before) edit.element.style.setProperty(edit.property, edit.before, edit.priority);
  else edit.element.style.removeProperty(edit.property);
  const edits = elementEdits.get(edit.element) ?? [];
  edits.pop();
  if (!edits.length) elementEdits.delete(edit.element);
}

export function resetDesignTokens(element: HTMLElement): void {
  const source = tokenSourceFor(element);
  if (!source) return;
  for (const [path, edit] of source.themeEdits) {
    const token = source.tokens.find((item) => item.path === path);
    if (!token) continue;
    if (edit.inlineBefore) source.root.style.setProperty(token.cssVariable, edit.inlineBefore);
    else source.root.style.removeProperty(token.cssVariable);
  }
  source.themeEdits.clear();
  const originals = source.elementOriginals.get(element);
  for (const [property, original] of originals ?? []) {
    if (original.value) element.style.setProperty(property, original.value, original.priority);
    else element.style.removeProperty(property);
  }
  source.elementOriginals.delete(element);
  source.elementBindings.delete(element);
  elementEdits.delete(element);
  history.set(source, (history.get(source) ?? []).filter(
    (edit) => edit.kind === "element" && edit.element !== element,
  ));
}

export function proposedDesignTokenChanges(element: HTMLElement): string | undefined {
  const source = tokenSourceFor(element);
  if (!source) return undefined;
  const rows: string[] = [];
  for (const [property, binding] of source.elementBindings.get(element) ?? []) {
    const token = source.tokens.find((item) => item.path === binding.tokenPath && item.properties.includes(property));
    if (!token) continue;
    const declared = source.tokens.find((item) => item.path === binding.declaredPath);
    const before = declared ? `var(${declared.cssVariable}) [${declared.path}]` : binding.initialValue || "(unset)";
    if (binding.mode === "token") {
      if (declared !== token) rows.push(`Element ${property}: ${before} → var(${token.cssVariable}) [${token.path}]${declared ? " [rebind]" : ""}`);
    } else {
      rows.push(`Element ${property}: ${before} → ${binding.customValue || "(unset)"} [${declared ? "custom override" : "custom value"}]`);
    }
  }
  for (const edit of elementEdits.get(element) ?? []) {
    if (edit.kind !== "element" || source.elementBindings.get(element)?.has(edit.property)) continue;
    const token = source.tokens.find((item) => edit.after === `var(${item.cssVariable})`);
    if (token) rows.push(`Element ${edit.property}: ${edit.before || "(unset)"} → var(${token.cssVariable}) [${token.path}]`);
  }
  for (const [path, edit] of source.themeEdits) {
    const token = source.tokens.find((item) => item.path === path);
    if (!token) continue;
    rows.push(`Shared theme ${path} (${token.cssVariable}): ${edit.before} → ${edit.after}; preview scope ${token.impactSelector} (${tokenImpactCount(source, token)} matching elements)`);
  }
  if (!rows.length) return undefined;
  return ["Proposed design-token changes (preview only)", ...rows, "Token references are preserved for element assignments; refresh resets previews."].join("\n");
}
