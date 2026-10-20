// Token adapter for utility-class design systems such as Tailwind.
//
//   import { tailwindTokens, tailwindSpacing } from "@hazem3500/komo/adapters/tailwind";
//   initKomo({ design: { tokens: tailwindTokens({ tokens: [...table, ...tailwindSpacing()] }) } });
//
// A token is a utility class. The app supplies the table (usually generated from
// its design-system foundations); komo never parses the Tailwind config, and reads
// the page's stylesheets only with `onlyGenerated`.
// This module is a separate entry point and never enters the core bundle.
import type { DesignToken, DesignTokenType, PreviewTarget, ThemeAxis, ThemeState, TokenAdapter, TokenUsage, TokenValueChange } from "../design-system.js";
import { inlineStyleSnapshot } from "../design-preview.js";
import { previewVariables } from "./variable-preview.js";
import { isDesignTarget } from "../design-target.js";

/** One utility class (or a set of equivalent classes) that sets design tokens. */
export interface TailwindToken {
  /** Stable dot path recorded on proposals, e.g. "color.text.primary". Unique in the table. */
  path: string;
  type: DesignTokenType;
  /**
   * The utility class, e.g. "text-primary". With several, the first is the canonical
   * class komo adds when previewing; the rest are recognised aliases (e.g. "rounded-md").
   */
  class: string | string[];
  /**
   * CSS properties the class sets, as the Design panel names them: "color",
   * "background-color", "padding", "padding-left", "border-radius", "font-size"...
   * A shorthand also covers its longhands ("padding" covers "padding-top", etc.).
   */
  properties: string[];
  /** Value when no theme-specific value applies, e.g. "#1f1f1f" or "8px". */
  value?: string;
  /**
   * Values per theme. Keys are option ids ("dark"), "axis=option" pairs ("mode=dark"),
   * or combinations joined with "+" ("docs+dark"). The most specific key that
   * fully matches the theme state wins; otherwise `value` is used.
   */
  values?: Record<string, string>;
  label?: string;
  group?: string;
  description?: string;
  /** Interaction states the class carries itself, e.g. ["hover", "active", "disabled"]. */
  states?: string[];
  /**
   * The CSS variable the class reads, e.g. "--color-surface" for `bg-surface`.
   * With it, the Tokens view previews new values page-wide by setting the variable.
   */
  cssVariable?: string;
  /** Convert an edited value into the variable's form, e.g. "#131213" to "19 18 19". */
  toCss?(value: string): string;
}

export interface TailwindTable {
  tokens: TailwindToken[];
}

export interface TailwindTokensOptions {
  /** Theme axes used to work out the current theme when `list()` gets none. */
  themes?: ThemeAxis[];
  /**
   * Properties reported as `{ offToken: computed value }` when no table class sets
   * them. Defaults to every property named in the table; `false` reports none.
   */
  offToken?: string[] | false;
  /**
   * List only tokens whose class has a rule in the page's stylesheets, so the picker
   * skips classes Tailwind's JIT never generated. Sheets komo cannot read (cross-origin
   * without CORS, such as an imported font stylesheet) are assumed not to hold the
   * utilities and are skipped. Every token stays listed while a <link> stylesheet is
   * loading or failed, or when no readable sheet has a style rule. `{ strict: true }`
   * also keeps every token while any sheet is unreadable, for utilities served
   * cross-origin; `true` is the default object. Elements that already use a hidden
   * class still resolve to it. In Design mode, a <style> or <link> added, removed,
   * edited or loaded refreshes the list, including in an open picker.
   */
  onlyGenerated?: boolean | { strict?: boolean };
  /** Return false to leave a token out of `list()`; it still resolves on elements. */
  filter?(token: TailwindToken): boolean;
  /**
   * Selector per theme option id where that option sets its variables, e.g.
   * { dark: ".dark" }, for token values previewed through `cssVariable`.
   */
  scopes?: Record<string, string>;
}

const sides = ["top", "right", "bottom", "left"];
/** Shorthands the Design panel edits, and the longhands they cover. */
const longhands: Record<string, string[]> = {
  padding: sides.map((side) => `padding-${side}`),
  margin: sides.map((side) => `margin-${side}`),
  gap: ["row-gap", "column-gap"],
  "border-radius": ["top-left", "top-right", "bottom-right", "bottom-left"].map((corner) => `border-${corner}-radius`),
  "border-width": sides.map((side) => `border-${side}-width`),
  "border-color": sides.map((side) => `border-${side}-color`),
};

interface Entry {
  token: TailwindToken;
  classes: string[];
  /** Explicit properties plus the longhands of any shorthand among them. */
  covers: Set<string>;
}

interface PreviewState {
  original: string | null;
  stack: { property: string; entry: Entry }[];
  inline: Map<string, ReturnType<typeof inlineStyleSnapshot>>;
}

