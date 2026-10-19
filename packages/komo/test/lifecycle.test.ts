// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { icon } from "../src/dom";
import { initComments } from "../src/index";
import type { CommentsController, CommentsOptions } from "../src/types";

let controller: CommentsController | undefined;
const options: CommentsOptions = {
  endpoint: "https://example.test",
  project: "fixture",
  repo: "fixture",
  branch: "main",
  onboarding: { inProject: true },
};
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
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
});
afterEach(() => {
  controller?.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
it("rejects another scope and keeps a replacement safe from stale teardown", () => {
  const first = initComments(options);
  controller = first;
  expect(initComments({ ...options })).toBe(first);
  for (const change of [
    { project: "other" },
    { branch: "other" },
    { endpoint: "https://other.test" },
  ])
    expect(() => initComments({ ...options, ...change })).toThrow(
      "Destroy the current",
    );
  first.destroy();
  controller = initComments({ ...options, branch: "next" });
  const host = [...document.body.children].find((node) => node.shadowRoot)!;
  document.body.style.background = "red";
  first.destroy();
  first.open();
  first.close();
  expect(host.isConnected).toBe(true);
  expect(document.body.style.background).toBe("red");
  expect(initComments({ ...options, branch: "next" })).toBe(controller);
});

it("rejects unsafe endpoint schemes and embedded credentials before mounting", () => {
  for (const endpoint of [
    "ftp://localhost",
    "http://public.example.test",
    "https://user:password@example.test",
  ])
    expect(() => initComments({ ...options, endpoint })).toThrow(
      "HTTPS API endpoint",
    );
  expect(document.body.children).toHaveLength(0);
});

it.each([false, true])(
  "renders Google login after an early anonymous 401 (private=%s)",
  async (isPrivate) => {
    let finishConfig!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: URL) => {
        if (url.pathname.endsWith("/config"))
          return new Promise<Response>((resolve) => {
            finishConfig = resolve;
          });
        return Promise.resolve(
          Response.json({ error: "Sign in required" }, { status: 401 }),
        );
      }),
    );
    controller = initComments({ ...options, onboarding: undefined });
    const shadow = [...document.body.children].find(
      (node) => node.shadowRoot,
    )!.shadowRoot!;
    shadow
      .querySelector<HTMLButtonElement>('[aria-label="Enter your name"]')!
      .click();
    await vi.waitFor(() =>
      expect(shadow.textContent).toContain("Sign in required"),
    );
    expect(shadow.textContent).not.toContain("Continue with Google");
    finishConfig(
      Response.json({
        google: true,
        github: false,
        guests: false,
        guestResolve: false,
        private: isPrivate,
      }),
    );
    await vi.waitFor(() =>
      expect(shadow.textContent).toContain("Continue with Google"),
    );
    expect(shadow.textContent).toContain(
      isPrivate ? "Private project" : "Sign in required",
    );
    if (!isPrivate) expect(shadow.textContent).not.toContain("Private project");
  },
);

it("offers Google login after an expired session, even with delayed config", async () => {
  const { CommentsApi } = await import("../src/api");
  const config = { ...options, onboarding: undefined };
  new CommentsApi(config).save({
    token: "expired-session",
    user: { id: "old", name: "Old", verified: true },
  });
  let finishConfig!: (response: Response) => void;
  const fetchMock = vi.fn((url: URL) => {
    if (url.pathname.endsWith("/config"))
      return new Promise<Response>((resolve) => {
        finishConfig = resolve;
      });
    return Promise.resolve(
      Response.json({ error: "Sign in required" }, { status: 401 }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  controller = initComments(config);
  const shadow = [...document.body.children].find(
    (node) => node.shadowRoot,
  )!.shadowRoot!;
  shadow
    .querySelector<HTMLButtonElement>('[aria-label="Old · Account"]')!
    .click();
  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) => url.pathname.endsWith("/config")),
    ).toBe(true),
  );
  expect(fetchMock.mock.calls[0][0].pathname.endsWith("/me")).toBe(true);
  expect(shadow.textContent).not.toContain("Continue with Google");
  finishConfig(
    Response.json({
      google: true,
      github: false,
      guests: false,
      guestResolve: false,
      private: false,
    }),
  );
  await vi.waitFor(() =>
    expect(shadow.textContent).toContain("Continue with Google"),
  );
  expect(shadow.textContent).not.toContain("Private project");
  localStorage.clear();
});

