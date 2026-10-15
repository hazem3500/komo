import { afterEach, expect, it, vi } from "vitest";
import { CommentsApi } from "../src/api";

const thread = (id: string) => ({
  id,
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
      id: "c1",
      body: "Feedback",
      author: { id: "u1", name: "Ty", verified: true },
      createdAt: 1,
      editedAt: null,
      reactions: {},
    },
  ],
});
afterEach(() => vi.unstubAllGlobals());
it("keeps an in-flight public config read alive after an anonymous 401", async () => {
  vi.stubGlobal("location", { hostname: "localhost", protocol: "http:" });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("localStorage", { getItem: () => null });
  let finishConfig!: (response: Response) => void;
  let configSignal!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: URL, init: RequestInit) => {
      if (url.pathname.endsWith("/config")) {
        configSignal = init.signal!;
        return new Promise<Response>((resolve) => {
          finishConfig = resolve;
        });
      }
      return Promise.resolve(
        Response.json({ error: "Sign in required" }, { status: 401 }),
      );
    }),
  );
  const api = new CommentsApi({
    endpoint: "https://example.com/api/",
    project: "test",
    repo: "test",
    branch: "main",
  });
  const config = api.request<{ google: boolean }>("config");
  const list = api.list();
  await expect(list).rejects.toMatchObject({ status: 401 });
  expect(configSignal.aborted).toBe(false);
  finishConfig(Response.json({ google: true }));
  await expect(config).resolves.toEqual({ google: true });
  expect(api.token).toBeNull();
});

it("clears an expired token but not a newer session on stale 401", async () => {
  vi.stubGlobal("location", { hostname: "localhost", protocol: "http:" });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  });
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const api = new CommentsApi({
    endpoint: "https://example.com/",
    project: "test",
    repo: "test",
    branch: "main",
  });
  const user = { id: "u1", name: "Ty", verified: true };
  api.save({ token: "old", user });
  const stale = api.request("me", "POST");
  api.save({ token: "new", user });
  finish(Response.json({ error: "Expired" }, { status: 401 }));
  await expect(stale).rejects.toMatchObject({ status: 401 });
  expect(api.token).toBe("new");
  const expired = api.request("me", "POST");
  finish(Response.json({ error: "Expired" }, { status: 401 }));
  await expect(expired).rejects.toMatchObject({ status: 401 });
  expect(api.token).toBeNull();
});
it("reuses the revision cache and replaces it when comments change", async () => {
  vi.stubGlobal("location", { hostname: "localhost" });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("localStorage", { getItem: () => null });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ threads: [thread("first")], revision: 1 }),
    )
    .mockResolvedValueOnce(Response.json({ notModified: true }))
    .mockResolvedValueOnce(
      Response.json({ threads: [thread("second")], revision: 2 }),
    );
  vi.stubGlobal("fetch", fetch);
  const api = new CommentsApi({
    endpoint: "https://example.com/api/",
    project: "test",
    repo: "test",
    branch: "main",
  });
  const first = await api.list();
  expect(await api.list()).toBe(first);
  expect(fetch.mock.calls[1][0].searchParams.get("revision")).toBe("1");
  const changed = await api.list();
  expect(changed).not.toBe(first);
  expect(changed).toEqual([thread("second")]);
});

it("explains network and CORS failures without claiming the cause is known", async () => {
  vi.stubGlobal("location", { hostname: "localhost" });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  );
  const api = new CommentsApi({
    endpoint: "https://example.com",
    project: "test",
    repo: "test",
    branch: "shared",
  });
  await expect(api.request("config")).rejects.toThrow(
    "Can’t connect to comments.",
  );
});