const classesOf = (value: string | string[]) => (Array.isArray(value) ? value : [value]).flatMap((item) => item.split(/\s+/)).filter(Boolean);
const readClass = (element: Element) => element.getAttribute("class");
/** Base-state utility name: variants ("hover:", "md:") are not the base state; "!" marks important. */
const baseClass = (name: string) => (name.includes(":") ? null : name.replace(/^!|!$/g, ""));

// Class selectors, still escaped as the CSSOM serializes them (".p-1\.5", ".md\:p-4", ".\32 xl\:p-4").
// list() compares them with CSS.escape(class), the same serialization.
const classPattern = /\.((?:\\[\da-f]{1,6} ?|\\[^]|[\w-]|[^\0-\x7f])+)/gi;
type AnyRule = CSSRule & { selectorText?: string; cssRules?: CSSRuleList; styleSheet?: CSSStyleSheet | null };
let seen: unknown[] | undefined;
/** The last scan: classes found, style rules seen, and whether a sheet was unreadable or a <link> pending. */
let scan: [found: Set<string>, rules: number, unreadable: boolean, pending: boolean] = [new Set(), 0, false, false];

const documentSheets = () => [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])];

/**
 * Changes when a sheet is added, removed or replaced (a <style>'s text changed),
 * its rule count changes, or a <link> stylesheet loads.
 */
function sheetKey(sheets = documentSheets()): unknown[] {
  const key: unknown[] = [...document.querySelectorAll<HTMLLinkElement>("link[rel~=stylesheet]:not([disabled])")].map((link) => link.sheet);
  for (const sheet of sheets) {
    let count;
    try {
      count = sheet.cssRules.length;
    } catch {}
    key.push(sheet, count);
  }
  return key;
}

const sameKey = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((item, index) => item === b[index]);

/** Whether a mutation can change the page's stylesheets: a <style> or <link> added, removed or edited. */
const isSheet = (node: Node | null) => /^(style|link)$/i.test(node?.nodeName ?? "");
const touchesSheets = (record: MutationRecord) =>
  isSheet(record.target) || isSheet(record.target.parentNode) ||
  [...record.addedNodes, ...record.removedNodes].some((node) => isSheet(node) || !!(node as Element).querySelector?.("style,link"));

/** Calls `onChange` when the stylesheets' key changes, while subscribed; nothing runs between DOM changes. */
function watchSheets(onChange: () => void): () => void {
  let last = sheetKey();
  const check = () => {
    const key = sheetKey();
    if (sameKey(key, last)) return;
    last = key;
    onChange();
  };
  const observer = new MutationObserver((records) => records.some(touchesSheets) && check());
  const events = new AbortController();
  observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "media", "rel", "href"] });
  // <link> load and error events don't bubble, so they are caught on the way down.
  for (const type of ["load", "error"]) document.addEventListener(type, check, { capture: true, signal: events.signal });
  return () => {
    observer.disconnect();
    events.abort();
  };
}

/**
 * Escaped class names with a rule in the document, or null when komo cannot tell:
 * a <link> stylesheet is still loading or failed, no readable sheet has a style rule,
 * or, with `strict`, any sheet (or @import) is unreadable.
 */
function generatedClasses(strict: boolean): Set<string> | null {
  // Re-scan only when the stylesheets' key changes.
  const sheets = documentSheets();
  const key = sheetKey(sheets);
  // The first call always scans: a page with no sheets has an empty key too.
  if (!seen || !sameKey(key, seen)) {
    seen = key;
    scan = [new Set(), 0, false, key.includes(null)];
    const walk = (rules: () => CSSRuleList) => {
      let list;
      try {
        list = rules(); // throws for cross-origin sheets without CORS
      } catch {
        return void (scan[2] = true);
      }
      for (const rule of list as Iterable<AnyRule>) {
        if (rule.selectorText != null) {
          scan[1]++;
          for (const match of rule.selectorText.matchAll(classPattern)) scan[0].add(match[1]);
        }
        if (rule.cssRules) walk(() => rule.cssRules!); // @media, @supports, @layer, @container, nested rules
        if ("styleSheet" in rule) walk(() => rule.styleSheet!.cssRules); // @import
      }
    };
    for (const sheet of sheets) walk(() => sheet.cssRules);
  }
  // Unknown: komo cannot prove a class is missing, so nothing is hidden.
  return scan[3] || !scan[1] || (strict && scan[2]) ? null : scan[0];
}