it("lets reviewers dismiss and restore the toolbar, and supports hidden initialization", () => {
  controller = initComments({ ...options, onboarding: undefined });
  const host = [...document.body.children].find(
    (node) => node.shadowRoot,
  ) as HTMLElement;
  const toolbar = host.shadowRoot!.querySelector<HTMLElement>(".toolbar")!;
  const dismiss = host.shadowRoot!.querySelector<HTMLButtonElement>(
    '[data-menu-item="dismiss"]',
  )!;
  const barOrder = [...host.shadowRoot!.querySelectorAll<HTMLElement>(
    ".morphing-menu__bar [data-menu-item]",
  )].map((item) => item.dataset.menuItem);
  expect(barOrder.slice(-2)).toEqual(["more", "dismiss"]);
  expect(dismiss.querySelector("svg")?.outerHTML).toBe(
    icon("close").outerHTML,
  );
  expect(toolbar.style.display).not.toBe("none");
  dismiss.click();
  expect(toolbar.style.display).toBe("none");
  const reopen = new KeyboardEvent("keydown", {
    key: "K",
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(reopen);
  expect(reopen.defaultPrevented).toBe(true);
  expect(toolbar.style.display).not.toBe("none");
  controller.destroy();

  document.body.replaceChildren();
  sessionStorage.clear();
  controller = initComments({
    ...options,
    onboarding: undefined,
    project: "hidden-fixture",
    showToolbar: false,
  });
  const hiddenHost = [...document.body.children].find(
    (node) => node.shadowRoot,
  ) as HTMLElement;
  const hiddenToolbar = hiddenHost.shadowRoot!.querySelector<HTMLElement>(
    ".toolbar",
  )!;
  expect(hiddenToolbar.style.display).toBe("none");
  controller.open();
  expect(hiddenToolbar.style.display).not.toBe("none");
});

it("removes Design mode entry points when the feature is off", () => {
  controller = initComments({
    ...options,
    onboarding: undefined,
    features: { designMode: false, tags: false },
  });
  const host = [...document.body.children].find(
    (node) => node.shadowRoot,
  ) as HTMLElement;
  const root = host.shadowRoot!;
  expect(root.querySelector('[data-menu-item="design"]')).toBeNull();
  expect(root.querySelector('[data-menu-item="comment"]')).not.toBeNull();
  expect(root.querySelector(".design-mode-trigger")).toBeNull();
  expect(root.querySelector(".design-inspector")).toBeNull();
});

it("uses configured shortcut keys and labels", () => {
  controller = initComments({
    ...options,
    onboarding: undefined,
    shortcuts: { comment: "M", browse: false, restore: "Shift+J" },
  });
  const host = [...document.body.children].find(
    (node) => node.shadowRoot,
  ) as HTMLElement;
  const root = host.shadowRoot!;
  const label = (id: string) =>
    root.querySelector(`[data-menu-item="${id}"]`)!.getAttribute("aria-label");
  expect(label("comment")).toBe("Add comment · M");
  expect(label("browse")).toBe("Browse website");
  expect(label("dismiss")).toBe("Dismiss inline feedback · Shift+J to restore");
  const key = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(key({ key: "c" })).toBe(false);
  expect(key({ key: "v" })).toBe(false);
  expect(key({ key: "m" })).toBe(true);
  const toolbar = root.querySelector<HTMLElement>(".toolbar")!;
  root.querySelector<HTMLButtonElement>('[data-menu-item="dismiss"]')!.click();
  expect(toolbar.style.display).toBe("none");
  expect(key({ key: "K", shiftKey: true })).toBe(false);
  expect(toolbar.style.display).toBe("none");
  expect(key({ key: "J", shiftKey: true })).toBe(true);
  expect(toolbar.style.display).not.toBe("none");
});

it("toggles the comment list with L and shows configured bindings in every hint", () => {
  const mount = (shortcuts?: CommentsOptions["shortcuts"]) => {
    controller?.destroy();
    controller = initComments({ ...options, onboarding: undefined, shortcuts });
    const root = ([...document.body.children].find((node) => node.shadowRoot) as HTMLElement).shadowRoot!;
    return (id: string) => root.querySelector(`[data-menu-item="${id}"]`)?.getAttribute("aria-label");
  };
  const key = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, ...init });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  };

  let label = mount();
  expect(label("comments")).toBe("View all comments · L · 0 open");
  expect(key({ key: "l" })).toBe(true);
  expect(label("comments")).toBe("Close comment sidebar · L");
  // Caps Lock.
  expect(key({ key: "L" })).toBe(true);
  expect(label("comments")).toBe("View all comments · L · 0 open");

  label = mount({ comment: "Shift+C", design: "Shift+D", comments: "Shift+L", restore: "Shift+R" });
  expect(label("comment")).toBe("Add comment · Shift+C");
  expect(label("design")).toBe("Design mode · Shift+D");
  expect(label("comments")).toBe("View all comments · Shift+L · 0 open");
  expect(label("dismiss")).toBe("Dismiss inline feedback · Shift+R to restore");
  expect(key({ key: "l" })).toBe(false);
  expect(key({ key: "c" })).toBe(false);
  // Caps Lock and a layout whose shifted key isn't L both reach Shift+L.
  expect(key({ key: "l", code: "KeyL", shiftKey: true })).toBe(true);
  expect(label("comments")).toBe("Close comment sidebar · Shift+L");
  expect(key({ key: "Ł", code: "KeyL", shiftKey: true })).toBe(true);
  expect(label("comments")).toBe("View all comments · Shift+L · 0 open");

  label = mount({ comment: false, design: false, comments: false, restore: false });
  expect(label("comment")).toBe("Add comment");
  expect(label("design")).toBe("Design mode");
  expect(label("comments")).toBe("View all comments · 0 open");
  expect(label("dismiss")).toBe("Dismiss inline feedback");
  expect(key({ key: "l" })).toBe(false);
});

