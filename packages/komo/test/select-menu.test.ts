// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attach } from "../src/select-menu";
import { STILL } from "../src/host-motion";

function mount({ grouped = false, disabled = false } = {}) {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  const field = document.createElement("label");
  field.className = "design-field";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Tone");
  select.disabled = disabled;
  for (const value of ["calm", "bold", "quiet"]) {
    const option = document.createElement("option");
    option.value = option.textContent = value;
    select.append(option);
  }
  if (grouped) {
    const group = document.createElement("optgroup");
    group.label = "Brand";
    for (const value of ["brand.primary", "brand.muted"]) {
      const option = document.createElement("option");
      option.value = option.textContent = value;
      group.append(option);
    }
    select.append(group);
  }
  select.value = "bold";
  field.append(select);
  // Browsers give a click on a label's own control no label activation; jsdom re-clicks it forever.
  field.addEventListener("click", (event) => { if (event.target === select) event.preventDefault(); });
  container.append(field);
  root.append(container);
  document.body.replaceChildren(host);
  attach(container);
  const changes: string[] = [];
  const inputs: string[] = [];
  select.addEventListener("change", () => changes.push(select.value));
  select.addEventListener("input", () => inputs.push(select.value));
  const list = () => root.querySelector<HTMLElement>("[role=listbox]");
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true, ...init });
    select.dispatchEvent(event);
    return event;
  };
  const pointer = (type: string, target: Element, init: PointerEventInit = {}) => {
    const event = new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse", ...init });
    target.dispatchEvent(event);
    return event;
  };
  // A mouse press: pointerdown, then its compatibility mousedown.
  const down = (target: Element) => {
    pointer("pointerdown", target);
    const event = new MouseEvent("mousedown", { bubbles: true, composed: true, cancelable: true, button: 0 });
    target.dispatchEvent(event);
    return event;
  };
  // A finger or pen: pointerdown, an optional drag, pointerup, touchend, then the tap's click.
  const tap = (target: Element, { pointerType = "touch", dx = 0, dy = 0 } = {}) => {
    const init = { pointerType, pointerId: 7, clientX: 20, clientY: 20 };
    const events = [pointer("pointerdown", target, init)];
    if (dx || dy) events.push(pointer("pointermove", target, { ...init, clientX: 20 + dx, clientY: 20 + dy }));
    events.push(pointer("pointerup", target, { ...init, clientX: 20 + dx, clientY: 20 + dy }));
    if (pointerType === "touch") {
      const end = new Event("touchend", { bubbles: true, composed: true, cancelable: true });
      target.dispatchEvent(end);
      events.push(end as PointerEvent);
    }
    // A cancelled touchend means the browser sends no click.
    if (!events.some((event) => event.type === "touchend" && event.defaultPrevented)) {
      const click = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, clientX: 20 + dx, clientY: 20 + dy });
      target.dispatchEvent(click);
      events.push(click as PointerEvent);
    }
    return events;
  };
  const active = () => root.getElementById(select.getAttribute("aria-activedescendant") ?? "")?.textContent;
  return { root, container, select, list, press, pointer, down, tap, active, changes, inputs };
}

afterEach(() => {
  // Close whatever is still open so window listeners never cross tests.
  window.dispatchEvent(new Event("resize"));
});

