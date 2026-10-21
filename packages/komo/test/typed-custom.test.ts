// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { pickerEditor } from "../src/token-custom.js";
import { cssParts, fontParts, fontValue, nudged, primaryFamily, readableColor, shadowLayers, shadowValue } from "../src/typed-custom.js";
import { customPickerValue } from "../src/custom-field.js";
import { fieldControl, type Field } from "../src/design-panel.js";
import type { DesignToken } from "../src/design-system.js";
vi.stubGlobal("CSS", { supports(property: string, value: string) {
  const style = document.createElement("span").style; style.setProperty(property, value);
  return !!style.getPropertyValue(property);
} });
afterEach(() => document.body.replaceChildren());
function editor(property: string, value: string, field?: Field, tokens: DesignToken[] = []) {
  const preview = vi.fn(), commit = vi.fn();
  const box = pickerEditor({ trigger: document.body, tokens, property, onSelect() {}, custom: { value, field, onPreview: () => () => {}, onSelect() {} } }, { preview, commit });
  document.body.append(box);
  const input = (name: string) => box.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!;
  const type = (name: string, value: string) => { input(name).value = value; input(name).dispatchEvent(new Event("input")); };
  const key = (name: string, key: string, shiftKey = false) => input(name).dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
  return { box, preview, commit, input, type, key };
}
const radius: Field = { property: "border-radius", label: "Corner radius", kind: "length", max: 96 };

it("has no Apply button: typing previews, Enter or blur keeps, units are exact and CSS validity rules", () => {
  const e = editor("border-radius", "2rem", radius);
  expect([...e.box.querySelectorAll("button")].map(button => button.textContent)).not.toContain("Apply custom");
  expect(e.input("Corner radius unit").value).toBe("rem");
  e.type("Corner radius", "200");
  expect(e.preview).toHaveBeenLastCalledWith("200rem");
  expect(e.commit).not.toHaveBeenCalled();
  e.type("Corner radius", "");
  expect(e.input("Corner radius").getAttribute("aria-invalid")).toBe("true");
  e.box.refresh("8px");
  expect(e.input("Corner radius").value).toBe("");
  e.key("Corner radius", "Enter");
  expect(e.commit).not.toHaveBeenCalled();
  e.type("Corner radius", "4");
  e.key("Corner radius", "Enter");
  expect(e.commit).toHaveBeenCalledExactlyOnceWith("4rem");
  e.type("Corner radius", "5");
  e.input("Corner radius").dispatchEvent(new Event("blur"));
  expect(e.commit).toHaveBeenLastCalledWith("5rem");
  e.input("Corner radius").dispatchEvent(new Event("blur"));
  expect(e.commit).toHaveBeenCalledTimes(2);
});

it("nudges with arrows, Shift ten times, scrubs by the label and keeps a unit change at once", () => {
  const e = editor("border-radius", "8px", radius);
  e.key("Corner radius", "ArrowUp");
  expect(e.commit).toHaveBeenLastCalledWith("9px");
  e.key("Corner radius", "ArrowUp", true);
  expect(e.commit).toHaveBeenLastCalledWith("19px");
  e.key("Corner radius", "ArrowDown", true);
  expect(e.commit).toHaveBeenLastCalledWith("9px");
  const label = e.input("Corner radius").previousElementSibling as HTMLElement;
  expect(label.title).toBe("Corner radius · drag to adjust");
  label.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, bubbles: true }));
  label.dispatchEvent(new MouseEvent("pointermove", { clientX: 110, bubbles: true }));
  label.dispatchEvent(new MouseEvent("pointermove", { clientX: 114, shiftKey: true, bubbles: true }));
  expect(e.preview).toHaveBeenLastCalledWith("34px");
  expect(e.commit).toHaveBeenCalledTimes(3);
  label.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
  expect(e.commit).toHaveBeenCalledTimes(4);
  expect(e.commit).toHaveBeenLastCalledWith("34px");
  const unit = e.input("Corner radius unit") as unknown as HTMLSelectElement;
  unit.value = "rem";
  unit.dispatchEvent(new Event("change"));
  expect(e.commit).toHaveBeenLastCalledWith("34rem");
  expect(nudged("1.4", 1)).toBe("1.5");
  expect(nudged("1em", -3)).toBe("0.7em");
  expect(nudged("12px", 10)).toBe("22px");
});

