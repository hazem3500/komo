// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { attach } from "../src/select-menu";

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
  const down = (target: Element) => {
    const event = new MouseEvent("mousedown", { bubbles: true, composed: true, cancelable: true, button: 0 });
    target.dispatchEvent(event);
    return event;
  };
  const active = () => root.getElementById(select.getAttribute("aria-activedescendant") ?? "")?.textContent;
  return { root, container, select, list, press, down, active, changes, inputs };
}

afterEach(() => {
  // Close whatever is still open so window listeners never cross tests.
  window.dispatchEvent(new Event("resize"));
});

describe("select menu", () => {
  it("opens a komo listbox from the select instead of the system popup", () => {
    const { root, select, list, down, active } = mount();
    const event = down(select);
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

  it("closes on an outside press, a scroll, and when its select is replaced", () => {
    const { root, container, select, list, down } = mount();
    down(select);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(list()).toBeNull();
    down(select);
    container.dispatchEvent(new Event("scroll"));
    expect(list()).toBeNull();
    down(select);
    container.replaceChildren();
    attach(container);
    expect(select.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector("[role=listbox]")).toBeNull();
  });
});
