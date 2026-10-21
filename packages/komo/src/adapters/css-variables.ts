// Token adapter that discovers a page's CSS custom properties.
//
//   import { discoverCssTokens } from "@hazem3500/komo/adapters/css-variables";
//   initKomo({ design: { tokens: discoverCssTokens() } });
//
// Reads `--*` declarations on :root / html from same-origin stylesheets, which
// includes the variables Tailwind v4 emits for `@theme`. The type comes from the
// Tailwind namespace (--color-*, --spacing-*, --radius-*, --text-*, --font-*,
// --font-weight-*, --leading-*) or, failing that, from the computed value.
// Previews and proposals write `var(--name)`, never the resolved value. Intended
// for development builds; this module is a separate entry point, outside the core bundle.
import type { DesignToken, DesignTokenType, TokenAdapter, TokenUsage } from "../design-system.js";
import { previewVariables } from "./variable-preview.js";

export interface DiscoverCssTokensOptions {
  /** Variable names to keep; defaults to every `--*` except Tailwind's internal `--tw-*`. */
  include?: (name: string) => boolean;
  /** Most tokens listed; default 300. */
  limit?: number;
  /**
   * Selector per theme option id where that option declares its variables, e.g.
   * { dark: ".dark" }. Token edits for an option preview there; an option
   * without one previews on :root, outside the other scopes.
   */
  scopes?: Record<string, string>;
}

interface Found {
  name: string;
  path: string;
  type: DesignTokenType;
  properties: string[];
  group: string;
  value: string;
  /** The variable this one is declared as, `var(--other)`. */
  declared?: string;
  /** Separator of a raw-channel color such as "19 18 19", shown as hex. */
  channels?: string;
}

const spacing = ["padding", "margin", "gap"];
const kinds: Record<string, [DesignTokenType, string[], string]> = {
  color: ["color", ["color", "background-color", "border-color"], "Color"],
  spacing: ["dimension", spacing, "Spacing"],
  radius: ["dimension", ["border-radius"], "Radius"],
  text: ["dimension", ["font-size"], "Font size"],
  font: ["fontFamily", ["font-family"], "Font"],
  leading: ["lineHeight", ["line-height"], "Line height"],
  "font-weight": ["fontWeight", ["font-weight"], "Font weight"],
};
const colorValue = /^(#[0-9a-f]{3,8}|(rgb|hsl|hwb|lab|lch|oklab|oklch|color)a?\(.*\))$/i;
const lengthValue = /^-?\d*\.?\d+(px|rem|em|%|vw|vh|ch)$/;
/** Whether a grouping rule applies now: @media and @supports are evaluated, @container is not guessed. */
const applies = (rule: CSSRule, view: Window | null = typeof window === "object" ? window : null) => {
  const { conditionText } = rule as CSSConditionRule;
  if (typeof conditionText !== "string") return true;
  if ("media" in rule) return typeof view?.matchMedia !== "function" || view.matchMedia(conditionText).matches;
  if (typeof CSS !== "undefined" && "supports" in CSS && rule.constructor.name.includes("Supports")) return CSS.supports(conditionText);
  return false;
};
const rootSelector = /^(:root|html|:host)$/;
/** Root declarations name the tokens; the current theme's scope rules only refine what they are declared as. */
const collect = (rules: CSSRuleList, into: Map<string, string>, scoped: Map<string, string>, active: Set<string>) => {
  for (const rule of Array.from(rules)) {
    if ("selectorText" in rule && (rule as CSSStyleRule).style) {
      const { selectorText, style } = rule as CSSStyleRule;
      const parts = selectorText.split(",").map((part) => part.trim());
      const root = parts.some((part) => rootSelector.test(part));
      if (!root && !parts.some((part) => active.has(part))) continue;
      for (const name of Array.from(style)) if (name.startsWith("--")) (root ? into : scoped).set(name, style.getPropertyValue(name).trim());
    } else if ("cssRules" in rule) collect((rule as CSSGroupingRule).cssRules, into, scoped, active);
  }
};
const channelValue = /^(\d{1,3})(\s*,\s*|\s+)(\d{1,3})\2(\d{1,3})$/;
/** "#131213" → "19 18 19", with the separator the page uses. */
const toChannels = (separator: string) => (value: string) => {
  const probe = document.createElement("span").style;
  probe.color = value;
  const parts = probe.color.match(/[\d.]+/g);
  return parts && parts.length > 2 ? parts.slice(0, 3).map((part) => Math.round(+part)).join(separator) : value;
};

function classify(name: string, value: string): (Pick<Found, "type" | "properties" | "group"> & { ns?: string }) | null {
  const body = name.slice(2);
  const key = Object.keys(kinds)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => body === prefix || body.startsWith(`${prefix}-`));
  if (key) {
    const [type, properties, group] = kinds[key];
    // `--font-*` holds families, but `--font-weight-*` is a weight; `--text-*-line-height` is a companion.
    if (type !== "fontFamily" || !/^\d+$/.test(value)) return { type, properties, group, ns: key };
  }
  if (colorValue.test(value)) return { type: "color", properties: kinds.color[1], group: "Color" };
  if (lengthValue.test(value)) return { type: "dimension", properties: [...spacing, "border-radius"], group: "Size" };
  return null;
}

