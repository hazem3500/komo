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
const assign = vi.fn();

beforeEach(async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [],
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  // jsdom's Location is not spyable; delegate everything but assign.
  const real = window.location;
  assign.mockReset();
  vi.stubGlobal("location", {
    get href() { return real.href; },
    get origin() { return real.origin; },
    get pathname() { return real.pathname; },
    get search() { return real.search; },
    get hash() { return real.hash; },
    get host() { return real.host; },
    get hostname() { return real.hostname; },
    get protocol() { return real.protocol; },
    get port() { return real.port; },
    assign,
    reload() {},
    replace: assign,
  });
  history.replaceState(null, "", "/");
  const { CommentsApi } = await import("../src/api");
  const api = new CommentsApi(options);
  api.save({
    token: "spa-session",
    user: { id: "reviewer", name: "Reviewer", verified: true },
  });
  const thread = (id: string, page: string, body: string) => ({
    id,
    page,
    resolved: false,
    resolvedBy: null,
    createdAt: 1,
    updatedAt: 1,
    anchor: {
      selector: "#target",
      text: "",
      x: 0.5,
      y: 0.5,
      width: 0,
      height: 0,
      pageX: 0,
      pageY: 0,
      viewportWidth: 1200,
    },
    comments: [
      {
        id: `${id}-comment`,
        body,
        author: api.user,
        createdAt: 1,
        editedAt: null,
        reactions: {},
      },
    ],
  });
  localStorage.setItem(
    `${api.sessionKey}:${JSON.stringify([options.repo, "local"])}:threads`,
    JSON.stringify({
      token: api.token,
      threads: [thread("away", "/other", "Other page thread")],
    }),
  );
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  controller?.destroy();
  controller = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  history.replaceState(null, "", "/");
  document.body.replaceChildren();
});

function mount(config: Partial<CommentsOptions> = {}) {
  controller = initComments({ ...options, ...config });
  controller.open();
  const shadow = [...document.body.children].find((node) => node.shadowRoot)!
    .shadowRoot!;
  const panel = shadow.querySelector<HTMLElement>(".panel")!;
  const card = () =>
    [...panel.querySelectorAll<HTMLButtonElement>(".thread-card")].find(
      (node) => node.textContent?.includes("Other page thread"),
    )!;
  const title = () =>
    panel.querySelector(".thread-pane .thread-title")?.textContent;
  return { card, title };
}

it("keeps a full page load without a navigate hook", () => {
  const { card } = mount();
  card().click();
  expect(assign).toHaveBeenCalledOnce();
  expect(String(assign.mock.calls[0][0])).toBe(
    `${location.origin}/other?comment=away`,
  );
});

it("routes through navigate and opens the thread once its anchor renders", async () => {
  vi.useFakeTimers();
  try {
    let finish!: () => void;
    const navigate = vi.fn(
      (url: URL) =>
        new Promise<void>((resolve) => {
          history.pushState({ key: "router" }, "", url.pathname + url.search + "#top");
          finish = resolve;
        }),
    );
    const { card, title } = mount({ navigate });
    card().click();
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate.mock.calls[0][0].href).toBe(
      `${location.origin}/other?comment=away`,
    );
    finish();
    await vi.advanceTimersByTimeAsync(300);
    // The route renders its content after the router resolves.
    expect(title()).toBeUndefined();
    const target = document.createElement("section");
    target.id = "target";
    document.body.prepend(target);
    await vi.advanceTimersByTimeAsync(200);
    expect(title()).toBe("Other page thread");
    expect(assign).not.toHaveBeenCalled();
    // The param is dropped in place so a reload doesn't reopen the thread.
    expect(location.pathname + location.search + location.hash).toBe("/other#top");
    expect(history.state).toEqual({ key: "router" });
  } finally {
    vi.useRealTimers();
  }
});

it("falls back to a page load when navigate rejects", async () => {
  const navigate = vi.fn(() => Promise.reject(new Error("blocked")));
  const { card } = mount({ navigate });
  card().click();
  await vi.waitFor(() => expect(assign).toHaveBeenCalledOnce());
  expect(String(assign.mock.calls[0][0])).toBe(
    `${location.origin}/other?comment=away`,
  );
});

it("opens a deep link on load and clears the comment param", async () => {
  history.replaceState({ keep: 1 }, "", "/other?comment=away&tab=2");
  const target = document.createElement("section");
  target.id = "target";
  document.body.append(target);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: URL) =>
      Promise.resolve(
        url.pathname.endsWith("/config")
          ? Response.json({ google: false, github: false, guests: true, guestResolve: false })
          : Response.json({ error: "offline" }, { status: 503 }),
      ),
    ),
  );
  const { title } = mount();
  await vi.waitFor(() => expect(title()).toBe("Other page thread"));
  expect(location.pathname + location.search).toBe("/other?tab=2");
  expect(history.state).toEqual({ keep: 1 });
});
