import { isMac } from "./kbd.js";
import type { Shortcut } from "./shortcuts.js";

const command = (label: string, key: string, group: string, modifiers: Partial<Shortcut> = {}) => ({
  label, group, shortcut: { key, label: key, alt: false, shift: false, ctrl: false, meta: false, ...modifiers },
});

/** Keys that work in every mode, listed with the toolbar's own commands. */
export function reviewCommands() {
  return [
    command("Post comment", "Enter", "Comments"),
    command("New line", "Enter", "Comments", { shift: true }),
  ];
}

export function designCommands(mac = isMac(), visibility?: Shortcut | null) {
  const canvas = "Design canvas", geometry = "Experimental geometry", text = "Text editing", compare = "Compare";
  return [
    command("Previous sibling", "ArrowLeft", canvas),
    command("Next sibling", "ArrowRight", canvas),
    command("Parent element", "ArrowUp", canvas, { alt: true }),
    command("Child element", "ArrowDown", canvas, { alt: true }),
    command("Inspect focused element", "Enter", canvas),
    command("Exit Design mode", "Escape", canvas),
    // M focuses the selection, so Alt+arrows there move it while Alt+arrows on the canvas keep
    // selecting parent and child. Ctrl+arrows switch spaces on macOS, so ⌘ resizes there.
    command("Focus selection to move or resize", "M", canvas),
    command("Move before previous sibling", "ArrowUp", geometry, { alt: true }),
    command("Move after next sibling", "ArrowDown", geometry, { alt: true }),
    command("Move out, after its parent", "ArrowUp", geometry, { alt: true, shift: true }),
    command("Move into previous sibling", "ArrowDown", geometry, { alt: true, shift: true }),
    command("Resize width (Shift: 10px)", "ArrowRight", geometry, mac ? { meta: true } : { ctrl: true }),
    command("Resize height (Shift: 10px)", "ArrowDown", geometry, mac ? { meta: true } : { ctrl: true }),
    command("Back to the canvas", "Escape", geometry),
    // The comments visibility key, reused in Design mode for the selection overlays.
    ...(visibility ? [{ label: "Hide or show selection · hold to peek", group: canvas, shortcut: visibility }] : []),
    command("Commit text", "Enter", text),
    command("New line", "Enter", text, { shift: true }),
    command("Cancel text edit", "Escape", text),
    command("Toggle before and after", "B", compare),
    command("Show before", "ArrowLeft", compare),
    command("Show after", "ArrowRight", compare),
  ];
}

/** Pointer gestures and help, listed beside the canvas keys in shortcut help. */
export function designGestures(mac = isMac()) {
  const group = "Design canvas";
  return [
    { label: "Inspect element", group, keys: [], gesture: "Click", aria: "Click" },
    { label: "Select inner element", group, keys: [mac ? "⌘" : "Ctrl"], gesture: "Click", aria: `${mac ? "Command" : "Control"} + Click` },
    { label: "Edit text", group, keys: [], gesture: "Double-click", aria: "Double-click" },
    { label: "Keyboard shortcuts", group, keys: ["?"], aria: "?" },
  ];
}
