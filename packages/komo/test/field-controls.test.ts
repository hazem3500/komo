// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { fieldControl, fields } from "../src/design-panel.js";
import { enhance } from "../src/field-controls.js";

afterEach(() => document.body.replaceChildren());

function mount(properties: string[]) {
  const element = document.createElement("p");
  document.body.append(element);
  const context = { element, begin: vi.fn(), apply: vi.fn((_control: unknown, property: string, value: string | null) => { if (value) element.style.setProperty(property, value); }), commit: vi.fn() };
  const container = document.createElement("div");
  for (const property of properties) container.append(fieldControl(fields.find(field => field.property === property)!, context));
  document.body.append(container);
  enhance(container, element);
  const box = (property: string) => container.querySelector<HTMLElement>(`[data-field-property="${property}"]`)!;
  return { element, context, container, box };
}

it("turns text alignment and border style into icon segments with one change per pick", () => {
  const { element, context, box } = mount(["text-align", "border-style", "display"]);
  const group = box("text-align").querySelector<HTMLElement>("[role=radiogroup]")!;
  expect(group.getAttribute("aria-label")).toBe("Alignment");
  const radios = [...group.querySelectorAll<HTMLButtonElement>("[role=radio]")];
  // Only options with an icon get a segment; the element's own other value checks none.
  expect(radios.map(radio => radio.value)).toEqual(["left", "center", "right", "justify"]);
  expect(radios.every(radio => radio.querySelector("svg"))).toBe(true);
  expect(box("border-style").querySelectorAll("[role=radio] svg")).toHaveLength(4);
  // Display keeps its listbox: not every option has a natural icon.
  expect(box("display").querySelector("[role=radiogroup]")).toBeNull();
  const center = radios.find(radio => radio.value === "center")!;
  center.dispatchEvent(new PointerEvent("pointerenter"));
  expect(element.style.textAlign).toBe("center");
  center.dispatchEvent(new PointerEvent("pointerleave"));
  expect(element.style.textAlign).toBe("");
  expect(context.begin).not.toHaveBeenCalled();
  center.click();
  expect(element.style.textAlign).toBe("center");
  expect(context.begin).toHaveBeenCalledTimes(1);
  expect(context.apply).toHaveBeenCalledTimes(1);
  expect(context.commit).toHaveBeenCalledWith(expect.anything(), "text-align");
  expect(center.getAttribute("aria-checked")).toBe("true");
  expect(center.tabIndex).toBe(0);
  center.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  expect(element.style.textAlign).toBe("right");
  // A value set from code (show(), syncFields) checks its segment.
  const select = box("text-align").querySelector<HTMLSelectElement>("select")!;
  select.value = "left";
  expect(radios.find(radio => radio.value === "left")!.getAttribute("aria-checked")).toBe("true");
  select.prepend(new Option("start", "start"));
  select.value = "start";
  expect(radios.find(radio => radio.value === "left")!.getAttribute("aria-checked")).toBe("true");
});

it("shows weights in their own weight and units inside numeric fields", () => {
  const { box } = mount(["font-weight", "padding", "width"]);
  const weights = [...box("font-weight").querySelectorAll("option")];
  expect(weights.find(option => option.value === "700")!.style.fontWeight).toBe("700");
  const padding = box("padding"), unit = padding.querySelector(".design-field__unit")!;
  expect(unit.textContent).toBe("px");
  expect(unit.previousElementSibling).toBe(padding.querySelector("[data-property]"));
  const width = box("width"), input = width.querySelector<HTMLInputElement>("[data-property]")!;
  input.value = "auto";
  expect(width.querySelector(".design-field__unit")!.textContent).toBe("");
  input.value = "120";
  expect(width.querySelector(".design-field__unit")!.textContent).toBe("px");
  input.value = "50%";
  input.dispatchEvent(new Event("input"));
  expect(width.querySelector(".design-field__unit")!.textContent).toBe("");
});

it("adds letter spacing and opacity fields that scrub in their own steps", () => {
  const { element, box } = mount(["letter-spacing", "opacity"]);
  const spacing = box("letter-spacing").querySelector<HTMLInputElement>("[data-property]")!;
  spacing.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  expect(element.style.letterSpacing).toBe("1px");
  const opacity = box("opacity").querySelector<HTMLInputElement>("[data-property]")!;
  opacity.value = "0.5";
  opacity.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true }));
  expect(element.style.opacity).toBe("0.6");
  opacity.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true }));
  for (let step = 0; step < 6; step++) opacity.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true }));
  expect(element.style.opacity).toBe("1");
});
