// @vitest-environment jsdom
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { installReactPreview } from "../src/adapters/react-preview.js";
import { discoverReactComponents } from "../src/adapters/react-fiber.js";
import { createReactPropsPanel, hasReactPropChanges, resetPreviews, showDesignBefore, undoReactProp } from "../src/react-props-panel.js";
import type { ComponentProperty } from "../src/design-system.js";

const schema: ComponentProperty[] = [
  { name: "label", kind: "string", required: true, typeLabel: "string" },
  { name: "disabled", kind: "boolean", required: true, typeLabel: "boolean" },
  { name: "tone", kind: "enum", required: false, values: ["calm", "bold"], typeLabel: "calm | bold" },
];
const mounted: Array<() => void> = [];
afterEach(() => {
  resetPreviews();
  mounted.splice(0).forEach(unmount => unmount());
  document.body.replaceChildren();
});
afterAll(() => { delete (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__; });

describe.each([
  ["React 19", "package.json"], ["React 18", "../komo-react18-fixture/package.json"],
])("runtime prop previews through %s", (_name, manifest) => {
  const require = createRequire(resolve(process.cwd(), manifest));
  installReactPreview();
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { flushSync } = require("react-dom");

  function setup(forward = false) {
    function ExampleButton(props: any) {
      return React.createElement("button", { disabled: props.disabled, "data-tone": props.tone, onClick: props.onClick }, props.label);
    }
    const Component = forward ? React.memo(React.forwardRef(ExampleButton)) : ExampleButton;
    const container = document.body.appendChild(document.createElement("main"));
    const root = createRoot(container);
    const onClick = vi.fn();
    const render = (props = {}) => flushSync(() => root.render(React.createElement(Component, { label: "Original", disabled: false, onClick, ...props })));
    render();
    mounted.push(() => flushSync(() => root.unmount()));
    const button = container.querySelector("button")!;
    const adapter = discoverReactComponents({ edit: true, schema: () => schema });
    const identity = adapter.identify(button)!;
    expect(adapter.editor!(identity)).not.toBeNull();
    const panel = document.body.appendChild(createReactPropsPanel(button, () => {}, undefined, undefined, { components: adapter })!);
    const control = (name: string) => panel.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="ExampleButton ${name}"]`)!;
    const change = (name: string, value: string | boolean) => {
      const input = control(name);
      if (typeof value === "boolean") (input as HTMLInputElement).checked = value;
      else input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    return { button, panel, control, change, render, root, adapter, onClick };
  }

  it("edits primitives and declared optional enums through the renderer, then restores and undoes a field reset", async () => {
    const { button, panel, change, control, onClick } = setup();
    expect(control("tone").value).toBe("");
    expect(panel.querySelector('[aria-label*="onClick"]')).toBeNull();
    change("label", "Preview");
    change("disabled", true);
    change("tone", "bold");
    await vi.waitFor(() => {
      expect(button.textContent).toBe("Preview");
      expect(button.disabled).toBe(true);
      expect(button.dataset.tone).toBe("bold");
    });
    const reset = panel.querySelector<HTMLButtonElement>('[aria-label="Reset ExampleButton label"]')!;
    expect(reset.hidden).toBe(false);
    reset.click();
    await vi.waitFor(() => expect(button.textContent).toBe("Original"));
    undoReactProp(button);
    await vi.waitFor(() => expect(button.textContent).toBe("Preview"));
    expect(hasReactPropChanges(button)).toBe(true);
    expect(button.disabled).toBe(true);
    showDesignBefore(true);
    await vi.waitFor(() => {
      expect(button.textContent).toBe("Original");
      expect(button.disabled).toBe(false);
      expect(button.hasAttribute("data-tone")).toBe(false);
    });
    showDesignBefore(false);
    await vi.waitFor(() => expect(button.textContent).toBe("Preview"));
    resetPreviews();
    await vi.waitFor(() => {
      expect(button.textContent).toBe("Original");
      expect(button.disabled).toBe(false);
      expect(button.hasAttribute("data-tone")).toBe(false);
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps only owned overrides through parent renders and stops overriding after reset", async () => {
    const { button, change, render } = setup();
    change("label", "Preview");
    await vi.waitFor(() => expect(button.textContent).toBe("Preview"));
    for (let i = 0; i < 3; i++) { showDesignBefore(true); showDesignBefore(false); }
    const callback = vi.fn();
    render({ label: "Parent update", onClick: callback, tone: "calm" });
    await vi.waitFor(() => expect(button.textContent).toBe("Preview"));
    expect(button.dataset.tone).toBe("calm");
    button.click();
    expect(callback).toHaveBeenCalledOnce();
    showDesignBefore(true);
    await vi.waitFor(() => expect(button.textContent).toBe("Original"));
    render({ label: "Changed while suspended" });
    showDesignBefore(false);
    await vi.waitFor(() => expect(button.textContent).toBe("Preview"));
    resetPreviews();
    await vi.waitFor(() => expect(button.textContent).toBe("Original"));
    render({ label: "After reset" });
    await vi.waitFor(() => expect(button.textContent).toBe("After reset"));
    expect(hasReactPropChanges(button)).toBe(false);
  });

  it("never transfers an old preview to a remounted instance", async () => {
    const { button, change, root, render, adapter } = setup();
    const editor = adapter.editor!(adapter.identify(button)!)!;
    change("label", "Preview");
    await vi.waitFor(() => expect(button.textContent).toBe("Preview"));
    flushSync(() => root.render(null));
    render({ label: "New instance" });
    await vi.waitFor(() => expect(document.querySelector("main button")!.textContent).toBe("New instance"));
    expect(editor.available!()).toBe(false);
  });

  it("edits a memo/forwardRef component without exposing a ref control", async () => {
    const { button, panel, change } = setup(true);
    change("disabled", true);
    await vi.waitFor(() => expect(button.disabled).toBe(true));
    expect(panel.querySelector('[aria-label*="ref"]')).toBeNull();
    undoReactProp(button);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  });

  it("keeps a nested forwardRef editor mounted through an unrelated parent/slot commit", async () => {
    let update!: () => void;
    const Slot = React.forwardRef(function Slot(props: any, ref: any) {
      return React.cloneElement(React.Children.only(props.children), { ref });
    });
    const ActionButton = React.forwardRef(function ActionButton(props: any, ref: any) {
      return React.createElement("button", { ref, className: `button-${props.variant}`, "aria-label": props["aria-label"] }, "Action");
    });
    const StableBranch = React.memo(function StableBranch() {
      return React.createElement(Slot, null, React.createElement(ActionButton, { variant: "tertiary", "aria-label": "Original action" }));
    });
    function UpdatingSibling() {
      const [tick, setTick] = React.useState(0);
      update = () => flushSync(() => setTick((value: number) => value + 1));
      return React.createElement("span", null, tick);
    }
    const container = document.body.appendChild(document.createElement("main"));
    const root = createRoot(container);
    flushSync(() => root.render(React.createElement("section", null, React.createElement(StableBranch), React.createElement(UpdatingSibling))));
    mounted.push(() => flushSync(() => root.unmount()));
    const button = container.querySelector("button")!;
    const adapter = discoverReactComponents({ edit: true });
    const identity = adapter.identify(button)!;
    expect(identity.name).toBe("ActionButton");
    const editor = adapter.editor!(identity)!;
    expect(editor.available!()).toBe(true);
    update();
    expect(editor.available!()).toBe(true);
    const panel = document.body.appendChild(createReactPropsPanel(button, () => {}, undefined, undefined, { components: adapter })!);
    const change = (name: string, value: string) => {
      const input = panel.querySelector<HTMLInputElement>(`[aria-label="ActionButton ${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    change("variant", "primary");
    await vi.waitFor(() => expect(button.className).toBe("button-primary"));
    expect(adapter.identify(button)!.props!.variant).toBe("primary");
    update();
    await vi.waitFor(() => expect(button.className).toBe("button-primary"));
    expect(editor.available!()).toBe(true);
    change("aria-label", "Preview action");
    await vi.waitFor(() => expect(button.getAttribute("aria-label")).toBe("Preview action"));
    undoReactProp(button);
    await vi.waitFor(() => expect(button.getAttribute("aria-label")).toBe("Original action"));
    undoReactProp(button);
    await vi.waitFor(() => expect(button.className).toBe("button-tertiary"));
    expect(editor.available!()).toBe(true);
    expect(adapter.editor!(adapter.identify(button)!)).toBe(editor);
  });
});
