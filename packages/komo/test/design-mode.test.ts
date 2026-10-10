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
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
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
});