it("never fires shortcuts while typing in a page or komo field", () => {
  controller = initComments({ ...options, onboarding: undefined });
  const root = ([...document.body.children].find((node) => node.shadowRoot) as HTMLElement).shadowRoot!;
  const key = (target: EventTarget, init: KeyboardEventInit = { key: "c" }) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, ...init });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const input = document.createElement("input");
  const editor = document.createElement("div");
  const nested = document.createElement("span");
  // jsdom doesn't compute isContentEditable.
  for (const node of [editor, nested])
    Object.defineProperty(node, "isContentEditable", { value: true });
  editor.append(nested);
  document.body.append(input, editor);
  for (const target of [input, editor, nested])
    for (const init of [{ key: "c" }, { key: "l" }, { key: "K", shiftKey: true }])
      expect(key(target, init)).toBe(false);

  // Focus inside a closed shadow root that composedPath() can't see into.
  const widget = document.createElement("div");
  const inner = document.createElement("textarea");
  widget.attachShadow({ mode: "closed" }).append(inner);
  Object.defineProperty(widget, "shadowRoot", { value: { activeElement: inner } });
  widget.tabIndex = 0;
  document.body.append(widget);
  widget.focus();
  expect(key(widget)).toBe(false);
  widget.blur();

  const field = document.createElement("input");
  root.append(field);
  expect(key(field)).toBe(false);
  expect(key(field, { key: "l" })).toBe(false);
  // Bare letters still work from komo's own non-editable controls.
  expect(key(root.querySelector('[data-menu-item="browse"]')!, { key: "l" })).toBe(true);
});

it("dismisses the active Design overlay without intercepting host clicks", async () => {
  controller = initComments({ ...options, onboarding: undefined });
  const host = [...document.body.children].find(
    (node) => node.shadowRoot,
  ) as HTMLElement;
  const root = host.shadowRoot!;
  const toolbar = root.querySelector<HTMLElement>(".toolbar")!;
  const design = root.querySelector<HTMLButtonElement>(
    '[data-menu-item="design"]',
  )!;
  design.click();

  // Design mode is a dynamic import; under load it takes more than a few ticks.
  await vi.waitFor(() =>
    expect(root.querySelector(".design-inspector")?.getAttribute("aria-hidden")).toBe("false"),
  );
  const inspector = root.querySelector<HTMLElement>(".design-inspector")!;
  expect(inspector.getAttribute("aria-hidden")).toBe("false");

  const hostButton = document.createElement("button");
  document.body.append(hostButton);
  const hostClick = vi.fn();
  hostButton.addEventListener("click", hostClick);
  const capturedClick = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  hostButton.dispatchEvent(capturedClick);
  expect(capturedClick.defaultPrevented).toBe(true);
  expect(hostClick).not.toHaveBeenCalled();

  const dismiss = root.querySelector<HTMLButtonElement>(
    '[data-menu-item="dismiss"]',
  )!;
  expect(dismiss.getAttribute("aria-label")).toBe(
    "Dismiss inline feedback · Shift+K to restore",
  );
  dismiss.click();
  expect(toolbar.style.display).toBe("none");
  expect(inspector.getAttribute("aria-hidden")).toBe("true");

  const restoredClick = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  hostButton.dispatchEvent(restoredClick);
  expect(restoredClick.defaultPrevented).toBe(false);
  expect(hostClick).toHaveBeenCalledOnce();

  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "K",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(toolbar.style.display).not.toBe("none");
});

it("keeps the morphing sidebar as the shared surface when entering and leaving Design", async () => {
  controller = initComments({ ...options, onboarding: undefined });
  const host = [...document.body.children].find((node) => node.shadowRoot) as HTMLElement;
  const root = host.shadowRoot!;
  const toolbar = root.querySelector<HTMLElement>(".toolbar")!;
  root.querySelector<HTMLButtonElement>('[data-menu-item="design"]')!.click();

  // Design mode is a dynamic import; under load it takes more than a few ticks.
  await vi.waitFor(() =>
    expect(root.querySelector(".design-inspector")?.getAttribute("aria-hidden")).toBe("false"),
  );
  const sidebar = root.querySelector<HTMLElement>(".edge-sidebar, .sidebar") ??
    [...root.children].find((element) => element.querySelector(".design-inspector")) as HTMLElement;
  const inspector = root.querySelector<HTMLElement>(".design-inspector")!;
  expect(toolbar.dataset.hidden).not.toBe("true");
  expect(toolbar.inert).toBe(true);
  expect(host.classList.contains("design-active")).toBe(true);
  expect(inspector.parentElement).toBe(sidebar);
  expect(sidebar.querySelector<HTMLElement>(".panel")?.inert).toBe(true);
  expect(sidebar.querySelector<HTMLElement>(".panel")?.hidden).toBe(true);

  inspector.querySelector<HTMLButtonElement>(".design-inspector__close")!.click();
  expect(root.querySelector<HTMLElement>(".design-inspector")?.getAttribute("aria-hidden")).toBe("true");
  expect(sidebar.querySelector<HTMLElement>(".panel")?.inert).toBe(false);
  expect(sidebar.querySelector<HTMLElement>(".panel")?.hidden).toBe(false);
  expect(toolbar.inert).toBe(false);
  expect(host.classList.contains("design-active")).toBe(false);
  expect(toolbar.dataset.hidden).not.toBe("true");
});

