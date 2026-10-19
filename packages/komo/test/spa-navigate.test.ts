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
  sessionStorage.clear();
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
  sessionStorage.clear();
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
  return { card, title, shadow };
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

it("retains the requested thread when navigate rejects without forcing a page load", async () => {
  const navigate = vi.fn(() => Promise.reject(new Error("blocked")));
  const { card, title, shadow } = mount({ navigate });
  card().click();
  await vi.waitFor(() => expect(title()).toBe("Other page thread"));
  expect(shadow.querySelector(".thread-navigation")?.textContent).toContain("could not be completed");
  expect(shadow.querySelector<HTMLAnchorElement>(".thread-destination")?.href).toBe(`${location.origin}/other`);
  expect(assign).not.toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledOnce();
});

it("retains the thread after a router redirects and never resolves a current-page lookalike", async () => {
  document.body.innerHTML = '<button id="target">Unrelated page target</button>';
  const navigate = vi.fn((url: URL) => {
    history.pushState({}, "", url);
    history.replaceState({ guarded: true }, "", "/fallback");
  });
  const { card, title, shadow } = mount({ navigate });
  card().click();
  await vi.waitFor(() => expect(title()).toBe("Other page thread"));
  expect(location.pathname).toBe("/fallback");
  expect(shadow.querySelector(".thread-navigation")?.textContent).toContain("different page");
  expect(shadow.querySelector<HTMLAnchorElement>(".thread-destination")?.href).toBe(`${location.origin}/other`);
  expect(shadow.querySelector<HTMLElement>(".outline")?.style.opacity || "0").toBe("0");
  expect(document.querySelector("#target")?.textContent).toBe("Unrelated page target");
  expect(assign).not.toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledOnce();
});

it("keeps the selected thread through a late host redirect", async () => {
  document.body.innerHTML = '<button id="target">Destination target</button>';
  const navigate = vi.fn((url: URL) => { history.pushState({}, "", url); });
  const { card, title, shadow } = mount({ navigate });
  card().click();
  await vi.waitFor(() => expect(title()).toBe("Other page thread"));
  document.querySelector("#target")!.remove();
  history.replaceState({ guarded: true }, "", "/fallback");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(shadow.querySelector(".thread-navigation")?.textContent).toContain("different page"));
  expect(title()).toBe("Other page thread");
  expect(navigate).toHaveBeenCalledOnce();
  expect(assign).not.toHaveBeenCalled();
});

it("does not reopen a dismissed request when its router promise settles later", async () => {
  document.body.innerHTML = '<button id="target">Destination target</button>';
  let finish!: () => void;
  const navigate = vi.fn((url: URL) => new Promise<void>(resolve => {
    finish = () => { history.pushState({}, "", url); window.dispatchEvent(new PopStateEvent("popstate")); resolve(); };
  }));
  const { card, title } = mount({ navigate });
  card().click();
  controller!.close();
  finish();
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(title()).toBeUndefined();
  expect(assign).not.toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledOnce();
});

it("allows one explicit destination retry after rejection", async () => {
  let attempt = 0;
  const navigate = vi.fn((url: URL) => {
    if (attempt++ === 0) return Promise.reject(new Error("blocked"));
    history.pushState({ router: true }, "", url);
    document.body.prepend(Object.assign(document.createElement("section"), { id: "target" }));
  });
  const { card, title, shadow } = mount({ navigate });
  card().click();
  await vi.waitFor(() => expect(title()).toBe("Other page thread"));
  shadow.querySelector<HTMLAnchorElement>(".thread-destination")!.click();
  await vi.waitFor(() => expect(shadow.querySelector(".thread-navigation")).toBeNull());
  expect(title()).toBe("Other page thread");
  expect(location.pathname + location.search).toBe("/other");
  expect(navigate).toHaveBeenCalledTimes(2);
  expect(assign).not.toHaveBeenCalled();
});

it("accepts canonical redirects without changing hash or router state", async () => {
  document.body.innerHTML = '<section id="target"></section>';
  const navigate = vi.fn((url: URL) => {
    history.pushState({ canonical: true }, "", url.pathname + "/" + url.search + "#section");
  });
  const { card, title, shadow } = mount({ navigate });
  card().click();
  await vi.waitFor(() => expect(title()).toBe("Other page thread"));
  expect(shadow.querySelector(".thread-navigation")).toBeNull();
  expect(location.pathname + location.search + location.hash).toBe("/other/#section");
  expect(history.state).toEqual({ canonical: true });
  expect(navigate).toHaveBeenCalledOnce();
  expect(assign).not.toHaveBeenCalled();
});

it.each([false, true])("opens a deep link on load with restored sidebar %s and clears the comment param", async (restored) => {
  if (restored) sessionStorage.setItem("branch-comments:open:fixture:fixture", "1");
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
