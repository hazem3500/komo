// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MAX_TAGS, normalizeTag, tagEditor } from "../src/tag-editor";

function mount(tags: string[] = [], suggestions: string[] = []) {
  const slot = document.createElement("div");
  document.body.replaceChildren(slot);
  const added: string[] = [];
  const removed: string[] = [];
  tagEditor(slot, {
    tags,
    suggestions,
    onAdd: (tag) => added.push(tag),
    onRemove: (tag) => removed.push(tag),
  });
  const add = () => slot.querySelector<HTMLButtonElement>(".tag-add");
  const input = () => slot.querySelector<HTMLInputElement>(".tag-input");
  const type = (value: string, key = "Enter") => {
    input()!.value = value;
    input()!.dispatchEvent(new Event("input"));
    return press(key);
  };
  const press = (key: string) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    input()!.dispatchEvent(event);
    return event;
  };
  const options = () => [...slot.querySelectorAll("[role=option]")].map((option) => option.textContent);
  const chips = () => [...slot.querySelectorAll(".tag-chip span")].map((chip) => chip.textContent);
  return { slot, added, removed, add, input, type, press, options, chips };
}

describe("tag editor", () => {
  it("normalizes tags the same way the server does", () => {
    expect(normalizeTag("  #Navigation ")).toBe("navigation");
    expect(normalizeTag("design.system_v2")).toBe("design.system_v2");
    expect(normalizeTag("bad/tag")).toBeNull();
    expect(normalizeTag("-leading")).toBeNull();
    expect(normalizeTag("x".repeat(33))).toBeNull();
  });

  it("lists existing tags on open, filters them, and offers to create a new one", () => {
    const form = document.createElement("form");
    let submitted = false;
    form.addEventListener("submit", () => (submitted = true));
    const editor = mount(["ui"], ["copy", "bug", "ui", "button"]);
    form.append(editor.slot);
    document.body.append(form);
    editor.add()!.click();
    expect(document.activeElement).toBe(editor.input());
    // Already-applied tags aren't offered again.
    expect(editor.options()).toEqual(["#copy", "#bug", "#button"]);
    // Prefix matches come first; the top match is highlighted.
    editor.input()!.value = "bu";
    editor.input()!.dispatchEvent(new Event("input"));
    expect(editor.options()).toEqual(["#bug", "#button", "Create#bu"]);
    editor.press("ArrowDown");
    expect(editor.press("Enter").defaultPrevented).toBe(true);
    expect(editor.added).toEqual(["button"]);
    // The list stays open for the next tag, and a new name can be created.
    editor.input()!.value = "Launch";
    editor.input()!.dispatchEvent(new Event("input"));
    expect(editor.options()).toEqual(["Create#launch"]);
    editor.press(",");
    expect(editor.chips()).toEqual(["#button", "#launch", "#ui"]);
    // Clicking an option picks it.
    editor.slot.querySelector<HTMLElement>("[role=option]")!.click();
    expect(editor.added).toEqual(["button", "launch", "copy"]);
    // Enter on an empty field closes it.
    editor.type("");
    expect(editor.input()).toBeNull();
    expect(submitted).toBe(false);
  });

  it("rejects invalid tags, ignores duplicates, and removes with × or Backspace", () => {
    const editor = mount(["nav"]);
    editor.add()!.click();
    editor.type("bad/tag");
    expect(editor.input()!.getAttribute("aria-invalid")).toBe("true");
    expect(editor.added).toEqual([]);
    editor.type("nav");
    expect(editor.added).toEqual([]);
    editor.add()?.click();
    editor.type("", "Backspace");
    expect(editor.removed).toEqual(["nav"]);
    expect(editor.chips()).toEqual([]);
    editor.type("", "Escape");
    editor.add()!.click();
    editor.type("ui");
    editor.slot.querySelector<HTMLButtonElement>(".tag-chip button")!.click();
    expect(editor.removed).toEqual(["nav", "ui"]);
  });

  it(`stops offering to add after ${MAX_TAGS} tags`, () => {
    const editor = mount(Array.from({ length: MAX_TAGS }, (_, index) => `t${index}`));
    expect(editor.add()).toBeNull();
  });
});
