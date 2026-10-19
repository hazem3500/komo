import { previewStyle } from "./design-popup.js";
import { inlineStyleSnapshot } from "./design-preview.js";
import { isDesignTarget } from "./design-target.js";
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
  inline?: ReturnType<typeof inlineStyleSnapshot>;
  customBefore: boolean;
}

const swaps = new Map<Element, Swap[]>();
const customs = new Map<Element, Set<string>>();
const usages = new WeakMap<Element, Map<string, TokenUsage | undefined>>();
const baselines = new WeakMap<Element, Map<string, { adapter: TokenAdapter; style: ReturnType<typeof inlineStyleSnapshot>; token?: DesignToken }>>();
let suspendedCustoms = new Map<Element, Map<string, ReturnType<typeof inlineStyleSnapshot>>>();
const lists = new WeakMap<TokenAdapter, Map<string, Promise<DesignToken[]>>>();
let showingBefore = false;

function removeCustom(element: Element, property: string) {
  const properties = customs.get(element);
  properties?.delete(property);
  if (!properties?.size) customs.delete(element);
}

export function rememberTokenUsage(element: Element, property: string, usage: TokenUsage | undefined, adapter: TokenAdapter, tokens: readonly DesignToken[]): TokenUsage | undefined {
  let known = usages.get(element);
  if (!known) usages.set(element, known = new Map());
  if (!known.has(property) || (!swaps.has(element) && !customs.has(element))) {
    known.set(property, usage);
    if (isDesignTarget(element)) {
      let properties = baselines.get(element);
      if (!properties) baselines.set(element, properties = new Map());
      const original = inlineStyleSnapshot(element, property);
      const baseline = { adapter, style: original, token: undefined as DesignToken | undefined };
      baseline.style = { ...original, get computed() { return baseline.token?.value ?? original.computed; } };
      properties.set(property, baseline);
    }
  }
  refreshBaseline(element, adapter, tokens);
  return known.get(property);
}

export function originalTokenUsage(element: Element | null, property: string): TokenUsage | undefined {
  return element ? usages.get(element)?.get(property) : undefined;
}

function refreshBaseline(element: Element, adapter: TokenAdapter, tokens: readonly DesignToken[]) {
  for (const [property, baseline] of baselines.get(element) ?? []) {
    if (baseline.adapter !== adapter) continue;
    const usage = originalTokenUsage(element, property);
    baseline.token = usage && "path" in usage ? tokens.find(token => token.path === usage.path) : undefined;
  }
}

export function effectiveTokenUsage(element: Element, property: string, fallback?: TokenUsage): TokenUsage | undefined {
  if (customs.get(element)?.has(property)) return { offToken: getComputedStyle(element).getPropertyValue(property).trim() };
  const token = swappedToken(element, property);
  return token ? { path: token.path } : fallback;
}

export function customTokenOverride(element: Element, property: string): { priority: string; undo?: () => void } | undefined {
  if (!usages.get(element)?.has(property)) return;
  let properties = customs.get(element);
  const previous = properties?.has(property) ?? false;
  const usage = usages.get(element)?.get(property);
  const wasToken = !!swappedToken(element, property) || !!usage && "path" in usage;
  if (!properties) customs.set(element, properties = new Set());
  properties.add(property);
  return { priority: "important", ...(!previous && wasToken ? { undo: () => {
    removeCustom(element, property);
    if (!showingBefore) { showTokenSwapsBefore(true); showTokenSwapsBefore(false); }
  } } : {}) };
}

export function originalTokenStyle(element: Element, property: string) {
  return baselines.get(element)?.get(property)?.style ?? swaps.get(element)?.find(swap => swap.property === property)?.inline;
}

/** The theme state Design mode lists tokens for: each axis's current option. */
export function themeState(design?: DesignSystem): ThemeState {
  const state: ThemeState = {};
  for (const axis of design?.themes ?? []) {
    try { state[axis.id] = axis.current(); } catch { /* An axis that throws is left out. */ }
  }
  return state;
}

export function watchThemes(design: DesignSystem | undefined, document: Document, update: () => void, signal: AbortSignal): void {
  if (signal.aborted || !design?.themes?.length) return;
  let key = JSON.stringify(themeState(design));
  const changed = () => {
    const next = JSON.stringify(themeState(design));
    if (next === key || signal.aborted) return;
    key = next;
    update();
  };
  const cleanups: Array<() => void> = [];
  let fallback = false;
  for (const axis of design.themes) {
    try {
      if (axis.subscribe) cleanups.push(axis.subscribe(changed));
      else fallback = true;
    } catch { fallback = true; }
  }
  const observer = fallback ? new MutationObserver(changed) : undefined;
  observer?.observe(document.documentElement, { attributes: true });
  if (document.body) observer?.observe(document.body, { attributes: true });
  signal.addEventListener("abort", () => {
    observer?.disconnect();
    for (const cleanup of cleanups) cleanup();
  }, { once: true });
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
  const text = value.trim().toLowerCase().replace(/\s+/g, " ");
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(text)?.[1];
  let channels: number[] | undefined;
  if (hex) {
    const full = hex.length < 5 ? [...hex].map((char) => char + char).join("") : hex;
    channels = full.match(/../g)!.map((pair, index) => parseInt(pair, 16) / (index > 2 ? 255 : 1));
  } else {
    // rgb() and rgba(), with commas or spaces and a slash, and a number or percentage alpha.
    const rgb = /^rgba?\(([^)]*)\)$/.exec(text)?.[1].split(/\s*[,/]\s*|\s+/);
    if (rgb && (rgb.length === 3 || rgb.length === 4) && rgb.every((part) => /^[\d.]+%?$/.test(part)))
      channels = rgb.map((part, index) => parseFloat(part) * (part.endsWith("%") ? (index > 2 ? 0.01 : 2.55) : 1));
  }
  if (!channels) return text.replace(/\s*,\s*/g, ",");
  const [r, g, b, a = 1] = channels.map((channel, index) => index > 2 ? +channel.toFixed(2) : Math.round(channel));
  return a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