it("clears private cached feedback and identity immediately on another tab's logout", async () => {
  const { CommentsApi } = await import("../src/api");
  const config = { ...options, onboarding: undefined };
  const api = new CommentsApi(config);
  api.save({
    token: "private-session",
    user: { id: "reviewer", name: "Private Reviewer", verified: true },
  });
  localStorage.setItem(
    `${api.sessionKey}:${JSON.stringify([config.repo, "local"])}:threads`,
    JSON.stringify({
      token: api.token,
      threads: [
        {
          id: "private",
          page: "/",
          resolved: false,
          resolvedBy: null,
          createdAt: 1,
          updatedAt: 1,
          anchor: {
            selector: "body",
            text: "",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            pageX: 0,
            pageY: 0,
            viewportWidth: 1200,
          },
          comments: [
            {
              id: "comment",
              body: "Private feedback",
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
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  controller = initComments(config);
  controller.open();
  const shadow = [...document.body.children].find(
    (node) => node.shadowRoot,
  )!.shadowRoot!;
  expect(shadow.textContent).toContain("Private feedback");
  expect(
    shadow.querySelector('[aria-label="Private Reviewer · Account"]'),
  ).not.toBeNull();
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "another-project",
      storageArea: localStorage,
    }),
  );
  expect(shadow.textContent).toContain("Private feedback");
  api.clear(); // The other tab removes both its session and account snapshot.
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: api.sessionKey,
      newValue: null,
      storageArea: localStorage,
    }),
  );
  expect(shadow.textContent).not.toContain("Private feedback");
  expect(
    shadow.querySelector('[aria-label="Private Reviewer · Account"]'),
  ).toBeNull();
  expect(shadow.querySelector('[aria-label="Enter your name"]')).not.toBeNull();
  api.save({
    token: "another-session",
    user: { id: "other", name: "Other Reviewer", verified: true },
  });
  window.dispatchEvent(new Event("focus"));
  expect(
    shadow.querySelector('[aria-label="Other Reviewer · Account"]'),
  ).not.toBeNull();
  expect(shadow.textContent).not.toContain("Private feedback");
  localStorage.clear();
});

it("keeps multi-root host layout and framework-owned nodes untouched", () => {
  const main = document.createElement("main");
  const aside = document.createElement("aside");
  document.body.append(main, aside);
  document.body.style.display = "grid";
  controller = initComments({ ...options, sidebar: "background" });
  const host = [...document.body.children].find(
    (node) => node.shadowRoot,
  )! as HTMLElement;
  expect(document.querySelector("body > main")).toBe(main);
  expect(document.querySelector("body > aside")).toBe(aside);
  expect(host.dataset.sidebar).toBe("edge");
  document.body.style.background = "blue";
  controller.close();
  controller.destroy();
  expect([...document.body.children]).toEqual([main, aside]);
  expect(document.body.style.display).toBe("grid");
  expect(document.body.style.background).toBe("blue");
  document.body.removeChild(main); // Framework ownership still matches the mounted tree.
  document.body.style.cssText = "";
});

it("frames an existing sole app root without reparenting it", () => {
  const app = document.createElement("main");
  document.body.append(app, document.createElement("script"));
  controller = initComments({ ...options, sidebar: "background" });
  expect(app.parentElement).toBe(document.body);
  expect(app.style.boxSizing).toBe("border-box");
  const host = [...document.body.children].find(
    (node) => node.shadowRoot,
  )! as HTMLElement;
  expect(host.dataset.sidebar).toBe("background");
  controller.destroy();
  expect(app.parentElement).toBe(document.body);
  expect(app.style.transform).toBe("");
  expect(app.style.boxSizing).toBe("");
  document.body.append(document.createElement("aside"));
  controller = initComments({
    ...options,
    sidebar: "background",
    pageRoot: app,
  });
  expect(app.parentElement).toBe(document.body);
  expect(
    (
      [...document.body.children].find(
        (node) => node.shadowRoot,
      )! as HTMLElement
    ).dataset.sidebar,
  ).toBe("background");
});

it("repaints the frame when a theme changes the page background", async () => {
  const style = document.createElement("style");
  style.textContent = "body{background:rgb(245, 244, 240)}[data-mode=dark] body{background:rgb(27, 28, 25)}";
  document.head.append(style);
  const app = document.createElement("main");
  document.body.append(app);
  controller = initComments({ ...options, sidebar: "background" });
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  expect(app.style.background).toBe("rgb(245, 244, 240)");
  document.documentElement.dataset.mode = "dark";
  await nextFrame();
  expect(app.style.background).toBe("rgb(27, 28, 25)");
  expect(document.body.style.background).toBe("rgb(8, 8, 8)");
  delete document.documentElement.dataset.mode;
  await nextFrame();
  expect(app.style.background).toBe("rgb(245, 244, 240)");
  controller.destroy();
  expect(document.body.style.background).toBe("");
  style.remove();
});

it("rejects unsafe page roots before mounting", () => {
  for (const pageRoot of [
    document.body,
    document.documentElement,
    document.createElement("main"),
  ])
    expect(() => initComments({ ...options, pageRoot })).toThrow(
      "pageRoot must",
    );
  expect([...document.body.children].some((node) => node.shadowRoot)).toBe(
    false,
  );
});

it("uses Floating for boxless content roots even when explicitly configured", () => {
  const app = document.createElement("main");
  app.style.display = "contents";
  document.body.append(app);
  controller = initComments({ ...options, sidebar: "background" });
  expect(([...document.body.children].find(node => node.shadowRoot)! as HTMLElement).dataset.sidebar).toBe("edge");
  expect(app.style.display).toBe("contents");
  controller.destroy();
  controller = initComments({ ...options, sidebar: "background", pageRoot: app });
  expect(([...document.body.children].find(node => node.shadowRoot)! as HTMLElement).dataset.sidebar).toBe("edge");
});

it("toggles Design mode with D, a configured key, and never while typing or disabled", async () => {
  const press = (init: KeyboardEventInit, target: EventTarget = document) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, ...init });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const mount = (extra: Partial<CommentsOptions> = {}) => {
    controller?.destroy();
    controller = initComments({ ...options, onboarding: undefined, ...extra });
    const host = [...document.body.children].find((node) => node.shadowRoot) as HTMLElement;
    return { host, root: host.shadowRoot! };
  };

  let { host, root } = mount();
  expect(root.querySelector('[data-menu-item="design"]')!.getAttribute("aria-label")).toBe("Design mode · D");
  const input = document.createElement("input");
  document.body.append(input);
  expect(press({ key: "d" }, input)).toBe(false);
  expect(host.classList.contains("design-active")).toBe(false);
  expect(press({ key: "d" })).toBe(true);
  expect(host.classList.contains("design-active")).toBe(true);
  for (let i = 0; i < 20 && !root.querySelector(".design-inspector__empty"); i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  expect(root.querySelector(".design-inspector__empty")?.textContent).toContain("Esc or D to exit");
  const sidebar = root.querySelector(".design-inspector")!.parentElement!;
  expect(sidebar.hasAttribute("data-design-empty")).toBe(true);
  expect(press({ key: "d" })).toBe(true);
  expect(host.classList.contains("design-active")).toBe(false);
  expect(sidebar.hasAttribute("data-design-empty")).toBe(false);

  ({ host, root } = mount({ shortcuts: { design: "Shift+E" } }));
  expect(root.querySelector('[data-menu-item="design"]')!.getAttribute("aria-label")).toBe("Design mode · Shift+E");
  expect(press({ key: "d" })).toBe(false);
  expect(press({ key: "E", shiftKey: true })).toBe(true);
  expect(host.classList.contains("design-active")).toBe(true);

  ({ host, root } = mount({ shortcuts: { design: false } }));
  expect(root.querySelector('[data-menu-item="design"]')!.getAttribute("aria-label")).toBe("Design mode");
  expect(press({ key: "d" })).toBe(false);
  expect(host.classList.contains("design-active")).toBe(false);

  ({ host } = mount({ features: { designMode: false } }));
  expect(press({ key: "d" })).toBe(false);
  expect(host.classList.contains("design-active")).toBe(false);
});

