// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initComments } from "../src/index";
import type { CommentsController, CommentsOptions } from "../src/types";

let controller: CommentsController | undefined;
const options: CommentsOptions = {
  endpoint: "https://example.test",
  project: "fixture",
  repo: "fixture",
  branch: "main",
};
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
});
afterEach(() => {
  controller?.destroy();
  controller = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});
// Mutations re-measure on the next frame, or after an 80ms burst when idle.
const frame = () => new Promise((resolve) => setTimeout(resolve, 150));

/** One thread anchored to a button inside a modal-style body portal. */
async function mount() {
  const { CommentsApi } = await import("../src/api");
  const api = new CommentsApi(options);
  api.save({ token: "detach-session", user: { id: "r", name: "Reviewer", verified: true } });
  localStorage.setItem(
    `${api.sessionKey}:${JSON.stringify([options.repo, "local"])}:threads`,
    JSON.stringify({
      token: api.token,
      threads: [{
        id: "modal", page: "/", resolved: false, resolvedBy: null, createdAt: 1, updatedAt: 1,
        anchor: { selector: "#modal-button", text: "", x: 0.5, y: 0.5, width: 0, height: 0, pageX: 0, pageY: 0, viewportWidth: 1200 },
        comments: [{ id: "c", body: "Modal thread", author: api.user, createdAt: 1, editedAt: null, reactions: {} }],
      }],
    }),
  );
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  const main = document.createElement("main");
  const portal = document.createElement("div");
  const button = document.createElement("button");
  button.id = "modal-button";
  portal.append(button);
  document.body.append(main, portal);
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this === button || this === main ? new DOMRect(10, 10, 400, 300) : measure.call(this);
  });
  controller = initComments(options);
  const host = document.querySelector<HTMLElement>("[data-branch-comments]")!;
  const shadow = host.shadowRoot!;
  const pin = () => shadow.querySelector<HTMLButtonElement>('.pin[data-thread="modal"]');
  return { host, shadow, portal, pin };
}

it("closes an open thread when its anchor leaves the page and shows the pin again on return", async () => {
  const { shadow, portal, pin } = await mount();
  pin()!.click();
  expect(shadow.querySelector(".dialog")?.textContent).toContain("Modal thread");
  const reply = shadow.querySelector<HTMLTextAreaElement>(".dialog textarea")!;
  reply.value = "Unsent reply";
  reply.dispatchEvent(new Event("input"));

  // The modal closes: the popover and pin go with it instead of floating.
  portal.remove();
  await frame();
  expect(shadow.querySelector(".dialog")).toBeNull();
  expect(pin()).toBeNull();

  // The modal reopens: the pin returns and the unsent reply is kept.
  document.body.append(portal);
  await frame();
  pin()!.click();
  expect(shadow.querySelector(".dialog")?.textContent).toContain("Modal thread");
  expect(shadow.querySelector<HTMLTextAreaElement>(".dialog textarea")!.value).toBe("Unsent reply");
});

it("keeps a thread open in the sidebar when its anchor leaves", async () => {
  const { shadow, portal } = await mount();
  controller!.open();
  shadow.querySelector<HTMLElement>('.list .thread-item[data-thread="modal"] .thread-card')!.click();
  expect(shadow.querySelector(".panel .thread-pane")?.textContent).toContain("Modal thread");
  portal.remove();
  await frame();
  expect(shadow.querySelector(".panel .thread-pane")?.textContent).toContain("Modal thread");
});

it("keeps komo's host exposed when a modal hides the page's other content", async () => {
  const { host } = await mount();
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("inert", "");
  await frame();
  expect(host.hasAttribute("aria-hidden")).toBe(false);
  expect(host.hasAttribute("inert")).toBe(false);
  // A library that keeps re-applying wins after a capped number of attempts.
  for (let i = 0; i < 30; i++) {
    host.setAttribute("aria-hidden", "true");
    await Promise.resolve();
  }
  await frame();
  expect(host.getAttribute("aria-hidden")).toBe("true");
});

it("parks an unsent new comment when its anchor leaves", async () => {
  const { shadow, portal } = await mount();
  controller!.comment(document.getElementById("modal-button")!);
  const input = shadow.querySelector<HTMLTextAreaElement>('[data-focus-key="body"]')!;
  input.value = "Half-written";
  input.dispatchEvent(new Event("input"));
  portal.remove();
  await frame();
  expect(shadow.querySelector(".dialog")).toBeNull();
  // Comment mode brings the parked draft back.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true, composed: true }));
  expect(shadow.querySelector<HTMLTextAreaElement>('[data-focus-key="body"]')?.value).toBe("Half-written");
});

it("stops guarding the host after destroy", async () => {
  const { host } = await mount();
  controller!.destroy();
  host.setAttribute("aria-hidden", "true");
  await frame();
  expect(host.getAttribute("aria-hidden")).toBe("true");
});