it("persists the last list so a new page load reuses it", async () => {
  const store = new Map<string, string>();
  vi.stubGlobal("location", { hostname: "localhost" });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ threads: [thread("first")], revision: 1 }),
    )
    .mockResolvedValueOnce(Response.json({ notModified: true }));
  vi.stubGlobal("fetch", fetch);
  const options = {
    endpoint: "https://example.com/api/",
    project: "test",
    repo: "test",
    branch: "main",
  };
  await new CommentsApi(options).list();
  const reloaded = new CommentsApi(options);
  expect(reloaded.cached()).toEqual([thread("first")]);
  expect(await reloaded.list()).toEqual([thread("first")]);
  expect(fetch.mock.calls[1][0].searchParams.get("revision")).toBe("1");
  expect(new CommentsApi({ ...options, branch: "other" }).cached()).toBeNull();
  reloaded.clear();
  expect(new CommentsApi(options).cached()).toBeNull();
});

it("remembers the signed-in account for the same token", () => {
  const store = new Map<string, string>();
  vi.stubGlobal("location", { hostname: "localhost", protocol: "http:" });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  const options = {
    endpoint: "https://example.com/api/",
    project: "test",
    repo: "test",
    branch: "main",
  };
  const user = { id: "u1", name: "Ty", verified: true };
  new CommentsApi(options).save({ token: "t1", user } as never);
  expect(new CommentsApi(options).user).toEqual(user);
  store.set(
    "branch-comments:https://example.com/api/:test:user",
    JSON.stringify({ token: "t1", user: { name: null } }),
  );
  expect(new CommentsApi(options).user).toBeNull();
  store.set("branch-comments:https://example.com/api/:test:user", "{broken");
  expect(new CommentsApi(options).token).toBe("t1");
  new CommentsApi(options).clear();
  expect(new CommentsApi(options).user).toBeNull();
});

it("discards a previous account's in-flight list before caching", async () => {
  const store = new Map<string, string>();
  vi.stubGlobal("location", { hostname: "localhost", protocol: "http:" });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  let finish!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(
      Response.json({ threads: [thread("public")], revision: 2 }),
    );
  vi.stubGlobal("fetch", fetch);
  const options = {
    endpoint: "https://example.com/api/",
    project: "test",
    repo: "test",
    branch: "main",
  };
  const api = new CommentsApi(options);
  api.save({
    token: "private",
    user: { id: "u1", name: "Ty", verified: true },
  } as never);
  const pending = api.list();
  api.clear();
  finish(Response.json({ threads: [thread("private")], revision: 1 }));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(await api.list()).toEqual([thread("public")]);
  expect(fetch.mock.calls[1][1].headers.Authorization).toBeUndefined();
  expect(new CommentsApi(options).cached()).toEqual([thread("public")]);
});

it("rejects invalid refreshes without overwriting the last healthy cache", async () => {
  const store = new Map<string, string>();
  vi.stubGlobal("location", { hostname: "localhost" });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  const options = {
    endpoint: "https://example.com/",
    project: "test",
    repo: "test",
    branch: "main",
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ threads: [thread("healthy")], revision: 1 }),
    );
  vi.stubGlobal("fetch", fetch);
  const api = new CommentsApi(options);
  const healthy = await api.list();
  for (const response of [
    new Response("not json"),
    Response.json(null),
    Response.json({}),
    Response.json({ threads: [null] }),
    Response.json({
      threads: [
        {
          ...thread("broken"),
          anchor: {
            ...thread("broken").anchor,
            context: { label: { nested: "invalid" } },
          },
        },
      ],
    }),
    Response.json({ threads: [], next: 0 }),
  ]) {
    fetch.mockResolvedValueOnce(response);
    await expect(api.list()).rejects.toThrow("Could not read comments");
    expect(new CommentsApi(options).cached()).toEqual(healthy);
  }
  fetch.mockResolvedValueOnce(Response.json({ notModified: true }));
  expect(await api.list()).toBe(healthy);
  const key = [...store.keys()].find((key) => key.endsWith(":threads"))!;
  for (const threads of [
    [null],
    [{ ...thread("broken"), comments: [null] }],
    [{ ...thread("broken"), anchor: null }],
    ...[
      null,
      [],
      { label: 4 },
      { scope: "x".repeat(2001) },
      { unexpected: "x" },
    ].map((context) => [
      { ...thread("broken"), anchor: { ...thread("broken").anchor, context } },
    ]),
  ]) {
    store.set(key, JSON.stringify({ token: "", revision: 1, threads }));
    expect(new CommentsApi(options).cached()).toBeNull();
  }
});

