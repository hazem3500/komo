// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindMove } from "../src/design-move.js";
import { designKeyboard } from "../src/design-keyboard.js";
import { bindGeometry, geometryProposal, type GeometryChange } from "../src/design-geometry.js";
import { resolveShortcuts } from "../src/shortcuts.js";
import type { DesignTarget } from "../src/design-target.js";

let cleanup: AbortController;
beforeEach(() => {
  cleanup = new AbortController();
  // jsdom has no layout, constructable-sheet adoption or animation frames.
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => [new DOMRect(0, 0, 100, 40)] as unknown as DOMRectList);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 100, 40));
  Object.defineProperty(document, "adoptedStyleSheets", { configurable: true, writable: true, value: [] });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => { cleanup.abort(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

type Entry = { element: DesignTarget; geometry?: GeometryChange[]; undo?(): void };

/** A list and a move binding over a shared history, as Design mode wires it; `undo` is its Undo button. */
function fixture() {
  document.body.innerHTML = '<main><ul id="list"><li id="one">One</li><li id="two">Two</li><li id="three">Three</li></ul></main><aside id="host"></aside>';
  const host = document.querySelector<HTMLElement>("#host")!;
  const history: Entry[] = [];
  let selected: DesignTarget | null = document.querySelector<DesignTarget>("#two");
  const announced: string[] = [];
  const move = bindMove({
    signal: cleanup.signal, host, targetAt: () => null, history: history as never,
    selected: () => selected, pick: () => {}, enabled: () => true, before: () => false,
    remember: () => {}, track: () => {}, update: () => {}, component: () => undefined, layout: () => "normal flow",
    announce: text => { announced.push(text); }, drag: () => {},
  });
  const undo = () => { history.pop()?.undo?.(); move.sync(); };
  const order = () => [...document.querySelector("#list")!.children]
    .filter(child => (child as HTMLElement).style.display !== "none")
    .map(child => `${child.textContent}${child.hasAttribute("data-komo-move-clone") ? "*" : ""}`);
  return { history, move, undo, order, announced, element: (id: string) => document.getElementById(id) as DesignTarget, select: (id: string) => { selected = document.getElementById(id) as DesignTarget; } };
}
const proposal = (history: Entry[]) => geometryProposal(history.flatMap(entry => entry.geometry ?? []));

describe("structural move undo", () => {
  it("records each move on the shared history, so one Undo removes the stand-in and shows the original exactly", () => {
    const f = fixture();
    const two = f.element("two");
    f.move.key(two, true, false);
    expect(f.announced.at(-1)).toBe("Moved after List item “Three”");
    expect(f.history).toHaveLength(1);
    expect(f.order()).toEqual(["One", "Three", "Two*"]);
    expect(proposal(f.history)).toContain("- Move List item “Two”: from ul#list (2nd) → ul#list (3rd)");
    f.undo();
    expect(f.order()).toEqual(["One", "Two", "Three"]);
    expect(document.querySelectorAll("[data-komo-move-clone]")).toHaveLength(0);
    expect(two.getAttribute("style")).toBeNull();
    expect(proposal(f.history)).toBeUndefined();
  });

  it("undoes consecutive moves one at a time, back through each earlier place", () => {
    const f = fixture();
    const two = f.element("two");
    f.move.key(two, false, false);
    expect(f.order()).toEqual(["Two*", "One", "Three"]);
    f.move.key(two, true, false);
    f.move.key(two, true, false);
    expect(f.order()).toEqual(["One", "Three", "Two*"]);
    expect(f.history).toHaveLength(3);
    f.undo();
    expect(f.order()).toEqual(["One", "Two*", "Three"]);
    f.undo();
    expect(f.order()).toEqual(["Two*", "One", "Three"]);
    expect(proposal(f.history)).toContain("from ul#list (2nd) → ul#list (1st)");
    f.undo();
    expect(f.order()).toEqual(["One", "Two", "Three"]);
    expect(two.getAttribute("style")).toBeNull();
  });

  it("keeps two stand-ins at the same end of a parent in a stable order, and undoes the later one first", () => {
    const f = fixture();
    const one = f.element("one"), two = f.element("two");
    f.select("one");
    f.move.key(one, true, false);
    f.move.key(one, true, false);
    expect(f.order()).toEqual(["Two", "Three", "One*"]);
    f.select("two");
    f.move.key(two, true, false);
    const settled = f.order();
    expect(settled).toEqual(["Three", "One*", "Two*"]);
    for (let pass = 0; pass < 3; pass++) { f.move.sync(); expect(f.order()).toEqual(settled); }
    f.undo();
    expect(f.order()).toEqual(["Two", "Three", "One*"]);
  });

  it("keeps a host style attribute exact through move, undo and a cleared history", () => {
    const f = fixture();
    const one = f.element("one");
    one.setAttribute("style", "color: red; display: list-item !important");
    f.select("one");
    f.move.key(one, true, false);
    expect(f.order()).toEqual(["Two", "One*", "Three"]);
    f.undo();
    expect(one.getAttribute("style")).toBe("color: red; display: list-item !important");
    // Reset clears the history and restores the originals; the stand-ins go with it.
    f.move.key(one, true, false);
    const entry = f.history.pop()!;
    entry.undo!();
    f.move.sync();
    expect(document.querySelectorAll("[data-komo-move-clone]")).toHaveLength(0);
    expect(one.getAttribute("style")).toBe("color: red; display: list-item !important");
  });
});

describe("overlay peek with the configured visibility key", () => {
  /** Geometry bound in Design mode with `visibility` as the comments visibility shortcut. */
  function bind(visibility: string | false) {
    document.body.innerHTML = '<main><div id="target"></div></main><aside id="host" class="design-active"></aside>';
    const host = document.querySelector<HTMLElement>("#host")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div class="design-inspector"><div class="design-inspector__heading"><button class="design-inspector__fold"></button></div><div class="controls"></div></div>';
    const shortcuts = resolveShortcuts({ visibility });
    bindGeometry({
      signal: cleanup.signal, history: [], selected: () => document.querySelector<DesignTarget>("#target"), select: () => {}, pick: () => {}, before: () => false, enabled: () => true,
      remember: () => {}, track: () => {}, tokens: () => null, update: () => {}, panel: () => root.querySelector<HTMLElement>(".controls")!,
      options: { root, host, targetAt: () => null, visibility: shortcuts.visibility },
    });
    const key = (type: "keydown" | "keyup", init: KeyboardEventInit) => document.body.dispatchEvent(new KeyboardEvent(type, { bubbles: true, composed: true, cancelable: true, ...init }));
    return { host, root, key, hidden: () => host.hasAttribute("data-komo-overlays-hidden") };
  }
  const hold = () => new Promise(resolve => setTimeout(resolve, 400));

  it("toggles on a tap and peeks while bare H is held", async () => {
    const f = bind("H");
    f.key("keydown", { key: "h" }); f.key("keyup", { key: "h" });
    expect(f.hidden()).toBe(true);
    f.key("keydown", { key: "h" }); f.key("keyup", { key: "h" });
    expect(f.hidden()).toBe(false);
    f.key("keydown", { key: "h" });
    expect(f.hidden()).toBe(true);
    await hold();
    f.key("keyup", { key: "h" });
    expect(f.hidden()).toBe(false);
  });

  it("uses Shift+H when configured, and releasing Shift first ends the peek", async () => {
    const f = bind("Shift+H");
    f.key("keydown", { key: "h" });
    expect(f.hidden()).toBe(false);
    f.key("keydown", { key: "H", shiftKey: true }); f.key("keyup", { key: "H", shiftKey: true });
    expect(f.hidden()).toBe(true);
    f.key("keydown", { key: "H", shiftKey: true }); f.key("keyup", { key: "H", shiftKey: true });
    expect(f.hidden()).toBe(false);
    f.key("keydown", { key: "H", shiftKey: true });
    await hold();
    f.key("keyup", { key: "Shift" });
    expect(f.hidden()).toBe(false);
    f.key("keyup", { key: "h" });
    expect(f.hidden()).toBe(false);
    const mac = /Mac|iPhone|iPad/i.test(navigator.platform);
    const eye = f.root.querySelector<HTMLButtonElement>(".design-inspector__eye")!;
    expect([eye.title, eye.getAttribute("aria-label")]).toEqual(Array(2).fill(`Hide selection (${mac ? "⇧H" : "Shift+H"})`));
  });

  it("ends a Meta combo's hold on the modifier's release, since macOS sends no letter keyup while ⌘ is down", async () => {
    const f = bind("Meta+H");
    f.key("keydown", { key: "h", metaKey: true });
    expect(f.hidden()).toBe(true);
    await hold();
    f.key("keyup", { key: "Meta" });
    expect(f.hidden()).toBe(false);
  });

  it("ends a hold when the window loses focus or the page is hidden, and names no key without one", () => {
    const f = bind("H");
    f.key("keydown", { key: "h" });
    expect(f.hidden()).toBe(true);
    window.dispatchEvent(new Event("blur"));
    expect(f.hidden()).toBe(false);
    f.key("keyup", { key: "h" });
    expect(f.hidden()).toBe(false);
    f.key("keydown", { key: "h" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(f.hidden()).toBe(false);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    const none = bind(false);
    expect(none.root.querySelector(".design-inspector__eye")!.getAttribute("aria-label")).toBe("Hide selection");
  });
});

describe("Undo shortcut on the focused selection", () => {
  it("presses Design mode's Undo for ⌘Z or Ctrl+Z from the focused selection and leaves focus there; Shift is not redo", () => {
    document.body.innerHTML = '<main><div id="target"></div></main><aside id="host"></aside>';
    const host = document.querySelector<HTMLElement>("#host")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div id="compare" hidden></div><div class="design-geometry"><div class="design-geometry__frame" tabindex="0" role="group"></div></div><button id="undo">Undo</button><input>';
    const undo = root.querySelector<HTMLButtonElement>("#undo")!;
    const clicks = vi.fn();
    undo.addEventListener("click", clicks);
    const handle = designKeyboard({ host, compare: root.querySelector<HTMLElement>("#compare")!, selected: () => document.querySelector<DesignTarget>("#target"),
      select: () => {}, compareBefore: () => {}, undo, root, signal: cleanup.signal });
    document.addEventListener("keydown", event => { handle(event); }, { signal: cleanup.signal });
    const frame = root.querySelector<HTMLElement>(".design-geometry__frame")!;
    frame.focus();
    const press = (init: KeyboardEventInit, target: Element = frame) => {
      const event = new KeyboardEvent("keydown", { key: "z", bubbles: true, composed: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    };
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    expect(press(mac ? { metaKey: true } : { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(root.activeElement).toBe(frame);
    // Design mode has no redo: ⌘⇧Z is left alone.
    expect(press(mac ? { metaKey: true, shiftKey: true } : { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    // A text field keeps its own undo.
    press(mac ? { metaKey: true } : { ctrlKey: true }, root.querySelector("input")!);
    expect(clicks).toHaveBeenCalledTimes(1);
    // From the canvas too (after Escape blurs the selection).
    frame.blur();
    press(mac ? { metaKey: true } : { ctrlKey: true }, document.body);
    expect(clicks).toHaveBeenCalledTimes(2);
  });
});
