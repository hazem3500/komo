// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initComments } from "../src/index";
import { captureSnapshot, HTML_LIMIT, noteComment, PLACEHOLDER, skipped, snapshotFor, snapshotHtml } from "../src/snapshot";
import type { CommentsController, CommentsOptions } from "../src/types";

const fixture = (html: string) => {
  const root = document.createElement("section");
  root.innerHTML = html;
  document.body.append(root);
  return root;
};

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("snapshot HTML", () => {
  it("strips scripts, styles, inline handlers and script URLs", () => {
    const root = fixture(`<div onclick="steal()" data-id="card"><script>alert(1)</script><style>p{}</style>
      <a href="javascript:alert(1)" onmouseover="x()">Link</a><a href="/next">Next</a><img src="/a.png" onerror="x()"><p>Text</p></div>`);
    const html = snapshotHtml(root);
    expect(html).not.toMatch(/script|onclick|onmouseover|onerror|javascript:|<style/i);
    expect(html).toContain('href="/next"');
    expect(html).toContain('data-id="card"');
    expect(html).toContain("<p>Text</p>");
  });

  it("redacts typed values, textareas and passwords, and keeps button labels and the page's own text", () => {
    const root = fixture(`<form><input name="email" value="ada@example.test"><input type="password" value="hunter2">
      <input type="hidden" value="csrf-secret"><input type="search"><textarea>draft text</textarea>
      <input type="submit" value="Send"><input type="checkbox" value="yes" checked><label>Email</label></form>`);
    const search = root.querySelector<HTMLInputElement>('[type="search"]')!;
    search.value = "typed after load";
    root.querySelector("textarea")!.value = "typed in the textarea";
    const html = snapshotHtml(root);
    for (const secret of ["ada@example.test", "hunter2", "csrf-secret", "typed after load", "draft text", "typed in the textarea"])
      expect(html).not.toContain(secret);
    expect(html.split(`value="${PLACEHOLDER}"`)).toHaveLength(5);
    expect(html).toContain(`<textarea>${PLACEHOLDER}</textarea>`);
    expect(html).toContain('value="Send"');
    expect(html).toContain('value="yes"');
    expect(html).toContain("<label>Email</label>");
  });

  it("lets the redact hook replace an element's text with the placeholder", () => {
    const root = fixture(`<div class="account"><span class="balance">$1,204.00</span><span>Visible</span></div>`);
    const redact = vi.fn((element: Element) => element.classList.contains("balance"));
    const html = snapshotHtml(root, redact);
    expect(html).not.toContain("1,204");
    expect(html).toContain(`<span class="balance">${PLACEHOLDER}</span>`);
    expect(html).toContain("<span>Visible</span>");
    expect(redact).toHaveBeenCalledWith(root.querySelector(".balance"));
  });

  it("caps attribute values, text and the whole snapshot", () => {
    const root = fixture(`<div title="${"t".repeat(1000)}">${"word ".repeat(400)}</div>`);
    const html = snapshotHtml(root);
    expect(html).toMatch(/title="t{199}…"/);
    expect(html).toMatch(/(word ){99}word…/);
    expect(html.length).toBeLessThan(1000);
    const big = fixture(Array.from({ length: 2000 }, (_, i) => `<p data-row="${i}">Row ${i} ${"é".repeat(40)}</p>`).join(""));
    const capped = snapshotHtml(big);
    expect(new TextEncoder().encode(capped).length).toBeLessThanOrEqual(HTML_LIMIT);
    expect(capped).toContain('data-row="0"');
    expect(capped).toContain("<!-- trimmed -->");
    expect(capped).not.toContain('data-row="1999"');
  });

  it("leaves out komo's own UI and markers, and empties host no-snapshot regions inside the target", () => {
    const root = fixture(`<div data-komo-inspectable="1" data-komo-still=""><p>Page</p>
      <div data-branch-comments="project">komo toolbar</div><div data-komo-move-clone>stand-in</div>
      <div data-komo-no-snapshot><p>Private notes</p></div></div>`);
    const html = snapshotHtml(root);
    expect(html).not.toMatch(/komo toolbar|stand-in|Private notes|data-komo-inspectable|data-komo-still|data-branch-comments/);
    expect(html).toContain("<p>Page</p>");
    expect(html).toContain("<div data-komo-no-snapshot=\"\"></div>");
  });
});