it("preserves identity on invalid restore and clears only denied thread snapshots", async () => {
  const store = new Map<string, string>();
  vi.stubGlobal("location", { hostname: "localhost" });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  const options = {
    endpoint: "https://example.com/",
    project: "test",
    repo: "test",
    branch: "main",
  };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const api = new CommentsApi(options);
  const user = { id: "u1", name: "Ty", verified: true };
  api.save({ token: "t1", user });
  fetch.mockResolvedValueOnce(Response.json({}));
  await expect(api.restore()).rejects.toThrow("Could not read comments");
  expect(api.user).toEqual(user);
  expect(new CommentsApi(options).user).toEqual(user);
  fetch.mockResolvedValueOnce(
    Response.json({ threads: [thread("private")], revision: 1 }),
  );
  const healthy = await api.list();
  fetch.mockResolvedValueOnce(
    Response.json({ error: "Forbidden" }, { status: 403 }),
  );
  await expect(api.request("usage")).rejects.toThrow("Forbidden");
  expect(new CommentsApi(options).cached()).toEqual(healthy);
  fetch.mockResolvedValueOnce(
    Response.json({ code: "site_not_approved" }, { status: 403 }),
  );
  await expect(api.list()).rejects.toThrow("Comments aren’t turned on");
  expect(new CommentsApi(options).cached()).toEqual([]);
  expect(api.user).toEqual(user);
  // A denied request from the former identity must not evict the new cache.
  let finish!: (response: Response) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const stale = api.list();
  api.save({ token: "t2", user });
  fetch.mockResolvedValueOnce(
    Response.json({ threads: [thread("current")], revision: 2 }),
  );
  const current = await api.list();
  finish(Response.json({ error: "Forbidden" }, { status: 403 }));
  await expect(stale).rejects.toMatchObject({ name: "AbortError" });
  expect(new CommentsApi(options).cached()).toEqual(current);
});

it("hydrates compact authors and bounds snapshots without reusing a partial revision", async () => {
  const store = new Map<string, string>();
  vi.stubGlobal("location", { hostname: "localhost", pathname: "/" });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  const options = {
    endpoint: "https://example.com/",
    project: "test",
    repo: "test",
    branch: "main",
  };
  const author = {
    id: "u1",
    name: "Ty",
    verified: true,
    avatarUrl: "x".repeat(12000),
  };
  const compact = Array.from({ length: 250 }, (_, i) => ({
    ...thread(String(i)),
    comments: [
      { ...thread("x").comments[0], author: "u1", body: "x".repeat(2000) },
    ],
  }));
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ threads: compact, authors: { u1: author }, revision: 4 }),
    );
  vi.stubGlobal("fetch", fetch);
  const api = new CommentsApi(options);
  const full = await api.list();
  expect(full).toHaveLength(250);
  expect(full[0].comments[0].author).toEqual(author);
  const serialized = [...store.values()][0];
  expect(serialized.length).toBeLessThan(251000);
  const snapshot = JSON.parse(serialized);
  expect(snapshot.revision).toBeUndefined();
  expect(Object.keys(snapshot.authors)).toEqual(["u1"]);
  const reloaded = new CommentsApi(options);
  expect(reloaded.cached()!.length).toBeGreaterThan(0);
  expect(reloaded.cached()!.length).toBeLessThan(250);
  fetch.mockResolvedValueOnce(Response.json({ threads: [], revision: 5 }));
  await reloaded.list();
  expect(fetch.mock.calls[1][0].searchParams.has("revision")).toBe(false);
});

