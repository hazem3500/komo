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
  // The menu floats at the root, outside the slot.
  const options = () => [...document.querySelectorAll("[role=option]")].map((option) => option.textContent);
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
    document.querySelector<HTMLElement>("[role=option]")!.click();
    expect(editor.added).toEqual(["button", "launch", "copy"]);
    // Enter on an empty field closes it.
    editor.type("");
    expect(editor.input()).toBeNull();
    expect(document.querySelectorAll(".tag-options")).toHaveLength(0);
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

  it("opens one header-anchored popover after the slot is attached to a shadow root", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    document.body.replaceChildren(host);
    const trigger = document.createElement("button");
    const slot = document.createElement("div");
    const added: string[] = [], removed: string[] = [];
    tagEditor(slot, { tags: ["ui"], suggestions: ["ui", "bug"], trigger, onAdd: tag => added.push(tag), onRemove: tag => removed.push(tag) });
    root.append(trigger, slot);
    trigger.click();
    const popover = root.querySelector<HTMLElement>(".tag-popover")!;
    const input = popover.querySelector<HTMLInputElement>("input")!;
    expect(root.querySelectorAll(".tag-popover")).toHaveLength(1);
    expect(slot.querySelector("input")).toBeNull();
    expect(root.activeElement).toBe(input);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(popover.querySelector('[aria-pressed="true"]')?.textContent).toContain("#ui");
    input.value = "new label";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(added).toEqual(["new label"]);
    expect(slot.textContent).toContain("#new label");
    expect(root.activeElement).toBe(input);
    popover.querySelector<HTMLButtonElement>('[data-tag="ui"]')!.click();
    expect(removed).toEqual(["ui"]);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(root.querySelector(".tag-popover")).toBeNull();
    expect(root.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps an empty metadata row hidden and dismisses on outside pointer or focus", () => {
    const trigger = document.createElement("button"), slot = document.createElement("div"), outside = document.createElement("button");
    document.body.replaceChildren(trigger, slot, outside);
    tagEditor(slot, { tags: [], suggestions: ["long tag name for narrow widths"], trigger, onAdd: () => {}, onRemove: () => {} });
    expect(slot.hidden).toBe(true);
    trigger.click();
    expect(slot.hidden).toBe(true);
    expect(document.querySelectorAll(".tag-popover input")).toHaveLength(1);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(document.querySelector(".tag-popover")).toBeNull();
    trigger.click();
    outside.focus();
    expect(document.querySelector(".tag-popover")).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("allows managing tags at the limit and confines the popup horizontally to the thread", () => {
    const dialog = document.createElement("div"); dialog.className = "dialog";
    const trigger = document.createElement("button"), slot = document.createElement("div");
    dialog.append(trigger, slot); document.body.replaceChildren(dialog);
    trigger.getBoundingClientRect = () => ({ left: 260, right: 284, top: 80, bottom: 104, width: 24, height: 24 }) as DOMRect;
    dialog.getBoundingClientRect = () => ({ left: 16, right: 300, width: 284, top: 60, bottom: 300, height: 240 }) as DOMRect;
    const removed: string[] = [];
    tagEditor(slot, { tags: Array.from({ length: MAX_TAGS }, (_, i) => `tag${i}`), suggestions: ["another"], trigger, onAdd: () => {}, onRemove: tag => removed.push(tag) });
    trigger.click();
    const popover = document.querySelector<HTMLElement>(".tag-popover")!;
    expect(parseFloat(popover.style.left)).toBeGreaterThanOrEqual(24);
    expect(parseFloat(popover.style.left) + parseFloat(popover.style.width)).toBeLessThanOrEqual(292);
    expect(popover.querySelector<HTMLButtonElement>('[data-tag="another"]')!.disabled).toBe(true);
    popover.querySelector<HTMLButtonElement>('[data-tag="tag0"]')!.click();
    expect(removed).toEqual(["tag0"]);
    expect(popover.querySelector<HTMLButtonElement>('[data-tag="another"]')!.disabled).toBe(false);
    trigger.click();
  });
});