it("picks body-level portals outside pageRoot unless pickRoots narrows the boundary", () => {
  const app = document.createElement("main");
  const portal = document.createElement("div");
  const save = document.createElement("button");
  save.textContent = "Save";
  portal.append(save);
  document.body.append(app, portal);
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [save, portal, document.body, document.documentElement],
  });
  Object.defineProperty(Element.prototype, "setPointerCapture", {
    configurable: true,
    value() {},
  });
  const pick = (extra: Partial<CommentsOptions> = {}) => {
    controller?.destroy();
    controller = initComments({ ...options, onboarding: undefined, pageRoot: app, ...extra });
    const root = [...document.body.children].find((node) => node.shadowRoot)!
      .shadowRoot!;
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "c", bubbles: true }),
    );
    const catcher = root.querySelector<HTMLElement>(".catch")!;
    for (const type of ["pointerdown", "pointerup"])
      catcher.dispatchEvent(
        new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 }),
      );
    return !!root.querySelector('[data-focus-key="body"]');
  };
  expect(pick()).toBe(true);
  expect(pick({ pickRoots: () => [] })).toBe(false);
  expect(pick({ pickRoots: () => [portal] })).toBe(true);
});

it("keeps komo's typing, pointer and focus events away from page listeners", () => {
  const mount = (extra: Partial<CommentsOptions> = {}) => {
    controller?.destroy();
    controller = initComments({ ...options, onboarding: undefined, ...extra });
    const host = [...document.body.children].find((node) => node.shadowRoot)!;
    const field = document.createElement("textarea");
    const control = document.createElement("button");
    host.shadowRoot!.append(field, control);
    return { host, root: host.shadowRoot!, field, control };
  };
  const seen: string[] = [];
  const page = (event: Event) =>
    seen.push(`${event.type}:${(event.target as Element).tagName}`);
  const types = ["keydown", "keyup", "pointerdown", "click", "wheel", "focusin", "focusout"];
  const listen = () => {
    for (const type of types) document.addEventListener(type, page);
    return () => types.forEach((type) => document.removeEventListener(type, page));
  };
  const fire = (target: EventTarget, type: string, init: object = {}) =>
    target.dispatchEvent(
      new (type.startsWith("key") ? KeyboardEvent : type.startsWith("focus") ? FocusEvent : MouseEvent)(
        type,
        { bubbles: true, composed: true, ...init },
      ),
    );

  let { host, root, field, control } = mount();
  const stop = listen();
  fire(field, "keydown", { key: "c" });
  fire(field, "keyup", { key: "c" });
  for (const type of ["pointerdown", "click", "wheel", "focusin", "focusout"])
    fire(control, type);
  expect(seen).toEqual([]);
  // Keys on komo's buttons still reach page shortcuts.
  fire(control, "keydown", { key: "k" });
  expect(seen).toEqual(["keydown:DIV"]);
  // Page events are untouched.
  const outside = document.createElement("input");
  document.body.append(outside);
  fire(outside, "pointerdown");
  fire(outside, "keydown", { key: "x" });
  expect(seen.slice(1)).toEqual(["pointerdown:INPUT", "keydown:INPUT"]);
  // Moving focus into komo doesn't reach later focus-trap listeners.
  seen.length = 0;
  fire(outside, "focusout", { relatedTarget: host });
  fire(outside, "focusout", { relatedTarget: null });
  expect(seen).toEqual(["focusout:INPUT"]);
  stop();

  // komo still handles its own shortcuts: Escape in a komo field leaves comment mode.
  fire(document, "keydown", { key: "c" });
  const catcher = root.querySelector<HTMLElement>(".catch")!;
  expect(catcher.hidden).toBe(false);
  fire(field, "keydown", { key: "Escape" });
  expect(catcher.hidden).toBe(true);

  ({ host, field, control } = mount({ isolateEvents: false }));
  seen.length = 0;
  const stopAgain = listen();
  fire(field, "keydown", { key: "c" });
  fire(control, "pointerdown");
  stopAgain();
  expect(seen).toEqual(["keydown:DIV", "pointerdown:DIV"]);
});

