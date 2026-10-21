// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesignMode } from "../src/design-mode.js";
import { changeKind } from "../src/design-export.js";

// The card that lists pending changes while nothing is selected: counts, rows, actions and Discard all.
describe("pending changes card", () => {
  let shadow: ShadowRoot;
  let host: HTMLElement;
  let pointed: Element | null;
  let controller: ReturnType<typeof createDesignMode>;
  let comments: Array<[Element, string | undefined]>;
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => shadow.querySelector<T>(selector)!;
  const card = () => $(".design-inspector__pending");
  const rows = () => [...card().querySelectorAll<HTMLButtonElement>(".design-change-row")];
  const action = (name: string) => card().querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) ??
    [...card().querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === name)!;
  const hero = () => document.querySelector<HTMLElement>("#hero")!;
  const label = () => document.querySelector<HTMLElement>("#label")!;

  function pick(target: Element) {
    pointed = target;
    target.dispatchEvent(Object.assign(new Event("pointerdown", { bubbles: true, cancelable: true, composed: true }), { clientX: 30, clientY: 20, button: 0 }));
  }
  function set(property: string, value: string) {
    const input = $<HTMLInputElement>(`[data-property="${property}"]`);
    input.dispatchEvent(new Event("focus"));
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur"));
  }
  /** Edit and leave the element, as a reviewer does before the card appears. */
  function edit(target: HTMLElement, changes: Record<string, string>) {
    pick(target);
    for (const [property, value] of Object.entries(changes)) set(property, value);
    controller.clearSelection();
  }
  const undoKey = () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
  const redoKey = () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));

  beforeEach(async () => {
    document.body.innerHTML = '<main><button id="hero">Hello</button><span id="label">Selected text</span></main><div id="komo"></div>';
    host = document.querySelector("#komo")!;
    shadow = host.attachShadow({ mode: "open" });
    comments = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    controller = createDesignMode({
      root: shadow, host,
      targetAt: () => pointed,
      onComment: (element, proposal) => { comments.push([element, proposal]); },
      onExit() {},
    });
    controller.setActive(true);
    await controller.ready;
  });

  afterEach(() => {
    controller.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("stays hidden with no changes", () => {
    expect(card().hidden).toBe(true);
    expect($(".design-inspector__empty")).not.toBeNull();
  });

  it("counts changes, not elements, with singulars", () => {
    edit(hero(), { color: "#ff0000" });
    expect(card().hidden).toBe(false);
    expect(card().querySelector("h3")!.textContent).toBe("1 unsaved change");
    expect(card().querySelector("p")!.textContent).toBe("Preview only. Nothing is saved until you comment or copy.");
    expect(rows().map(row => row.getAttribute("aria-label"))).toEqual(["Button “Hello” · 1 change"]);
    edit(label(), { color: "#00ff00", width: "200" });
    expect(card().querySelector("h3")!.textContent).toBe("3 unsaved changes");
    // Most recent first, one 28px row each: kind icon, label and count.
    expect(rows().map(row => row.getAttribute("aria-label"))).toEqual(["“Selected text” · 2 changes", "Button “Hello” · 1 change"]);
    expect(rows().map(row => [row.dataset.kind, row.querySelector("small")!.textContent])).toEqual([["style", "2"], ["style", "1"]]);
    expect(rows()[0].querySelector("svg")).not.toBeNull();
    expect(card().textContent).not.toMatch(/runtime|proposal/i);
  });

  it("selects a row's element on click and outlines it on hover", () => {
    vi.spyOn(hero(), "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, 200, 40));
    edit(hero(), { color: "#ff0000" });
    const outline = $(".design-outline:not(.design-outline--prospective)");
    expect(outline.hidden).toBe(true);
    rows()[0].dispatchEvent(new Event("pointerenter"));
    expect(outline.hidden).toBe(false);
    expect(outline.dataset.kind).toBe("selected");
    expect(outline.style.left).toBe("20px");
    rows()[0].dispatchEvent(new Event("pointerleave"));
    expect(outline.hidden).toBe(true);
    rows()[0].click();
    expect($(".design-inspector__target").textContent).toBe("button#hero");
    expect($(".design-inspector__count").textContent).toBe("1 change");
    expect(card().hidden).toBe(true);
    // Leaving the selection again does not leave the hovered outline behind.
    controller.clearSelection();
    expect(outline.hidden).toBe(true);
  });

  it("comments with every change and copies them", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    edit(hero(), { color: "#ff0000" });
    action("Copy changes").click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]).toEqual([expect.stringMatching(/^Proposed style changes \(preview only\)\nTarget: #hero\n- color: .* → rgb\(255, 0, 0\)/)]);
    expect(action("Copy changes").dataset.tip).toBe("Copy changes");
    // One element carries its own comment; then the previews are cleared.
    action("Comment with changes").click();
    expect(comments).toEqual([[hero(), writeText.mock.calls[0][0]]]);
    expect(hero().style.color).toBe("");
    expect(card().hidden).toBe(true);
  });

  it("comments several elements on the page", () => {
    edit(hero(), { color: "#ff0000" });
    edit(label(), { color: "#00ff00" });
    action("Comment with changes").click();
    expect(comments[0][0]).toBe(document.body);
    expect(comments[0][1]!.match(/^Target: /gm)).toHaveLength(2);
  });

  it("discards all without a confirm; ⌘Z brings everything back and ⌘⇧Z discards it again", async () => {
    // komo's one polite live region, which index.ts provides.
    const live = Object.assign(document.createElement("div"), { className: "sr-only" });
    live.setAttribute("aria-live", "polite");
    shadow.append(live);
    edit(hero(), { color: "#ff0000" });
    edit(label(), { width: "200" });
    const discard = action("Discard all");
    expect(discard.dataset.tip).toMatch(/^Undo · (⌘Z|Ctrl\+Z)$/);
    discard.click();
    const discarded = async () => {
      await vi.waitFor(() => expect([hero().style.color, label().style.width]).toEqual(["", ""]));
      expect(card().hidden).toBe(true);
    };
    await discarded();
    expect(live.textContent).toBe("2 changes discarded");
    // The footer offers Undo, but not Before/After, while the set waits.
    expect($<HTMLButtonElement>('[aria-label="Undo"]').disabled).toBe(false);
    expect($(".design-inspector__compare").hidden).toBe(true);
    const restored = async () => {
      await vi.waitFor(() => expect([hero().style.color, label().style.width]).toEqual(["rgb(255, 0, 0)", "200px"]));
      expect(card().hidden).toBe(false);
      expect(card().querySelector("h3")!.textContent).toBe("2 unsaved changes");
    };
    undoKey();
    await restored();
    expect(live.textContent).toBe("2 changes restored");
    expect($<HTMLButtonElement>('[aria-label="Redo"]').disabled).toBe(false);
    redoKey();
    await discarded();
    expect($<HTMLButtonElement>('[aria-label="Redo"]').disabled).toBe(true);
    undoKey();
    await restored();
    // The restored set is a normal pending set again: select, edit and Undo as before.
    rows()[1].click();
    expect($(".design-inspector__count").textContent).toBe("1 change");
    expect(hero().style.color).toBe("rgb(255, 0, 0)");
  });

  it("drops a discarded set for good once something is selected", async () => {
    edit(hero(), { color: "#ff0000" });
    action("Discard all").click();
    pick(label());
    expect(hero().style.color).toBe("");
    expect($<HTMLButtonElement>('[aria-label="Undo"]').disabled).toBe(true);
    undoKey();
    expect(hero().style.color).toBe("");
    controller.clearSelection();
    expect(card().hidden).toBe(true);
  });

  it("names each row's kind from its proposal", () => {
    expect(changeKind("Proposed style changes (preview only)\nTarget: a")).toBe("style");
    expect(changeKind("Proposed inline text change (preview only)\n- Text: \"a\" → \"b\"")).toBe("text");
    expect(changeKind("Proposed React prop changes (preview only)")).toBe("prop");
    expect(changeKind("Proposed design-token changes (preview only)")).toBe("token");
    expect(changeKind("Proposed style changes (preview only)\n- width: 1px → 2px\n\nProposed geometry changes (preview only)")).toBe("geometry");
    expect(changeKind(undefined)).toBe("style");
  });
});
