// @vitest-environment jsdom
// Design mode proposals end up as comments whose Before/After switch is the only
// thing that changes the page: Design mode's live preview never outlives it, and
// the switch finds the edited element even among many same-class siblings.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureAnchor } from "../src/anchors";
import { cssSelector, designProposal } from "../src/design-export";
import { resetDesignPreviews, shortTarget } from "../src/design-comment";
import { initComments } from "../src/index";
import type { CommentsController, CommentsOptions } from "../src/types";

let controller: CommentsController | undefined;
const options: CommentsOptions = {
  endpoint: "https://example.test",
  project: "fixture",
  repo: "fixture",
  branch: "main",
};
// A Tailwind-like sidebar: every link shares the same utility classes.
const sidebar = `<main id="target"><aside><nav>${["Overview", "Timer", "Reports", "Projects"]
  .map((label) => `<div class="flex w-full"><a class="flex w-full" href="#${label}">${label}</a></div>`)
  .join("")}</nav></aside></main>`;
const link = (label: string) =>
  [...document.querySelectorAll<HTMLElement>("a")].find((node) => node.textContent === label)!;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  // Reduced motion: switches apply at once instead of animating.
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
  Element.prototype.scrollIntoView = () => {};
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  document.body.innerHTML = sidebar;
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.id === "target") return new DOMRect(0, 0, 1000, 700);
    const index = [...document.querySelectorAll("a")].indexOf(this as HTMLAnchorElement);
    return index >= 0 ? new DOMRect(10, 40 + index * 40, 200, 32) : measure.call(this);
  });
});
afterEach(() => {
  controller?.destroy();
  controller = undefined;
  resetDesignPreviews();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.replaceChildren();
});

describe("design proposal targets", () => {
  it("records a selector that matches exactly the edited element among same-class siblings", () => {
    const timer = link("Timer");
    const selector = cssSelector(timer);
    expect([...document.querySelectorAll(selector)]).toEqual([timer]);
    expect(shortTarget(selector)).toBe("a.flex.w-full");
    // Paths start at a unique id or body, never at a bare class.
    expect(selector.startsWith("#target > ")).toBe(true);
    document.getElementById("target")!.removeAttribute("id");
    expect([...document.querySelectorAll(cssSelector(timer))]).toEqual([timer]);
    expect(cssSelector(timer).startsWith("body > ")).toBe(true);
    // Generated React and Radix ids are skipped, as anchors do.
    timer.id = ":r4:";
    expect(cssSelector(timer)).not.toContain(":r4:");
    expect([...document.querySelectorAll(cssSelector(timer))]).toEqual([timer]);
  });

  it("puts the exact selector on the proposal's Target line", () => {
    const timer = link("Timer");
    const body = designProposal(timer, new Map([["width", "166px"]]), () => "200px", undefined, []);
    const target = /^Target: (.+)$/m.exec(body!)![1];
    expect([...document.querySelectorAll(target)]).toEqual([timer]);
  });
});

async function mount(threads: unknown[] = [], sidebarMode: "background" | "edge" = "edge") {
  const { CommentsApi } = await import("../src/api");
  const config = { ...options, sidebar: sidebarMode };
  const api = new CommentsApi(config);
  api.save({ token: "design-session", user: { id: "designer", name: "Designer", verified: true } });
  localStorage.setItem(
    `${api.sessionKey}:${JSON.stringify([config.repo, "local"])}:threads`,
    JSON.stringify({ token: api.token, threads }),
  );
  // Reads stay pending; writes succeed.
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: URL, init?: RequestInit) =>
      init?.method && init.method !== "GET"
        ? Promise.resolve(Response.json({ id: "posted-thread", commentId: "posted-comment" }))
        : new Promise<Response>(() => {}),
    ),
  );
  // Only Design mode picks point at an element; pins stay unobstructed.
  let pointed: Element | null = null;
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => (pointed ? [pointed] : []) });
  controller = initComments(config);
  const host = [...document.body.children].find((node) => node.shadowRoot) as HTMLElement;
  const shadow = host.shadowRoot!;
  const press = (key: string, target: EventTarget = document.body) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true }));
  const inspector = () => shadow.querySelector<HTMLElement>(".design-inspector");
  /** Enter Design mode, select `element` and preview a width and background on it. */
  const edit = async (element: HTMLElement) => {
    if (!host.classList.contains("design-active")) press("d");
    await vi.waitFor(() => expect(inspector()?.getAttribute("aria-hidden")).toBe("false"));
    pointed = element;
    const down = new Event("pointerdown", { bubbles: true, cancelable: true, composed: true });
    Object.defineProperties(down, { clientX: { value: 20 }, clientY: { value: 60 }, button: { value: 0 } });
    element.dispatchEvent(down);
    await vi.waitFor(() => expect(shadow.querySelector('.design-inspector [data-property="width"]')).not.toBeNull());
    for (const [property, value] of [["width", "166"], ["border-radius", "34"]]) {
      const input = shadow.querySelector<HTMLInputElement>(`.design-inspector [data-property="${property}"]`)!;
      input.dispatchEvent(new Event("focus"));
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    pointed = null;
    expect(element.style.width).toBe("166px");
    expect(element.style.borderRadius).toBe("34px");
  };
  const comment = async () => {
    shadow.querySelector<HTMLButtonElement>(".design-inspector__actions button:last-child")!.click();
    await vi.waitFor(() => expect(shadow.querySelector(".draft-proposal .design-toggle")).not.toBeNull());
  };
  const pressed = (root: ParentNode = shadow) =>
    root.querySelector('.design-toggle button[aria-pressed="true"]')?.textContent;
  const toggle = (label: "Before" | "After") =>
    [...shadow.querySelectorAll<HTMLButtonElement>(".design-toggle button")].find((button) => button.textContent === label)!.click();
  return { host, shadow, press, edit, comment, pressed, toggle };
}

