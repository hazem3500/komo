// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { CommentsApi } from "../src/api";
import { originAllowed, sitePattern } from "../server/validation";
import { approvedSites, siteInput } from "../src/approved-sites";
import { editedOrigins } from "../server/project-sites";

const valid: Array<[string, string]> = [
  ["https://your-site.com", "https://your-site.com"],
  ["https://Your-Site.com/", "https://your-site.com"],
  ["https://*.your-site.com", "https://*.your-site.com"],
  [
    "https://*-komo-site.off-brand.workers.dev",
    "https://*-komo-site.off-brand.workers.dev",
  ],
  [
    "https://preview-*.your-site.com:8443",
    "https://preview-*.your-site.com:8443",
  ],
  ["http://localhost:4340", "http://localhost:4340"],
  ["https://dev.your-site.com:*", "https://dev.your-site.com:*"],
  ["https://*-preview.your-site.com:*", "https://*-preview.your-site.com:*"],
  ["http://localhost:*", "http://localhost:*"],
];
const invalid = [
  "https://your-site.com:3000:*",
  "https://your-site.com:4*",
  "https://*.com:*",
  "https://*.com",
  "https://*",
  "https://a.*.your-site.com",
  "https://**.your-site.com",
  "https://*-a-*.your-site.com",
  "http://your-site.com",
  "https://your-site.com/path",
  "https://user@your-site.com",
  "https://your-site.com?x=1",
  "javascript:alert(1)",
];

describe("approved site patterns", () => {
  it("accepts exact origins, localhost, and leftmost-label wildcards", () => {
    for (const [input, site] of valid) expect(sitePattern(input)).toBe(site);
  });
  it("rejects broad, nested, or non-origin patterns", () => {
    for (const input of invalid)
      expect(() => sitePattern(input), input).toThrow();
    expect(() => sitePattern(42)).toThrow();
  });
  it("matches the saved preview wildcard against branch previews only", () => {
    const sites = [sitePattern("https://*-komo-site.off-brand.workers.dev")];
    expect(
      originAllowed(
        "https://feature-edge-sidebar-komo-site.off-brand.workers.dev",
        sites
      )
    ).toBe(true);
    expect(
      originAllowed("https://komo-site.off-brand.workers.dev", sites)
    ).toBe(false);
    expect(
      originAllowed("https://x.y-komo-site.off-brand.workers.dev", sites)
    ).toBe(false);
    expect(
      originAllowed(
        "https://evil-komo-site.off-brand.workers.dev.evil.com",
        sites
      )
    ).toBe(false);
  });
  it("normalizes typed sites the same way in the editor", () => {
    for (const [input, site] of valid) expect(siteInput(input)).toBe(site);
    expect(siteInput("your-site.com")).toBe("https://your-site.com");
    expect(siteInput("*-preview.your-site.com")).toBe(
      "https://*-preview.your-site.com"
    );
    for (const input of invalid.filter(
      (value) => value !== "http://your-site.com"
    ))
      expect(() => siteInput(input), input).toThrow();
  });
});

describe("approved sites editor", () => {
  const fakeApi = (fail = false) => {
    const calls: Array<[string, string, unknown]> = [];
    let sites = ["https://example.com", "https://preview.example.com"];
    const api = {
      async request(path: string, method = "GET", data?: { sites: string[] }) {
        calls.push([path, method, data]);
        if (method === "PATCH") {
          if (fail) throw new Error("You can’t remove the site you’re on.");
          sites = data!.sites;
        }
        return { sites, fixed: [] };
      },
    } as unknown as CommentsApi;
    return { api, calls };
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve));
  const labels = (root: HTMLElement) =>
    [...root.querySelectorAll(".approved-site > span")].map(
      (n) => n.textContent
    );
  const toggle = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>(".approved-sites-toggle")!;

  it("starts collapsed and expands from its header", async () => {
    const { api } = fakeApi();
    const editor = (await approvedSites(api))!;
    expect(editor.dataset.open).toBe("false");
    expect(toggle(editor).getAttribute("aria-expanded")).toBe("false");
    expect(toggle(editor).textContent).toContain("2");
    expect(
      editor.querySelector<HTMLElement>(".approved-sites-reveal")!.inert
    ).toBe(true);
    toggle(editor).click();
    expect(editor.dataset.open).toBe("true");
    expect(toggle(editor).getAttribute("aria-expanded")).toBe("true");
    expect(
      editor.querySelector<HTMLElement>(".approved-sites-reveal")!.inert
    ).toBe(false);
  });

  it("lets every site be removed and saves added sites", async () => {
    const { api, calls } = fakeApi();
    const editor = (await approvedSites(api, "?workspace=w1"))!;
    expect(labels(editor)).toEqual(["example.com", "preview.example.com"]);
    expect(editor.querySelectorAll(".approved-site button")).toHaveLength(2);
    editor.querySelector("input")!.value = "*-komo-site.off-brand.workers.dev";
    editor
      .querySelector<HTMLButtonElement>(".approved-site-add button")!
      .click();
    await flush();
    expect(calls.at(-1)).toEqual([
      "project/sites?workspace=w1",
      "PATCH",
      {
        sites: [
          "https://example.com",
          "https://preview.example.com",
          "https://*-komo-site.off-brand.workers.dev",
        ],
      },
    ]);
    editor.querySelector<HTMLButtonElement>(".approved-site button")!.click();
    await flush();
    expect(calls.at(-1)![2]).toEqual({
      sites: [
        "https://preview.example.com",
        "https://*-komo-site.off-brand.workers.dev",
      ],
    });
    expect(labels(editor)).not.toContain("example.com");
  });

  it("puts a site back and explains when removing it fails", async () => {
    const { api } = fakeApi(true);
    const editor = (await approvedSites(api))!;
    editor.querySelector<HTMLButtonElement>(".approved-site button")!.click();
    await flush();
    expect(labels(editor)).toEqual(["example.com", "preview.example.com"]);
    expect(editor.querySelector("[role=status]")!.textContent).toBe(
      "You can’t remove the site you’re on."
    );
  });

  it("shows config sites from older APIs as removable", async () => {
    const api = {
      request: async () => ({
        sites: ["https://added.example.com"],
        fixed: ["https://example.com"],
      }),
    } as unknown as CommentsApi;
    const editor = (await approvedSites(api))!;
    expect(labels(editor)).toEqual(["example.com", "added.example.com"]);
  });

  it("stays hidden for viewers who cannot manage the project", async () => {
    const api = {
      request: async () => {
        throw new Error("403");
      },
    } as unknown as CommentsApi;
    expect(await approvedSites(api)).toBeNull();
  });
});

describe("configured project site edits", () => {
  it("hides removed config sites and adds owner sites", () => {
    expect(
      editedOrigins(["https://a.com", "https://b.com"], {
        added: ["https://*-x.example.com", "https://a.com"],
        removed: ["https://b.com"],
      })
    ).toEqual(["https://a.com", "https://*-x.example.com"]);
  });
});