/** Pick the theme-specific value: the most specific fully-matching key, else `value`. */
export function tokenValue(token: Pick<TailwindToken, "value" | "values">, theme: ThemeState = {}): string {
  let best: string | undefined;
  let score = 0;
  for (const [key, value] of Object.entries(token.values ?? {})) {
    const parts = key.split("+");
    const matches = parts.every((part) => {
      const [axis, option] = part.split("=");
      return option === undefined ? Object.values(theme).includes(axis) : theme[axis] === option;
    });
    if (matches && parts.length > score) [best, score] = [value, parts.length];
  }
  return best ?? token.value ?? "";
}

/** A `TokenAdapter` whose tokens are utility classes listed in `table`. */
export function tailwindTokens(table: TailwindTable, options: TailwindTokensOptions = {}): TokenAdapter {
  const entries: Entry[] = table.tokens.map((token) => ({
    token,
    classes: classesOf(token.class),
    covers: new Set(token.properties.flatMap((property) => [property, ...(longhands[property] ?? [])])),
  }));
  const byClass = new Map<string, Entry>();
  for (const entry of entries) for (const name of entry.classes) byClass.set(name, entry);
  const byPath = new Map(entries.map((entry) => [entry.token.path, entry]));
  const offToken = options.offToken === false ? [] : options.offToken ?? [...new Set(table.tokens.flatMap((token) => token.properties))];
  const previews = new WeakMap<Element, PreviewState>();

  /** Table classes on the element, in class order, with the entry each one names. */
  const matched = (className: string | null) =>
    (className ?? "")
      .split(/\s+/)
      .flatMap((name) => {
        const base = baseClass(name);
        const entry = base ? byClass.get(base) : undefined;
        return entry ? [{ name, entry }] : [];
      });

  /** Winner per property: the narrowest class (Tailwind emits longhand utilities later), then the last. */
  function winners(className: string | null) {
    const result = new Map<string, { name: string; entry: Entry }>();
    for (const match of matched(className))
      for (const property of match.entry.covers) {
        const current = result.get(property);
        if (!current || match.entry.covers.size <= current.entry.covers.size) result.set(property, match);
      }
    // A shorthand belongs to a class only if that class also wins every longhand.
    for (const [property, match] of result)
      if (longhands[property]?.some((longhand) => result.get(longhand)?.entry !== match.entry)) result.delete(property);
    return result;
  }

  /** Swap one class in: drop table classes it fully replaces, keeping position and variants. */
  function swap(className: string, property: string, entry: Entry) {
    const names = className.split(/\s+/).filter(Boolean);
    const add = entry.classes[0];
    let at = -1;
    const kept = names.filter((name, index) => {
      const base = baseClass(name);
      const other = base ? byClass.get(base) : undefined;
      const conflicts =
        !!other &&
        (other === entry ||
          ([...other.covers].every((item) => entry.covers.has(item)) &&
            (other.covers.has(property) || (longhands[property] ?? []).some((item) => other.covers.has(item)))));
      if (conflicts && at < 0) at = index;
      return !conflicts;
    });
    const before = names.slice(0, at < 0 ? names.length : at).filter((name) => kept.includes(name)).length;
    kept.splice(before, 0, add);
    return kept.join(" ");
  }

  function render(element: Element, state: PreviewState) {
    if (!state.stack.length) {
      if (state.original === null) element.removeAttribute("class");
      else element.setAttribute("class", state.original);
      previews.delete(element);
      return;
    }
    element.setAttribute(
      "class",
      state.stack.reduce((className, item) => swap(className, item.property, item.entry), state.original ?? ""),
    );
  }

  return {
    id: "tailwind",
    list(theme) {
      const state = theme ?? Object.fromEntries((options.themes ?? []).map((axis) => [axis.id, axis.current()]));
      const present = options.onlyGenerated ? generatedClasses(options.onlyGenerated !== true && !!options.onlyGenerated.strict) : null;
      return entries.filter(({ token, classes }) => (!present || present.has(CSS.escape(classes[0]))) && (!options.filter || options.filter(token))).map(({ token, classes }): DesignToken => ({
        path: token.path,
        type: token.type,
        value: tokenValue(token, state),
        properties: [...token.properties],
        ref: classes[0],
        ...(token.label ? { label: token.label } : {}),
        ...(token.group ? { group: token.group } : {}),
        ...(token.description ? { description: token.description } : {}),
        ...(token.states ? { states: [...token.states] } : {}),
        ...(token.cssVariable ? { cssVariable: token.cssVariable } : {}),
        ...(token.toCss ? { toCss: token.toCss } : {}),
      }));
    },
    // Only tables that name their variables can preview token values.
    ...(table.tokens.some((token) => token.cssVariable) ? {
      previewValues(changes: TokenValueChange[], theme?: string, target?: PreviewTarget) {
        return previewVariables(changes, (path) => byPath.get(path)?.token, options.scopes, theme, target?.document);
      },
    } : {}),
    // Only `onlyGenerated` lists depend on the page, so only they report changes.
    ...(options.onlyGenerated ? { subscribe: watchSheets } : {}),
    resolve(element) {
      const result: Record<string, TokenUsage> = {};
      const won = winners(readClass(element));
      if (isDesignTarget(element)) {
        for (const [property, match] of won) {
          const inline = element.style.getPropertyValue(property);
          const importantClass = match.name.startsWith("!") || match.name.endsWith("!");
          if (inline && (!importantClass || element.style.getPropertyPriority(property) === "important")) won.delete(property);
        }
        for (const [property, match] of won)
          if (longhands[property]?.some(longhand => won.get(longhand)?.entry !== match.entry)) won.delete(property);
      }
      for (const [property, match] of won) result[property] = { path: match.entry.token.path };
      let style: CSSStyleDeclaration | undefined;
      for (const property of offToken) {
        if (won.has(property) || longhands[property]?.some((longhand) => won.has(longhand))) continue;
        style ??= getComputedStyle(element);
        const value = style.getPropertyValue(property);
        if (value) result[property] = { offToken: value };
      }
      return result;
    },
    preview(element, property, token) {
      const entry = byPath.get(token.path);
      if (!entry) return () => {};
      const state: PreviewState = previews.get(element) ?? { original: readClass(element), stack: [], inline: new Map() };
      previews.set(element, state);
      if (isDesignTarget(element)) {
        if (!state.inline.has(property)) state.inline.set(property, inlineStyleSnapshot(element, property));
        element.style.setProperty(property, "");
      }
      const item = { property, entry };
      state.stack.push(item);
      render(element, state);
      return () => {
        const index = state.stack.indexOf(item);
        if (index < 0) return;
        state.stack.splice(index, 1);
        render(element, state);
        if (!state.stack.some(item => item.property === property)) {
          state.inline.get(property)?.restore();
          state.inline.delete(property);
        }
      };
    },
    describe(element, property, from, to) {
      const add = byPath.get(to.path)?.classes[0] ?? to.ref ?? to.path;
      if ("path" in from) {
        const entry = byPath.get(from.path);
        const original = previews.get(element)?.original ?? readClass(element);
        const present = matched(original).find((match) => match.entry === entry)?.name;
        const remove = present ?? entry?.classes[0] ?? from.path;
        return remove === add ? `Keep class "${add}"` : `Replace class "${remove}" with "${add}"`;
      }
      return `Add class "${add}"`;
    },
  };
}

