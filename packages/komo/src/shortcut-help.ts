import { renderKbd } from "./kbd.js";
import type { Shortcut } from "./shortcuts.js";

export function showShortcutHelp(root: ShadowRoot, commands: Array<{ label: string; shortcut?: Shortcut | null; group?: string }>, design = false) {
  if (design) {
    for (const [label, key, alt] of [["Parent element", "ArrowUp", true], ["Child element", "ArrowDown", true], ["Compare changes (with previews)", "B", false], ["Before (with previews)", "ArrowLeft", false], ["After (with previews)", "ArrowRight", false], ["Inspect focused element", "Enter", false], ["Exit design mode", "Escape", false]] as const)
      commands.push({ label, group: "Design · outside editors", shortcut: { key, alt, shift: false, ctrl: false, meta: false, label: key } });
  }
  const previous = root.activeElement?.closest(".morphing-menu__panel")
    ? root.querySelector<HTMLElement>('[data-menu-item="more"]') : root.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "komo-shortcuts";
  dialog.setAttribute("aria-label", "Keyboard shortcuts");
  const title = document.createElement("h2");
  title.textContent = "Keyboard shortcuts";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close help";
  dialog.append(title);
  for (const group of new Set(commands.filter(item => item.shortcut).map(item => item.group ?? "Review"))) {
    const heading = document.createElement("h3");
    heading.textContent = group;
    dialog.append(heading);
    for (const command of commands.filter(item => item.shortcut && (item.group ?? "Review") === group)) {
      const line = document.createElement("div");
      line.append(command.label, renderKbd(command.shortcut!));
      dialog.append(line);
    }
  }
  const note = document.createElement("p");
  note.textContent = "Review shortcuts pause while you type in an editor.";
  dialog.append(note, close);
  const listeners = new AbortController();
  // Run before the Design document handler, only for this modal's own events.
  window.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !dialog.open || !event.composedPath().includes(dialog)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dialog.close();
  }, { capture: true, signal: listeners.signal });
  close.onclick = () => dialog.close();
  dialog.addEventListener("close", () => { listeners.abort(); dialog.remove(); if (previous?.isConnected) previous.focus(); }, { once: true });
  root.append(dialog);
  dialog.showModal();
}
