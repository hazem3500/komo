import type { Shortcut } from "./shortcuts.js";

/** Apple platforms label modifiers ⌘ ⌥ ⌃ ⇧; others spell out Ctrl and Alt. */
export const isMac = () =>
  /mac|iphone|ipad/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform);

// Configured keys arrive lower-cased ("arrowleft"); named keys read in their DOM casing.
const NAMED = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Escape", "Tab", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown"];
const named = (key: string) => key.length === 1 ? key.toUpperCase() : NAMED.find(name => name.toLowerCase() === key.toLowerCase()) ?? key;

export function shortcutKeys(shortcut: Shortcut, mac = isMac()) {
  const names = [shortcut.ctrl && "Control", shortcut.alt && "Alt", shortcut.shift && "Shift", shortcut.meta && "Meta", named(shortcut.key)].filter(Boolean) as string[];
  const symbols: Record<string, string> = mac ? { Control: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" } : { Control: "Ctrl", Meta: "Meta" };
  return { aria: names.join("+"), spoken: names.map(key => key === "Meta" && mac ? "Command" : key === "Alt" && mac ? "Option" : key).join(" + "), keys: names.map(key => symbols[key] ?? ({ ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Enter: "↵", Escape: "Esc" } as Record<string, string>)[key] ?? key) };
}

/**
 * Keycap look: "surface" is a quiet filled chip tinted from the surrounding ink,
 * so it reads on dark and light surfaces alike; "outline" draws a bordered cap.
 */
export type KbdVariant = "surface" | "outline";

/** Native keycaps shared by DOM surfaces and the existing lazy menu. */
export function renderKbd(shortcut: Shortcut, mac?: boolean, variant: KbdVariant = "surface"): HTMLElement {
  const keys = shortcutKeys(shortcut, mac);
  return renderKeycaps(keys.keys, keys.spoken, variant);
}

/** Keycaps for any sequence, such as a pointer gesture, read aloud as `label`. */
export function renderKeycaps(keys: string[], label: string, variant: KbdVariant = "surface"): HTMLElement {
  const group = document.createElement("span");
  group.className = "komo-kbd";
  group.dataset.variant = variant;
  group.setAttribute("role", "img");
  group.setAttribute("aria-label", label);
  for (const key of keys) {
    const cap = document.createElement("kbd");
    cap.textContent = key;
    cap.setAttribute("aria-hidden", "true");
    group.append(cap);
  }
  return group;
}
