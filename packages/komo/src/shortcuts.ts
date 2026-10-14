import type { KomoShortcuts } from "./types.js";

export type ShortcutAction = keyof KomoShortcuts;

export interface Shortcut {
  key: string;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  /** Display form, e.g. "Shift+K". */
  label: string;
}

const defaults: Record<ShortcutAction, string> = {
  comment: "C",
  browse: "V",
  restore: "Shift+K",
};
const modifiers = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const reserved = new Set(["escape", "tab"]);

function parse(action: ShortcutAction, value: string): Shortcut {
  const parts = value.split("+").map((part) => part.trim());
  // "Shift++" binds the plus key.
  if (parts.length > 1 && parts.at(-1) === "" && parts.at(-2) === "")
    parts.splice(-2, 2, "+");
  const key = parts.pop() ?? "";
  const held = new Set<string>();
  for (const part of parts) {
    const name = modifiers.find((m) => m.toLowerCase() === part.toLowerCase());
    if (!name || held.has(name))
      throw new Error(`Invalid komo shortcut for ${action}: "${value}".`);
    held.add(name);
  }
  if (!key || reserved.has(key.toLowerCase()))
    throw new Error(`Invalid komo shortcut for ${action}: "${value}".`);
  const display = key.length === 1 ? key.toUpperCase() : key;
  return {
    key: key.toLowerCase(),
    shift: held.has("Shift"),
    alt: held.has("Alt"),
    ctrl: held.has("Ctrl"),
    meta: held.has("Meta"),
    label: [...modifiers.filter((m) => held.has(m)), display].join("+"),
  };
}

/** Resolve configured shortcuts; false disables one. Throws on invalid or duplicate keys. */
export function resolveShortcuts(
  config: KomoShortcuts = {},
): Record<ShortcutAction, Shortcut | null> {
  const resolved = {} as Record<ShortcutAction, Shortcut | null>;
  const seen = new Map<string, ShortcutAction>();
  for (const action of Object.keys(defaults) as ShortcutAction[]) {
    const value = config[action] ?? defaults[action];
    if (value === false) {
      resolved[action] = null;
      continue;
    }
    if (typeof value !== "string")
      throw new Error(`Invalid komo shortcut for ${action}.`);
    const shortcut = parse(action, value);
    const other = seen.get(shortcut.label.toLowerCase());
    if (other)
      throw new Error(
        `komo shortcuts for ${other} and ${action} both use ${shortcut.label}.`,
      );
    seen.set(shortcut.label.toLowerCase(), action);
    resolved[action] = shortcut;
  }
  return resolved;
}

export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: Shortcut | null,
): boolean {
  if (
    !shortcut ||
    event.shiftKey !== shortcut.shift ||
    event.altKey !== shortcut.alt ||
    event.ctrlKey !== shortcut.ctrl ||
    event.metaKey !== shortcut.meta
  )
    return false;
  if (event.key.toLowerCase() === shortcut.key) return true;
  // Alt and Shift can change event.key (Alt+C is "ç" on macOS); fall back to the physical key.
  const { key } = shortcut;
  return (
    key.length === 1 &&
    (/[a-z]/.test(key)
      ? event.code === `Key${key.toUpperCase()}`
      : /[0-9]/.test(key) && event.code === `Digit${key}`)
  );
}

export function withShortcut(label: string, shortcut: Shortcut | null): string {
  return shortcut ? `${label} · ${shortcut.label}` : label;
}