it("cancels paginated reads without cancelling writes or persisting obsolete results", async () => {
  vi.stubGlobal("location", { hostname: "localhost" });
  vi.stubGlobal("document", { cookie: "" });
  const setItem = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem });
  const api = new CommentsApi({
    endpoint: "https://example.com/",
    project: "test",
    repo: "test",
    branch: "main",
  });
  let finish!: (response: Response) => void;
  const fetch = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const pending = api.list();
  const signal = fetch.mock.calls[0][1].signal as AbortSignal;
  api.cancelReads();
  expect(signal.aborted).toBe(true);
  finish(
    Response.json({ threads: [thread("obsolete")], next: 50, revision: 1 }),
  );
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(setItem).not.toHaveBeenCalled();
  const write = api.request("threads", "POST", {});
  const writeSignal = fetch.mock.calls[1][1].signal as AbortSignal;
  api.cancelReads();
  expect(writeSignal.aborted).toBe(false);
  finish(Response.json({ ok: true }));
  await expect(write).resolves.toEqual({ ok: true });
});

it("stops retrying cache writes after a storage quota failure", async () => {
  vi.stubGlobal("location", { hostname: "localhost" });
  vi.stubGlobal("document", { cookie: "" });
  const setItem = vi.fn(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem,
    removeItem: vi.fn(),
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ threads: [thread("first")], revision: 1 }),
      ),
  );
  const api = new CommentsApi({
    endpoint: "https://example.com/",
    project: "test",
    repo: "test",
    branch: "main",
  });
  await api.list();
  await api.list();
  expect(setItem).toHaveBeenCalledTimes(1);
});

it("does not turn an oversized thread into an empty project or lose shared author details", async () => {
  const store = new Map<string, string>();
  vi.stubGlobal("location", { hostname: "localhost", pathname: "/" });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  const options = {
    endpoint: "https://example.com/",
    project: "test",
    repo: "test",
    branch: "main",
  };
  const oversized = {
    ...thread("large"),
    comments: Array.from({ length: 80 }, (_, i) => ({
      ...thread("x").comments[0],
      id: String(i),
      body: "x".repeat(4000),
    })),
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ threads: [oversized], revision: 1 }),
    );
  vi.stubGlobal("fetch", fetch);
  const api = new CommentsApi(options);
  await api.list();
  expect(new CommentsApi(options).cached()).toBeNull();
  const first = {
    ...thread("first"),
    resolvedBy: { id: "u2", name: "A", verified: true },
  };
  const second = thread("second");
  const author = {
    id: "u2",
    name: "A",
    verified: true,
    avatarUrl: "https://example.com/avatar",
    accentColor: "#aabbcc",
  };
  second.comments[0].author = author;
  fetch.mockResolvedValueOnce(
    Response.json({ threads: [first, second], revision: 2 }),
  );
  await api.list();
  expect(new CommentsApi(options).cached()![1].comments[0].author).toEqual(
    author,
  );
});

it("prefers cursor continuation and falls back to legacy offsets", async () => {
  vi.stubGlobal("location", {hostname: "localhost"});
  vi.stubGlobal("document", {cookie: ""});
  vi.stubGlobal("localStorage", {getItem: () => null, setItem: vi.fn()});
  for (const cursor of ['[100,"first"]', undefined]) {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({threads: [thread("first")], next: 50, nextCursor: cursor, revision: 1}))
      .mockResolvedValueOnce(Response.json({threads: [thread("second")], next: null, revision: 1}));
    vi.stubGlobal("fetch", fetch);
    const api = new CommentsApi({endpoint: "https://example.com/", project: "test", repo: "test", branch: "main"});
    expect(await api.list()).toEqual([thread("first"), thread("second")]);
    const params = fetch.mock.calls[1][0].searchParams;
    expect(params.get("cursor")).toBe(cursor ?? null);
    expect(params.get("offset")).toBe("50");
  }
});
