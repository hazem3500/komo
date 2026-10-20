// Native toolbar order, separators, badge and focus; uses only a synthetic loopback fixture.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = join(tmpdir(), "komo-shots");
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-toolbar-order-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      const query = new URLSearchParams(location.search);
      const user = { id: "synthetic-reviewer", name: "Example reviewer", verified: true };
      const anchor = { selector: "#target", text: "", x: .5, y: .5, width: 0, height: 0, pageX: 0, pageY: 0, viewportWidth: 1280 };
      const threads = Array.from({ length: Number(query.get("threads") ?? 3) }, (_, index) => ({
        id: "thread-" + index, page: location.pathname, anchor, resolved: false, resolvedBy: null, createdAt: Date.now(), updatedAt: Date.now(),
        comments: [{ id: "comment-" + index, body: "Synthetic note " + index, author: user, createdAt: Date.now(), editedAt: null, reactions: {} }],
      }));
      const key = "branch-comments:" + location.origin + ":toolbar-order";
      localStorage.setItem(key, "synthetic-session");
      localStorage.setItem(key + ":user", JSON.stringify({ token: "synthetic-session", user }));
      if (query.get("edge")) localStorage.setItem("branch-comments:drawer:toolbar-order:example/review", JSON.stringify({ x: 16, y: 260, edgeX: query.get("edge") }));
      window.fetch = async () => Response.json({ user, threads, guests: true });
      window.komo = initKomo({
        endpoint: location.origin, project: "toolbar-order", repo: "example/review", branch: "fixture",
        pageRoot: document.querySelector("main"), restoreOpen: false, autoHideDrawer: false,
        ...(query.has("items") ? { toolbar: { items: JSON.parse(query.get("items")) } } : {}),
        ...(query.get("design") === "off" ? { features: { designMode: false } } : {}),
      });
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end('<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font:16px system-ui;background:#f4f2ee}main{min-height:100vh;box-sizing:border-box;padding:70px}</style><main><p id="target">Example text</p></main><script type="module" src="/entry.js"></script>');
      return;
    }
    try {
      const file = resolve(directory, `.${path}`);
      if (!file.startsWith(directory + "/")) throw new Error("outside fixture");
      response.setHeader("content-type", "text/javascript");
      response.end(await readFile(file));
    } catch { response.statusCode = 404; response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

type Entry = { id: string; x: number; y: number; width: number; height: number };
// Bar children in DOM order with their rendered geometry; "|" marks a separator.
const entries = (page: Page) => page.locator(".morphing-menu__bar").evaluate(bar => [...bar.children].map(node => {
  const box = node.getBoundingClientRect();
  return { id: (node as HTMLElement).dataset.menuItem ?? (node.classList.contains("morphing-menu__separator") ? "|" : "?"), x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height };
}));
const focused = (page: Page) => page.evaluate(() => (document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement as HTMLElement | null)?.dataset.menuItem ?? null);

async function open(query: string, viewport = { width: 1280, height: 800 }, touch = false) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce", hasTouch: touch, isMobile: touch });
  page.setDefaultTimeout(5000);
  await page.goto(`${origin}/?${query}`);
  await page.waitForFunction(() => !!(window as any).komo);
  await page.locator(".morphing-menu__bar").waitFor();
  // Hovering loads the interactive menu (its controls carry no title); touch keeps the first paint.
  if (!touch) {
    await page.locator(".toolbar .morphing-menu").hover({ position: { x: 2, y: 2 }, force: true });
    await page.locator(".morphing-menu__shortcut:not([title])").first().waitFor({ state: "attached" });
  }
  return page;
}

function expectAxis(list: Entry[], axis: "x" | "y") {
  for (let index = 1; index < list.length; index++) expect(list[index]![axis]).toBeGreaterThan(list[index - 1]![axis]);
}

const defaultOrder = ["browse", "comment", "design", "|", "comments", "|", "more", "account", "|", "dismiss"];

