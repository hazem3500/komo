import { afterEach, describe, expect, it, vi } from "vitest";

const element = () => ({ style: { left: "", opacity: "", transform: "", translate: "" } }) as unknown as HTMLElement;

async function load(animate: (...args: unknown[]) => unknown, fail = false) {
  vi.resetModules();
  vi.doMock("../src/motion-animate.js", () => {
    if (fail) throw new Error("chunk failed");
    return { animate };
  });
  return import("../src/lazy-motion.js");
}

afterEach(() => vi.doUnmock("../src/motion-animate.js"));

describe("lazy motion", () => {
  it("holds the first keyframe until Motion loads, then starts the same animation", async () => {
    const controls = { stop: vi.fn(), finished: Promise.resolve("done") };
    const animate = vi.fn(() => controls);
    const { animate: lazyAnimate } = await load(animate);
    const target = element();
    const options = { duration: 0.2 };
    const motion = lazyAnimate(target, { left: ["10px", "40px"], opacity: 1 }, options);
    expect(target.style.left).toBe("10px");
    expect(target.style.opacity).toBe("");
    await expect(motion.finished).resolves.toBe("done");
    expect(animate).toHaveBeenCalledWith(target, { left: ["10px", "40px"], opacity: 1 }, options);
    // Once loaded, calls go straight to Motion.
    expect(lazyAnimate(target, { opacity: 0 }, options)).toBe(controls);
  });

  it("never starts an animation stopped before Motion arrives", async () => {
    const animate = vi.fn();
    const { animate: lazyAnimate, loadMotion } = await load(animate);
    const motion = lazyAnimate(element(), { translate: ["4px 0px", "0px 0px"] }, {});
    motion.stop();
    let settled = false;
    void motion.finished.then(() => (settled = true));
    await loadMotion();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(animate).not.toHaveBeenCalled();
    expect(settled).toBe(false);
  });

  it("jumps to the last keyframe and settles when Motion cannot load", async () => {
    const { animate: lazyAnimate } = await load(vi.fn(), true);
    const target = element();
    const motion = lazyAnimate(target, { left: ["10px", "40px"], opacity: 1, y: 0 }, {});
    await expect(motion.finished).resolves.toBeUndefined();
    expect(target.style.left).toBe("40px");
    expect(target.style.opacity).toBe("1");
    expect(target.style.transform).toBe("translateY(0px)");
  });
});
