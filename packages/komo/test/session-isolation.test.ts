import { JSDOM, CookieJar } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { CommentsApi } from "../src/api";

const options = {
  endpoint: "https://api.example.test",
  project: "project",
  repo: "repo",
  branch: "main",
};
const user = { id: "reviewer", name: "Reviewer", verified: true };
const windows: JSDOM[] = [];
function page(
  url = "https://preview.account.workers.dev",
  cookieJar = new CookieJar(),
) {
  const dom = new JSDOM("", { url, cookieJar });
  windows.push(dom);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("location", dom.window.location);
  vi.stubGlobal("localStorage", dom.window.localStorage);
  return dom;
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const dom of windows.splice(0)) dom.window.close();
});
it("keeps default sessions out of sibling scripts and HTTP requests", () => {
  const jar = new CookieJar();
  page(undefined, jar);
  new CommentsApi(options).save({ token: "private-session", user });
  expect(new CommentsApi(options).token).toBe("private-session");
  const sibling = page("https://unrelated.account.workers.dev", jar);
  expect(sibling.window.document.cookie).toBe("");
  expect(
    jar.getCookieStringSync("https://unrelated.account.workers.dev/"),
  ).toBe("");
  expect(new CommentsApi(options).token).toBeNull();
});
it("isolates endpoint and project tokens on the same host", () => {
  page();
  new CommentsApi(options).save({ token: "first-api", user });
  const other = { ...options, endpoint: "https://different.example.test" };
  expect(new CommentsApi(other).token).toBeNull();
  expect(new CommentsApi({ ...options, project: "another" }).token).toBeNull();
  new CommentsApi(other).save({ token: "second-api", user });
  expect(new CommentsApi(options).token).toBe("first-api");
  expect(new CommentsApi(other).token).toBe("second-api");
});
it("shares only explicitly trusted parent domains with the same endpoint and project", () => {
  const jar = new CookieJar();
  page(undefined, jar);
  const shared = { ...options, sessionDomain: ".account.workers.dev" };
  new CommentsApi(shared).save({ token: "shared-session", user });
  page("https://another.account.workers.dev", jar);
  expect(
    new CommentsApi({ ...shared, endpoint: `${options.endpoint}/` }).token,
  ).toBe("shared-session");
  expect(new CommentsApi({ ...shared, project: "another" }).token).toBeNull();
  page("https://preview.other-account.workers.dev", jar);
  expect(new CommentsApi(shared).token).toBeNull();
});
it("saves and restores the cookie when localStorage is blocked", () => {
  page();
  const blocked = () => {
    throw new DOMException("Blocked", "SecurityError");
  };
  vi.stubGlobal("localStorage", {
    getItem: blocked,
    setItem: blocked,
    removeItem: blocked,
  });
  new CommentsApi(options).save({ token: "cookie-only", user });
  expect(new CommentsApi(options).token).toBe("cookie-only");
});
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
      id: "comment",
      body: "Feedback",
      author: user,
      createdAt: 1,
      editedAt: null,
      reactions: {},
    },
  ],
});
it("separates repository/branch tuples that previously collided on colons", async () => {
  page();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ threads: [thread("one")], revision: 1 }),
      )
      .mockResolvedValueOnce(
        Response.json({ threads: [thread("two")], revision: 2 }),
      ),
  );
  const first = { ...options, repo: "repo:topic", branch: "main" };
  const second = { ...options, repo: "repo", branch: "topic:main" };
  await new CommentsApi(first).list();
  await new CommentsApi(second).list();
  expect(new CommentsApi(first).cached()?.[0].id).toBe("one");
  expect(new CommentsApi(second).cached()?.[0].id).toBe("two");
});
it("logout removes every branch snapshot and legacy cache for this session only", async () => {
  const dom = page();
  const api = new CommentsApi(options);
  api.save({ token: "signed-in", user });
  const prefix = `palette:${options.endpoint}:${options.project}`;
  const store = dom.window.localStorage;
  store.setItem(`${prefix}:["repo","main"]:threads`, "private-main");
  store.setItem(`${prefix}:["repo","feature"]:threads`, "private-feature");
  store.setItem(`${prefix}:repo:legacy:threads`, "private-legacy");
  store.setItem(`${prefix}-different`, "other-project-session");
  store.setItem("host-app-setting", "keep");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ok: true })),
  );
  await api.logout();
  expect(
    Object.keys(store).filter(
      (key) => key === prefix || key.startsWith(`${prefix}:`),
    ),
  ).toEqual([]);
  expect(new CommentsApi(options).token).toBeNull();
  expect(store.getItem(`${prefix}-different`)).toBe("other-project-session");
  expect(store.getItem("host-app-setting")).toBe("keep");
});
it("never adopts a legacy project-only cookie and retains only endpoint-scoped local fallback", () => {
  const jar = new CookieJar();
  const dom = page(undefined, jar);
  dom.window.document.cookie =
    "bc-session-project=unscoped-token; Path=/; Domain=account.workers.dev; Secure";
  expect(new CommentsApi(options).token).toBeNull();
  expect(dom.window.document.cookie).not.toContain("bc-session-project=");
  dom.window.localStorage.setItem(
    `palette:${options.endpoint}:${options.project}`,
    "scoped-token",
  );
  expect(new CommentsApi(options).token).toBe("scoped-token");
  expect(
    new CommentsApi({ ...options, endpoint: "https://different.example.test" })
      .token,
  ).toBeNull();
});
it("restores the scoped local session when the cookie getter is blocked", () => {
  const dom = page();
  dom.window.localStorage.setItem(
    `palette:${options.endpoint}:${options.project}`,
    "local-session",
  );
  Object.defineProperty(dom.window.document, "cookie", {
    get() {
      throw new DOMException("Blocked", "SecurityError");
    },
    set() {
      throw new DOMException("Blocked", "SecurityError");
    },
  });
  expect(new CommentsApi(options).token).toBe("local-session");
});
it("stays signed out and does not restore private caches when remote logout fails", async () => {
  page();
  const api = new CommentsApi(options);
  api.save({ token: "signed-in", user });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Offline")));
  await expect(api.logout()).rejects.toThrow();
  expect(api.token).toBeNull();
  expect(api.user).toBeNull();
  expect(new CommentsApi(options).token).toBeNull();
  expect(new CommentsApi(options).cached()).toBeNull();
});

