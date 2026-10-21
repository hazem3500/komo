// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { enterShell, shellUrl } from "../src/shell-mode";
import { shellNonce } from "../src/shell-session";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("single-copy shell", () => {
  it("asks first, names unposted design changes, and keeps two copies when the reviewer cancels", () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fallback = vi.fn();
    enterShell("example-project", true, true, fallback);
    expect(ask.mock.calls[0][0]).toContain("Unsaved changes in the app are lost, and so are design changes you haven't posted.");
    expect(fallback).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("komo:shell")).toBeNull();
    enterShell("example-project", true, false, fallback);
    expect(ask.mock.calls[1][0]).not.toContain("design changes");
  });

  it("keeps two copies when sessionStorage is blocked", () => {
    const ask = vi.spyOn(window, "confirm");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const fallback = vi.fn();
    // A remembered Frame reopening on load doesn't ask.
    enterShell("example-project", false, false, fallback);
    expect(ask).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("matches only komo's own nonce for this project and origin", () => {
    const nonce = "f".repeat(32);
    history.replaceState(null, "", shellUrl(location.href, nonce));
    expect(shellNonce("example-project")).toBe("");
    sessionStorage.setItem("komo:shell", JSON.stringify({ v: 1, project: "example-project", nonce, origin: location.origin }));
    expect(shellNonce("example-project")).toBe(nonce);
    expect(shellNonce("other-project")).toBe("");
    sessionStorage.setItem("komo:shell", JSON.stringify({ v: 1, project: "example-project", nonce, origin: "https://elsewhere.test" }));
    expect(shellNonce("example-project")).toBe("");
    history.replaceState(null, "", shellUrl(location.href, ""));
    expect(new URL(location.href).searchParams.has("komo-shell")).toBe(false);
  });
});