describe("select menu", () => {
  it("opens a komo listbox from the select instead of the system popup", () => {
    const { root, select, list, pointer, down, active } = mount();
    // A mouse opens on press, and neither its pointerdown nor its mousedown reaches the system popup.
    expect(pointer("pointerdown", select).defaultPrevented).toBe(true);
    expect(list()).not.toBeNull();
    const event = new MouseEvent("mousedown", { bubbles: true, composed: true, cancelable: true, button: 0 });
    select.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(root.activeElement).toBe(select);
    expect(list()).not.toBeNull();
    expect(list()!.getAttribute("aria-label")).toBe("Tone");
    expect(select.getAttribute("aria-haspopup")).toBe("listbox");
    expect(select.getAttribute("aria-expanded")).toBe("true");
    expect(select.getAttribute("aria-controls")).toBe(list()!.id);
    expect([...list()!.querySelectorAll("[role=option]")].map((option) => option.textContent)).toEqual(["calm", "bold", "quiet"]);
    expect(list()!.querySelector("[aria-selected=true]")!.textContent).toBe("bold");
    expect(active()).toBe("bold");
    // A second press on the trigger closes it again.
    down(select);
    expect(list()).toBeNull();
    expect(select.getAttribute("aria-expanded")).toBe("false");
    expect(select.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("moves with the keyboard and fires input and change on Enter", () => {
    const { select, list, press, active, changes, inputs } = mount();
    select.focus();
    expect(press("ArrowDown").defaultPrevented).toBe(true);
    expect(list()).not.toBeNull();
    expect(active()).toBe("bold");
    press("ArrowDown");
    expect(active()).toBe("quiet");
    press("ArrowDown");
    expect(active()).toBe("quiet");
    press("Home");
    expect(active()).toBe("calm");
    press("End");
    expect(active()).toBe("quiet");
    press("c");
    expect(active()).toBe("calm");
    expect(changes).toEqual([]);
    press("Enter");
    expect(list()).toBeNull();
    expect(select.value).toBe("calm");
    expect(inputs).toEqual(["calm"]);
    expect(changes).toEqual(["calm"]);
  });

  it("closes on Escape without reaching the page or changing the value", () => {
    const { select, list, press, changes } = mount();
    select.focus();
    press("Enter");
    let reached = false;
    const page = () => { reached = true; };
    document.addEventListener("keydown", page, true);
    press("ArrowDown");
    const escape = press("Escape");
    document.removeEventListener("keydown", page, true);
    expect(escape.defaultPrevented).toBe(true);
    expect(reached).toBe(false);
    expect(list()).toBeNull();
    expect(select.value).toBe("bold");
    expect(changes).toEqual([]);
    // Escape with the menu closed is the page's again, e.g. to exit Design mode.
    expect(press("Escape").defaultPrevented).toBe(false);
  });

  it("closes on Tab and lets focus move on", () => {
    const { select, list, press } = mount();
    select.focus();
    press(" ");
    expect(list()).not.toBeNull();
    expect(press("Tab").defaultPrevented).toBe(false);
    expect(list()).toBeNull();
  });

  it("previews field values without change events and restores exact styles on cancel or replacement", async () => {
    const { container, select, list, down, pointer, press, changes, inputs } = mount();
    const element = document.createElement("p");
    element.style.setProperty("font-weight", "500", "important");
    document.body.append(element);
    select.dataset.property = "font-weight";
    for (const [i, option] of [...select.options].entries()) option.value = option.textContent = String(400 + i * 100);
    select.value = "500";
    attach(container, element);
    down(select);
    pointer("pointermove", list()!.querySelectorAll("[role=option]")[2]);
    expect(element.style.fontWeight).toBe("600");
    expect(changes).toEqual([]);
    expect(inputs).toEqual([]);
    press("Escape");
    expect(element.style.fontWeight).toBe("500");
    expect(element.style.getPropertyPriority("font-weight")).toBe("important");
    down(select);
    press("ArrowUp");
    expect(element.style.fontWeight).toBe("400");
    select.remove();
    await new Promise(done => setTimeout(done, 0));
    expect(list()).toBeNull();
    expect(element.style.fontWeight).toBe("500");
  });

  it("holds the element's own motion while an option previews, and lets go after Escape or a commit", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      const { container, select, list, down, pointer, press, changes } = mount();
      const element = document.body.appendChild(document.createElement("button"));
      attach(container, element);
      const previews: Array<[string | null, boolean]> = [];
      // A component prop hears komo-preview; the hold is already on when it renders.
      select.addEventListener("komo-preview", (event) => previews.push([(event as CustomEvent<string | null>).detail, element.hasAttribute(STILL)]));
      const frames = () => { vi.advanceTimersToNextFrame(); vi.advanceTimersToNextFrame(); };
      down(select);
      const options = () => list()!.querySelectorAll("[role=option]");
      pointer("pointermove", options()[0]);
      pointer("pointermove", options()[2]);
      // Between options the hold never lapses, however many frames pass.
      frames();
      expect(element.hasAttribute(STILL)).toBe(true);
      press("Escape");
      expect(previews).toEqual([["calm", true], [null, true], ["quiet", true], [null, true]]);
      expect(element.hasAttribute(STILL)).toBe(true);
      frames();
      expect(element.hasAttribute(STILL)).toBe(false);
      expect(element.getAttribute("style")).toBeNull();
      // Enter commits after the opening value is put back; both render while held.
      down(select);
      press("ArrowDown");
      let held: boolean | undefined;
      select.addEventListener("change", () => { held = element.hasAttribute(STILL); }, { once: true });
      press("Enter");
      expect(changes).toEqual(["quiet"]);
      expect(held).toBe(true);
      frames();
      expect(element.hasAttribute(STILL)).toBe(false);
      expect(element.getAttribute("style")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("selects with a click and keeps the change for a new value only", () => {
    const { select, list, down, changes } = mount();
    down(select);
    const options = [...list()!.querySelectorAll<HTMLElement>("[role=option]")];
    expect(down(options[2]).defaultPrevented).toBe(true);
    options[2].click();
    expect(select.value).toBe("quiet");
    expect(changes).toEqual(["quiet"]);
    down(select);
    list()!.querySelectorAll<HTMLElement>("[role=option]")[2].click();
    expect(changes).toEqual(["quiet"]);
  });

  it("shows option groups under small headings", () => {
    const { select, list, down } = mount({ grouped: true });
    down(select);
    const group = list()!.querySelector("[role=group]")!;
    expect(group.querySelector("small")!.textContent).toBe("Brand");
    expect(group.getAttribute("aria-labelledby")).toBe(group.querySelector("small")!.id);
    expect([...group.querySelectorAll("[role=option]")].map((option) => option.textContent)).toEqual(["brand.primary", "brand.muted"]);
  });

  it("stays shut while the select is disabled", () => {
    const { select, list, down, press } = mount({ disabled: true });
    expect(down(select).defaultPrevented).toBe(false);
    press("Enter");
    expect(list()).toBeNull();
  });

  it("closes on an outside press, a scroll that moves its select, and when its select is replaced", () => {
    const { root, container, select, list, down } = mount();
    down(select);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(list()).toBeNull();
    down(select);
    // A scroll that left the select in place (focus brought it into view first) keeps the list.
    container.dispatchEvent(new Event("scroll"));
    expect(list()).not.toBeNull();
    select.getBoundingClientRect = () => new DOMRect(0, -40, 100, 28);
    container.dispatchEvent(new Event("scroll"));
    expect(list()).toBeNull();
    down(select);
    container.replaceChildren();
    attach(container);
    expect(select.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector("[role=listbox]")).toBeNull();
  });

  it("opens on a touch or pen tap without the system picker", () => {
    for (const pointerType of ["touch", "pen"]) {
      const { root, select, list, tap } = mount();
      const events = tap(select, { pointerType });
      // The press is cancelled, so no compatibility mousedown reaches the system picker, and
      // a touch's touchend is too, so the browser sends no mousedown or click after it.
      expect(events.filter((event) => /down|touchend/.test(event.type)).every((event) => event.defaultPrevented)).toBe(true);
      expect(events.some((event) => event.type === "click")).toBe(pointerType === "pen");
      expect(list()).not.toBeNull();
      // Focusing the select from a tap can raise the iOS picker, so a tap leaves focus alone.
      expect(root.activeElement).not.toBe(select);
      expect(select.getAttribute("aria-expanded")).toBe("true");
      // A second tap on the trigger closes the menu.
      tap(select, { pointerType });
      expect(list()).toBeNull();
    }
  });

  it("does not open when a touch on the select drags or is cancelled", () => {
    const { select, list, pointer, tap } = mount();
    expect(tap(select, { dy: 30 })[0].defaultPrevented).toBe(true);
    expect(list()).toBeNull();
    // The browser cancels a pointer it scrolls with and sends no pointerup; the next tap still opens.
    pointer("pointerdown", select, { pointerType: "touch", pointerId: 8 });
    pointer("pointercancel", select, { pointerType: "touch", pointerId: 8 });
    expect(list()).toBeNull();
    tap(select);
    expect(list()).not.toBeNull();
  });

  it("picks an option on a tap but not after scrolling the list by touch", () => {
    const { select, list, tap, changes } = mount();
    tap(select);
    const options = () => [...list()!.querySelectorAll<HTMLElement>("[role=option]")];
    // Small jitter is still a tap.
    tap(options()[0], { dx: 4 });
    expect(select.value).toBe("calm");
    tap(select);
    // A drag past the slop scrolls instead, even if the browser still sends a click.
    tap(options()[2], { dy: 40 });
    expect(list()).not.toBeNull();
    expect(select.value).toBe("calm");
    expect(changes).toEqual(["calm"]);
    // A pen tap picks normally afterwards.
    tap(options()[2], { pointerType: "pen" });
    expect(select.value).toBe("quiet");
  });

  it("gives options finger-sized rows on coarse pointers", () => {
    const { root, down, select } = mount();
    down(select);
    const css = [...root.querySelectorAll("style")].map((style) => style.textContent).join("");
    const coarse = css.match(/@media \(pointer:coarse\)\{(.*?\})\}/)?.[1] ?? "";
    const height = Number(coarse.match(/\[role=option\]\{min-height:(\d+)px/)?.[1]);
    expect(height).toBeGreaterThanOrEqual(36);
    expect(height).toBeLessThanOrEqual(44);
  });

  it("stops only the keys it handles while open, so komo's shortcuts see the rest", () => {
    const { select, list, press } = mount();
    select.focus();
    press("Enter");
    const reached: string[] = [];
    const page = (event: KeyboardEvent) => reached.push(event.key);
    window.addEventListener("keydown", page);
    // Letters are type-ahead, as in a native select, and arrows move: both stay in the menu.
    for (const key of ["d", "ArrowDown", "Home"]) expect(press(key).defaultPrevented).toBe(true);
    // Modifier chords and keys the menu ignores pass through untouched.
    for (const [key, init] of [["z", { metaKey: true }], ["k", { ctrlKey: true }], ["F2", {}], ["Shift", { shiftKey: true }]] as const)
      expect(press(key, init).defaultPrevented).toBe(false);
    expect(list()).not.toBeNull();
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(list()).toBeNull();
    // With the menu shut, Escape and letters belong to the page again.
    press("Escape");
    press("d");
    window.removeEventListener("keydown", page);
    expect(reached).toEqual(["z", "k", "F2", "Shift", "Escape", "d"]);
  });
});
