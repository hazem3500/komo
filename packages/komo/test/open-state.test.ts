// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { openState } from "../src/open-state";

const key = "branch-comments:open:fixture:fixture";
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

it("restores from sessionStorage by default and ignores localStorage", () => {
  localStorage.setItem(key, "1");
  const store = openState(key);
  expect(store.get()).toBe(false);
  expect(localStorage.getItem(key)).toBeNull();
  store.set(true);
  expect(sessionStorage.getItem(key)).toBe("1");
  expect(localStorage.getItem(key)).toBeNull();
  expect(openState(key, "session").get()).toBe(true);
  store.set(false);
  expect(sessionStorage.getItem(key)).toBeNull();
});

it("keeps the open state in localStorage with 'always'", () => {
  localStorage.setItem(key, "1");
  const store = openState(key, "always");
  expect(store.get()).toBe(true);
  store.set(false);
  expect(localStorage.getItem(key)).toBeNull();
  store.set(true);
  expect(localStorage.getItem(key)).toBe("1");
  expect(sessionStorage.getItem(key)).toBeNull();
});

it("neither restores nor writes when false, and drops the stale key", () => {
  localStorage.setItem(key, "1");
  sessionStorage.setItem(key, "1");
  const store = openState(key, false);
  expect(store.get()).toBe(false);
  expect(localStorage.getItem(key)).toBeNull();
  store.set(true);
  expect(localStorage.getItem(key)).toBeNull();
  expect(sessionStorage.getItem(key)).toBe("1");
});

it("starts closed when storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  const store = openState(key);
  expect(store.get()).toBe(false);
  expect(() => store.set(true)).not.toThrow();
});