describe.skipIf(!chrome)("toolbar order in Chrome", () => {
  it("draws the default order with thin separators, a badge, and matching Tab/arrow order", async () => {
    const page = await open("threads=3");
    try {
      const list = await entries(page);
      expect(list.map(entry => entry.id)).toEqual(defaultOrder);
      expectAxis(list, "x");
      for (const separator of list.filter(entry => entry.id === "|")) expect([separator.width, separator.height]).toEqual([1, 20]);
      const comments = page.locator('.morphing-menu__shortcut[data-menu-item="comments"]');
      expect(await comments.locator(".morphing-menu__badge").textContent()).toBe("3");
      expect(await comments.getAttribute("aria-label")).toBe("All comments, 3 open comments");
      expect(await page.locator('.morphing-menu__shortcut[data-menu-item="browse"]').getAttribute("aria-current")).toBe("page");
      await page.locator('.morphing-menu__shortcut[data-menu-item="browse"]').hover();
      await comments.hover();
      const tooltip = page.locator(".morphing-menu__tooltip");
      await expect.poll(() => tooltip.textContent()).toContain("All comments · 3 open");
      expect(await tooltip.locator("kbd").allTextContents()).toEqual(["L"]);
      await page.screenshot({ path: join(shots, "toolbar-default.png"), clip: await page.locator(".toolbar").evaluate(node => { const box = node.getBoundingClientRect(); return { x: box.x - 24, y: box.y - 64, width: box.width + 48, height: box.height + 88 }; }) });

      const ids = defaultOrder.filter(id => id !== "|");
      await page.locator('.morphing-menu__shortcut[data-menu-item="browse"]').focus();
      const tabbed = [await focused(page)];
      for (let step = 1; step < ids.length; step++) { await page.keyboard.press("Tab"); tabbed.push(await focused(page)); }
      expect(tabbed).toEqual(ids);
      const arrowed = [await focused(page)];
      for (let step = 1; step < ids.length; step++) { await page.keyboard.press("ArrowLeft"); arrowed.push(await focused(page)); }
      expect(arrowed).toEqual([...ids].reverse());
      await page.keyboard.press("ArrowLeft");
      expect(await focused(page)).toBe("dismiss");
    } finally { await page.close(); }
  });

  it("caps the badge at 99+ and hides it at zero", async () => {
    for (const [threads, text, label] of [[0, null, "All comments"], [120, "99+", "All comments, 120 open comments"]] as const) {
      const page = await open(`threads=${threads}`);
      try {
        const comments = page.locator('.morphing-menu__shortcut[data-menu-item="comments"]');
        await expect.poll(() => comments.getAttribute("aria-label")).toBe(label);
        expect(await comments.locator(".morphing-menu__badge").count()).toBe(text ? 1 : 0);
        if (text) expect(await comments.locator(".morphing-menu__badge").textContent()).toBe(text);
      } finally { await page.close(); }
    }
  });

  it("keeps the order top to bottom on a vertical edge toolbar", async () => {
    const page = await open("threads=3&edge=left");
    try {
      expect(await page.locator(".toolbar .morphing-menu").getAttribute("data-vertical")).toBe("true");
      const list = await entries(page);
      expect(list.map(entry => entry.id)).toEqual(defaultOrder);
      expectAxis(list, "y");
      for (const separator of list.filter(entry => entry.id === "|")) expect([separator.width, separator.height]).toEqual([20, 1]);
      await page.screenshot({ path: join(shots, "toolbar-vertical-left.png"), clip: { x: 0, y: 0, width: 360, height: 800 } });
    } finally { await page.close(); }
  });

  it("keeps the order in the open sidebar's docked toolbar", async () => {
    const page = await open("threads=3");
    try {
      await page.locator('.morphing-menu__shortcut[data-menu-item="comments"]').click();
      await expect.poll(() => page.locator(".toolbar").getAttribute("data-edge-orient")).toBe("horizontal");
      const list = await entries(page);
      expect(list.map(entry => entry.id)).toEqual(defaultOrder);
      expectAxis(list, "x");
      for (const separator of list.filter(entry => entry.id === "|")) expect([separator.width, separator.height]).toEqual([1, 20]);
      await page.screenshot({ path: join(shots, "toolbar-sidebar-open.png") });
    } finally { await page.close(); }
  });

  it("fits a 390px mobile viewport in the same order", async () => {
    const page = await open("threads=3", { width: 390, height: 844 }, true);
    try {
      const list = await entries(page);
      expect(list.map(entry => entry.id)).toEqual(defaultOrder);
      expectAxis(list, "x");
      const bar = await page.locator(".morphing-menu__bar").boundingBox();
      expect(bar!.x).toBeGreaterThanOrEqual(0);
      expect(bar!.x + bar!.width).toBeLessThanOrEqual(390);
      for (const button of list.filter(entry => entry.id !== "|")) expect(button.width).toBeGreaterThanOrEqual(32);
      await page.screenshot({ path: join(shots, "toolbar-mobile-390.png") });
    } finally { await page.close(); }
  });

  it("follows custom items, skipping a disabled feature and collapsing separators", async () => {
    const items = ["|", "comments", "|", "|", "design", "comment", "browse", "|", "dismiss", "|"];
    const page = await open(`threads=4&design=off&items=${encodeURIComponent(JSON.stringify(items))}`);
    try {
      const list = await entries(page);
      expect(list.map(entry => entry.id)).toEqual(["comments", "|", "comment", "browse", "|", "dismiss"]);
      expectAxis(list, "x");
      await page.locator('.morphing-menu__shortcut[data-menu-item="dismiss"]').focus();
      await page.keyboard.press("Home");
      expect(await focused(page)).toBe("comments");
      await page.screenshot({ path: join(shots, "toolbar-custom-items.png"), clip: await page.locator(".toolbar").evaluate(node => { const box = node.getBoundingClientRect(); return { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: box.height + 48 }; }) });
      // Dismiss from the bar; the restore shortcut brings the toolbar back.
      await page.locator('.morphing-menu__shortcut[data-menu-item="dismiss"]').click();
      expect(await page.locator(".toolbar").evaluate(node => (node as HTMLElement).style.display)).toBe("none");
      await page.keyboard.press("Shift+K");
      expect(await page.locator(".toolbar").evaluate(node => (node as HTMLElement).style.display)).not.toBe("none");
    } finally { await page.close(); }
  });

  it("keeps hidden controls in More and restores without a Dismiss button", async () => {
    const page = await open(`items=${encodeURIComponent(JSON.stringify(["browse", "comment", "more"]))}`);
    try {
      expect((await entries(page)).map(entry => entry.id)).toEqual(["browse", "comment", "more"]);
      await page.locator('.morphing-menu__shortcut[data-menu-item="more"]').click();
      const panel = page.locator(".morphing-menu__panel[aria-hidden=false]");
      await panel.locator('[data-menu-item="account"]').waitFor();
      await panel.locator('[data-menu-item="dismiss"]').click();
      expect(await page.locator(".toolbar").evaluate(node => (node as HTMLElement).style.display)).toBe("none");
      await page.keyboard.press("Shift+K");
      expect(await page.locator(".toolbar").evaluate(node => (node as HTMLElement).style.display)).not.toBe("none");
    } finally { await page.close(); }
  });
});
