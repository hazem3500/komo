import { runInNewContext } from "node:vm";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import { EYEDROPPER_STUB_HEX, eyeDropperStub } from "./setup-no-eyedropper.js";

// No browser here: this checks the guard itself, so a broken guard fails before any e2e file runs.
const page = () => {
  class Native { open() { return Promise.resolve({ sRGBHex: "#000000" }); } }
  const scope: Record<string, unknown> = { EyeDropper: Native, DOMException, Promise, Error, Object };
  scope.globalThis = scope;
  runInNewContext(eyeDropperStub, scope);
  return { scope, Native };
};

it("replaces the native EyeDropper with a stub and makes a native open throw", async () => {
  const { scope, Native } = page();
  expect(scope.EyeDropper).not.toBe(Native);
  expect(() => new Native().open()).toThrow("Native EyeDropper reached");
  const Stub = scope.EyeDropper as new () => { open(): Promise<{ sRGBHex: string }> };
  await expect(new Stub().open()).resolves.toEqual({ sRGBHex: EYEDROPPER_STUB_HEX });
  scope.__komoEyeDropper = "abort";
  await expect(new Stub().open()).rejects.toMatchObject({ name: "AbortError" });
  expect(scope.__komoEyeDropperCalls).toBe(2);
});

it("wraps every Chromium launch", () => {
  expect(chromium.launch.toString()).toContain("withFlag");
  expect(chromium.launchPersistentContext.toString()).toContain("withFlag");
});
