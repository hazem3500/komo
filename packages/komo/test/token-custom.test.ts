// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { openTokenPicker, refreshTokenPicker } from "../src/token-picker.js";

vi.stubGlobal("CSS", { supports: (property: string, value: string) => {
  const style = document.createElement("span").style;
  style.setProperty(property, value);
  return !!style.getPropertyValue(property);
} });
afterEach(() => document.body.replaceChildren());

it("keeps the popup, query, active token and scroll position through async theme refresh", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  const tokens = Array.from({ length: 80 }, (_, i) => ({ path: `color.${i}`, type: "color" as const, value: "#123456", label: `Color ${i}`, properties: ["color"] }));
  const options = { trigger, tokens, property: "color", current: "color.1", onSelect: vi.fn() };
  const close = openTokenPicker(options);
  const popup = document.querySelector(".komo-tokens")!;
  const search = popup.querySelector("input")!;
  search.value = "Color 1";
  search.dispatchEvent(new Event("input"));
  search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  const list = popup.querySelector<HTMLElement>('[role="listbox"]')!;
  list.scrollTop = 48;
  const active = popup.querySelector('[data-active]')!.getAttribute("aria-label");
  refreshTokenPicker(trigger);
  refreshTokenPicker(trigger, { ...options, tokens: tokens.map(token => ({ ...token, value: "#abcdef" })) });
  expect(document.querySelector(".komo-tokens")).toBe(popup);
  expect(search.value).toBe("Color 1");
  expect(list.scrollTop).toBe(48);
  expect(popup.querySelector('[data-active]')!.getAttribute("aria-label")).toBe(active!.replace("#123456", "#abcdef"));
  expect(options.onSelect).not.toHaveBeenCalled();
  close();
});

it("opens unbound values in Custom, allows Tab, and restores before a single custom commit", async () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  let value = "serif";
  const commit = vi.fn(next => { expect(value).toBe("serif"); value = next; });
  const close = openTokenPicker({ trigger, tokens: [], property: "font-family", onSelect: vi.fn(), custom: {
    value, onPreview(next) { const before = value; value = next; return () => { value = before; }; }, onSelect: commit,
  } });
  await vi.waitFor(() => expect(document.querySelector(".komo-custom")).not.toBeNull());
  const input = document.querySelector<HTMLInputElement>('[aria-label="CSS value"]')!;
  input.value = "monospace";
  input.dispatchEvent(new Event("input"));
  expect(value).toBe("monospace");
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  expect(document.querySelector(".komo-tokens")).not.toBeNull();
  expect(commit).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>(".komo-custom button")!.click();
  expect(commit).toHaveBeenCalledExactlyOnceWith("monospace");
  expect(document.querySelector(".komo-tokens")).toBeNull();
  close();
});
