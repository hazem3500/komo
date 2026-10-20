import type { Shortcut } from "./shortcuts.js";

export function designCommands(mac = /Mac|iPhone|iPad/.test(navigator.platform)) {
  const command = (label: string, key: string, group: string, modifiers: Partial<Shortcut> = {}) => ({
    label, group, shortcut: { key, label: key, alt: false, shift: false, ctrl: false, meta: false, ...modifiers },
  });
  const canvas = "Design · canvas selection";
  return [
    command("Previous sibling", "ArrowLeft", canvas),
    command("Next sibling", "ArrowRight", canvas),
    command("Parent element", "ArrowUp", canvas, { alt: true }),
    command("Child element", "ArrowDown", canvas, { alt: true }),
    command("Compare changes (with previews)", "B", "Design · outside editors"),
    command("Before", "ArrowLeft", "Focused comparison controls"),
    command("After", "ArrowRight", "Focused comparison controls"),
    command("Inspect focused element", "Enter", canvas),
    command("Exit design mode", "Escape", canvas),
    command("Commit text preview", "Enter", "Inline text editor"),
    command("New line", "Enter", "Inline text editor", { shift: true }),
    command("Cancel text preview", "Escape", "Inline text editor"),
    command("Post comment or proposal", "Enter", "Comment composer", mac ? { meta: true } : { ctrl: true }),
    command("New line", "Enter", "Comment composer", { shift: true }),
  ];
}

/** Pointer gestures and help, listed beside the canvas keys in shortcut help. */
export function designGestures(mac = /Mac|iPhone|iPad/.test(navigator.platform)) {
  const group = "Design · canvas selection";
  return [
    { label: "Inspect element", group, keys: ["Click"], aria: "Click" },
    { label: "Select an inner target", group, keys: [mac ? "⌘" : "Ctrl", "Click"], aria: `${mac ? "Command" : "Control"} + Click` },
    { label: "Edit text", group, keys: ["Double-click"], aria: "Double-click" },
    { label: "Keyboard shortcuts", group, keys: ["?"], aria: "?" },
  ];
}
