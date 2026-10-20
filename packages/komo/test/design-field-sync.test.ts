// @vitest-environment jsdom
// Fields show declarations changed outside them (a geometry resize, Undo, Reset,
// Before/After) and keep what their own edits show.
import { afterEach, expect, it } from "vitest";
import { fieldControl, fields, syncFields } from "../src/design-panel.js";

afterEach(() => document.body.replaceChildren());

function render(...properties: string[]) {
  const element = document.createElement("div");
  element.style.width = "184px";
  const container = document.createElement("div");
  document.body.append(element, container);
  const context = {
    element,
    begin() {},
    apply(_control: Element, property: string, value: string | null) { if (value) element.style.setProperty(property, value); },
    commit() {},
  };
  for (const property of properties) container.append(fieldControl(fields.find((field) => field.property === property)!, context));
  const control = (property: string) => container.querySelector<HTMLInputElement>(`[data-property="${property}"]`)!;
  return { element, container, control };
}

it("refreshes fields whose declaration changed elsewhere, keeping units and swatches", () => {
  const { element, container, control } = render("width", "margin", "background-color");
  expect(control("width").value).toBe("184");
  element.style.setProperty("width", "136px", "important");
  element.style.margin = "1rem";
  element.style.backgroundColor = "rgb(255, 0, 0)";
  syncFields(container, () => false);
  expect(control("width").value).toBe("136");
  expect(control("margin").value).toBe("1rem");
  expect(control("background-color").value).toBe("#ff0000");
  expect(container.querySelector<HTMLInputElement>('input[type="color"]')!.value).toBe("#ff0000");
  element.style.removeProperty("width");
  syncFields(container, () => false);
  expect(control("width").value).not.toBe("136");
});

it("keeps a field's own edit and skips fields mid-edit", () => {
  const { element, container, control } = render("width");
  const width = control("width");
  width.value = "50%";
  width.dispatchEvent(new Event("input"));
  width.dispatchEvent(new Event("change"));
  expect(element.style.width).toBe("50%");
  syncFields(container, () => false);
  expect(width.value).toBe("50%");
  element.style.width = "120px";
  syncFields(container, () => true);
  expect(width.value).toBe("50%");
  syncFields(container, () => false);
  expect(width.value).toBe("120");
});
