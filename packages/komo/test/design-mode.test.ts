// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesignMode } from "../src/design-mode.js";

describe("design mode preview inspector", () => {
  let shadow: ShadowRoot;
  let host: HTMLElement;
  let page: HTMLElement;
  let button: HTMLButtonElement;
  let pointed: HTMLElement;
  let controller: ReturnType<typeof createDesignMode>;
  let exited: number;
  let comments: Element[];
  let commentProposals: Array<string | undefined>;

  function pointer(type: string, target: Element) {
    if (target instanceof HTMLElement) pointed = target;
    const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
    Object.defineProperties(event, { clientX: { value: 30 }, clientY: { value: 20 }, button: { value: 0 } });
    target.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
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
  });

  afterEach(() => {
    controller.destroy();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
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
    expect(shadow.querySelector<HTMLElement>(".design-inspector__status")?.textContent).toContain("resets on refresh");
    controller.setActive(false);
    expect(button.style.color).toBe("rgb(255, 0, 0)");
  });

  it("edits leaf text inline, keeps pasted markup as text, and supports undo/reset/comment", async () => {
    const label = document.querySelector<HTMLElement>("#label")!;
    pointer("pointerdown", label);
    const edit = shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button[aria-label='Edit selected text inline']")!;
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
    const edit = () => shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button[aria-label='Edit selected text inline']")!;
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

  it("edits button text but keeps private text and form controls read-only", async () => {
    const edit = () => shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button[aria-label='Edit selected text inline']")!;
    const status = () => shadow.querySelector(".design-inspector__status")?.textContent;
    pointer("pointerdown", button);
    edit().click();
    await vi.waitFor(() => expect(button.getAttribute("contenteditable")).toBe("true"));
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, composed: true }));
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
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button[aria-label='Edit selected text inline']")!.click();
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
    expect(shadow.querySelector(".design-inspector__mark svg")).not.toBeNull();
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
    const reset = [...shadow.querySelectorAll<HTMLButtonElement>(".design-inspector__actions button")].find((item) => item.textContent === "Reset")!;
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

  it("keeps a slider gesture and precision input synchronized with one Undo", () => {
    button.style.fontSize = "18px";
    pointer("pointerdown", button);
    const slider = shadow.querySelector<HTMLInputElement>('[aria-label="Font size slider"]')!;
    const value = shadow.querySelector<HTMLInputElement>('[data-property="font-size"]')!;
    slider.dispatchEvent(new Event("focus"));
    for (const size of [24, 30, 36]) {
      slider.value = String(size);
      slider.dispatchEvent(new Event("input"));
    }
    slider.dispatchEvent(new Event("change"));
    expect(value.value).toBe("36");
    expect(slider.getAttribute("aria-valuetext")).toBe("36 pixels");
    expect(button.style.fontSize).toBe("36px");
    const undo = shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button")!;
    undo.click();
    expect(button.style.fontSize).toBe("18px");
    expect(undo.disabled).toBe(true);
    const precision = shadow.querySelector<HTMLInputElement>('[data-property="font-size"]')!;
    precision.focus();
    precision.value = "27";
    precision.dispatchEvent(new Event("input"));
    expect(shadow.querySelector<HTMLInputElement>('[aria-label="Font size slider"]')?.value).toBe("27");
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