it.each(["calc(100% - 2rem)", "var(--width)", "25% 30% / 10px 50%"])("keeps complex CSS %s exact", value => {
  const e = editor(value.includes("/") ? "border-radius" : "width", value);
  expect(e.input("CSS value").value).toBe(value);
  expect(e.box.querySelector("details")!.open).toBe(true);
  e.key("CSS value", "Enter");
  expect(e.commit).toHaveBeenCalledWith(value);
});

it("edits shadow layers in a 2×2 grid without losing nested color commas, and keeps complex fallback", () => {
  expect(cssParts('1px 2px rgb(0, 0, 0), inset 0 1px red', true)).toHaveLength(2);
  expect(shadowLayers("var(--shadow)")).toBeUndefined();
  const e = editor("box-shadow", "1px 2px 3px 4px rgba(0, 0, 0, 0.2), inset 0px 1px red");
  expect(e.box.querySelectorAll(".komo-typed__layer")).toHaveLength(2);
  expect(e.box.querySelectorAll(".komo-typed__layer .komo-typed__grid .komo-typed__field")).toHaveLength(8);
  e.type("Layer 1 x offset", "5");
  expect(e.preview).toHaveBeenLastCalledWith("5px 2px 3px 4px rgba(0, 0, 0, 0.2), inset 0px 1px red");
  e.key("Layer 1 x offset", "Enter");
  expect(e.commit).toHaveBeenCalledTimes(1);
  expect(e.box.querySelector('[aria-label="Layer 1 color"]')!.textContent).toBe("00000020%");
  expect(e.box.querySelector('[aria-label="Layer 2 color"] span')!.textContent).toBe("RED");
  expect(e.box.querySelector(".komo-typed__tile i")!.getAttribute("style")).toContain("box-shadow");
});

it("switches Drop and Inner, hides, removes and adds layers, each kept at once", () => {
  const e = editor("box-shadow", "0px 2px 4px red");
  const type = e.box.querySelector<HTMLSelectElement>('select[aria-label="Layer 1 type"]')!;
  expect(type.value).toBe("drop");
  type.value = "inner";
  type.dispatchEvent(new Event("change"));
  expect(e.commit).toHaveBeenLastCalledWith("inset 0px 2px 4px red");
  e.box.querySelector<HTMLButtonElement>('[aria-label="Add shadow layer"]')!.click();
  expect(e.commit).toHaveBeenLastCalledWith("inset 0px 2px 4px red, 0px 2px 4px 0px #00000040");
  expect(e.box.querySelectorAll(".komo-typed__layer")).toHaveLength(2);
  const eye = e.box.querySelector<HTMLButtonElement>('[aria-label="Layer 1 visible"]')!;
  expect(eye.getAttribute("aria-pressed")).toBe("true");
  eye.click();
  expect(e.commit).toHaveBeenLastCalledWith("0px 2px 4px 0px #00000040");
  expect(eye.getAttribute("aria-pressed")).toBe("false");
  eye.click();
  expect(e.commit).toHaveBeenLastCalledWith("inset 0px 2px 4px red, 0px 2px 4px 0px #00000040");
  e.box.querySelector<HTMLButtonElement>('[aria-label="Remove layer 1"]')!.click();
  expect(e.commit).toHaveBeenLastCalledWith("0px 2px 4px 0px #00000040");
  e.box.querySelector<HTMLButtonElement>('[aria-label="Remove layer 1"]')!.click();
  expect(e.commit).toHaveBeenLastCalledWith("none");
  expect(shadowValue([])).toBe("none");
  expect(shadowValue([{ lengths: ["1px", "1px"], color: "red", inset: false, hidden: true }])).toBe("none");
  expect(readableColor("rgb(255, 0, 0)")).toBe("#ff0000");
  expect(readableColor("rgb(0 0 0 / 50%)")).toBe("#000000 · 50%");
  expect(readableColor("")).toBe("currentColor");
});

it("keeps a unit suffix with no unitless choice for lengths, and offers no unit only where a value takes one", () => {
  const e = editor("box-shadow", "0 1px 3px 0 rgb(0 0 0 / 8%)");
  const units = [...e.box.querySelectorAll<HTMLSelectElement>('select[aria-label="Layer 1 x offset unit"] option')].map(option => option.value);
  expect(units[0]).toBe("px");
  expect(units).not.toContain("");
  e.type("Layer 1 x offset", "2");
  expect(e.preview).toHaveBeenLastCalledWith("2px 1px 3px 0 rgb(0 0 0 / 8%)");
});

