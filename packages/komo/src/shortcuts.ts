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
  design: "D",
  restore: "Shift+K",
  comments: "L",
  visibility: "H",
};
// Defaults added after release yield to a host's existing bindings instead of throwing.
const yielding = new Set<ShortcutAction>(["visibility"]);
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
    if (other && config[action] === undefined && yielding.has(action)) {
      resolved[action] = null;
      continue;
    }
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
  const { key } = shortcut;
  if (event.key.toLowerCase() === key) return true;
  // Bare letters follow the keyboard layout. With a modifier, event.key can
  // change (Alt+C is "ç" on macOS), so match the physical key; a non-Latin
  // layout falls back to it for bare keys too.
  const code = /^[a-z]$/.test(key)
    ? `Key${key.toUpperCase()}`
    : /^\d$/.test(key) && `Digit${key}`;
  return (
    event.code === code &&
    (shortcut.shift ||
      shortcut.alt ||
      shortcut.ctrl ||
      shortcut.meta ||
      !/^[a-z\d]$/i.test(event.key))
  );
}

export function withShortcut(label: string, shortcut: Shortcut | null): string {
  return shortcut ? `${label} · ${shortcut.label}` : label;
}
