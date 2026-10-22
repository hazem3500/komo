// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { allPages, inPersistentRegion, threadOnPage } from "../src/thread-scope";
import { agentPrompt } from "../src/agent-prompt";
import { CommentsApi } from "../src/api";
import type { Thread } from "../src/types";

const anchor = {
  selector: "[data-sidebar] a",
  text: "Reports",
  x: 0.5,
  y: 0.5,
  width: 0,
  height: 0,
  pageX: 10,
  pageY: 10,
  viewportWidth: 1280,
};
const thread = (id: string, page: string, scope?: string): Thread => ({
  id,
  page,
  anchor,
  resolved: false,
  resolvedBy: null,
  createdAt: 1,
  updatedAt: 1,
  ...(scope === undefined ? {} : { scope: scope as Thread["scope"] }),
  comments: [
    {
      id: `${id}-comment`,
      body: `Feedback ${id}`,
      author: { id: "reviewer", name: "Reviewer", verified: true },
      createdAt: 1,
      editedAt: null,
      reactions: {},
    },
  ],
});

describe("persistent regions", () => {
  afterEach(() => document.body.replaceChildren());
  it("matches elements inside configured selectors or a custom test", () => {
    document.body.innerHTML =
      '<header><button id="menu">Menu</button></header><aside data-sidebar><a id="link">Reports</a></aside><main><p id="body">Copy</p></main>';
    const at = (id: string) => document.getElementById(id)!;
    const regions = { persistentRegions: ["header", "[data-sidebar]"] };
    expect(inPersistentRegion(at("menu"), regions)).toBe(true);
    expect(inPersistentRegion(at("link"), regions)).toBe(true);
    expect(inPersistentRegion(at("body"), regions)).toBe(false);
    expect(inPersistentRegion(at("body"), {})).toBe(false);
    expect(
      inPersistentRegion(at("body"), { isPersistent: (element) => element.id === "body" }),
    ).toBe(true);
  });
  it("skips invalid selectors instead of failing the comment", () => {
    document.body.innerHTML = '<nav><a id="link">Home</a></nav>';
    const link = document.getElementById("link")!;
    expect(inPersistentRegion(link, { persistentRegions: ["[[invalid", "nav"] })).toBe(true);
    expect(inPersistentRegion(link, { persistentRegions: ["[[invalid"] })).toBe(false);
  });
});

describe("thread page membership", () => {
  it("treats only scope all as every page, so old and unknown records stay on their page", () => {
    expect(allPages(thread("legacy", "/a"))).toBe(false);
    expect(allPages(thread("page", "/a", "page"))).toBe(false);
    expect(allPages(thread("future", "/a", "workspace"))).toBe(false);
    expect(allPages(thread("all", "/a", "all"))).toBe(true);
  });
  it("shows all-pages threads only where their anchor resolves", () => {
    const resolves = vi.fn((value: unknown) => value === anchor);
    const missing = () => null;
    expect(threadOnPage(thread("all", "/a", "all"), "/b", resolves)).toBe(true);
    expect(threadOnPage(thread("all", "/a", "all"), "/b", missing)).toBe(false);
    // Its own page always includes it, so a missing element still reads as not found there.
    expect(threadOnPage(thread("all", "/a", "all"), "/a", missing)).toBe(true);
    resolves.mockClear();
    expect(threadOnPage(thread("page", "/a"), "/b", resolves)).toBe(false);
    expect(threadOnPage(thread("page", "/a"), "/a", missing)).toBe(true);
    expect(resolves).not.toHaveBeenCalled();
  });
  it("counts each thread once across a page filter", () => {
    const threads = [thread("all", "/a", "all"), thread("a", "/a"), thread("b", "/b")];
    const here = (page: string) =>
      threads.filter((item) => threadOnPage(item, page, () => true)).map((item) => item.id);
    expect(here("/a")).toEqual(["all", "a"]);
    expect(here("/b")).toEqual(["all", "b"]);
    expect(threads.filter((item) => !item.resolved)).toHaveLength(3);
  });
});

describe("agent prompt", () => {
  const context = { project: "review", repo: "team/site", branch: "main", origin: "https://preview.example.com" };
  it("labels all-pages threads and keeps them in a page prompt under their own page", () => {
    const prompt = agentPrompt([thread("all", "/a", "all"), thread("other", "/a")], { ...context, page: "/b" })!;
    expect(prompt).toContain('### Thread "all"');
    expect(prompt).toContain('## Page "/a"');
    expect(prompt).toContain("Shown on: all pages with this target");
    expect(prompt).not.toContain('### Thread "other"');
    expect(agentPrompt([thread("other", "/a")], context)).not.toContain("Shown on:");
  });
});

describe("cached thread scope", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("accepts scoped, legacy, and unknown-scope threads from the API and cache", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    const threads = [thread("all", "/a", "all"), thread("legacy", "/a"), thread("future", "/a", "workspace")];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ threads, revision: 1 })));
    const options = { endpoint: "https://example.com/api/", project: "scope", repo: "team/site", branch: "main" };
    expect(await new CommentsApi(options).list()).toEqual(threads);
    await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    expect(new CommentsApi(options).cached()).toEqual(threads);
  });
});
