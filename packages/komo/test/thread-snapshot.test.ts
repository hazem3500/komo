// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotContext } from "../src/thread-snapshot";
import type { Thread } from "../src/types";

const origin = "https://comments.example.test";
let host: HTMLElement;
let root: ShadowRoot;
let counter = 0;
const url = (kind: "image" | "html", version = 1) => `${origin}/threads/t${++counter}/snapshot/${kind}?project=p&v=${version}`;
const context = (overrides: Partial<SnapshotContext> = {}): SnapshotContext => ({
  root,
  token: () => "session-token",
  origin: () => origin,
  dropped: new WeakSet(),
  go: vi.fn(),
  notify: vi.fn(),
  remove: vi.fn(),
  ...overrides,
});
const thread = (snapshot?: Thread["snapshot"], anchor: Partial<Thread["anchor"]> = {}): Thread => ({
  id: "thread-1",
  page: "/pricing",
  resolved: false,
  resolvedBy: null,
  createdAt: 1,
  updatedAt: 1,
  anchor: { selector: "#cta", text: "Start building", x: 0, y: 0, width: 0, height: 0, pageX: 0, pageY: 0, viewportWidth: 1280, ...anchor },
  comments: [],
  ...(snapshot ? { snapshot } : {}),
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Each test gets the module fresh: its read cache and rate limit are module state.
let confirmRemove: typeof import("../src/thread-snapshot").confirmRemove;
let disposeSnapshots: typeof import("../src/thread-snapshot").disposeSnapshots;
let mountSnapshot: typeof import("../src/thread-snapshot").mountSnapshot;
let readSnapshot: typeof import("../src/thread-snapshot").readSnapshot;
let snapshotAlt: typeof import("../src/thread-snapshot").snapshotAlt;
let splitNote: typeof import("../src/thread-snapshot").splitNote;
let READS_PER_MINUTE: number;
const found = <T,>(value: T | null | undefined): T => {
  if (!value) throw new Error("Not rendered yet");
  return value;
};

beforeEach(async () => {
  vi.resetModules();
  ({ confirmRemove, disposeSnapshots, mountSnapshot, readSnapshot, snapshotAlt, splitNote, READS_PER_MINUTE } = await import("../src/thread-snapshot"));
  host = document.createElement("div");
  document.body.append(host);
  root = host.attachShadow({ mode: "open" });
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:${origin}/${++next}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("snapshot reads", () => {
  it("send the bearer token, and never send it to another origin", async () => {
    const fetch = vi.fn(async () => new Response("png", { status: 200, headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", fetch);
    const own = url("image");
    expect((await readSnapshot(own, context()))?.size).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [target, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(target)).toBe(own);
    expect(init.headers).toEqual({ Authorization: "Bearer session-token" });
    expect(init.credentials).toBe("omit");
    expect(await readSnapshot("https://elsewhere.example.test/threads/x/snapshot/image?v=1", context())).toBeNull();
    expect(await readSnapshot("not a url", context())).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("are cached per URL and version; a missing snapshot stays missing, a failure retries", async () => {
    const statuses = [200, 200, 404, 500, 200];
    const fetch = vi.fn(async () => new Response("x", { status: statuses.shift() }));
    vi.stubGlobal("fetch", fetch);
    const first = url("image", 1);
    await readSnapshot(first, context());
    await readSnapshot(first, context());
    expect(fetch).toHaveBeenCalledTimes(1);
    // A replaced snapshot has a new v=, and another session reads its own copy.
    await readSnapshot(first.replace("v=1", "v=2"), context());
    expect(fetch).toHaveBeenCalledTimes(2);
    statuses.unshift(200);
    await readSnapshot(first, context({ token: () => "another-session" }));
    expect(fetch).toHaveBeenCalledTimes(3);
    const missing = url("image");
    expect(await readSnapshot(missing, context())).toBeNull();
    expect(await readSnapshot(missing, context())).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(4);
    const flaky = url("image");
    await expect(readSnapshot(flaky, context())).rejects.toThrow("500");
    await flush();
    expect(await readSnapshot(flaky, context())).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("start at most 20 a minute, two at a time, and only with a session", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    const fetch = vi.fn(async () => new Response("x"));
    vi.stubGlobal("fetch", fetch);
    const reads = Array.from({ length: READS_PER_MINUTE + 5 }, () => readSnapshot(url("image"), context()));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(READS_PER_MINUTE);
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all(reads);
    expect(fetch).toHaveBeenCalledTimes(READS_PER_MINUTE + 5);
    // Signed out: nothing is read.
    expect(await readSnapshot(url("image"), context({ token: () => null }))).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(READS_PER_MINUTE + 5);
  });
});

describe("snapshot UI", () => {
  it("names what the snapshot shows", () => {
    expect(snapshotAlt(thread())).toBe("Snapshot of “Start building” when the comment was left");
    expect(snapshotAlt(thread(undefined, { text: "", context: { tag: "button" } }))).toBe("Snapshot of the button element when the comment was left");
    expect(snapshotAlt(thread(undefined, { text: "" }))).toBe("Snapshot of the commented element when the comment was left");
    expect(snapshotAlt(thread(undefined, { text: "x".repeat(100) }))).toContain("…”");
  });

  it("splits the missing-image note from the markup", () => {
    expect(splitNote("<!-- komo: no image snapshot, the element shows images from another origin. --><p>Hi</p>")).toEqual({
      note: "No image snapshot, the element shows images from another origin.",
      code: "<p>Hi</p>",
    });
    expect(splitNote("<p>Hi</p>")).toEqual({ note: "", code: "<p>Hi</p>" });
  });

  it("mounts a thumbnail through a blob URL and revokes it once unmounted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("png", { headers: { "Content-Type": "image/png" } })));
    const slot = document.createElement("div");
    root.append(slot);
    mountSnapshot(slot, context(), 1, thread({ image: url("image") }));
    const image = root.querySelector<HTMLImageElement>(".komo-snapshot img")!;
    expect(image.alt).toBe("Snapshot of “Start building” when the comment was left");
    await vi.waitFor(() => expect(found(image.getAttribute("src"))).toMatch(/^blob:/));
    const src = image.src;
    image.closest("button")!.remove();
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith(src));
    expect(image.hasAttribute("src")).toBe(false);
  });

  it("revokes every blob URL in a root when komo unmounts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("png")));
    const slot = document.createElement("div");
    root.append(slot);
    mountSnapshot(slot, context(), 0, thread({ image: url("image") }));
    const image = root.querySelector<HTMLImageElement>(".komo-snapshot img")!;
    await vi.waitFor(() => expect(found(image.getAttribute("src"))).toMatch(/^blob:/));
    const src = image.src;
    disposeSnapshots(root);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(src);
  });

  it("leaves list rows without an image empty and skips threads from older servers", () => {
    vi.stubGlobal("fetch", vi.fn());
    for (const [mode, snapshot] of [[0, { html: url("html") }], [1, undefined], [2, undefined]] as const) {
      const slot = document.createElement("div");
      root.append(slot);
      mountSnapshot(slot, context(), mode, thread(snapshot));
      expect(slot.isConnected).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows HTML only as text, with its note, in the not-found fallback", async () => {
    const markup = `<!-- komo: no image snapshot, the element shows images from another origin. --><b id="bold">Bold</b><img src="x" onerror="window.hit=1">`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(markup, { headers: { "Content-Type": "text/plain" } })));
    const slot = document.createElement("div");
    root.append(slot);
    const go = vi.fn();
    mountSnapshot(slot, context({ go }), 4, thread({ html: url("html") }));
    const code = await vi.waitFor(() => found(root.querySelector("pre.komo-snapshot-code")));
    expect(code.textContent).toBe(`<b id="bold">Bold</b><img src="x" onerror="window.hit=1">`);
    expect(root.querySelector("#bold, pre img")).toBeNull();
    expect(root.textContent).toContain("No image snapshot, the element shows images from another origin.");
    const route = root.querySelector<HTMLAnchorElement>("a.thread-route")!;
    expect(route.textContent).toBe("/pricing");
    expect(route.href).toBe(`${location.origin}/pricing?comment=thread-1`);
    route.click();
    expect(go).toHaveBeenCalledWith(new URL(`${location.origin}/pricing?comment=thread-1`));
  });

  it("previews a pending capture and drops it on request", async () => {
    const dropped = new WeakSet<Thread["anchor"]>();
    const form = document.createElement("form");
    const input = document.createElement("textarea");
    const slot = document.createElement("div");
    form.append(input, slot);
    root.append(form);
    const anchor = thread().anchor;
    mountSnapshot(slot, context({ dropped }), 3, { anchor, page: "", id: "" }, Promise.resolve({ image: "data:image/webp;base64,AAAA", html: "<p>x</p>" }));
    const row = await vi.waitFor(() => found(root.querySelector(".komo-snapshot-draft")));
    expect(row.textContent).toContain("Snapshot and HTML attached");
    row.querySelector<HTMLButtonElement>('[aria-label="Remove snapshot"]')!.click();
    expect(dropped.has(anchor)).toBe(true);
    expect(row.isConnected).toBe(false);
    expect(root.activeElement).toBe(input);
  });

  it("confirms before removing a snapshot", () => {
    const notify = vi.fn();
    const remove = vi.fn();
    const item = thread({ image: url("image") });
    confirmRemove(item, context({ notify, remove }));
    expect(remove).not.toHaveBeenCalled();
    const [text, action] = notify.mock.calls[0]!;
    expect(text).toBe("Remove this comment’s snapshot?");
    action.run();
    expect(remove).toHaveBeenCalledWith(item);
    expect(notify).toHaveBeenLastCalledWith("Snapshot removed");
  });
});