describe("snapshot capture", () => {
  it("skips targets inside a data-komo-no-snapshot ancestor and komo's own UI", async () => {
    const root = fixture(`<div data-komo-no-snapshot><article><p id="private">Account</p></article></div><p id="public">Public</p>`);
    const host = document.createElement("div");
    host.dataset.branchComments = "fixture";
    host.innerHTML = "<button>Comment</button>";
    document.body.append(host);
    const hidden = root.querySelector("#private")!;
    expect(skipped(hidden)).toBe(true);
    expect(skipped(host.querySelector("button")!)).toBe(true);
    expect(await captureSnapshot(hidden, { html: true, image: true })).toBeNull();
    expect(await captureSnapshot(host.querySelector("button"), { html: true })).toBeNull();
    expect(await captureSnapshot(root.querySelector("#public"), { html: true })).toEqual({ html: '<p id="public">Public</p>' });
    expect(await captureSnapshot(null, { html: true })).toBeNull();
  });

  const limits = { guests: false, maxImageBytes: 262_144, maxHtmlBytes: 32_768 };
  it("captures nothing when no kind is turned on, and once per anchor", async () => {
    const root = fixture(`<p>Hello</p>`);
    const resolve = vi.fn(() => root.firstElementChild);
    expect(await snapshotFor({}, resolve, {}, limits)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    const anchor = {};
    const first = snapshotFor(anchor, resolve, { html: true }, limits);
    expect(snapshotFor(anchor, resolve, { html: true }, limits)).toBe(first);
    expect(await first).toEqual({ html: "<p>Hello</p>" });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("keeps the HTML within the server's limit", async () => {
    const root = fixture(Array.from({ length: 400 }, (_, i) => `<p>Row ${i} ${"x".repeat(30)}</p>`).join(""));
    const shot = await snapshotFor({}, () => root, { html: true }, { ...limits, maxHtmlBytes: 4_000 });
    expect(new TextEncoder().encode(shot!.html!).length).toBeLessThanOrEqual(4_000);
  });

  it("says why the image is missing at the top of the HTML", () => {
    expect(noteComment("cross-origin")).toBe("<!-- komo: no image snapshot, the element shows images from another origin. -->");
  });

  it("uploads each kind as its raw file after capture, and logs a failed upload quietly", async () => {
    const root = fixture(`<p>Héllo</p>`);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const post = vi.fn((_kind: string, _body: Blob) => Promise.reject(new Error("Snapshot storage is full")));
    await snapshotFor({}, () => root.firstElementChild, { html: true }, limits, post);
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith("komo: the comment posted without its html snapshot.", "Snapshot storage is full"));
    const [kind, body] = post.mock.calls[0]!;
    expect(kind).toBe("html");
    expect(body.type).toBe("text/html;charset=utf-8");
    expect(await body.text()).toBe("<p>Héllo</p>");
    info.mockRestore();
  });
});

const measureRect = HTMLElement.prototype.getBoundingClientRect;
describe("posting with snapshots", () => {
  let controller: CommentsController | undefined;
  let requests: { path: string; method: string; type?: string; body?: string }[];
  let server: Record<string, unknown>;
  let failUploads: boolean;
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    requests = [];
    failUploads = false;
    server = { github: false, guests: true, guestResolve: false, snapshots: { guests: false, maxImageBytes: 262_144, maxHtmlBytes: 32_768 } };
    // Config loads (post() answers /me); other reads stay pending; writes succeed.
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const { pathname, searchParams } = new URL(url);
      const body = init?.body instanceof Blob ? await init.body.text() : (init?.body as string | undefined);
      requests.push({ path: `${pathname}${searchParams.has("kind") ? `?kind=${searchParams.get("kind")}` : ""}`, method, type: (init?.headers as Record<string, string>)?.["Content-Type"], body });
      if (pathname.endsWith("/snapshot"))
        return failUploads ? Response.json({ error: "Snapshot storage is full" }, { status: 413 }) : Response.json({ ok: true }, { status: 201 });
      if (pathname === "/config") return Response.json(server);
      return method === "GET" ? new Promise<Response>(() => {}) : Response.json({ id: "thread-1", commentId: "comment-1" });
    }));
  });
  afterEach(() => {
    controller?.destroy();
    controller = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function post(snapshots: CommentsOptions["snapshots"], verified = true, wrap = "") {
    const { CommentsApi } = await import("../src/api");
    const config: CommentsOptions = { endpoint: "https://example.test", project: "fixture", repo: "fixture", branch: "main", snapshots };
    const user = { id: "reviewer", name: "Reviewer", verified };
    new CommentsApi(config).save({ token: "session", user });
    const fetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    const respond = fetch.getMockImplementation()!;
    fetch.mockImplementation((url: URL, init?: RequestInit) =>
      new URL(url).pathname === "/me" ? (requests.push({ path: "/me", method: "GET" }), Promise.resolve(Response.json({ user }))) : respond(url, init));
    const target = document.createElement("article");
    target.id = "target";
    target.innerHTML = `<h2>Card</h2><input value="secret">`;
    const holder = document.createElement("main");
    holder.innerHTML = wrap;
    (holder.querySelector("[data-slot]") ?? holder).append(target);
    document.body.append(holder);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this === target ? new DOMRect(10, 10, 400, 300) : measureRect.call(this);
    });
    controller = initComments(config);
    // Capture waits for the server's snapshot support.
    await vi.waitFor(() => expect(requests.some((request) => request.path === "/config")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const shadow = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
    controller.comment(target);
    const input = shadow.querySelector<HTMLTextAreaElement>('[data-focus-key="body"]')!;
    input.value = "Tighten the heading";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(requests.some((request) => request.path === "/threads" && request.method === "POST")).toBe(true));
    // Give a capture and upload every chance to run.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return requests.filter((request) => request.path.includes("/snapshot"));
  }

  it("is off by default", async () => {
    expect(await post(undefined)).toEqual([]);
  });

  it("stays off until a kind is turned on", async () => {
    expect(await post({ maxBytes: 1000 })).toEqual([]);
  });

  it("uploads the trimmed HTML as text/html after the thread is created for signed-in reviewers", async () => {
    const uploads = await post({ html: true });
    expect(uploads).toEqual([{ path: "/threads/thread-1/snapshot?kind=html", method: "POST", type: "text/html;charset=utf-8", body: expect.stringContaining("<h2>Card</h2>") }]);
    expect(uploads[0]!.body).not.toContain("secret");
    const order = requests.map((request) => request.path);
    expect(order.indexOf("/threads")).toBeLessThan(order.indexOf("/threads/thread-1/snapshot?kind=html"));
  });

  it("skips servers without snapshot support", async () => {
    delete server.snapshots;
    expect(await post({ html: true })).toEqual([]);
  });

  it("skips guests unless the server allows them", async () => {
    expect(await post({ html: true, image: true }, false)).toEqual([]);
    controller!.destroy();
    controller = undefined;
    document.body.replaceChildren();
    requests = [];
    server.snapshots = { guests: true, maxImageBytes: 262_144, maxHtmlBytes: 32_768 };
    expect((await post({ html: true }, false)).map((request) => request.path)).toEqual(["/threads/thread-1/snapshot?kind=html"]);
  });

  it("skips a target inside data-komo-no-snapshot", async () => {
    expect(await post({ html: true }, true, `<div data-komo-no-snapshot><div data-slot></div></div>`)).toEqual([]);
  });

  it("still posts the comment when the upload fails", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    failUploads = true;
    const uploads = await post({ html: true });
    expect(uploads).toHaveLength(1);
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith("komo: the comment posted without its html snapshot.", "Snapshot storage is full"));
    const shadow = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
    expect(shadow.textContent).not.toContain("Couldn't save");
  });
});
