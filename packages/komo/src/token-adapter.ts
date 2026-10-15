// Design mode's side of an app's TokenAdapter: cached token lists, per-element
// token swaps with their undo, Before/After, and the proposal text. Loaded with
// the token controls, never at startup.
import type {
  DesignEditChange,
  DesignSystem,
  DesignToken,
  ThemeState,
  TokenAdapter,
  TokenUsage,
} from "./design-system.js";

interface Swap {
  adapter: TokenAdapter;
  property: string;
  token: DesignToken;
  /** What the property used before komo's first swap, and that token when it has one. */
  from: TokenUsage;
  fromToken?: DesignToken;
  undo: () => void;
}

const swaps = new Map<Element, Swap[]>();
const lists = new WeakMap<TokenAdapter, Map<string, Promise<DesignToken[]>>>();
let showingBefore = false;

/** The theme state Design mode lists tokens for: each axis's current option. */
export function themeState(design?: DesignSystem): ThemeState {
  const state: ThemeState = {};
  for (const axis of design?.themes ?? []) {
    try { state[axis.id] = axis.current(); } catch { /* An axis that throws is left out. */ }
  }
  return state;
}

/** `list()` runs once per adapter and theme state; a failed call is retried next time. */
export function listTokens(adapter: TokenAdapter, theme: ThemeState = {}): Promise<DesignToken[]> {
  let cache = lists.get(adapter);
  if (!cache) lists.set(adapter, (cache = new Map()));
  const key = JSON.stringify(Object.entries(theme).sort());
  let tokens = cache.get(key);
  if (!tokens) {
    tokens = Promise.resolve()
      .then(() => adapter.list(Object.keys(theme).length ? theme : undefined))
      .then((list) => (Array.isArray(list) ? list.filter((token) => token && typeof token.path === "string") : []));
    tokens.catch(() => cache.delete(key));
    cache.set(key, tokens);
  }
  return tokens;
}

/** Which token each property of `element` uses; an adapter error reads as "unknown". */
export function resolveTokens(adapter: TokenAdapter, element: Element): Promise<Record<string, TokenUsage>> {
  return Promise.resolve()
    .then(() => adapter.resolve(element))
    .then((usage) => usage ?? {}, () => ({}));
}

/** Tokens suggested for one CSS property, in list order. */
export function tokensFor(tokens: readonly DesignToken[], property: string): DesignToken[] {
  return tokens.filter((token) => token.properties?.includes(property));
}