it("edits a typography token as family, weight, size and line height, with or without a family", () => {
  expect(fontParts("500 0.875rem/1.43")).toEqual({ style: "", weight: "500", size: "0.875rem", lineHeight: "1.43", family: "" });
  expect(fontParts('italic 600 14px/20px "Acme, Face", serif')).toEqual({ style: "italic", weight: "600", size: "14px", lineHeight: "20px", family: '"Acme, Face", serif' });
  expect(fontParts("calc(1rem + 1px) serif")).toBeUndefined();
  expect(fontValue({ style: "", weight: "700", size: "1rem", lineHeight: "", family: "serif" })).toBe("700 1rem serif");
  const e = editor("font", "500 0.875rem/1.43", undefined, [{ path: "font.body", type: "fontFamily", value: '"Body Face", sans-serif', label: "Body" }]);
  // The popup header names the editor, so the editor itself has no title.
  expect(e.box.querySelector("strong")).toBeNull();
  expect(e.box.querySelector(".komo-typed__hint")).toBeNull();
  expect(e.box.querySelector("details")!.open).toBe(false);
  expect(e.box.querySelector("summary")!.textContent).toBe("Edit as CSS");
  expect([...e.box.querySelectorAll<HTMLOptionElement>('select[aria-label="Font family"] option')].map(option => option.textContent)).toEqual(["Inherited family", "Body"]);
  const weight = e.box.querySelector<HTMLSelectElement>('select[aria-label="Font weight"]')!;
  weight.value = "700";
  weight.dispatchEvent(new Event("change"));
  expect(e.commit).toHaveBeenLastCalledWith("700 0.875rem/1.43");
  e.key("Font size", "ArrowUp");
  expect(e.commit).toHaveBeenLastCalledWith("700 0.975rem/1.43");
  e.key("Line height", "ArrowDown");
  expect(e.commit).toHaveBeenLastCalledWith("700 0.975rem/1.33");
  e.type("Line height", "");
  expect(e.preview).toHaveBeenLastCalledWith("700 0.975rem");
  const family = e.box.querySelector<HTMLSelectElement>('select[aria-label="Font family"]')!;
  family.value = '"Body Face", sans-serif';
  family.dispatchEvent(new Event("change"));
  expect(e.commit).toHaveBeenLastCalledWith('700 0.975rem "Body Face", sans-serif');
});