/** [ids, classes/attrs/pseudo-classes, types] packed so a larger number is more specific. */
const specificity = (selector: string) => {
  const s = selector.replace(/::?(not|is|where|has)\(([^)]*)\)/g, " $2 ");
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+/g, " ").match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return ids * 1e6 + classes * 1e3 + types;
};

/** Shorthands whose single `var()` value applies to the longhand-style property names the panel edits. */
const sources: Record<string, string[]> = {
  "background-color": ["background-color", "background"],
  "border-color": ["border-color", "border"],
  padding: ["padding"],
  margin: ["margin"],
  gap: ["gap"],
  "border-radius": ["border-radius"],
  font: ["font"],
};

/** A `TokenAdapter` over the page's own CSS custom properties. */
export function discoverCssTokens(options: DiscoverCssTokensOptions = {}): TokenAdapter {
  const keep = options.include ?? ((name: string) => !name.startsWith("--tw-"));
  const limit = options.limit ?? 300;
  const scopes = options.scopes ?? {};
  let found = new Map<string, Found>();
  let listed = new Map<string, DesignToken>();

  function scan(theme: Record<string, string> = {}): Map<string, Found> {
    const names = new Map<string, string>();
    const scoped = new Map<string, string>();
    const active = new Set(Object.values(theme).flatMap((id) => (scopes[id] ? [scopes[id]] : [])));
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        collect(sheet.cssRules, names, scoped, active);
      } catch {
        // Cross-origin stylesheets are unreadable; they are skipped, not guessed.
      }
    }
    const computed = getComputedStyle(document.documentElement);
    const next = new Map<string, Found>();
    for (const [name, declared] of names) {
      let value = computed.getPropertyValue(name).trim();
      const kind = value && keep(name) ? classify(name, value) : null;
      if (!kind || next.size >= limit) continue;
      const body = name.slice(2);
      const { ns, ...rest } = kind;
      const dash = ns ? ns.length : body.indexOf("-");
      const path = dash > 0 && body.length > dash ? `${body.slice(0, dash)}.${body.slice(dash + 1)}` : body;
      // Raw channels ("19 18 19", used as rgb(var(--name))) read and edit as hex.
      const channels = kind.type === "color" ? channelValue.exec(value) : null;
      const rgb = channels && [channels[1], channels[3], channels[4]].map(Number);
      if (rgb?.every((channel) => channel < 256)) value = `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
      next.set(name, { name, path, value, ...rest, declared: scoped.get(name) ?? declared, ...(rgb ? { channels: channels![2].includes(",") ? ", " : " " } : {}) });
    }
    found = next;
    return next;
  }

  /** The `--name` a declaration value points at when it is exactly one `var()`. */
  const referenced = (value: string) => {
    const match = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(value.trim());
    return match && found.has(match[1]) ? match[1] : null;
  };

  function declaredName(element: Element, property: string): string | null {
    const style = (element as HTMLElement).style;
    const names = sources[property] ?? [property];
    for (const name of names) {
      const inline = style?.getPropertyValue(name);
      if (inline && style.getPropertyPriority(name) !== "important") return referenced(inline);
    }
    let best: { rank: number; value: string } | null = null;
    let order = 0;
    const visit = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if ("selectorText" in rule && (rule as CSSStyleRule).style) {
          const { selectorText, style: declared } = rule as CSSStyleRule;
          for (const part of selectorText.split(",")) {
            let hit = false;
            try {
              hit = element.matches(part.trim());
            } catch {
              // Selectors jsdom or the browser can't match are ignored.
            }
            if (!hit) continue;
            for (const name of names) {
              const value = declared.getPropertyValue(name);
              if (!value) continue;
              const rank = (declared.getPropertyPriority(name) ? 1e12 : 0) + specificity(part) * 1e3 + order++;
              if (!best || rank >= best.rank) best = { rank, value };
            }
          }
        } else if ("cssRules" in rule && applies(rule, element.ownerDocument.defaultView)) visit((rule as CSSGroupingRule).cssRules);
      }
    };
    // The element's own document: Frame's viewport iframe has its own media queries.
    for (const sheet of Array.from(element.ownerDocument.styleSheets)) {
      try {
        visit(sheet.cssRules);
      } catch {
        // Cross-origin stylesheet.
      }
    }
    return best ? referenced((best as { value: string }).value) : null;
  }

  /** Every token, declared aliases included; previews look tokens up in the latest list. */
  function list(theme?: Record<string, string>): DesignToken[] {
    const tokens = [...scan(theme).values()].map((token): DesignToken => {
      const alias = referenced(token.declared ?? "");
      return {
        path: token.path,
        type: token.type,
        value: token.value,
        properties: [...token.properties],
        group: token.group,
        ref: token.name,
        cssVariable: token.name,
        ...(alias && alias !== token.name ? { alias: found.get(alias)!.path } : {}),
        ...(token.channels ? { toCss: toChannels(token.channels) } : {}),
      };
    });
    listed = new Map(tokens.map((token) => [token.path, token]));
    return tokens;
  }

  return {
    id: "css-variables",
    list,
    previewValues(changes, theme, target) {
      if (!listed.size) list();
      return previewVariables(changes, (path) => listed.get(path), scopes, theme, target?.document);
    },
    resolve(element) {
      if (!found.size) scan();
      const usage: Record<string, TokenUsage> = {};
      const computed = getComputedStyle(element);
      for (const property of new Set([...found.values()].flatMap((token) => token.properties))) {
        const name = declaredName(element, property);
        usage[property] = name ? { path: found.get(name)!.path } : { offToken: computed.getPropertyValue(property).trim() };
      }
      return usage;
    },
    preview(element, property, token) {
      const style = (element as HTMLElement).style;
      const value = style.getPropertyValue(property);
      const priority = style.getPropertyPriority(property);
      style.setProperty(property, `var(${token.ref ?? `--${token.path.replace(".", "-")}`})`);
      return () => {
        if (value) style.setProperty(property, value, priority);
        else style.removeProperty(property);
      };
    },
    describe(element, property, from, to) {
      const add = `var(${to.ref})`;
      const old = "path" in from ? [...found.values()].find((token) => token.path === from.path)?.name : undefined;
      return old
        ? old === to.ref
          ? `Keep ${property}: ${add}`
          : `Replace var(${old}) with ${add} for ${property}`
        : `Set ${property} to ${add}`;
    },
  };
}
