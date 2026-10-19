// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { installReactPreview, reactPreviewKey, type ReactPreviewBridge } from "../src/adapters/react-preview.js";

const target = globalThis as any;
afterEach(() => { delete target.__REACT_DEVTOOLS_GLOBAL_HOOK__; vi.unstubAllGlobals(); });

it("preserves an existing DevTools hook and commit callback, and installs once", () => {
  const previous = vi.fn();
  const hook = { supportsFiber: true, renderers: new Map(), onCommitFiberRoot: previous };
  target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  expect(installReactPreview()).toBe(true);
  const commit = hook.onCommitFiberRoot;
  expect(installReactPreview()).toBe(true);
  expect(hook.onCommitFiberRoot).toBe(commit);
  const root = {};
  hook.onCommitFiberRoot(7, root);
  expect(previous).toHaveBeenCalledWith(7, root);
  expect(target.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(hook);
});

it.each([0, 1])("requires a supported development renderer capability, bundleType=%s", bundleType => {
  const root = {};
  const overrideProps = vi.fn();
  target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map([[1, { bundleType, version: "19.2.7", rendererPackageName: "react-dom", overrideProps }]]),
    getFiberRoots: () => new Set([root]),
  };
  expect(installReactPreview()).toBe(true);
  const bridge = target.__REACT_DEVTOOLS_GLOBAL_HOOK__[reactPreviewKey] as ReactPreviewBridge;
  const read = vi.fn(() => ({ fiber: {}, root, props: { label: "Original" } }));
  const editor = bridge.editor({ schema: [{ name: "label", kind: "string", required: true, typeLabel: "string" }], current: read });
  if (!bundleType) expect(editor).toBeNull();
  else {
    editor!.apply({ label: "Preview" });
    expect(overrideProps).toHaveBeenCalledWith(expect.any(Object), [], { label: "Preview" });
  }
});

it("leaves a frozen or unsupported hook untouched and does nothing without a window", () => {
  const hook = Object.freeze({ supportsFiber: true, renderers: new Map() });
  target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  expect(installReactPreview()).toBe(false);
  expect(target.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(hook);
  vi.stubGlobal("window", undefined);
  expect(installReactPreview()).toBe(false);
});
