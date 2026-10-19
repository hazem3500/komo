// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initComments } from "../src/index";
import type { CommentsController } from "../src/types";

let controller: CommentsController | undefined;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  controller?.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});

it("shows a pending Continue while the guest name saves, and restores it on failure", async () => {
  let finishGuest!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn((url: URL) => {
    if (url.pathname.endsWith("/config"))
      return Promise.resolve(Response.json({ google: false, github: false, guests: true, guestResolve: false, private: false }));
    if (url.pathname.endsWith("/auth/guest"))
      return new Promise<Response>((resolve) => { finishGuest = resolve; });
    return Promise.resolve(Response.json({ error: "Sign in required" }, { status: 401 }));
  }));
  controller = initComments({ endpoint: "https://example.test", project: "fixture", repo: "fixture", branch: "main" });
  const shadow = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
  shadow.querySelector<HTMLButtonElement>('[aria-label="Enter your name"]')!.click();
  await vi.waitFor(() => expect(shadow.querySelector('input[name="name"]')).not.toBeNull());
  const input = shadow.querySelector<HTMLInputElement>('input[name="name"]')!;
  input.value = "Ada";
  input.dispatchEvent(new Event("input"));
  const save = () => shadow.querySelector<HTMLButtonElement>("form.account button[type=submit]")!;
  expect(save().disabled).toBe(false);
  shadow.querySelector<HTMLFormElement>("form.account")!.requestSubmit();
  await vi.waitFor(() => expect(save().disabled).toBe(true));
  expect(save().getAttribute("aria-busy")).toBe("true");
  finishGuest(Response.json({ error: "Name is taken" }, { status: 400 }));
  await vi.waitFor(() => expect(save().disabled).toBe(false));
  expect(save().hasAttribute("aria-busy")).toBe(false);
  expect(shadow.textContent).toContain("Name is taken");
  expect(shadow.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("Ada");
});