/** The token whose value is exactly the off-token value, colors compared by channel. */
export function closestToken(tokens: readonly DesignToken[], value: string): DesignToken | undefined {
  const target = comparable(value);
  return target ? tokens.find((token) => typeof token.value === "string" && comparable(token.value) === target) : undefined;
}

export function tokenName(token: DesignToken): string {
  return token.label || token.path;
}

/** Tooltip text: path, ref, value and states; states are shown, never previewed. */
export function tokenTitle(token: DesignToken, value = token.value, detail?: string): string {
  return [token.path, token.ref, value, detail, token.states?.length ? `States: ${token.states.join(", ")}` : "", token.description]
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


export function previewToken(adapter: TokenAdapter, element: Element, property: string, token: DesignToken): () => void {
  const inline = isDesignTarget(element) ? inlineStyleSnapshot(element, property) : undefined;
  try {
    if (isDesignTarget(element)) element.style.setProperty(property, "");
    const undo = adapter.preview ? adapter.preview(element, property, token) : previewStyle(element, property, token.value);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      undo?.();
      inline?.restore();
    };
  } catch {
    inline?.restore();
    throw new Error("This token could not be previewed.");
  }
}

/** The latest token komo previewed for a property, if any. */
export function swappedToken(element: Element, property: string): DesignToken | undefined {
  if (customs.get(element)?.has(property)) return;
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
  const inline = isDesignTarget(element) ? inlineStyleSnapshot(element, property) : undefined;
  const customBefore = customs.get(element)?.has(property) ?? false;
  const undo = previewToken(adapter, element, property, token);
  removeCustom(element, property);
  stack.push({
    adapter,
    property,
    token,
    from: first?.from ?? from,
    fromToken: first ? first.fromToken : fromToken,
    undo, inline, customBefore,
  });
  return () => undoTokenSwap(element);
}

export function undoTokenSwap(element: Element): void {
  const stack = swaps.get(element);
  const swap = stack?.pop();
  swap?.undo();
  if (swap?.customBefore) {
    let properties = customs.get(element);
    if (!properties) customs.set(element, properties = new Set());
    properties.add(swap.property);
  } else if (swap) removeCustom(element, swap.property);
  if (stack && !stack.length) swaps.delete(element);
}

export function hasTokenSwaps(element: Element): boolean {
  return !!swaps.get(element)?.length;
}

export function hasCustomTokenOverrides(element: Element): boolean {
  return !!customs.get(element)?.size;
}

export function resetTokenSwaps(element: Element): void {
  while (swaps.has(element)) undoTokenSwap(element);
  customs.delete(element);
}

/** Take back every swap, e.g. when Design mode closes. */
export function resetAllTokenSwaps(): void {
  for (const element of [...swaps.keys()]) resetTokenSwaps(element);
  customs.clear();
  suspendedCustoms.clear();
}

/** Properties whose change the token section describes. */
export function swappedProperties(element: Element): string[] {
  return [...new Set(swaps.get(element)?.map((swap) => swap.property))].filter(property => !customs.get(element)?.has(property));
}

/** Before takes every swap back; After previews them again in order. */
export function showTokenSwapsBefore(on: boolean): void {
  if (on === showingBefore) return;
  showingBefore = on;
  if (on) {
    suspendedCustoms = new Map([...customs].flatMap(([element, properties]) => isDesignTarget(element)
      ? [[element, new Map([...properties].map(property => [property, inlineStyleSnapshot(element, property)]))] as const] : []));
  }
  for (const [element, stack] of swaps) {
    if (on) for (const swap of [...stack].reverse()) swap.undo();
    else for (const swap of stack) {
      if (swap.customBefore) swap.inline?.restore();
      if (isDesignTarget(element)) swap.inline = inlineStyleSnapshot(element, swap.property);
      swap.undo = previewToken(swap.adapter, element, swap.property, swap.token);
    }
  }
  if (!on) {
    for (const properties of suspendedCustoms.values()) for (const snapshot of properties.values()) snapshot.restore();
    suspendedCustoms.clear();
  }
}

/** Resolve existing semantic proposals again without recording an edit or changing Before/After. */
export function refreshTokenSwaps(adapter: TokenAdapter, tokens: readonly DesignToken[]): void {
  const before = showingBefore;
  if (!before) showTokenSwapsBefore(true);
  for (const element of new Set([...swaps.keys(), ...customs.keys()])) refreshBaseline(element, adapter, tokens);
  for (const stack of swaps.values()) for (const swap of stack) {
    if (swap.adapter !== adapter) continue;
    swap.token = tokens.find(token => token.path === swap.token.path) ?? swap.token;
    if ("path" in swap.from) swap.fromToken = tokens.find(token => token.path === (swap.from as { path: string }).path);
  }
  if (!before) showTokenSwapsBefore(false);
}

/** Net change per property: the first swap's origin and the latest token. */
function netSwaps(element: Element): Swap[] {
  const latest = new Map<string, Swap>();
  for (const swap of swaps.get(element) ?? []) latest.set(swap.property, swap);
  return [...latest.values()].filter((swap) => !customs.get(element)?.has(swap.property) && (!("path" in swap.from) || swap.from.path !== swap.token.path));
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