const restored = (element: HTMLElement) => {
  expect(element.style.width).toBe("");
  expect(element.style.borderRadius).toBe("");
};

describe("Design mode preview cleanup", () => {
  it("restores the page on Escape", async () => {
    const { host, press, edit } = await mount();
    await edit(link("Timer"));
    press("Escape");
    expect(host.classList.contains("design-active")).toBe(false);
    restored(link("Timer"));
  });

  it("restores the page when switching to comment mode", async () => {
    const { host, press, edit } = await mount();
    await edit(link("Timer"));
    press("c");
    expect(host.classList.contains("design-active")).toBe(false);
    restored(link("Timer"));
  });

  it("restores the page when komo is dismissed or destroyed", async () => {
    const { shadow, edit } = await mount();
    await edit(link("Timer"));
    shadow.querySelector<HTMLButtonElement>('[data-menu-item="dismiss"]')!.click();
    restored(link("Timer"));
    controller!.open();
    await edit(link("Reports"));
    controller!.destroy();
    restored(link("Reports"));
  });

  it("does not bring old edits back when Design mode reopens", async () => {
    const { press, edit, shadow } = await mount();
    await edit(link("Timer"));
    press("Escape");
    press("d");
    await vi.waitFor(() => expect(shadow.querySelector(".design-inspector")?.getAttribute("aria-hidden")).toBe("false"));
    restored(link("Timer"));
    const undo = shadow.querySelector<HTMLButtonElement>('.design-inspector [aria-label="Undo"]')!;
    expect(undo.disabled).toBe(true);
  });

  it("previews the draft with its own switch and resets it when the draft is cancelled", async () => {
    const { shadow, edit, comment, pressed, toggle, press } = await mount();
    const timer = link("Timer");
    await edit(timer);
    await comment();
    // Design mode has closed and handed the change to the draft card, which starts on After.
    expect(pressed(shadow.querySelector(".draft-proposal")!)).toBe("After");
    expect(timer.style.width).toBe("166px");
    toggle("Before");
    restored(timer);
    toggle("After");
    expect(timer.style.width).toBe("166px");
    press("Escape", shadow.querySelector<HTMLTextAreaElement>('[data-focus-key="body"]')!);
    await vi.waitFor(() => expect(shadow.querySelector(".draft-proposal")).toBeNull());
    await vi.waitFor(() => restored(timer));
  });

  it("restores the page on post, then the posted thread previews only through Before/After", async () => {
    const { shadow, edit, comment, pressed, toggle } = await mount();
    const timer = link("Timer");
    await edit(timer);
    await comment();
    const input = shadow.querySelector<HTMLTextAreaElement>('[data-focus-key="body"]')!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    // The posted thread opens straight away, showing Before on an untouched page.
    await vi.waitFor(() => expect(shadow.querySelector(".draft-proposal")).toBeNull());
    await vi.waitFor(() => expect(shadow.querySelector(".design-toggle")).not.toBeNull());
    expect(pressed()).toBe("Before");
    restored(timer);
    toggle("After");
    expect(timer.style.width).toBe("166px");
    expect(timer.style.borderRadius).toBe("34px");
    for (const other of ["Overview", "Reports", "Projects"]) expect(link(other).style.width).toBe("");
    toggle("Before");
    restored(timer);
  });
});