it("previews a hovered family or weight as the whole value and shows options as samples", () => {
  const hover = vi.fn();
  const box = pickerEditor({ trigger: document.body, tokens: [{ path: "font.body", type: "fontFamily", value: '"Body Face", sans-serif', label: "Body" }], property: "font", onSelect() {}, custom: { value: "500 14px/20px serif", onPreview: () => () => {}, onSelect() {} } }, { preview: vi.fn(), commit: vi.fn(), hover });
  document.body.append(box);
  const menu = (name: string) => box.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`)!;
  const option = (name: string, value: string) => [...menu(name).options].find(item => item.value === value)!;
  expect(option("Font weight", "800").style.fontWeight).toBe("800");
  expect(option("Font family", '"Body Face", sans-serif').style.fontFamily).toContain("Body Face");
  menu("Font weight").dispatchEvent(new CustomEvent("komo-preview", { detail: "800" }));
  expect(hover).toHaveBeenLastCalledWith("800 14px/20px serif");
  menu("Font family").dispatchEvent(new CustomEvent("komo-preview", { detail: '"Body Face", sans-serif' }));
  expect(hover).toHaveBeenLastCalledWith('500 14px/20px "Body Face", sans-serif');
  menu("Font family").dispatchEvent(new CustomEvent("komo-preview", { detail: null }));
  expect(hover).toHaveBeenLastCalledWith(undefined);
  box.destroy();
  menu("Font weight").dispatchEvent(new CustomEvent("komo-preview", { detail: "300" }));
  expect(hover).toHaveBeenCalledTimes(3);
});

it("shows primary font and only real token choices, retaining quoted fallback stacks", () => {
  const stack = '"Acme, Display", "Fallback Sans", sans-serif';
  expect(primaryFamily(stack)).toBe("Acme, Display");
  const e = editor("font-family", stack, undefined, [{ path: "font.body", type: "fontFamily", value: '"Body", serif' }]);
  expect(e.box.querySelector(".komo-typed__sample span")!.textContent).toBe("Acme, Display");
  expect(e.input("CSS value").value).toBe(stack);
  expect(e.box.querySelectorAll("option")).toHaveLength(2);
  e.type("CSS value", '"Other, Face", monospace');
  e.box.refresh("serif");
  e.key("CSS value", "Enter");
  expect(e.commit).toHaveBeenCalledExactlyOnceWith('"Other, Face", monospace');
});

it.each([{ property: "padding", label: "Padding", kind: "length" as const, max: 200 }, { property: "font-family", label: "Font family", kind: "text" as const }])("routes $property Custom through the existing field transaction", field => {
  const element = document.createElement("div"); document.body.append(element);
  const context = { element, begin: vi.fn(), apply: vi.fn(), commit: vi.fn() };
  const box = fieldControl(field, context), control = box.querySelector<HTMLElement>("[data-property]")!;
  const custom = customPickerValue(element, field.property, control)!;
  expect(custom.field).toBe(field);
  const undo = custom.onPreview(field.kind === "length" ? "2rem" : "serif"); undo(); expect(element.getAttribute("style")).toBeNull();
  const value = field.kind === "length" ? "calc(1rem + 2px)" : "serif";
  custom.onSelect(value);
  expect(context.begin).toHaveBeenCalledExactlyOnceWith(control, field.property);
  expect(context.apply).toHaveBeenCalledExactlyOnceWith(control, field.property, value);
  expect(context.commit).toHaveBeenCalledExactlyOnceWith(control, field.property);
});

it.each([{ property: "display", label: "Layout", kind: "select" as const, values: ["flex", "grid"] }, { property: "opacity", label: "Opacity", kind: "text" as const }])("gives $property no Custom popup: the field is its editor", field => {
  const element = document.createElement("div"); document.body.append(element);
  const box = fieldControl(field, { element, begin() {}, apply() {}, commit() {} });
  expect(customPickerValue(element, field.property, box.querySelector<HTMLElement>("[data-property]"))).toBeUndefined();
});

it("keeps live values as one pending edit that the popup closing finishes", () => {
  const field: Field = { property: "padding", label: "Padding", kind: "length", max: 200 };
  const element = document.createElement("div"); document.body.append(element);
  const context = { element, begin: vi.fn(), apply: vi.fn(), commit: vi.fn() };
  const box = fieldControl(field, context), control = box.querySelector<HTMLElement>("[data-property]")!;
  const custom = customPickerValue(element, field.property, control)!;
  custom.onCommit!("4px 8px");
  custom.onCommit!("6px 8px");
  expect(context.begin).toHaveBeenCalledTimes(1);
  expect(context.apply.mock.calls.map(call => call[2])).toEqual(["4px 8px", "6px 8px"]);
  expect(context.commit.mock.calls.map(call => call[2])).toEqual([false, false]);
  custom.onDone!();
  expect(context.commit).toHaveBeenLastCalledWith(control, "padding");
  custom.onDone!();
  expect(context.commit).toHaveBeenCalledTimes(3);
});

it("does not apply a stale offset while another shadow control is empty", () => {
  const e = editor("box-shadow", "1px 2px 3px red");
  e.type("Layer 1 x offset", ""); e.type("Layer 1 y offset", "6"); e.key("Layer 1 y offset", "Enter");
  expect(e.preview).not.toHaveBeenCalled(); expect(e.commit).not.toHaveBeenCalled();
  e.type("Layer 1 x offset", "4");
  expect(e.preview).toHaveBeenLastCalledWith("4px 6px 3px red");
  e.key("Layer 1 x offset", "Enter");
  expect(e.commit).toHaveBeenCalledExactlyOnceWith("4px 6px 3px red");
});

it("retains the exact font draft and caret through refresh and keeps a token choice as a literal", () => {
  const e = editor("font-family", '"Acme, Face", serif', undefined, [{ path: "font.body", type: "fontFamily", value: '"Body, Face", sans-serif' }]);
  const select = e.box.querySelector<HTMLSelectElement>('select[aria-label="Font family choices"]')!;
  select.value = '"Body, Face", sans-serif'; select.dispatchEvent(new Event("change"));
  expect(e.commit).toHaveBeenLastCalledWith('"Body, Face", sans-serif');
  e.type("CSS value", '"Draft, Face", serif'); e.input("CSS value").setSelectionRange(2, 5); e.box.refresh("monospace");
  expect(e.input("CSS value").value).toBe('"Draft, Face", serif');
  expect(e.input("CSS value").selectionStart).toBe(2); expect(e.input("CSS value").selectionEnd).toBe(5);
});