it("closes komo menus on pointerdown elsewhere in komo despite isolation", async () => {
  const { onPage } = await import("../src/dom");
  controller = initComments({ ...options, onboarding: undefined });
  const root = [...document.body.children].find((node) => node.shadowRoot)!
    .shadowRoot!;
  const menu = document.createElement("div");
  const elsewhere = document.createElement("button");
  root.append(menu, elsewhere);
  const close = vi.fn();
  const listening = new AbortController();
  onPage(menu, "pointerdown", close, { signal: listening.signal });
  const down = (target: EventTarget) =>
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
  down(elsewhere);
  down(document.body);
  expect(close).toHaveBeenCalledTimes(2);
  listening.abort();
  down(elsewhere);
  expect(close).toHaveBeenCalledTimes(2);
});

/** jsdom has no layout: give the commented element a box so pins render. */
function layoutBody() {
  const target = document.createElement("main");
  target.id = "target";
  document.body.append(target);
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this === target ? new DOMRect(10, 10, 400, 300) : measure.call(this);
  });
}

it("opens threads inside the open sidebar, switches in place, and steps back with Escape", async () => {
  const { CommentsApi } = await import("../src/api");
  const config = { ...options, onboarding: undefined };
  const api = new CommentsApi(config);
  api.save({
    token: "panel-session",
    user: { id: "reviewer", name: "Panel Reviewer", verified: true },
  });
  const thread = (id: string, body: string, updatedAt: number) => ({
    id,
    page: "/",
    resolved: false,
    resolvedBy: null,
    createdAt: 1,
    updatedAt,
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
    `${api.sessionKey}:${JSON.stringify([config.repo, "local"])}:threads`,
    JSON.stringify({
      token: api.token,
      threads: [thread("first", "First thread", 2), thread("second", "Second thread", 1)],
    }),
  );
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  layoutBody();
  controller = initComments(config);
  controller.open();
  const shadow = [...document.body.children].find(
    (node) => node.shadowRoot,
  )!.shadowRoot!;
  const panel = shadow.querySelector<HTMLElement>(".panel")!;
  const pane = () =>
    [...panel.children].find((node) => node.classList.contains("thread-pane"));
  const card = (text: string) =>
    [...panel.querySelectorAll<HTMLButtonElement>(".thread-card")].find((node) =>
      node.textContent?.includes(text),
    )!;

  card("First thread").click();
  expect(panel.hasAttribute("data-thread")).toBe(true);
  expect(pane()?.querySelector(".thread-title")?.textContent).toBe("First thread");
  expect(pane()?.querySelector(".messages")?.textContent).toContain("First thread");
  expect(pane()?.querySelector('[aria-label="Back to comments"]')).not.toBeNull();
  expect(pane()?.querySelector("textarea")).not.toBeNull();
  // The floating dialog layer is empty: the thread lives in the sidebar.
  expect(shadow.querySelector(":scope > div > .dialog")).toBeNull();
  expect(
    shadow.querySelector('.pin.active[aria-label^="Comment 1:"]'),
  ).not.toBeNull();

  shadow.querySelector<HTMLButtonElement>('.pin[aria-label^="Comment 2:"]')!.click();
  expect(pane()?.querySelector(".thread-title")?.textContent).toBe("Second thread");
  expect(
    shadow.querySelector('.pin.active[aria-label^="Comment 2:"]'),
  ).not.toBeNull();

  const reply = pane()!.querySelector("textarea")!;
  reply.value = "Panel reply";
  reply.dispatchEvent(new Event("input"));
  reply.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  await vi.waitFor(() =>
    expect(pane()?.querySelector(".messages")?.textContent).toContain("Panel reply"),
  );
  expect(panel.hasAttribute("data-thread")).toBe(true);

  pane()!.querySelector<HTMLButtonElement>('[aria-label="Back to comments"]')!.click();
  expect(panel.hasAttribute("data-thread")).toBe(false);
  expect(pane()).toBeUndefined();

  card("First thread").click();
  pane()!
    .querySelector("textarea")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
  expect(panel.hasAttribute("data-thread")).toBe(false);
  expect(panel.isConnected).toBe(true);
  panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
  // Then the sidebar closes: removed, or parked inert as the floating drawer.
  expect(!panel.isConnected || panel.parentElement!.inert).toBe(true);
  localStorage.clear();
});

it("keeps the floating dialog while the sidebar is closed", async () => {
  const { CommentsApi } = await import("../src/api");
  const config = { ...options, onboarding: undefined };
  const api = new CommentsApi(config);
  api.save({
    token: "closed-session",
    user: { id: "reviewer", name: "Closed Reviewer", verified: true },
  });
  localStorage.setItem(
    `${api.sessionKey}:${JSON.stringify([config.repo, "local"])}:threads`,
    JSON.stringify({
      token: api.token,
      threads: [
        {
          id: "only",
          page: "/",
          resolved: false,
          resolvedBy: null,
          createdAt: 1,
          updatedAt: 1,
          anchor: { selector: "#target", text: "", x: 0.5, y: 0.5, width: 0, height: 0, pageX: 0, pageY: 0, viewportWidth: 1200 },
          comments: [
            { id: "c", body: "Floating thread", author: api.user, createdAt: 1, editedAt: null, reactions: {} },
          ],
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  layoutBody();
  controller = initComments(config);
  const shadow = [...document.body.children].find(
    (node) => node.shadowRoot,
  )!.shadowRoot!;
  shadow.querySelector<HTMLButtonElement>(".pin")!.click();
  const dialog = shadow.querySelector<HTMLElement>(".dialog")!;
  expect(dialog.textContent).toContain("Floating thread");
  expect(dialog.closest(".panel")).toBeNull();
  expect(dialog.querySelector(".thread-back")).toBeNull();
  localStorage.clear();
});

async function mountForComments(sidebar: "background" | "edge", name: string) {
  const { CommentsApi } = await import("../src/api");
  const config = { ...options, onboarding: undefined, sidebar };
  const api = new CommentsApi(config);
  api.save({ token: `${name}-session`, user: { id: name, name, verified: true } });
  localStorage.setItem(
    `${api.sessionKey}:${JSON.stringify([config.repo, "local"])}:threads`,
    JSON.stringify({ token: api.token, threads: [] }),
  );
  // Reads stay pending; writes succeed.
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: URL, init?: RequestInit) =>
      init?.method && init.method !== "GET"
        ? Promise.resolve(Response.json({ id: `${name}-thread`, commentId: `${name}-comment` }))
        : new Promise<Response>(() => {}),
    ),
  );
  layoutBody();
  controller = initComments(config);
  const host = [...document.body.children].find((node) => node.shadowRoot) as HTMLElement;
  const shadow = host.shadowRoot!;
  const press = (key: string) =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true }));
  const open = () => host.classList.contains("review-open");
  const capturing = () => !shadow.querySelector<HTMLElement>(".catch")!.hidden;
  const pane = () => shadow.querySelector<HTMLElement>(".panel .thread-pane");
  const post = async (text: string) => {
    controller!.comment(document.getElementById("target")!);
    const input = shadow.querySelector<HTMLTextAreaElement>('[data-focus-key="body"]')!;
    expect(input.closest(".panel")).toBeNull();
    input.value = text;
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(capturing()).toBe(true));
  };
  return { host, shadow, press, open, capturing, pane, post };
}

