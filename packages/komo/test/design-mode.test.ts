// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesignMode } from "../src/design-mode.js";

describe("design mode preview inspector", () => {
  let shadow: ShadowRoot;
  let host: HTMLElement;
  let page: HTMLElement;
  let button: HTMLButtonElement;
  let pointed: Element | null;
  let controller: ReturnType<typeof createDesignMode>;
  let exited: number;
  let comments: Element[];
  let commentProposals: Array<string | undefined>;

  function pointer(type: string, target: Element) {
    pointed = target;
    const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
    Object.defineProperties(event, { clientX: { value: 30 }, clientY: { value: 20 }, button: { value: 0 } });
    target.dispatchEvent(event);
    return event;
  }

  beforeEach(async () => {
    document.body.innerHTML = '<main><button id="hero">Hello</button><span id="label">Selected text</span><div id="nested"><strong>Rich</strong> text</div><iframe title="Preview"></iframe></main><div id="komo"></div>';
    page = document.querySelector("main")!;
    button = document.querySelector("#hero")!;
    pointed = button;
    host = document.querySelector("#komo")!;
    shadow = host.attachShadow({ mode: "open" });
    exited = 0;
    comments = [];
    commentProposals = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    controller = createDesignMode({
      root: shadow,
      host,
      targetAt: () => pointed,
      onComment: (element, proposal) => { comments.push(element); commentProposals.push(proposal); },
      onExit: () => { exited++; },
    });
    controller.setActive(true);
    await controller.ready;
  });

  afterEach(() => {
    controller.destroy();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("shows a compact empty state until an element is selected", () => {
    const inspector = shadow.querySelector<HTMLElement>(".design-inspector")!;
    const empty = shadow.querySelector<HTMLElement>(".design-inspector__empty")!;
    const comment = shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:last-child")!;
    expect(inspector.hasAttribute("data-empty")).toBe(true);
    expect(empty.querySelector("strong")?.textContent).toBe("Select an element");
    expect([...empty.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "Click to inspect",
      "Ctrl-click for an inner target",
      "Alt+↑ parent · Alt+↓ child",
      "Double-click text to edit",
      "Esc to exit",
    ]);
    expect([...empty.querySelectorAll("kbd")].map((key) => key.textContent)).toEqual(["Click", "Ctrl-click", "Alt+↑", "Alt+↓", "Double-click", "Esc"]);
    expect(empty.querySelector("svg")).not.toBeNull();
    expect(comment.hidden).toBe(true);
    pointer("pointerdown", button);
    expect(inspector.hasAttribute("data-empty")).toBe(false);
    expect(shadow.querySelector(".design-inspector__empty")).toBeNull();
    expect(comment.hidden).toBe(false);
  });

  it("selects a page element and applies live preview styles", () => {
    const event = pointer("pointerdown", button);
    expect(event.defaultPrevented).toBe(true);
    expect(shadow.querySelector(".design-inspector__target")?.textContent).toBe("button#hero");
    const color = shadow.querySelector<HTMLInputElement>('[data-property="color"]')!;
    color.dispatchEvent(new Event("focus"));
    color.value = "#ff0000";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    expect(button.style.color).toBe("rgb(255, 0, 0)");
    expect(shadow.querySelector<HTMLElement>(".design-inspector__count")?.textContent).toBe("1 change");
    expect(shadow.querySelector<HTMLElement>(".design-inspector__count")?.title).toContain("Undo");
    controller.setActive(false);
    expect(button.style.color).toBe("");
    controller.setActive(true);
    expect(button.style.color).toBe("rgb(255, 0, 0)");
    expect(shadow.querySelector(".design-inspector__target")?.textContent).toBe("button#hero");
    controller.destroy();
    expect(button.style.color).toBe("");
  });

  it("keeps a selected target solid while prospective hover leaves its controls and edits intact", () => {
    const label = document.querySelector<HTMLElement>("#label")!;
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, 200, 40));
    vi.spyOn(label, "getBoundingClientRect").mockReturnValue(new DOMRect(240, 50, 100, 20));
    pointer("pointerdown", button);
    const color = shadow.querySelector<HTMLInputElement>('[data-property="color"]')!;
    color.dispatchEvent(new Event("focus"));
    color.value = "#ff0000";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    const selected = shadow.querySelector<HTMLElement>('.design-outline:not(.design-outline--prospective)')!;
    const prospective = shadow.querySelector<HTMLElement>('.design-outline--prospective')!;
    pointer("pointermove", label);
    expect(selected.hidden).toBe(false);
    expect(selected.dataset.kind).toBe("selected");
    expect(selected.style.left).toBe("20px");
    expect(prospective.hidden).toBe(false);
    expect(prospective.style.left).toBe("240px");
    expect(shadow.querySelector('[data-property="color"]')).toBe(color);
    expect(button.style.color).toBe("rgb(255, 0, 0)");
    expect(shadow.querySelector('.design-inspector__target')?.textContent).toBe("button#hero");
    pointer("pointermove", button);
    expect(prospective.hidden).toBe(true);
    pointer("pointermove", label);
    pointer("pointermove", shadow.querySelector('.design-inspector__close')!);
    expect(prospective.hidden).toBe(true);
    expect(selected.hidden).toBe(false);
    pointed = null;
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    expect(prospective.hidden).toBe(true);
    expect(button.style.color).toBe("rgb(255, 0, 0)");
  });

  it("selects an SVG icon, drills into a shape explicitly, and supports keyboard parent/child navigation", () => {
    const link = document.createElement("a");
    link.href = "/example";
    link.innerHTML = '<svg id="report-icon" width="24" height="24"><path id="report-shape" d="M0 0h24v24H0z"/></svg><span>Example</span>';
    page.append(link);
    const svg = link.querySelector("svg")!, path = link.querySelector("path")!;
    const title = () => shadow.querySelector('.design-inspector__target')?.textContent;
    pointer("pointerdown", path);
    expect(title()).toBe("svg#report-icon");
    const color = shadow.querySelector<HTMLInputElement>('[data-property="color"]')!;
    color.dispatchEvent(new Event("focus"));
    color.value = "#ff0000";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    expect(svg.style.color).toBe("rgb(255, 0, 0)");
    expect(link.style.color).toBe("");
    expect(path.style.color).toBe("");
    expect(shadow.querySelector('.design-text-edit')).toBeNull();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    path.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    pointed = path;
    path.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }));
    expect(title()).toBe("path#report-shape");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));
    expect(title()).toBe("svg#report-icon");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    expect(title()).toBe("path#report-shape");
    shadow.querySelector<HTMLInputElement>('[data-property="color"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, composed: true }));
    expect(title()).toBe("path#report-shape");
  });

  it("clears visible selection on explicit exit while preserving a recoverable pending proposal", () => {
    pointer("pointerdown", button);
    const color = shadow.querySelector<HTMLInputElement>('[data-property="color"]')!;
    color.dispatchEvent(new Event("focus"));
    color.value = "#ff0000";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    shadow.querySelector<HTMLButtonElement>('[aria-label="Exit design mode"]')!.click();
    expect(controller.active).toBe(false);
    expect(exited).toBe(1);
    controller.setActive(true);
    expect(shadow.querySelector('.design-inspector__empty')).not.toBeNull();
    expect(button.style.color).toBe("rgb(255, 0, 0)");
    expect(shadow.querySelector<HTMLElement>('.design-inspector__pending')!.hidden).toBe(false);
    shadow.querySelector<HTMLButtonElement>('.design-inspector__pending button')!.click();
    expect(shadow.querySelector('.design-inspector__target')?.textContent).toBe("button#hero");
    expect(shadow.querySelector('.design-inspector__count')?.textContent).toBe("1 change");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    controller.setActive(true);
    expect(shadow.querySelector('.design-inspector__empty')).not.toBeNull();
  });

  it("lets a host picker consume Escape before Design exits and still handles feedback-owned Escape", () => {
    pointer("pointerdown", button);
    const popup = document.createElement("div");
    const input = document.createElement("input");
    input.role = "combobox";
    popup.append(input);
    page.append(popup);
    input.focus();
    const consume = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.target !== input) return;
      event.preventDefault();
      popup.remove();
      button.focus();
    };
    document.addEventListener("keydown", consume, true);
    try {
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(controller.active).toBe(true);
      expect(exited).toBe(0);
      expect(document.activeElement).toBe(button);
      expect(
        shadow.querySelector(".design-inspector__target")?.textContent,
      ).toBe("button#hero");
    } finally {
      document.removeEventListener("keydown", consume, true);
    }
    const reserved = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    reserved.preventDefault();
    shadow
      .querySelector('[aria-label="Exit design mode"]')!
      .dispatchEvent(reserved);
    expect(controller.active).toBe(false);
    expect(exited).toBe(1);
    controller.setActive(true);
    const unclaimed = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(unclaimed);
    expect(controller.active).toBe(false);
    expect(unclaimed.defaultPrevented).toBe(true);
    expect(exited).toBe(2);
  });

  it("does not resume a replacement element with the same id after detach or a route change", async () => {
    pointer("pointerdown", button);
    button.remove();
    const replacement = document.createElement("button");
    replacement.id = "hero";
    page.append(replacement);
    await vi.waitFor(() => expect(shadow.querySelector('.design-inspector__empty')).not.toBeNull());
    controller.setActive(false);
    controller.setActive(true);
    expect(shadow.querySelector('.design-inspector__empty')).not.toBeNull();
    expect(replacement.style.color).toBe("");
    controller.destroy();
    let route = "/one";
    controller = createDesignMode({ root: shadow, host, targetAt: () => replacement, page: () => route, onComment() {}, onExit() {} });
    controller.setActive(true);
    await controller.ready;
    controller.select(replacement);
    controller.setActive(false);
    route = "/two";
    controller.setActive(true);
    expect(shadow.querySelector('.design-inspector__empty')).not.toBeNull();
  });

  it("hands only the selected preview to a comment and retains other pending edits", async () => {
    pointer("pointerdown", button);
    const color = shadow.querySelector<HTMLInputElement>('[data-property="color"]')!;
    color.dispatchEvent(new Event("focus"));
    color.value = "#ff0000";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    const label = document.querySelector<HTMLElement>("#label")!;
    pointer("pointerdown", label);
    const width = shadow.querySelector<HTMLInputElement>('[data-property="width"]')!;
    width.dispatchEvent(new Event("focus"));
    width.value = "200";
    width.dispatchEvent(new Event("input", { bubbles: true }));
    shadow.querySelector<HTMLButtonElement>('.design-inspector__actions button:last-child')!.click();
    await vi.waitFor(() => expect(comments).toEqual([label]));
    expect(commentProposals[0]).toContain("200px");
    expect(label.style.width).toBe("");
    expect(button.style.color).toBe("rgb(255, 0, 0)");
    controller.setActive(false);
    expect(button.style.color).toBe("");
    controller.setActive(true);
    expect(button.style.color).toBe("rgb(255, 0, 0)");
    expect(label.style.width).toBe("");
    controller.select(button);
    expect(shadow.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.disabled).toBe(false);
  });

  it("lets an exit cancel a pending comment handoff without losing its preview history", async () => {
    pointer("pointerdown", button);
    const color = shadow.querySelector<HTMLInputElement>('[data-property="color"]')!;
    color.dispatchEvent(new Event("focus"));
    color.value = "#ff0000";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    shadow.querySelector<HTMLButtonElement>('.design-inspector__actions button:last-child')!.click();
    controller.setActive(false);
    await Promise.resolve();
    expect(comments).toEqual([]);
    expect(button.style.color).toBe("");
    controller.setActive(true);
    expect(button.style.color).toBe("rgb(255, 0, 0)");
  });

  it("compares Before and After from the footer and with ←, → and B", () => {
    pointer("pointerdown", button);
    const compare = shadow.querySelector<HTMLElement>(".design-inspector__compare")!;
    expect(compare.hidden).toBe(true);
    const color = shadow.querySelector<HTMLInputElement>('[data-property="color"]')!;
    color.dispatchEvent(new Event("focus"));
    color.value = "#ff0000";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    expect(compare.hidden).toBe(false);
    const press = (key: string, target: EventTarget = document.body) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true }));
    press("ArrowLeft");
    expect(button.style.color).toBe("");
    expect(compare.querySelector('[aria-pressed="true"]')?.textContent).toBe("Before");
    press("ArrowRight");
    expect(button.style.color).toBe("rgb(255, 0, 0)");
    press("b");
    expect(button.style.color).toBe("");
    // Typing in a field never toggles, and editing a field returns to After first.
    press("b", color);
    expect(button.style.color).toBe("");
    color.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(button.style.color).toBe("rgb(255, 0, 0)");
    compare.querySelector<HTMLButtonElement>("button")!.click();
    expect(button.style.color).toBe("");
    // Leaving Design mode restores the page, whichever side was showing.
    controller.setActive(false);
    expect(button.style.color).toBe("");
  });

  it("edits leaf text inline, keeps pasted markup as text, and supports undo/reset/comment", async () => {
    const label = document.querySelector<HTMLElement>("#label")!;
    pointer("pointerdown", label);
    const edit = shadow.querySelector<HTMLButtonElement>("[aria-label='Edit selected text inline']")!;
    expect(edit.disabled).toBe(false);
    edit.click();
    await vi.waitFor(() => expect(label.getAttribute("contenteditable")).toBe("true"));
    expect(label.getAttribute("contenteditable")).toBe("true");
    expect(shadow.querySelector<HTMLElement>(".design-inspector__status")?.textContent).toContain("Editing text");
    expect(document.activeElement).toBe(label);

    const selection = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(label);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    const paste = new Event("paste", { bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "<img src=x onerror=alert(1)>" } });
    label.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(label.childElementCount).toBe(0);
    expect(label.textContent).toBe("Selected text<img src=x onerror=alert(1)>");

    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, composed: true });
    label.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(label.hasAttribute("contenteditable")).toBe(false);
    expect(shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:first-child")!.disabled).toBe(false);

    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:first-child")!.click();
    expect(label.textContent).toBe("Selected text");
    edit.click();
    await vi.waitFor(() => expect(label.getAttribute("contenteditable")).toBe("true"));
    label.textContent = "Reset me";
    label.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    label.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, composed: true }));
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:nth-child(2)")!.click();
    expect(label.textContent).toBe("Selected text");

    edit.click();
    await vi.waitFor(() => expect(label.getAttribute("contenteditable")).toBe("true"));
    label.textContent = "Comment proposal";
    label.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    label.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, composed: true }));
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:last-child")!.click();
    await vi.waitFor(() => expect(comments.at(-1)).toBe(label));
    expect(commentProposals.at(-1)).toContain('"Selected text" → "Comment proposal"');
  });

  it("retains edited text, styles and history through a brief Design exit, with explicit Reset", async () => {
    const label = document.querySelector<HTMLElement>("#label")!;
    pointer("pointerdown", label);
    shadow.querySelector<HTMLButtonElement>("[aria-label='Edit selected text inline']")!.click();
    await vi.waitFor(() => expect(label.getAttribute("contenteditable")).toBe("true"));
    label.textContent = "Edited";
    label.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    label.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, composed: true }));
    const color = shadow.querySelector<HTMLInputElement>('[data-property="color"]')!;
    color.dispatchEvent(new Event("focus"));
    color.value = "#ff0000";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    expect(label.textContent).toBe("Edited");
    expect(label.style.color).toBe("rgb(255, 0, 0)");
    controller.setActive(false);
    expect(label.textContent).toBe("Selected text");
    expect(label.style.color).toBe("");
    controller.setActive(true);
    expect(label.textContent).toBe("Edited");
    expect(label.style.color).toBe("rgb(255, 0, 0)");
    const undo = shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:first-child")!;
    expect(undo.disabled).toBe(false);
    pointer("pointerdown", label);
    expect(shadow.querySelector<HTMLElement>(".design-inspector__compare")!.hidden).toBe(false);
    shadow.querySelector<HTMLButtonElement>('[aria-label="Reset"]')!.click();
    expect(label.textContent).toBe("Selected text");
    expect(label.style.color).toBe("");
    expect(undo.disabled).toBe(true);
  });

  it("double-clicking text selects it and starts inline editing", async () => {
    const label = document.querySelector<HTMLElement>("#label")!;
    const doubleClick = (target: Element) => {
      pointer("pointerdown", target);
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, clientX: 30, clientY: 20, detail: 2 }));
    };
    doubleClick(label);
    await vi.waitFor(() => expect(label.getAttribute("contenteditable")).toBe("true"));
    expect(document.activeElement).toBe(label);
    label.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, composed: true }));
    expect(label.hasAttribute("contenteditable")).toBe(false);

    // A double-click that lands outside the selection must not edit the previous selection.
    pointer("pointerdown", label);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, detail: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(label.hasAttribute("contenteditable")).toBe(false);

    const nested = document.querySelector<HTMLElement>("#nested")!;
    doubleClick(nested);
    await vi.waitFor(() => expect(nested.getAttribute("contenteditable")).toBe("true"));
  });

  it("edits text inside nested markup in place without changing its structure", async () => {
    const edit = () => shadow.querySelector<HTMLButtonElement>("[aria-label='Edit selected text inline']")!;
    const nested = document.querySelector<HTMLElement>("#nested")!;
    const strong = nested.querySelector("strong")!;
    const rich = strong.firstChild as Text;
    pointer("pointerdown", nested);
    expect(edit().disabled).toBe(false);
    edit().click();
    await vi.waitFor(() => expect(nested.getAttribute("contenteditable")).toBe("true"));
    const input = (inputType: string, range: Range, data: string | null = null) => {
      const event = new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true, composed: true });
      Object.defineProperty(event, "getTargetRanges", { value: () => [range] });
      nested.dispatchEvent(event);
      return event;
    };
    const at = (node: Node, start: number, end = start) => {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      return range;
    };
    expect(input("insertText", at(rich, 4), "er").defaultPrevented).toBe(true);
    expect(input("deleteContentBackward", at(rich, 0, 1)).defaultPrevented).toBe(true);
    expect(nested.innerHTML).toBe("<strong>icher</strong> text");
    // Deleting across the <strong> boundary, or starting a new paragraph, is refused.
    const across = document.createRange();
    across.setStart(rich, 4);
    across.setEnd(nested.lastChild!, 1);
    input("deleteContentForward", across);
    input("insertParagraph", at(rich, 2));
    expect(nested.querySelector("strong")).toBe(strong);
    expect(nested.innerHTML).toBe("<strong>icher</strong> text");

    nested.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, composed: true }));
    expect(nested.hasAttribute("contenteditable")).toBe(false);
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:first-child")!.click();
    expect(nested.innerHTML).toBe("<strong>Rich</strong> text");
    expect(nested.querySelector("strong")!.firstChild).toBe(rich);
  });

  it("edits button and component text but keeps private text read-only", async () => {
    const edit = () => shadow.querySelector<HTMLButtonElement>("[aria-label='Edit selected text inline']")!;
    const status = () => shadow.querySelector(".design-inspector__status")?.textContent;
    pointer("pointerdown", button);
    edit().click();
    await vi.waitFor(() => expect(button.getAttribute("contenteditable")).toBe("true"));
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, composed: true }));
    // Text inside a registered React component is editable even without a mapped textProp.
    const card = document.createElement("article");
    card.dataset.komoInspectable = "promo-card";
    card.innerHTML = "<p>Preview interactions: <span>3</span></p>";
    page.append(card);
    const body = card.querySelector("p")!;
    pointer("pointerdown", body);
    edit().click();
    await vi.waitFor(() => expect(body.getAttribute("contenteditable")).toBe("true"));
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, composed: true }));
    const secret = document.createElement("span");
    secret.dataset.private = "true";
    secret.innerHTML = "do <b>not</b> edit";
    page.append(secret);
    pointer("pointerdown", secret);
    edit().click();
    await vi.waitFor(() => expect(status()).toContain("stays read-only"));
    expect(secret.hasAttribute("contenteditable")).toBe(false);
  });

  it("lets Space reach the text being edited instead of reselecting it", async () => {
    const label = document.querySelector<HTMLElement>("#label")!;
    pointer("pointerdown", label);
    shadow.querySelector<HTMLButtonElement>("[aria-label='Edit selected text inline']")!.click();
    await vi.waitFor(() => expect(label.getAttribute("contenteditable")).toBe("true"));
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true, composed: true });
    label.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(false);
    expect(label.getAttribute("contenteditable")).toBe("true");
  });

  it("Escape cancels an inline edit first, then exits Design mode", async () => {
    const label = document.querySelector<HTMLElement>("#label")!;
    pointer("pointerdown", label);
    shadow.querySelector<HTMLButtonElement>("[aria-label='Edit selected text inline']")!.click();
    await vi.waitFor(() => expect(label.getAttribute("contenteditable")).toBe("true"));
    label.textContent = "Not saved";
    label.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    label.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, composed: true }));
    expect(label.textContent).toBe("Selected text");
    expect(controller.active).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(controller.active).toBe(false);
  });

  it("moves keyboard focus into the inspector when Design mode opens", () => {
    expect(shadow.activeElement).toBe(
      shadow.querySelector<HTMLButtonElement>(".design-inspector__close"),
    );
  });

  it("uses a short open/close transition and hides the closing inspector from assistive tech", () => {
    const panel = shadow.querySelector<HTMLElement>(".design-inspector")!;
    expect(panel.dataset.state).toBe("active");
    expect(panel.getAttribute("aria-hidden")).toBe("false");
    vi.useFakeTimers();
    controller.setActive(false);
    expect(panel.dataset.state).toBe("closing");
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    vi.advanceTimersByTime(250);
    expect(panel.hidden).toBe(true);
    vi.useRealTimers();
  });

  it("closes immediately when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion") }));
    controller.setActive(false);
    const panel = shadow.querySelector<HTMLElement>(".design-inspector")!;
    expect(panel.hidden).toBe(true);
    expect(panel.hasAttribute("data-state")).toBe(false);
  });

  it("lets keyboard users select a focused page element without activating it", () => {
    button.focus();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, composed: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(shadow.querySelector(".design-inspector__target")?.textContent).toBe("button#hero");
  });

  it("supports undo and reset, then restores original inline declarations on destroy", () => {
    button.style.setProperty("font-size", "18px", "important");
    pointer("pointerdown", button);
    const input = shadow.querySelector<HTMLInputElement>('[data-property="font-size"]')!;
    input.dispatchEvent(new Event("focus"));
    input.value = "26";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(button.style.getPropertyValue("font-size")).toBe("26px");
    const undo = shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button")!;
    expect(undo.disabled).toBe(false);
    undo.click();
    expect(button.style.getPropertyValue("font-size")).toBe("18px");
    expect(button.style.getPropertyPriority("font-size")).toBe("important");
    expect(shadow.activeElement).toBe(shadow.querySelector(".design-inspector__close"));
    input.dispatchEvent(new Event("focus"));
    input.value = "30";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const reset = shadow.querySelector<HTMLButtonElement>('.design-inspector__actions [aria-label="Reset"]')!;
    reset.click();
    expect(button.style.getPropertyValue("font-size")).toBe("18px");
    expect(shadow.activeElement).toBe(shadow.querySelector(".design-inspector__close"));
    input.dispatchEvent(new Event("focus"));
    input.value = "30";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    controller.destroy();
    expect(button.style.getPropertyValue("font-size")).toBe("18px");
    expect(button.style.getPropertyPriority("font-size")).toBe("important");
  });

  it("exits without hijacking clicks outside mode and can hand the target to comments", async () => {
    controller.setActive(false);
    const ordinary = pointer("pointerdown", button);
    expect(ordinary.defaultPrevented).toBe(false);
    controller.setActive(true);
    pointer("pointerdown", button);
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:last-child")!.click();
    await vi.waitFor(() => expect(comments).toEqual([button]));
    expect(exited).toBe(0);
  });

  it("labels iframe selection as frame-only and exits on Escape", () => {
    const frame = document.querySelector("iframe")!;
    controller.destroy();
    controller = createDesignMode({ root: shadow, host, targetAt: () => frame, onComment: () => {}, onExit: () => { exited++; } });
    controller.setActive(true);
    pointer("pointerdown", frame);
    expect(shadow.querySelector(".design-inspector__heading small")?.textContent).toContain("contents are isolated");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(controller.active).toBe(false);
    expect(exited).toBe(1);
  });

  it("scrubs a number by dragging its glyph and nudges with arrow keys, as one Undo each", () => {
    button.style.fontSize = "18px";
    pointer("pointerdown", button);
    const field = shadow.querySelector<HTMLElement>('[data-field-property="font-size"]')!;
    const glyph = field.querySelector<HTMLElement>(".design-field__glyph")!;
    const value = field.querySelector<HTMLInputElement>('[data-property="font-size"]')!;
    const drag = (type: string, clientX: number, shiftKey = false) => {
      const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
      Object.defineProperties(event, { clientX: { value: clientX }, pointerId: { value: 1 }, shiftKey: { value: shiftKey } });
      glyph.dispatchEvent(event);
      return event;
    };
    expect(drag("pointerdown", 100).defaultPrevented).toBe(true);
    drag("pointermove", 112);
    expect(value.value).toBe("24");
    drag("pointermove", 114, true);
    expect(value.value).toBe("34");
    drag("pointerup", 114);
    expect(button.style.fontSize).toBe("34px");
    const undo = shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button")!;
    undo.click();
    expect(button.style.fontSize).toBe("18px");
    expect(undo.disabled).toBe(true);

    const input = shadow.querySelector<HTMLInputElement>('[data-property="font-size"]')!;
    input.focus();
    const key = (key: string, shiftKey = false) => {
      const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      return event;
    };
    expect(key("ArrowUp").defaultPrevented).toBe(true);
    key("ArrowUp", true);
    key("ArrowDown");
    expect(input.value).toBe("28");
    expect(button.style.fontSize).toBe("28px");
    input.blur();
    undo.click();
    expect(button.style.fontSize).toBe("18px");
  });

  it("shows only the sections that apply and adds a fill from its empty section", () => {
    const sections = () => [...shadow.querySelectorAll(".design-section")].map((item) =>
      `${item.querySelector("summary, .design-section__title")?.textContent}${item.querySelector(".design-group") ? "" : " (empty)"}`);
    const box = document.createElement("div");
    box.append(document.createElement("span"));
    page.append(box);
    pointer("pointerdown", box);
    expect(sections()).toEqual(["Layout", "Fill (empty)", "Border (empty)"]);
    expect(shadow.querySelector('[data-property="gap"]')).toBeNull();
    expect(shadow.querySelector("[aria-label='Edit selected text inline']")).toBeNull();

    box.style.display = "flex";
    box.style.border = "2px solid red";
    pointer("pointerdown", box);
    expect(shadow.querySelector('[data-property="gap"]')).not.toBeNull();
    expect(sections()).toEqual(["Layout", "Fill (empty)", "Border"]);

    pointer("pointerdown", button);
    expect(sections()).toEqual(["Layout", "Typography", "Fill (empty)", "Border (empty)"]);
    expect(shadow.querySelector(".design-section:nth-child(2) [aria-label='Edit selected text inline']")).not.toBeNull();
    shadow.querySelector<HTMLButtonElement>('[aria-label="Add fill"]')!.click();
    expect(button.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(sections()).toEqual(["Layout", "Typography", "Fill", "Border (empty)"]);
    expect(shadow.querySelector<HTMLInputElement>('[data-property="background-color"]')?.value).toBe("#ffffff");
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button")!.click();
    expect(button.style.backgroundColor).toBe("");
    expect(sections()).toContain("Fill (empty)");
  });

  it("keeps the footer quiet until there are changes, then counts them", async () => {
    const bar = shadow.querySelector<HTMLElement>(".design-inspector__bar")!;
    const count = shadow.querySelector<HTMLElement>(".design-inspector__count")!;
    pointer("pointerdown", button);
    expect(bar.hasAttribute("data-changes")).toBe(false);
    expect(count.textContent).toBe("");
    expect(shadow.querySelector(".design-inspector__actions button:last-child")?.textContent).toBe("Comment");
    const edit = (property: string, value: string) => {
      const input = shadow.querySelector<HTMLInputElement>(`[data-property="${property}"]`)!;
      input.dispatchEvent(new Event("focus"));
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    edit("color", "#ff0000");
    expect(bar.hasAttribute("data-changes")).toBe(true);
    expect(count.textContent).toBe("1 change");
    edit("font-size", "30");
    expect(count.textContent).toBe("2 changes");
    shadow.querySelector<HTMLButtonElement>('.design-inspector__actions [aria-label="Copy CSS"]')!.click();
    await vi.waitFor(() => expect(bar.hasAttribute("data-message")).toBe(true));
    expect(shadow.querySelector(".design-inspector__status")?.textContent).not.toBe("");
    shadow.querySelector<HTMLButtonElement>('.design-inspector__actions [aria-label="Reset"]')!.click();
    expect(count.textContent).toBe("");
    expect(bar.hasAttribute("data-changes")).toBe(false);
  });

  it("preserves color alpha until edited and rejects invalid CSS colors", () => {
    button.style.backgroundColor = "rgba(10, 20, 30, 0.4)";
    pointer("pointerdown", button);
    const color = shadow.querySelector<HTMLInputElement>('[data-property="background-color"]')!;
    expect(color.value).toBe("rgba(10, 20, 30, 0.4)");
    color.focus();
    color.value = "invalid-color";
    color.dispatchEvent(new Event("input"));
    expect(color.getAttribute("aria-invalid")).toBe("true");
    expect(button.style.backgroundColor).toBe("rgba(10, 20, 30, 0.4)");
    color.value = "rgba(30, 40, 50, 0.6)";
    color.dispatchEvent(new Event("input"));
    expect(button.style.backgroundColor).toBe("rgba(30, 40, 50, 0.6)");
    expect(color.getAttribute("aria-invalid")).toBe("false");
  });

  it("keeps collapsed groups closed when the selection changes", async () => {
    pointer("pointerdown", button);
    const group = shadow.querySelector<HTMLDetailsElement>(".design-group")!;
    group.open = false;
    group.dispatchEvent(new Event("toggle"));
    pointer("pointerdown", button);
    expect(shadow.querySelector<HTMLDetailsElement>(".design-group")?.open).toBe(false);
  });

  it("suppresses page link activation only while Design mode is active", () => {
    const link = document.createElement("a");
    link.href = "#destination";
    page.append(link);
    const click = () => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
      link.dispatchEvent(event);
      return event;
    };
    expect(click().defaultPrevented).toBe(true);
    controller.setActive(false);
    expect(click().defaultPrevented).toBe(false);
  });

  it("hands plain style and text previews to one comment proposal", async () => {
    pointer("pointerdown", button);
    const color = shadow.querySelector<HTMLInputElement>('[data-property="color"]')!;
    color.dispatchEvent(new Event("focus"));
    color.value = "#ff0000";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    color.dispatchEvent(new Event("change", { bubbles: true }));
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:last-child")!.click();
    await vi.waitFor(() => expect(comments).toEqual([button]));
    expect(commentProposals[0]).toContain("Proposed style changes (preview only)");
    expect(commentProposals[0]).toContain("Target: #hero");
    expect(commentProposals[0]).toMatch(/- color: .* → rgb\(255, 0, 0\)/);
  });

  it("folds the compact sheet while picking and keeps the close control rightmost", () => {
    controller.destroy();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), media: query }));
    vi.stubGlobal("scrollBy", vi.fn());
    controller = createDesignMode({ root: shadow, host, targetAt: () => pointed, onComment: () => {}, onExit: () => { exited++; } });
    controller.setActive(true);
    const inspector = shadow.querySelector<HTMLElement>(".design-inspector")!;
    const fold = shadow.querySelector<HTMLButtonElement>(".design-inspector__fold")!;
    const heading = shadow.querySelector<HTMLElement>(".design-inspector__heading")!;
    expect(heading.lastElementChild?.getAttribute("aria-label")).toBe("Exit design mode");
    expect(heading.lastElementChild?.querySelector("svg")).not.toBeNull();
    expect(inspector.hasAttribute("data-folded")).toBe(true);
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    pointer("pointerdown", button);
    // The sheet unfolds only after the tap completes, never under the finger.
    expect(inspector.hasAttribute("data-folded")).toBe(true);
    pointer("click", button);
    expect(inspector.hasAttribute("data-folded")).toBe(false);
    expect(fold.getAttribute("aria-label")).toBe("Collapse inspector");
    fold.click();
    expect(inspector.hasAttribute("data-folded")).toBe(true);
    expect(fold.getAttribute("aria-expanded")).toBe("false");
  });
});
