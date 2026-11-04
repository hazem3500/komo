import { afterEach, expect, it, vi } from "vitest";
import { frameBridge } from "../src/frame-target";
import { claimShell, shellClaimed } from "../src/shell-session";

afterEach(() => vi.unstubAllGlobals());

it("reads a frame bridge an older release published as komo.frame-bridge", () => {
  vi.stubGlobal("window", {});
  const inspectableFor = () => null;
  const framed = { [Symbol.for("komo.frame-bridge")]: { inspectableFor } };
  expect(frameBridge(framed as unknown as Window)?.inspectableFor).toBe(inspectableFor);
  const current = { [Symbol.for("palette.frame-bridge")]: { inspectableFor } };
  expect(frameBridge(current as unknown as Window)?.inspectableFor).toBe(inspectableFor);
});

it("claims the shell under both names, so an older guard stands down", () => {
  const realm: Record<symbol, string> = {};
  vi.stubGlobal("window", realm);
  claimShell("nonce");
  expect(realm[Symbol.for("palette.shell")]).toBe("nonce");
  expect(realm[Symbol.for("komo.shell")]).toBe("nonce");
  delete realm[Symbol.for("palette.shell")];
  expect(shellClaimed("nonce")).toBe(true);
});
