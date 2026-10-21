// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STILL, holdHostMotion, stillPreview } from "../src/host-motion.js";

// jsdom has no constructable sheets or animations; a stand-in records what komo adopts.
class Sheet { text = ""; replaceSync(text: string) { this.text = text; } }
const animation = (endTime: number) => ({ effect: { getComputedTiming: () => ({ endTime }) }, finish: vi.fn() });
const frames = (count = 2) => { for (let i = 0; i < count; i++) vi.advanceTimersToNextFrame(); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  vi.stubGlobal("CSSStyleSheet", Sheet);
  for (const root of [Document.prototype, ShadowRoot.prototype])
    if (!("adoptedStyleSheets" in root)) Object.defineProperty(root, "adoptedStyleSheets", {
      configurable: true,
      get(this: { _sheets?: unknown[] }) { return this._sheets ?? []; },
      set(this: { _sheets?: unknown[] }, value: unknown[]) { this._sheets = value; },
    });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  (document as unknown as { _sheets?: unknown[] })._sheets = undefined;
});

const mount = () => {
  document.body.innerHTML = `<button id="button" class="host"><span>Label</span></button>`;
  return document.getElementById("button")!;
};

describe("host motion during komo previews", () => {
  it("turns transitions off in the previewed subtree and restores the element exactly", () => {
    const element = mount();
    const host = new Sheet();
    document.adoptedStyleSheets = [host as unknown as CSSStyleSheet];
    const release = holdHostMotion(element);
    expect(element.hasAttribute(STILL)).toBe(true);
    const sheets = document.adoptedStyleSheets as unknown as Sheet[];
    expect(sheets).toHaveLength(2);
    expect(sheets[0]).toBe(host);
    // The element, every descendant and their pseudo-elements.
    expect(sheets[1].text).toContain(`:is([${STILL}],[${STILL}] *)::before`);
    expect(sheets[1].text).toContain("transition:none!important");
    // No inline style is written, so an absent style attribute stays absent.
    expect(element.getAttribute("style")).toBeNull();
    release();
    // The host renders the restored value first; only then do its transitions return.
    expect(element.hasAttribute(STILL)).toBe(true);
    frames();
    expect(element.hasAttribute(STILL)).toBe(false);
    expect(element.getAttribute("style")).toBeNull();
    expect(element.outerHTML).toBe(`<button id="button" class="host"><span>Label</span></button>`);
    expect(document.adoptedStyleSheets).toEqual([host]);
  });

  it("keeps one hold across steps, so moving between options never lets motion back in", () => {
    const element = mount();
    const first = holdHostMotion(element);
    first();
    frames(1);
    // The next option arrives before the release lands.
    const second = holdHostMotion(element);
    frames(3);
    expect(element.hasAttribute(STILL)).toBe(true);
    expect(document.adoptedStyleSheets).toHaveLength(1);
    const nested = holdHostMotion(element);
    second();
    second();
    frames(3);
    expect(element.hasAttribute(STILL)).toBe(true);
    nested();
    frames();
    expect(element.hasAttribute(STILL)).toBe(false);
    expect(document.adoptedStyleSheets).toHaveLength(0);
  });

  it("finishes animations a step started and leaves the host's own running and endless ones", () => {
    const element = mount();
    const running = animation(1000), loop = animation(Infinity), started = animation(300), spinner = animation(Infinity);
    const list = [running];
    element.getAnimations = (() => list) as unknown as Element["getAnimations"];
    const release = holdHostMotion(element);
    list.push(started, spinner);
    frames(1);
    expect(started.finish).toHaveBeenCalledOnce();
    expect(running.finish).not.toHaveBeenCalled();
    expect(spinner.finish).not.toHaveBeenCalled();
    list.push(loop);
    release();
    frames();
    expect(running.finish).not.toHaveBeenCalled();
    expect(loop.finish).not.toHaveBeenCalled();
  });

  it("adopts into the element's own shadow root", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = host.attachShadow({ mode: "open" });
    const element = root.appendChild(document.createElement("button"));
    const release = holdHostMotion(element);
    expect(root.adoptedStyleSheets).toHaveLength(1);
    expect(document.adoptedStyleSheets).toHaveLength(0);
    release();
    frames();
    expect(root.adoptedStyleSheets).toHaveLength(0);
    expect(element.hasAttribute(STILL)).toBe(false);
  });

  it("undoes a held preview inside the hold, and lets go when the preview throws", () => {
    const element = mount();
    const undo = vi.fn(() => expect(element.hasAttribute(STILL)).toBe(true));
    const stop = stillPreview(element, () => { element.style.color = "red"; return () => { element.removeAttribute("style"); undo(); }; });
    expect(element.style.color).toBe("red");
    stop();
    expect(undo).toHaveBeenCalledOnce();
    frames();
    expect(element.hasAttribute(STILL)).toBe(false);
    expect(element.getAttribute("style")).toBeNull();
    expect(() => stillPreview(element, () => { throw new Error("no preview"); })).toThrow("no preview");
    frames();
    expect(element.hasAttribute(STILL)).toBe(false);
  });
});