it("frames body-level portals with the page and restores them exactly", async () => {
  const watched = new Map<Element, () => void>();
  vi.stubGlobal("ResizeObserver", class {
    private targets = new Set<Element>();
    constructor(private callback: () => void) {}
    observe(node: Element) { this.targets.add(node); watched.set(node, this.callback); }
    unobserve(node: Element) { this.targets.delete(node); watched.delete(node); }
    disconnect() { for (const node of this.targets) watched.delete(node); this.targets.clear(); }
  });
  const { host } = await mountForComments("background", "portals");
  const portal = (css: string) => {
    const node = document.createElement("div");
    node.style.cssText = css;
    document.body.append(node);
    return node;
  };
  const dialog = portal("position: fixed; inset: 0px; translate: 1px 2px; transform-origin: 50px 25px;");
  let portalLeft = 0;
  Object.defineProperty(dialog, "offsetLeft", { get: () => portalLeft });
  const original = dialog.style.cssText;
  const flow = portal("height: 10px;");
  const anchored = portal("position: fixed; transform: translate(5px, 5px);");
  const chosen = portal("position: absolute;");
  const reopen = (include?: (node: HTMLElement) => boolean) => {
    controller!.destroy();
    controller = initComments({ ...options, onboarding: undefined, sidebar: "background", pageRoot: document.getElementById("target")!, frame: { include } });
    controller.open();
  };
  controller!.open();
  const target = document.getElementById("target")!;
  expect(target.style.transform).toMatch(/scale/);
  const scale = target.style.transform.match(/scale\(([\d.]+)\)/)![1];
  // Present on entry: scaled like the page, keeping its own translate inside.
  expect(dialog.style.scale).toBe(scale);
  expect(dialog.style.translate).toMatch(/1px/);
  // komo's host, in-flow content and script-anchored popovers stay as they are.
  for (const node of [host, flow, anchored, chosen]) expect(node.style.scale).toBe("");
  // A size change re-maps the portal through the existing page observer.
  const remap = watched.get(dialog)!;
  expect(remap).toBeTypeOf("function");
  const firstTranslate = dialog.style.translate;
  portalLeft = 100;
  remap();
  expect(dialog.style.scale).toBe(scale);
  expect(dialog.style.translate).not.toBe(firstTranslate);
  expect(dialog.style.translate).toContain("1px");
  // Unrelated inline changes survive leaving Frame view.
  dialog.style.color = "red";
  // Mounted while framed.
  const toast = portal("position: fixed; right: 0px; bottom: 0px;");
  const enlarged = portal("position: fixed; scale: 1.1 0.9;");
  await Promise.resolve();
  expect(toast.style.scale).toBe(scale);
  expect(enlarged.style.scale).toBe(`${1.1 * +scale} ${0.9 * +scale}`);
  controller!.close();
  expect(dialog.style.color).toBe("red");
  dialog.style.color = "";
  expect(dialog.style.cssText).toBe(original);
  expect(watched.has(dialog)).toBe(false);
  expect(enlarged.style.scale).toBe("1.1 0.9");
  expect(toast.style.cssText).toBe("position: fixed; right: 0px; bottom: 0px;");
  // include() overrides the default; destroy() restores too.
  reopen((node) => node === chosen);
  expect(chosen.style.scale).toBe(scale);
  expect(dialog.style.scale).toBe("");
  controller!.destroy();
  expect(chosen.style.cssText).toBe("position: absolute;");
  reopen();
  expect(dialog.style.scale).toBe(scale);
  controller!.destroy();
  expect(dialog.style.cssText).toBe(original);
  expect(watched.size).toBe(0);
});

