// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mountFrameSize } from "../src/frame-size";
import { frameView } from "../src/review-layout";

const key = "palette:frame-size:mode-test:example/review";
const box = { left: 24, top: 48, width: 852, height: 728 };
const mounted: Array<{ destroy(): void }> = [];

function mount(viewport: false | "iframe" | "transform", stored?: object, hooks: { shell?: boolean } = {}) {
  if (stored) localStorage.setItem(key, JSON.stringify(stored));
  const host = document.body.appendChild(document.createElement("div"));
  const root = host.attachShadow({ mode: "open" });
  const toggles: boolean[] = [];
  const controls = mountFrameSize(root, () => document.body, key, (toggled) => toggles.push(!!toggled), frameView, viewport, hooks);
  mounted.push(controls);
  controls.update(box);
  const row = () => root.querySelector<HTMLElement>('[role="menuitemcheckbox"]');
  return { controls, root, row, toggles, stored: () => JSON.parse(localStorage.getItem(key) ?? "null") };
}

afterEach(() => {
  mounted.splice(0).forEach((controls) => controls.destroy());
  document.body.replaceChildren();
  localStorage.clear();
});

describe("Frame's simulated viewport choice", () => {
  it("ignores a remembered choice when the host doesn't offer the simulated viewport, and keeps it", () => {
    const frame = mount(false, { v: 2, size: [390, 844], actual: false, inPlace: false });
    expect(frame.controls.separate).toBe(false);
    // No row and no old switch: nothing in the Frame UI offers it.
    expect(frame.row()).toBeNull();
    expect(frame.root.querySelector(".frame-mode")).toBeNull();
    expect(frame.stored()).toEqual({ v: 2, size: [390, 844], actual: false, inPlace: false });
    // A later size choice keeps the stored choice too.
    frame.root.querySelector<HTMLElement>('[role="menuitemradio"]')!.click();
    expect(frame.controls.separate).toBe(false);
    expect(frame.stored()).toEqual({ v: 2, size: null, actual: false, inPlace: false });
  });

  it("honours the kept choice when the host offers the simulated viewport again", () => {
    expect(mount("transform", { v: 2, size: null, actual: false, inPlace: false }).controls.separate).toBe(true);
  });

  it("is a checkbox row in the size menu that toggles, without closing it, and is remembered", () => {
    const frame = mount("transform");
    const row = frame.row()!;
    expect(row.parentElement!.getAttribute("role")).toBe("menu");
    expect(row.getAttribute("aria-checked")).toBe("false");
    expect(frame.root.getElementById(row.getAttribute("aria-labelledby")!)!.textContent).toBe("Simulate real viewport");
    expect(frame.root.getElementById(row.getAttribute("aria-describedby")!)!.textContent).toBe(
      "Reloads the page in a frame so breakpoints and popovers match this size. Runs a second copy of the app.",
    );
    frame.root.querySelector<HTMLElement>(".frame-size-trigger")!.click();
    row.click();
    expect(frame.controls.separate).toBe(true);
    expect(row.getAttribute("aria-checked")).toBe("true");
    expect(frame.root.querySelector<HTMLElement>(".frame-menu")!.hidden).toBe(false);
    expect(frame.toggles).toEqual([true]);
    expect(frame.stored()).toMatchObject({ inPlace: false });
    row.click();
    expect(frame.controls.separate).toBe(false);
    expect(row.getAttribute("aria-checked")).toBe("false");
    expect(frame.stored()).toMatchObject({ inPlace: true });
  });

  it("says a second copy runs only without the single-copy shell", () => {
    const hint = (frame: ReturnType<typeof mount>) => frame.root.getElementById("frame-sim-hint")!.textContent;
    expect(hint(mount("iframe"))).toBe("Reloads the page in a frame so breakpoints and popovers match this size. Runs a second copy of the app.");
    mounted.splice(0).forEach((controls) => controls.destroy());
    document.body.replaceChildren();
    expect(hint(mount("iframe", undefined, { shell: true }))).toBe("Reloads this page inside a frame so breakpoints and popovers match this size.");
  });

  it("points the window note at the row only when the menu has it", () => {
    const tip = (frame: ReturnType<typeof mount>) => {
      const info = frame.root.querySelector(".frame-info")!;
      expect(info.getAttribute("aria-description")).toBe(frame.root.querySelector(".frame-tip")!.textContent);
      return info.getAttribute("aria-description");
    };
    expect(tip(mount(false))).toBe("Uses window size.");
    mounted.splice(0).forEach((controls) => controls.destroy());
    document.body.replaceChildren();
    expect(tip(mount("transform"))).toBe("Uses window size. Use Simulate real viewport.");
  });

  it("starts checked by default with mode iframe", () => {
    const frame = mount("iframe");
    expect(frame.controls.separate).toBe(true);
    expect(frame.row()!.getAttribute("aria-checked")).toBe("true");
    // Nothing chosen yet, so nothing is stored for the default size.
    expect(frame.stored()).toBeNull();
  });
});
