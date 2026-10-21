import { isMac } from "./kbd.js";
import { resolveDesignKeys, type DesignKeys, type Shortcut } from "./shortcuts.js";

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

export function designCommands(mac = isMac(), visibility?: Shortcut | null, keys: DesignKeys = resolveDesignKeys()) {
  const canvas = "Design canvas", geometry = "Experimental geometry", text = "Text editing", compare = "Compare";
  const bound = (label: string, group: string, shortcut: Shortcut | null) => ({ label, group, shortcut });
  const plainEnter = keys.child?.key === "enter" && !keys.child.alt && !keys.child.shift && !keys.child.ctrl && !keys.child.meta;
  const customChild = plainEnter ? null : keys.child;
  return [
    // Tab and Shift+Tab walk siblings. Shift+Enter goes to the parent. Alt+↓ goes to the first child.
    // Plain Enter posts the comment when a target is selected.
    bound("Next sibling", canvas, keys.next),
    bound("Previous sibling", canvas, keys.prev),
    bound("Parent element", canvas, keys.parent),
    command("Post comment", "Enter", canvas),
    ...(customChild ? [bound("First child", canvas, customChild)] : []),
    command(customChild ? "First child (alternative)" : "First child", "ArrowDown", canvas, { alt: true }),
    command("Parent element (alternative)", "ArrowUp", canvas, { alt: true }),
    command("Exit Design mode", "Escape", canvas),
    command("Undo last preview", "z", canvas, mac ? { meta: true } : { ctrl: true }),
    command("Redo last undo", "z", canvas, mac ? { meta: true, shift: true } : { ctrl: true, shift: true }),
    ...(mac ? [] : [command("Redo last undo", "y", canvas, { ctrl: true })]),
    // M focuses the selection, so Alt+arrows there move it while Alt+arrows on the canvas keep
    // selecting parent and child. Ctrl+arrows switch spaces on macOS, so ⌘ resizes there.
    command("Focus selection to move or resize", "M", canvas),
    command("Move before previous sibling", "ArrowUp", geometry, { alt: true }),
    command("Move after next sibling", "ArrowDown", geometry, { alt: true }),
    command("Move out, after its parent", "ArrowUp", geometry, { alt: true, shift: true }),
    command("Move into previous sibling", "ArrowDown", geometry, { alt: true, shift: true }),
    command("Resize width", "ArrowRight", geometry, mac ? { meta: true } : { ctrl: true }),
    command("Resize height", "ArrowDown", geometry, mac ? { meta: true } : { ctrl: true }),
    command("Resize by 10px", "ArrowRight", geometry, mac ? { meta: true, shift: true } : { ctrl: true, shift: true }),
    command("Back to the canvas", "Escape", geometry),
    // The comments visibility key, reused in Design mode for the selection overlays.
    ...(visibility ? [{ label: "Hide or show selection · hold to peek", group: canvas, shortcut: visibility }] : []),
    command("Commit text", "Enter", text),
    command("New line", "Enter", text, { shift: true }),
    command("Cancel text edit", "Escape", text),
    command("Toggle before and after", "B", compare),
    bound("Show before", compare, keys.before),
    bound("Show after", compare, keys.after),
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
