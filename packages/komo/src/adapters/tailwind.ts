// Token adapter for utility-class design systems such as Tailwind.
//
//   import { tailwindTokens, tailwindSpacing } from "@hazem3500/komo/adapters/tailwind";
//   initKomo({ design: { tokens: tailwindTokens({ tokens: [...table, ...tailwindSpacing()] }) } });
//
// A token is a utility class. The app supplies the table (usually generated from
// its design-system foundations); komo never parses CSS or the Tailwind config.
// This module is a separate entry point and never enters the core bundle.
import type { DesignToken, DesignTokenType, ThemeAxis, ThemeState, TokenAdapter, TokenUsage } from "../design-system.js";

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
   * or combinations joined with "+" ("track+dark"). The most specific key that
   * fully matches the theme state wins; otherwise `value` is used.
   */
  values?: Record<string, string>;
  label?: string;
  group?: string;
  description?: string;
  /** Interaction states the class carries itself, e.g. ["hover", "active", "disabled"]. */
  states?: string[];
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
}

const classesOf = (value: string | string[]) => (Array.isArray(value) ? value : [value]).flatMap((item) => item.split(/\s+/)).filter(Boolean);
const readClass = (element: Element) => element.getAttribute("class");
/** Base-state utility name: variants ("hover:", "md:") are not the base state; "!" marks important. */
const baseClass = (name: string) => (name.includes(":") ? null : name.replace(/^!|!$/g, ""));

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
      return entries.map(({ token, classes }): DesignToken => ({
        path: token.path,
        type: token.type,
        value: tokenValue(token, state),
        properties: [...token.properties],
        ref: classes[0],
        ...(token.label ? { label: token.label } : {}),
        ...(token.group ? { group: token.group } : {}),
        ...(token.description ? { description: token.description } : {}),
        ...(token.states ? { states: [...token.states] } : {}),
      }));
    },
    resolve(element) {
      const result: Record<string, TokenUsage> = {};
      const won = winners(readClass(element));
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
      const state = previews.get(element) ?? { original: readClass(element), stack: [] };
      previews.set(element, state);
      const item = { property, entry };
      state.stack.push(item);
      render(element, state);
      return () => {
        const index = state.stack.indexOf(item);
        if (index < 0) return;
        state.stack.splice(index, 1);
        render(element, state);
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
