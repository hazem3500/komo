// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommentsApi } from "../src/api";
import { initComments } from "../src/index";
import type { CommentsController, CommentsOptions } from "../src/types";

const options: CommentsOptions = {
  endpoint: "https://example.test",
  project: "design-threads",
  repo: "fixture",
  branch: "main",
  restoreOpen: false,
};
let controller: CommentsController | undefined;
let target: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
  document.body.innerHTML =
    '<main><button id="target">Example target</button></main>';
  target = document.getElementById("target")!;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(HTMLElement.prototype, "showPopover", {
    configurable: true,
    value() {
      this.dataset.open = "true";
    },
  });
  Object.defineProperty(HTMLElement.prototype, "hidePopover", {
    configurable: true,
    value() {
      delete this.dataset.open;
    },
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return this.id === "target"
        ? new DOMRect(20, 30, 240, 80)
        : new DOMRect();
    },
  );
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [target, target.parentElement, document.body],
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
});
afterEach(() => {
  controller?.destroy();
  controller = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

function mount(
  config: Partial<CommentsOptions> = {},
  page = "/",
  selector = "#target",
) {
  const api = new CommentsApi(options);
  api.save({
    token: "design-fixture-session",
    user: { id: "reviewer", name: "Reviewer", verified: true },
  });
  localStorage.setItem(
    `${api.sessionKey}:${JSON.stringify([options.repo, "local"])}:threads`,
    JSON.stringify({
      token: api.token,
      threads: [
        {
          id: "example",
          page,
          resolved: false,
          resolvedBy: null,
          createdAt: 1,
          updatedAt: 1,
          anchor: {
            selector,
            text: "",
            x: 0.5,
            y: 0.5,
            width: 240,
            height: 80,
            pageX: 0,
            pageY: 0,
            viewportWidth: 1200,
          },
          comments: [
            {
              id: "comment",
              body: "Example feedback",
              author: api.user,
              createdAt: 1,
              editedAt: null,
              reactions: {},
            },
          ],
        },
      ],
    }),
  );
  controller = initComments({ ...options, ...config });
  const host = document.querySelector<HTMLElement>("[data-branch-comments]")!;
  const root = host.shadowRoot!;
  const inspect = () =>
    [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent === "Open in Design",
    );
  return { host, root, inspect };
}

it.each([false, true])(
  "returns from Design to the same thread layout and unsent reply (sidebar=%s)",
  async (sidebar) => {
    const { host, root, inspect } = mount();
    if (sidebar) controller!.open();
    root.querySelector<HTMLButtonElement>(".pin")!.click();
    const reply = root.querySelector<HTMLTextAreaElement>(".dialog textarea")!;
    reply.value = "Unsent example reply";
    reply.dispatchEvent(new Event("input"));
    root.querySelector<HTMLElement>('[aria-label="Comment actions"]')!.click();
    inspect()!.click();
    await vi.waitFor(() =>
      expect(root.querySelector(".design-inspector__target")?.textContent).toBe(
        "button#target",
      ),
    );
    expect(host.classList.contains("design-active")).toBe(true);
    expect(
      root.querySelector('.design-outline[data-kind="selected"]'),
    ).not.toBeNull();
    const back = root.querySelector<HTMLButtonElement>(
      '[aria-label="Back to comment"]',
    )!;
    expect(back.hidden).toBe(false);
    back.click();
    expect(host.classList.contains("design-active")).toBe(false);
    const dialog = root.querySelector<HTMLElement>(".dialog")!;
    expect(!!dialog.closest(".thread-pane")).toBe(sidebar);
    expect(dialog.textContent).toContain("Example feedback");
    expect(dialog.querySelector("textarea")!.value).toBe(
      "Unsent example reply",
    );
    await vi.waitFor(() =>
      expect(root.activeElement).toBe(
        dialog.querySelector('[aria-label="Comment actions"]'),
      ),
    );
  },
);

it("explains a missing anchor without selecting another element", () => {
  const { host, root, inspect } = mount({}, "/", "#missing");
  controller!.open();
  root.querySelector<HTMLButtonElement>(".thread-card")!.click();
  root.querySelector<HTMLElement>('[aria-label="Comment actions"]')!.click();
  inspect()!.click();
  expect(host.classList.contains("design-active")).toBe(false);
  expect(root.textContent).toContain("Design is unavailable");
  expect(root.querySelector(".design-inspector")).toBeNull();
  expect(target.style.cssText).toBe("");
});

it("omits the action when Design is disabled", () => {
  const { root, inspect } = mount({ features: { designMode: false } });
  root.querySelector<HTMLButtonElement>(".pin")!.click();
  root.querySelector<HTMLElement>('[aria-label="Comment actions"]')!.click();
  expect(inspect()).toBeUndefined();
});

it("uses the host navigation hook and inspects only the destination anchor", async () => {
  const navigate = vi.fn(async (url: URL) => {
    history.pushState(
      { router: true },
      "",
      url.pathname + url.search + url.hash,
    );
    const next = document.createElement("button");
    next.id = "target";
    next.textContent = "Destination target";
    target.replaceWith(next);
    target = next;
  });
  const { host, root, inspect } = mount({ navigate }, "/other");
  controller!.open();
  root.querySelector<HTMLButtonElement>(".thread-card")!.click();
  // Open the destination thread first, then exercise the same shared menu.
  await vi.waitFor(() =>
    expect(root.querySelector(".thread-pane .dialog")).not.toBeNull(),
  );
  history.pushState(null, "", "/");
  root.querySelector<HTMLElement>('[aria-label="Comment actions"]')!.click();
  inspect()!.click();
  await vi.waitFor(() =>
    expect(host.classList.contains("design-active")).toBe(true),
  );
  await vi.waitFor(() =>
    expect(root.querySelector(".design-inspector__target")?.textContent).toBe(
      "button#target",
    ),
  );
  expect(navigate).toHaveBeenLastCalledWith(
    new URL("/other?comment=example&comment-view=design", location.origin),
  );
  expect(location.pathname + location.search).toBe("/other");
  expect(history.state).toEqual({ router: true });
});