it("keeps HTTP development sessions in local storage instead of cookies sent to every port", () => {
  const dom = page("http://localhost:3000");
  new CommentsApi(options).save({ token: "local-dev", user });
  expect(dom.window.document.cookie).toBe("");
  expect(new CommentsApi(options).token).toBe("local-dev");
});

it("shared logout prevents another preview's local fallback from reviving the session", async () => {
  const jar = new CookieJar();
  const first = page(undefined, jar);
  const shared = { ...options, sessionDomain: "account.workers.dev" };
  new CommentsApi(shared).save({ token: "shared", user });
  page("https://second.account.workers.dev", jar);
  const second = new CommentsApi(shared);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true })));
  await second.logout();
  vi.stubGlobal("document", first.window.document);
  vi.stubGlobal("location", first.window.location);
  vi.stubGlobal("localStorage", first.window.localStorage);
  expect(first.window.localStorage.getItem(`palette:${options.endpoint}:${options.project}`)).toBe("shared");
  expect(new CommentsApi(shared).token).toBeNull();
  expect(new CommentsApi(shared).user).toBeNull();
  expect(first.window.localStorage.getItem(`palette:${options.endpoint}:${options.project}`)).toBeNull();
});

it("marks memory-only sessions so a focus check cannot mistake blocked persistence for logout", () => {
  page("http://localhost:3000");
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("Blocked"); }, removeItem: () => {} });
  const api = new CommentsApi(options);
  api.save({ token: "memory-only", user });
  expect(api.transient).toBe(true);
  expect(api.token).toBe("memory-only");
  expect(new CommentsApi(options).token).toBeNull();
});

it("migrates a previously validated endpoint-scoped account snapshot without trusting legacy cookies", async () => {
  const dom = page();
  const key = `palette:${options.endpoint}:${options.project}`;
  dom.window.localStorage.setItem(`${key}:user`, JSON.stringify({ token: "known-session", user }));
  const api = new CommentsApi(options);
  expect(api.token).toBe("known-session");
  expect(api.user).toEqual(user);
  expect(new CommentsApi({ ...options, endpoint: "https://other.test" }).token).toBeNull();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ user })));
  await api.restore();
  expect(dom.window.localStorage.getItem(key)).toBe("known-session");
  expect(dom.window.document.cookie).toContain("__Host-bc-session-");
});