describe("Frame view", () => {
  it("restores the page on post and previews Before/After without touching the page scale", async () => {
    const { shadow, edit, comment, pressed, toggle } = await mount([], "background");
    controller!.open();
    const frame = document.getElementById("target")!;
    expect(frame.style.transform).toMatch(/scale/);
    const timer = link("Timer");
    await edit(timer);
    await comment();
    expect(timer.style.width).toBe("166px");
    shadow.querySelector<HTMLTextAreaElement>('[data-focus-key="body"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(shadow.querySelector(".draft-proposal")).toBeNull());
    await vi.waitFor(() => expect(shadow.querySelector(".design-toggle")).not.toBeNull());
    expect(pressed()).toBe("Before");
    restored(timer);
    // Whether Frame view stays open after posting is up to the sidebar; the switch leaves its scale alone.
    const scale = frame.style.transform;
    toggle("After");
    expect(timer.style.width).toBe("166px");
    for (const other of ["Overview", "Reports", "Projects"]) expect(link(other).style.width).toBe("");
    expect(frame.style.transform).toBe(scale);
    toggle("Before");
    restored(timer);
    expect(frame.style.transform).toBe(scale);
  });
});

describe("Before/After target resolution", () => {
  const thread = (anchor: ReturnType<typeof captureAnchor>, body: string) => ({
    id: "design-thread",
    page: "/",
    resolved: false,
    resolvedBy: null,
    createdAt: 1,
    updatedAt: 1,
    anchor,
    comments: [{ id: "design-comment", body, author: { id: "designer", name: "Designer", verified: true }, createdAt: 1, editedAt: null, reactions: {} }],
  });
  const proposal = (target: string) =>
    ["Proposed style changes (preview only)", `Target: ${target}`, "- width: 200px → 166px", "- border-radius: 0px → 34px"].join("\n");
  const open = async (shadow: ShadowRoot, fromList = false) => {
    if (fromList) {
      // Detached threads have no pin on the element; open them from the sidebar.
      controller!.open();
      await vi.waitFor(() => expect(shadow.querySelector(".thread-card")).not.toBeNull());
      shadow.querySelector<HTMLButtonElement>(".thread-card")!.click();
    } else {
      await vi.waitFor(() => expect(shadow.querySelector(".pin")).not.toBeNull());
      shadow.querySelector<HTMLButtonElement>(".pin")!.click();
    }
    await vi.waitFor(() => expect(shadow.querySelector(".design-toggle")).not.toBeNull());
  };

  it("follows the comment's anchor when an older proposal only recorded utility classes", async () => {
    const timer = link("Timer");
    const anchor = captureAnchor(timer, { x: 20, y: 96 }, { x: 20, y: 96 });
    // Older proposals stored a class-only path that matches every link.
    const { shadow, toggle } = await mount([thread(anchor, proposal("div.flex.w-full > a.flex.w-full"))]);
    await open(shadow);
    expect(shadow.querySelector(".design-card-target")?.textContent).toBe("a.flex.w-full");
    toggle("After");
    expect(timer.style.width).toBe("166px");
    for (const other of ["Overview", "Reports", "Projects"]) expect(link(other).style.width).toBe("");
    toggle("Before");
    restored(timer);
  });

  it("uses an exact selector when the pin was moved to another element", async () => {
    const timer = link("Timer");
    const anchor = captureAnchor(link("Projects"), { x: 20, y: 176 }, { x: 20, y: 176 });
    const { shadow, toggle } = await mount([thread(anchor, proposal(cssSelector(timer)))]);
    await open(shadow);
    toggle("After");
    expect(timer.style.width).toBe("166px");
    expect(link("Projects").style.width).toBe("");
  });

  it("falls back to an old selector's first match when the anchor no longer resolves", async () => {
    const anchor = captureAnchor(link("Timer"), { x: 20, y: 96 }, { x: 20, y: 96 });
    const { shadow, toggle } = await mount([thread({ ...anchor, selector: "#gone", text: "Gone", context: undefined }, proposal("nav > div.flex.w-full:nth-of-type(2) > a.flex.w-full"))]);
    await open(shadow, true);
    toggle("After");
    expect(link("Timer").style.width).toBe("166px");
  });

  it("resets the preview when the dialog closes", async () => {
    const timer = link("Timer");
    const anchor = captureAnchor(timer, { x: 20, y: 96 }, { x: 20, y: 96 });
    const { shadow, toggle, press } = await mount([thread(anchor, proposal(cssSelector(timer)))]);
    await open(shadow);
    toggle("After");
    expect(timer.style.width).toBe("166px");
    press("Escape");
    await vi.waitFor(() => restored(timer));
  });
});
