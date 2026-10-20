import type { Shortcut } from "./shortcuts.js";

export function shortcutKeys(shortcut: Shortcut, mac = /Mac|iPhone|iPad/.test(navigator.platform)) {
  const names = [shortcut.ctrl && "Control", shortcut.alt && "Alt", shortcut.shift && "Shift", shortcut.meta && "Meta", shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key].filter(Boolean) as string[];
  const symbols: Record<string, string> = mac ? { Control: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" } : { Control: "Ctrl", Meta: "Meta" };
  return { aria: names.join("+"), spoken: names.map(key => key === "Meta" && mac ? "Command" : key === "Alt" && mac ? "Option" : key).join(" + "), keys: names.map(key => symbols[key] ?? ({ ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" } as Record<string, string>)[key] ?? key) };
}

/** Native keycaps shared by DOM surfaces and the existing lazy menu. */
export function renderKbd(shortcut: Shortcut, mac?: boolean): HTMLElement {
  const keys = shortcutKeys(shortcut, mac);
  const group = document.createElement("span");
  group.className = "komo-kbd";
  group.setAttribute("role", "img");
  group.setAttribute("aria-label", keys.spoken);
  for (const key of keys.keys) {
    const cap = document.createElement("kbd");
    cap.textContent = key;
    cap.setAttribute("aria-hidden", "true");
    group.append(cap);
  }
  return group;
}
