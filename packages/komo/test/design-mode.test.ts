// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesignMode } from "../src/design-mode.js";

describe("design mode preview inspector", () => {
  let shadow: ShadowRoot;
  let host: HTMLElement;
  let page: HTMLElement;
  let button: HTMLButtonElement;
  let controller: ReturnType<typeof createDesignMode>;
  let exited: number;
  let comments: Element[];

  function pointer(type: string, target: Element) {
    const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
    Object.defineProperties(event, { clientX: { value: 30 }, clientY: { value: 20 }, button: { value: 0 } });
    target.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    document.body.innerHTML = '<main><button id="hero">Hello</button><iframe title="Preview"></iframe></main><div id="komo"></div>';
    page = document.querySelector("main")!;
    button = document.querySelector("#hero")!;
    host = document.querySelector("#komo")!;
    shadow = host.attachShadow({ mode: "open" });
    exited = 0;
    comments = [];
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    controller = createDesignMode({
      root: shadow,
      host,
      targetAt: () => button,
      onComment: (element) => comments.push(element),
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
    input.dispatchEvent(new Event("focus"));
    input.value = "30";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const reset = [...shadow.querySelectorAll<HTMLButtonElement>(".design-inspector__actions button")].find((item) => item.textContent === "Reset")!;
    reset.click();
    expect(button.style.getPropertyValue("font-size")).toBe("18px");
    input.dispatchEvent(new Event("focus"));
    input.value = "30";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    controller.destroy();
    expect(button.style.getPropertyValue("font-size")).toBe("18px");
    expect(button.style.getPropertyPriority("font-size")).toBe("important");
  });

  it("exits without hijacking clicks outside mode and can hand the target to comments", () => {
    controller.setActive(false);
    const ordinary = pointer("pointerdown", button);
    expect(ordinary.defaultPrevented).toBe(false);
    controller.setActive(true);
    pointer("pointerdown", button);
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:last-child")!.click();
    expect(comments).toEqual([button]);
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
});