/** Colors compare as rgb(), everything else as trimmed lowercase text. */
function comparable(value: string): string {
  const text = value.trim().toLowerCase().replace(/\s+/g, "");
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(text)?.[1];
  if (!hex) return text.replace(/^rgba\((\d+,\d+,\d+),1\)$/, "rgb($1)");
  const full = hex.length < 5 ? [...hex].map((char) => char + char).join("") : hex;
  const [r, g, b, a = 255] = full.match(/../g)!.map((pair) => parseInt(pair, 16));
  return a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+(a / 255).toFixed(3)})`;
}

/** The token whose value is exactly the off-token value; only colors and dimensions. */
export function closestToken(tokens: readonly DesignToken[], value: string): DesignToken | undefined {
  const target = comparable(value);
  return target ? tokens.find((token) => (token.type === "color" || token.type === "dimension") && comparable(token.value) === target) : undefined;
}

export function tokenName(token: DesignToken): string {
  return token.label || token.path;
}

/** Tooltip text: path, ref, value and states; states are shown, never previewed. */
export function tokenTitle(token: DesignToken): string {
  return [token.path, token.ref, token.value, token.states?.length ? `States: ${token.states.join(", ")}` : "", token.description]
    .filter(Boolean).join(" · ");
}

/** A subtle marker for a value that doesn't come from a token. */
export function offTokenMarker(): HTMLElement {
  const dot = document.createElement("span");
  dot.className = "design-token-off";
  dot.setAttribute("role", "img");
  return dot;
}

/** "Not from a token · 13px", naming a token with exactly that value when there is one. */
export function markOffToken(dot: HTMLElement, value: string, match?: DesignToken): void {
  dot.title = `Not from a token · ${value || "unset"}${match ? ` · matches ${tokenName(match)}` : ""}`;
  dot.setAttribute("aria-label", dot.title);
}

function inlinePreview(element: Element, property: string, value: string): () => void {
  const style = (element as HTMLElement).style;
  if (!style) return () => {};
  const before = style.getPropertyValue(property);
  const priority = style.getPropertyPriority(property);
  style.setProperty(property, value, priority);
  return () => {
    if (before) style.setProperty(property, before, priority);
    else style.removeProperty(property);
  };
}

function preview(adapter: TokenAdapter, element: Element, property: string, token: DesignToken): () => void {
  try {
    if (adapter.preview) return adapter.preview(element, property, token) ?? (() => {});
  } catch {
    return () => {};
  }
  return inlinePreview(element, property, token.value);
}

/** The latest token komo previewed for a property, if any. */
export function swappedToken(element: Element, property: string): DesignToken | undefined {
  return [...swaps.get(element) ?? []].reverse().find((swap) => swap.property === property)?.token;
}

/**
 * Preview `token` through the adapter (or inline) and record the swap. Returns
 * the undo for Design mode's history, which pops this element's latest swap.
 */
export function swapToken(
  adapter: TokenAdapter,
  element: Element,
  property: string,
  token: DesignToken,
  from: TokenUsage,
  fromToken?: DesignToken,
): () => void {
  let stack = swaps.get(element);
  if (!stack) swaps.set(element, (stack = []));
  const first = stack.find((swap) => swap.property === property);
  stack.push({
    adapter,
    property,
    token,
    from: first?.from ?? from,
    fromToken: first ? first.fromToken : fromToken,
    undo: preview(adapter, element, property, token),
  });
  return () => undoTokenSwap(element);
}

export function undoTokenSwap(element: Element): void {
  const stack = swaps.get(element);
  stack?.pop()?.undo();
  if (stack && !stack.length) swaps.delete(element);
}

export function hasTokenSwaps(element: Element): boolean {
  return !!swaps.get(element)?.length;
}

export function resetTokenSwaps(element: Element): void {
  while (swaps.has(element)) undoTokenSwap(element);
}

/** Properties whose change the token section describes. */
export function swappedProperties(element: Element): string[] {
  return [...new Set(swaps.get(element)?.map((swap) => swap.property))];
}

/** Before takes every swap back; After previews them again in order. */
export function showTokenSwapsBefore(on: boolean): void {
  if (on === showingBefore) return;
  showingBefore = on;
  for (const [element, stack] of swaps) {
    if (on) for (const swap of [...stack].reverse()) swap.undo();
    else for (const swap of stack) swap.undo = preview(swap.adapter, element, swap.property, swap.token);
  }
}

/** Net change per property: the first swap's origin and the latest token. */
function netSwaps(element: Element): Swap[] {
  const latest = new Map<string, Swap>();
  for (const swap of swaps.get(element) ?? []) latest.set(swap.property, swap);
  return [...latest.values()].filter((swap) => !("path" in swap.from) || swap.from.path !== swap.token.path);
}

function applyText(element: Element, swap: Swap): string | undefined {
  try {
    const text = swap.adapter.describe?.(element, swap.property, swap.from, swap.token);
    // One line, and never an arrow the comment card would read as a change.
    return text ? String(text).replace(/\s+/g, " ").replace(/→/g, "->").trim().slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hook for structured proposals: each net token swap as a `DesignEdit` change.
 * The human-readable section below is derived from the same data.
 */
export function tokenSwapChanges(element: Element): DesignEditChange[] {
  return netSwaps(element).map((swap) => {
    const apply = applyText(element, swap);
    return { kind: "token", property: swap.property, from: swap.from, to: { path: swap.token.path }, ...(apply ? { apply } : {}) };
  });
}

/**
 * Lines the design-comment card parses: `Element color: before → after [path]`.
 * The adapter's describe() text follows on its own `Apply:` line.
 */
export function proposedTokenSwaps(element: Element): string | undefined {
  const rows: string[] = [];
  const ids = new Set<string>();
  for (const swap of netSwaps(element)) {
    ids.add(swap.adapter.id);
    const before = "path" in swap.from
      ? `${swap.fromToken?.value ? `${swap.fromToken.value} ` : ""}[${swap.from.path}]`
      : swap.from.offToken || "(unset)";
    rows.push(`Element ${swap.property}: ${before} → ${swap.token.value} [${swap.token.path}]`);
    const apply = applyText(element, swap);
    if (apply) rows.push(`Apply: ${apply}`);
  }
  if (!rows.length) return undefined;
  return ["Proposed design-token changes (preview only)", ...rows, `Token adapter: ${[...ids].join(", ")}`].join("\n");
}
