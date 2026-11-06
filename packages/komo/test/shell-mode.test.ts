// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { enterShell, shellUrl } from "../src/shell-mode";
import { shellNonce } from "../src/shell-session";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("single-copy shell", () => {
  it("asks first, names unposted design changes, and keeps the current page when the reviewer cancels", () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fallback = vi.fn();
    enterShell("example-project", true, true, fallback);
    expect(ask.mock.calls[0][0]).toContain("Unsaved app changes and unposted Design changes will be lost.");
    expect(fallback).toHaveBeenCalledWith("Reload cancelled.");
    expect(sessionStorage.getItem("palette:shell")).toBeNull();
    enterShell("example-project", true, false, fallback);
    expect(ask.mock.calls[1][0]).not.toContain("Design changes");
  });

  it("reports blocked sessionStorage without loading a second app", () => {
    const ask = vi.spyOn(window, "confirm");
    vi.stubGlobal("sessionStorage", { setItem() {
      throw new DOMException("blocked", "SecurityError");
    } });
    const fallback = vi.fn();
    // A remembered Frame reopening on load doesn't ask.
    enterShell("example-project", false, false, fallback);
    expect(ask).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledWith("Storage blocked.");
  });

  it("matches only Palette's own nonce for this project and origin", () => {
    const nonce = "f".repeat(32);
    history.replaceState(null, "", shellUrl(location.href, nonce));
    expect(shellNonce("example-project")).toBe("");
    sessionStorage.setItem("palette:shell", JSON.stringify({ v: 1, project: "example-project", nonce, origin: location.origin }));
    expect(shellNonce("example-project")).toBe(nonce);
    expect(shellNonce("other-project")).toBe("");
    sessionStorage.setItem("palette:shell", JSON.stringify({ v: 1, project: "example-project", nonce, origin: "https://elsewhere.test" }));
    expect(shellNonce("example-project")).toBe("");
    history.replaceState(null, "", shellUrl(location.href, ""));
    expect(new URL(location.href).searchParams.has("palette-shell")).toBe(false);
  });
});
