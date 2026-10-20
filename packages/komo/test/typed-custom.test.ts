// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { customEditor } from "../src/token-custom.js";
import { cssParts, primaryFamily, shadowLayers } from "../src/typed-custom.js";
import { customPickerValue } from "../src/custom-field.js";
import { fieldControl } from "../src/design-panel.js";
vi.stubGlobal("CSS", { supports(property: string, value: string) {
  const style = document.createElement("span").style; style.setProperty(property, value);
  return !!style.getPropertyValue(property);
} });
afterEach(() => document.body.replaceChildren());
function editor(property: string, value: string, field?: Parameters<typeof customEditor>[4], tokens?: Parameters<typeof customEditor>[5]) {
  const preview = vi.fn(), commit = vi.fn();
  const box = customEditor(property, value, preview, commit, field, tokens); document.body.append(box);
  const input = (name: string) => box.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!;
  const type = (name: string, value: string) => { input(name).value = value; input(name).dispatchEvent(new Event("input")); };
  const apply = () => box.querySelector<HTMLButtonElement>(".komo-custom__actions button")!.click();
  return { box, preview, commit, input, type, apply };
}
it("uses CSS validity rather than the scrub range, preserves units and incomplete drafts", () => {
  const e = editor("border-radius", "2rem", { property: "border-radius", label: "Corner radius", kind: "length", max: 96 });
  expect(e.input("Corner radius unit").value).toBe("rem");
  e.type("Corner radius value", "200"); expect(e.preview).toHaveBeenLastCalledWith("200rem");
  e.type("Corner radius value", ""); e.box.refresh("8px");
  expect(e.input("Corner radius value").value).toBe(""); e.apply(); expect(e.commit).not.toHaveBeenCalled();
  e.type("Corner radius value", "4"); e.apply(); expect(e.commit).toHaveBeenCalledExactlyOnceWith("4rem");
});
it.each(["calc(100% - 2rem)", "var(--width)", "25% 30% / 10px 50%"])("keeps complex CSS %s exact", value => {
  const e = editor(value.includes("/") ? "border-radius" : "width", value);
  expect(e.input("CSS value").value).toBe(value); expect(e.box.querySelector("details")!.open).toBe(true);
  e.apply(); expect(e.commit).toHaveBeenCalledWith(value);
});
it("edits shadow layers without losing nested color commas and keeps complex fallback", () => {
  expect(cssParts('1px 2px rgb(0, 0, 0), inset 0 1px red', true)).toHaveLength(2);
  expect(shadowLayers("var(--shadow)")).toBeUndefined();
  const e = editor("box-shadow", "1px 2px 3px 4px rgba(0, 0, 0, 0.2), inset 0px 1px red");
  e.type("X offset value", "5");
  expect(e.preview).toHaveBeenLastCalledWith("5px 2px 3px 4px rgba(0, 0, 0, 0.2), inset 0px 1px red");
  e.apply(); expect(e.commit).toHaveBeenCalledTimes(1);
});
it("shows primary font and only real token choices, retaining quoted fallback stacks", () => {
  const stack = '"Acme, Display", "Fallback Sans", sans-serif';
  expect(primaryFamily(stack)).toBe("Acme, Display");
  const e = editor("font-family", stack, undefined, [{ path: "font.body", type: "fontFamily", value: '"Body", serif' }]);
  expect(e.box.querySelector(".komo-typed__sample span")!.textContent).toBe("Acme, Display");
  expect(e.input("CSS value").value).toBe(stack);
  expect(e.box.querySelectorAll("option")).toHaveLength(2);
  e.type("CSS value", '"Other, Face", monospace'); e.box.refresh("serif"); e.apply();
  expect(e.commit).toHaveBeenCalledExactlyOnceWith('"Other, Face", monospace');
});
it.each([{ property: "padding", label: "Padding", kind: "length" as const, max: 200 }, { property: "display", label: "Layout", kind: "select" as const, values: ["flex", "grid"] }])("routes $property Custom through the existing field transaction", field => {
  const element = document.createElement("div"); document.body.append(element);
  const context = { element, begin: vi.fn(), apply: vi.fn(), commit: vi.fn() };
  const box = fieldControl(field, context), control = box.querySelector<HTMLElement>("[data-property]")!;
  const custom = customPickerValue(element, field.property, control)!;
  expect(custom.field).toBe(field);
  const undo = custom.onPreview(field.kind === "length" ? "2rem" : "grid"); undo(); expect(element.getAttribute("style")).toBeNull();
  const value = field.kind === "length" ? "calc(1rem + 2px)" : "grid";
  custom.onSelect(value);
  expect(context.begin).toHaveBeenCalledExactlyOnceWith(control, field.property);
  expect(context.apply).toHaveBeenCalledExactlyOnceWith(control, field.property, value);
  expect(context.commit).toHaveBeenCalledExactlyOnceWith(control, field.property);
});
it("does not apply a stale offset while another shadow control changes", () => {
  const e = editor("box-shadow", "1px 2px 3px red");
  e.type("X offset value", ""); e.type("Y offset value", "6"); e.apply();
  expect(e.preview).not.toHaveBeenCalled(); expect(e.commit).not.toHaveBeenCalled();
  e.type("X offset value", "4"); e.apply();
  expect(e.commit).toHaveBeenCalledExactlyOnceWith("4px 6px 3px red");
});
it("retains the exact font draft and caret through refresh and keeps token choice a literal", () => {
  const e = editor("font-family", '"Acme, Face", serif', undefined, [{ path: "font.body", type: "fontFamily", value: '"Body, Face", sans-serif' }]);
  const select = e.box.querySelector<HTMLSelectElement>('select[aria-label="Font family choices"]')!;
  select.value = '"Body, Face", sans-serif'; select.dispatchEvent(new Event("change"));
  expect(e.preview).toHaveBeenLastCalledWith('"Body, Face", sans-serif');
  e.type("CSS value", '"Draft, Face", serif'); e.input("CSS value").setSelectionRange(2, 5); e.box.refresh("monospace");
  expect(e.input("CSS value").value).toBe('"Draft, Face", serif');
  expect(e.input("CSS value").selectionStart).toBe(2); expect(e.input("CSS value").selectionEnd).toBe(5);
});