it("keeps Frame view open while commenting, posting, resolving and in Design mode", async () => {
  const { host, shadow, press, open, capturing, pane, post } = await mountForComments("background", "framer");
  expect(host.dataset.sidebar).toBe("background");
  controller!.open();
  expect(open()).toBe(true);
  const frame = document.getElementById("target")!;
  expect(frame.style.transform).toMatch(/scale/);

  press("c");
  expect(open()).toBe(true);
  expect(capturing()).toBe(true);

  await post("Framed note");
  // The new thread opens in the sidebar and comment mode stays armed.
  expect(open()).toBe(true);
  expect(frame.style.transform).toMatch(/scale/);
  expect(pane()?.querySelector(".thread-title")?.textContent).toBe("Framed note");

  pane()!.querySelector<HTMLButtonElement>('[aria-label="Resolve comment"]')!.click();
  expect(open()).toBe(true);
  press("Escape");
  expect(open()).toBe(true);
  expect(capturing()).toBe(false);

  press("d");
  expect(host.classList.contains("design-active")).toBe(true);
  expect(open()).toBe(true);
  press("c");
  expect(host.classList.contains("design-active")).toBe(false);
  expect(open()).toBe(true);
  expect(capturing()).toBe(true);
  press("Escape");
  // Leaving Frame stays explicit: a second Escape closes the sidebar.
  press("Escape");
  expect(open()).toBe(false);
  expect(shadow.querySelector(".thread-pane")).toBeNull();
  localStorage.clear();
});

it("still closes the Floating sidebar when commenting", async () => {
  const { host, press, open, capturing, pane, post } = await mountForComments("edge", "floater");
  expect(host.dataset.sidebar).toBe("edge");
  controller!.open();
  expect(open()).toBe(true);
  press("c");
  expect(open()).toBe(false);
  expect(capturing()).toBe(true);
  controller!.open();
  await post("Floating note");
  expect(open()).toBe(false);
  expect(pane()).toBeNull();
  localStorage.clear();
});

it("outlines a hovered or focused list card's target and raises its pin", async () => {
  const { CommentsApi } = await import("../src/api");
  const config = { ...options, onboarding: undefined };
  const api = new CommentsApi(config);
  api.save({ token: "hover-session", user: { id: "hover", name: "Hover Reviewer", verified: true } });
  const anchor = { selector: "#target", text: "", x: 0.5, y: 0.5, width: 0, height: 0, pageX: 0, pageY: 0, viewportWidth: 1200 };
  const thread = (id: string, body: string) => ({
    id, page: "/", resolved: false, resolvedBy: null, createdAt: 1, updatedAt: 1, anchor,
    comments: [{ id: `${id}-c`, body, author: api.user, createdAt: 1, editedAt: null, reactions: {} }],
  });
  localStorage.setItem(
    `${api.sessionKey}:${JSON.stringify([config.repo, "local"])}:threads`,
    JSON.stringify({ token: api.token, threads: [thread("one", "Hover one"), thread("two", "Hover two")] }),
  );
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  layoutBody();
  controller = initComments(config);
  controller.open();
  const shadow = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
  const outline = shadow.querySelector<HTMLElement>(".component-hover")!;
  const item = (id: string) => shadow.querySelector<HTMLElement>(`.list .thread-item[data-thread="${id}"]`)!;
  const pin = (id: string) => shadow.querySelector<HTMLElement>(`.pin[data-thread="${id}"]`)!;
  const fire = (target: Element, type: string) => target.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  const lit = () => outline.hasAttribute("data-thread") && outline.style.opacity === "1";

  fire(item("one").querySelector(".thread-card")!, "pointerover");
  expect(lit()).toBe(true);
  expect(outline.style.width).toBe("400px");
  expect(pin("one").classList.contains("hot")).toBe(true);
  expect(pin("two").classList.contains("hot")).toBe(false);

  // Card to card: no gap clears in between.
  fire(item("one").parentElement!, "pointerover");
  fire(item("two"), "pointerover");
  expect(lit()).toBe(true);
  expect(pin("two").classList.contains("hot")).toBe(true);
  expect(pin("one").classList.contains("hot")).toBe(false);

  fire(shadow.querySelector(".panel")!, "pointerleave");
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(outline.hasAttribute("data-thread")).toBe(false);
  expect(shadow.querySelector(".pin.hot")).toBeNull();

  // Keyboard focus does the same, and a list scroll clears it.
  fire(item("one").querySelector(".thread-card")!, "focusin");
  expect(lit()).toBe(true);
  shadow.querySelector(".list")!.dispatchEvent(new Event("scroll"));
  expect(outline.hasAttribute("data-thread")).toBe(false);

  fire(item("two").querySelector(".thread-card")!, "pointerover");
  expect(lit()).toBe(true);
  controller.close();
  expect(outline.hasAttribute("data-thread")).toBe(false);
  expect(shadow.querySelector(".pin.hot")).toBeNull();
  localStorage.clear();
});
