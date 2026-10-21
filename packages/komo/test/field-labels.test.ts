// @vitest-environment jsdom
import { expect, it } from "vitest";
import { fieldControl, type Field } from "../src/design-panel.js";

it("keeps metadata labels visible and associated with empty or populated controls", () => {
  const element = document.createElement("div");
  element.style.opacity = "0.4";
  document.body.append(element);
  const fields: Field[] = [
    { property: "color", label: "Text color", kind: "color" },
    { property: "background-color", label: "Fill", kind: "color" },
    { property: "border-color", label: "Border color", kind: "color" },
    { property: "opacity", label: "Opacity", kind: "text" },
    { property: "width", label: "Width", kind: "size" },
    { property: "border-radius", label: "Corner radius", kind: "length", min: 0, max: 96 },
  ];
  for (const field of fields) {
    const box = fieldControl(field, { element, begin() {}, apply() {}, commit() {} });
    document.body.append(box);
    const label = box.querySelector("label")!;
    const control = box.querySelector<HTMLInputElement>("[data-property]")!;
    expect(label.htmlFor).toBe(control.id);
    expect(label.control).toBe(control);
    expect(label.textContent).toContain(field.label);
    expect(box.dataset.fieldLabel).toBe(field.label);
    if (field.property === "opacity") {
      expect(label.textContent).toBe("Opacity");
      expect(control.value).toBe("0.4");
    }
    // Units show inside the field (field-controls.ts), so labels name the field alone.
    if (field.kind === "length" || field.kind === "size") expect(label.textContent).toBe(field.label);
    control.value = "";
    expect(label.textContent).toContain(field.label);
  }
  document.body.replaceChildren();
});
