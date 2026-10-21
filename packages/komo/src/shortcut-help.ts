import { designCommands, designGestures } from "./design-commands.js";
import { renderKbd, renderKeycaps } from "./kbd.js";
import type { Shortcut } from "./shortcuts.js";

type HelpCommand = { label: string; shortcut?: Shortcut | null; group?: string; keys?: string[]; aria?: string };

export function showShortcutHelp(root: ShadowRoot, commands: HelpCommand[], design = false) {
  if (design) commands.push(...designGestures(), ...designCommands(undefined, commands.find(item => (item as { id?: string }).id === "visibility")?.shortcut));
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
  const listed = commands.filter(item => item.shortcut || item.keys);
  for (const group of new Set(listed.map(item => item.group ?? "Review"))) {
    const heading = document.createElement("h3");
    heading.textContent = group;
    dialog.append(heading);
    for (const command of listed.filter(item => (item.group ?? "Review") === group)) {
      const line = document.createElement("div");
      line.append(command.label, command.shortcut ? renderKbd(command.shortcut) : renderKeycaps(command.keys!, command.aria ?? command.keys!.join(" + ")));
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
