import type { ToolbarItem } from "./types.js";

const builtIn = new Set<unknown>(["browse", "comment", "design", "comments", "more", "account", "dismiss"]);
export const defaultToolbarItems: readonly ToolbarItem[] = ["browse", "comment", "design", "|", "comments", "|", "more", "account", "|", "dismiss"];

/** Configured entries in order; unknown or repeated ids are ignored with one warning. */
export function normalizeToolbarItems(items: unknown): readonly ToolbarItem[] {
  if (items === undefined) return defaultToolbarItems;
  const result: ToolbarItem[] = [], ignored: unknown[] = [];
  if (!Array.isArray(items)) ignored.push(items);
  else
    for (const item of items)
      if (item === "|" || (builtIn.has(item) && !result.includes(item))) result.push(item);
      else ignored.push(item);
  if (ignored.length) console.warn(`komo: ignoring invalid or repeated toolbar.items: ${ignored.map(item => String(JSON.stringify(item))).join(", ")}.`);
  return Array.isArray(items) ? result : defaultToolbarItems;
}

/** Drops unavailable controls, then leading, trailing and doubled separators. */
export function toolbarLayout(items: readonly string[], available: (id: string) => boolean): string[] {
  const layout: string[] = [];
  for (const item of items)
    if (item !== "|" ? available(item) : layout.length && layout.at(-1) !== "|") layout.push(item);
  if (layout.at(-1) === "|") layout.pop();
  return layout;
}

/** Bar entries in order; without a layout, items in the bar, then More, with Dismiss last. */
export function barLayout(items: readonly { id: string; showInBar?: boolean }[], bar?: readonly string[]): readonly string[] {
  if (bar) return bar;
  const ids = items.filter(item => item.showInBar !== false).map(item => item.id);
  return [...ids.filter(id => id !== "dismiss"), "more", ...ids.filter(id => id === "dismiss")];
}

export const badgeText = (count: number) => (count > 99 ? "99+" : String(count));
export const countLabel = (label: string, count?: number) => (count ? `${label}, ${count} open comment${count === 1 ? "" : "s"}` : label);
