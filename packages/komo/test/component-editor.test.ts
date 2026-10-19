// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createReactPropsPanel, hasReactPropChanges, resetPreviews, undoReactProp } from "../src/react-props-panel.js";
import type { ComponentEditor, ComponentAdapter } from "../src/design-system.js";

afterEach(() => { resetPreviews(); document.body.replaceChildren(); });

function fixture(fail = false) {
  const element = document.body.appendChild(document.createElement("button"));
  let props = { label: "Original", disabled: false };
  let available = true;
  const release = vi.fn();
  const editor: ComponentEditor = {
    schema: [
      { name: "label", kind: "string", required: true, typeLabel: "string" },
      { name: "disabled", kind: "boolean", required: true, typeLabel: "boolean" },
    ],
    read: () => props,
    apply(next) {
      if (fail) throw new Error("Renderer unavailable");
      props = next as typeof props;
      element.textContent = props.label;
      element.disabled = props.disabled;
    },
    release,
    available: () => available && element.isConnected,
  };
  element.textContent = props.label;
  const adapter: ComponentAdapter = {
    identify: () => ({ name: "ExampleButton", element, props, source: "example/button.ts:4" }),
    editor: () => editor,
  };
  const onEdit = vi.fn();
  const panel = document.body.appendChild(createReactPropsPanel(element, onEdit, undefined, undefined, { components: adapter })!);
  const label = panel.querySelector<HTMLInputElement>('[aria-label="ExampleButton label"]')!;
  return { element, panel, label, release, onEdit, disconnect: () => { available = false; } };
}

it("uses a framework-independent editor callback, supports an empty string, and releases exactly the reset field", () => {
  const { element, panel, label, release } = fixture();
  label.value = "";
  label.dispatchEvent(new Event("change"));
  expect(element.textContent).toBe("");
  expect(hasReactPropChanges(element)).toBe(true);
  const disabled = panel.querySelector<HTMLInputElement>('[aria-label="ExampleButton disabled"]')!;
  disabled.checked = true;
  disabled.dispatchEvent(new Event("change"));
  panel.querySelector<HTMLButtonElement>('[aria-label="Reset ExampleButton label"]')!.click();
  expect(element.textContent).toBe("Original");
  expect(element.disabled).toBe(true);
  expect(release).toHaveBeenCalledWith(["label"]);
  undoReactProp(element);
  expect(element.textContent).toBe("");
  expect(element.disabled).toBe(true);
});

it("keeps the host value and history when an editor rejects a preview", () => {
  const { element, label, onEdit } = fixture(true);
  label.value = "Unavailable";
  label.dispatchEvent(new Event("change"));
  expect(element.textContent).toBe("Original");
  expect(hasReactPropChanges(element)).toBe(false);
  expect(onEdit).not.toHaveBeenCalled();
  expect(label.getAttribute("aria-invalid")).toBe("true");
});

it("does not record a UI-only edit when the captured component becomes unavailable", () => {
  const { element, label, onEdit, disconnect } = fixture();
  disconnect();
  label.value = "Unavailable";
  label.dispatchEvent(new Event("change"));
  expect(element.textContent).toBe("Original");
  expect(hasReactPropChanges(element)).toBe(false);
  expect(onEdit).not.toHaveBeenCalled();
  expect(label.getAttribute("aria-invalid")).toBe("true");
});
