// Cold load on a throttled network: the toolbar paints and shortcuts respond from the
// mount bundle alone, and on-demand chunks (Motion included) load only when needed.
import { build, type Metafile } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;
let initial: Set<string>, motionChunk: string;
// Lazy chunk requests wait here until a test releases them.
let gate: Promise<void>, release: () => void;
const requested: string[] = [], served: string[] = [];

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-lazy-chunks-"));
  const result = await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      const user = { id: "synthetic-reviewer", name: "Example reviewer", verified: true };
      const anchor = { selector: "#target", text: "", x: .5, y: .5, width: 0, height: 0, pageX: 0, pageY: 0, viewportWidth: 1280 };
      const threads = [0, 1].map(index => ({
        id: "thread-" + index, page: location.pathname, anchor, resolved: false, resolvedBy: null, createdAt: Date.now(), updatedAt: Date.now(),
        comments: [{ id: "comment-" + index, body: "Synthetic note " + index, author: user, createdAt: Date.now(), editedAt: null, reactions: {} }],
      }));
      const key = "branch-comments:" + location.origin + ":lazy-chunks";
      localStorage.setItem(key, "synthetic-session");
      localStorage.setItem(key + ":user", JSON.stringify({ token: "synthetic-session", user }));
      window.fetch = async () => Response.json({ user, threads, guests: true });
      window.komo = initKomo({
        endpoint: location.origin, project: "lazy-chunks", repo: "example/review", branch: "fixture",
        pageRoot: document.querySelector("main"), restoreOpen: false, autoHideDrawer: false,
      });
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
    metafile: true, minify: true,
  });
  const outputs: Metafile["outputs"] = result.metafile.outputs;
  const entry = Object.keys(outputs).find(path => basename(path) === "entry.js")!;
  initial = new Set();
  const visit = (path: string) => {
    if (initial.has(basename(path))) return;
    initial.add(basename(path));
    for (const item of outputs[path]!.imports) if (!item.external && item.kind !== "dynamic-import") visit(item.path);
  };
  visit(entry);
  motionChunk = basename(Object.keys(outputs).find(path => Object.keys(outputs[path]!.inputs).some(input => input.includes("motion-dom")))!);
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end('<style>body{margin:0;font:16px system-ui;background:#f4f2ee}main{min-height:100vh;box-sizing:border-box;padding:70px}</style><main><p id="target">Example text</p></main><script type="module" src="/entry.js"></script>');
      return;
    }
    const name = basename(path);
    requested.push(name);
    if (!initial.has(name)) await gate;
    try {
      const file = resolve(directory, `.${path}`);
      if (!file.startsWith(directory + "/")) throw new Error("outside fixture");
      response.setHeader("content-type", "text/javascript");
      response.end(await readFile(file));
      served.push(name);
    } catch { response.statusCode = 404; response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
});

afterAll(async () => {
  release?.();
  await browser?.close();
  server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe.skipIf(!chrome)("lazy chunks on a cold, throttled load", () => {
  it("keeps Motion out of the mount bundle", () => {
    expect(initial.has(motionChunk)).toBe(false);
  });

  it("paints the toolbar and answers shortcuts before on-demand chunks arrive", async () => {
    gate = new Promise(resolve => (release = resolve));
    requested.length = served.length = 0;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      page.setDefaultTimeout(10_000);
      // Slow 3G-like latency and throughput on top of the held lazy chunks.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 400 * 1024 / 8, uploadThroughput: 400 * 1024 / 8 });
      await page.goto(origin);
      const bar = page.locator(".morphing-menu__bar");
      await bar.waitFor();
      expect(await bar.locator("[data-menu-item]").evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.menuItem)))
        .toEqual(["browse", "comment", "design", "comments", "more", "account", "dismiss"]);
      expect(served.filter(name => !initial.has(name))).toEqual([]);

      // The comments shortcut opens the sidebar right away; its motion waits for the chunk.
      await page.keyboard.press("l");
      const host = page.locator("[data-branch-comments]");
      await expect.poll(() => host.evaluate(node => node.classList.contains("review-open")), { timeout: 10_000 }).toBe(true);
      expect(served.filter(name => !initial.has(name))).toEqual([]);
      const sidebar = page.locator(".edge-sidebar");
      expect(await sidebar.evaluate(node => (node as HTMLElement).dataset.morphing)).toBe("true");
      await expect.poll(() => requested.some(name => name.startsWith("motion-animate-")), { timeout: 10_000 }).toBe(true);

      release();
      await expect.poll(() => served.includes(motionChunk), { timeout: 10_000 }).toBe(true);
      await expect.poll(() => sidebar.evaluate(node => (node as HTMLElement).dataset.morphing ?? null), { timeout: 10_000 }).toBe(null);
      await expect.poll(() => page.locator(".thread-card").first().evaluate(node => getComputedStyle(node).opacity), { timeout: 10_000 }).toBe("1");
      expect(await page.locator(".thread-card").count()).toBe(2);

      // Closing animates with the loaded chunk and leaves the toolbar in place.
      await page.keyboard.press("l");
      await expect.poll(() => host.evaluate(node => node.classList.contains("review-open")), { timeout: 10_000 }).toBe(false);
      await expect.poll(() => sidebar.evaluate(node => (node as HTMLElement).dataset.morphing ?? null), { timeout: 10_000 }).toBe(null);
      await expect.poll(() => bar.isVisible(), { timeout: 10_000 }).toBe(true);
    } finally { await page.close(); }
  });
});
