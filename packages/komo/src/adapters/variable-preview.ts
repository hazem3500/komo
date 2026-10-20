// Shared by the CSS-variable and utility-class adapters: previews token values
// from the Tokens view by writing each token's custom property into one
// injected stylesheet. Bundled into each adapter entry point, never into core.
import type { DesignToken, TokenValueChange } from "../design-system.js";

type Variable = Pick<DesignToken, "cssVariable" | "ref" | "toCss">;

/** The custom property behind a token: `cssVariable`, else a `ref` such as "--color-brand". */
export const variableOf = (token?: Variable) => {
  const name = token?.cssVariable ?? (token?.ref?.startsWith("--") ? token.ref : undefined);
  return name && /^--[\w-]+$/.test(name) ? name : undefined;
};

/**
 * Preview `changes` until the returned cleanup removes the stylesheet, which
 * restores the page exactly. A change without a theme sets the variable on
 * :root. One with a theme key ("dark", "docs+dark") uses the `scopes` selector
 * of each option in the key ({ dark: ".dark" }), on one element, and excludes
 * every other scoped option, so an edit made in light never reaches dark. A
 * themed change with no scope to use applies only while `theme` is its key.
 * Declarations are !important, so they win over the page's own values.
 */
export function previewVariables(
  changes: readonly TokenValueChange[],
  token: (path: string) => Variable | undefined,
  scopes: Record<string, string> = {},
  theme?: string,
): () => void {
  const rules: string[] = [];
  for (const change of changes) {
    const found = token(change.path);
    const name = variableOf(found);
    if (!found || !name) continue;
    const target = change.alias ? variableOf(token(change.alias)) : undefined;
    let value = change.value;
    try { value = target ? `var(${target})` : found.toCss ? found.toCss(change.value) : change.value; } catch { /* Keep the readable value. */ }
    if (!value || /[{};<]/.test(value)) continue;
    const parts = change.theme?.split("+") ?? [];
    const own = parts.flatMap((part) => (scopes[part] ? [`:is(${scopes[part]})`] : []));
    const others = change.theme ? Object.entries(scopes).filter(([id]) => !parts.includes(id)).map(([, selector]) => `:not(${selector})`) : [];
    if (change.theme && !own.length && !others.length && change.theme !== theme) continue;
    rules.push(`${own.join("") || ":root"}${others.join("")}{${name}:${value}!important}`);
  }
  if (!rules.length) return () => {};
  const style = document.createElement("style");
  style.dataset.komoTokenPreview = "";
  style.textContent = rules.join("");
  (document.head ?? document.documentElement).append(style);
  return () => style.remove();
}