/** Spacing utility families and the CSS properties each sets. */
const spacingFamilies: Record<string, [group: string, properties: string[]]> = {
  p: ["Padding", ["padding"]],
  px: ["Padding", ["padding-left", "padding-right"]],
  py: ["Padding", ["padding-top", "padding-bottom"]],
  pt: ["Padding", ["padding-top"]],
  pr: ["Padding", ["padding-right"]],
  pb: ["Padding", ["padding-bottom"]],
  pl: ["Padding", ["padding-left"]],
  m: ["Margin", ["margin"]],
  mx: ["Margin", ["margin-left", "margin-right"]],
  my: ["Margin", ["margin-top", "margin-bottom"]],
  mt: ["Margin", ["margin-top"]],
  mr: ["Margin", ["margin-right"]],
  mb: ["Margin", ["margin-bottom"]],
  ml: ["Margin", ["margin-left"]],
  gap: ["Gap", ["gap"]],
  "gap-x": ["Gap", ["column-gap"]],
  "gap-y": ["Gap", ["row-gap"]],
};

/** Tailwind's default spacing steps (multiples of the base unit). */
export const defaultSpacingSteps = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96];

export interface TailwindSpacingOptions {
  /** Utility families; defaults to every padding, margin and gap family (p, px, ..., m, ..., gap, gap-x, gap-y). */
  prefix?: string[];
  /** Pixels per step; Tailwind's default is 4. */
  scale?: number;
  /** Steps to emit; defaults to Tailwind's spacing scale (0 to 96). */
  steps?: number[];
}

/**
 * Table entries for spacing utilities, e.g. `p-4` → padding 16px at scale 4.
 * Paths are "spacing.<class>", e.g. "spacing.px-2.5".
 */
export function tailwindSpacing(options: TailwindSpacingOptions = {}): TailwindToken[] {
  const scale = options.scale ?? 4;
  const steps = options.steps ?? defaultSpacingSteps;
  return (options.prefix ?? Object.keys(spacingFamilies)).flatMap((prefix) => {
    const family = spacingFamilies[prefix];
    if (!family) throw new Error(`komo: unknown spacing prefix "${prefix}"`);
    return steps.map((step): TailwindToken => {
      const name = `${prefix}-${step}`;
      return { path: `spacing.${name}`, type: "dimension", class: name, properties: family[1], value: `${step * scale}px`, group: family[0], label: name };
    });
  });
}
