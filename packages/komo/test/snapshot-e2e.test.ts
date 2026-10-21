import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string, elsewhere: string;
let server: Server, browser: Browser;
// Captured images are kept here for review.
const shots = join(tmpdir(), "komo-snapshot-shots");
const keep = (name: string, dataUrl: string) => writeFile(join(shots, `${name}.webp`), decoded(dataUrl));

const green = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="rgb(0,200,0)"/></svg>`;
// Two cards, one showing an image from another origin, a busy grid that compresses badly, and a
// region the host keeps private.
const app = (other: string) => `<!doctype html><html><head><style>
body{margin:0;font:16px system-ui;background:rgb(248,250,252);color:#0f172a}main{padding:24px}
.card{width:320px;padding:16px;margin:0 0 24px;border-radius:12px;background:rgb(124,58,237);color:#fff}
.card h2{margin:0 0 8px;font-size:20px}.card h2::before{content:"★ "}.logo{display:block;width:40px;height:40px}
.grid{display:grid;grid-template-columns:repeat(40,24px);width:960px}.grid span{height:24px;font:9px monospace;overflow:hidden}
</style></head><body><main id="root">
<article class="card" id="plain"><h2>Plain card</h2><img class="logo" src="/green.svg" alt=""><input id="email" value="ada@example.test">
<div data-komo-move-clone style="height:20px;background:rgb(255,0,255)">stand-in</div><p data-komo-no-snapshot style="height:20px">Private notes</p></article>
<article class="card" id="foreign"><h2>Foreign image</h2><img class="logo" src="${other}/green.svg" alt=""></article>
<section class="grid" id="busy">${Array.from({ length: 1200 }, (_, i) => `<span style="background:hsl(${(i * 47) % 360} ${40 + ((i * 13) % 60)}% ${30 + ((i * 7) % 50)}%)">${(i * 7919).toString(36)}</span>`).join("")}</section>
</main><script type="module" src="/entry.js"></script></body></html>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-snapshot-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      const params=new URLSearchParams(location.search);
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+'/api:snapshots';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      window.komo=initKomo({endpoint:location.origin+'/api',project:'snapshots',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),
        sidebar:'background',restoreOpen:false,pollInterval:60000,snapshots:{image:true,html:true,maxBytes:Number(params.get('max')||250000)},
        ...(params.has('frame')?{frame:{mode:'iframe'}}:{})});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/green.svg") {
      response.setHeader("content-type", "image/svg+xml");
      return response.end(green);
    }
    if (!url.pathname.endsWith(".js")) {
      response.setHeader("content-type", "text/html; charset=utf-8");
      return response.end(app(elsewhere));
    }
    try {
      const file = resolve(directory, `.${url.pathname}`);
      if (!file.startsWith(directory + "/")) throw new Error("outside fixture");
      response.setHeader("content-type", "text/javascript");
      response.end(await readFile(file));
    } catch { response.statusCode = 404; response.end(); }
  }).listen(0);
  const port = (server.address() as { port: number }).port;
  origin = `http://localhost:${port}`;
  // The same server under another host name is another origin, and sends no CORS headers.
  elsewhere = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

type Upload = { thread: string; kind: "image" | "html"; data: string; note?: string };
/** The comments API, mocked: threads save, and snapshot uploads are recorded (or fail). */
async function mockApi(page: Page, failUploads = false) {
  const threads: { id: string; body: string }[] = [];
  const saved: object[] = [];
  const uploads: Upload[] = [];
  const user = { id: "reviewer", name: "Example reviewer", verified: true };
  await page.route(`${origin}/api/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    const snapshot = path.match(/^\/threads\/([^/]+)\/snapshot$/);
    if (snapshot && method === "POST") {
      uploads.push({ thread: snapshot[1]!, ...request.postDataJSON() });
      return failUploads
        ? route.fulfill({ status: 500, json: { error: "Snapshot storage is unavailable" } })
        : route.fulfill({ json: { ok: true } });
    }
    if (path === "/threads" && method === "POST") {
      const id = `thread-${threads.length + 1}`;
      const body = request.postDataJSON();
      threads.push({ id, body: body.body });
      saved.push({ id, page: body.page, anchor: body.anchor, resolved: false, resolvedBy: null, createdAt: Date.now(), updatedAt: Date.now(), tags: [],
        comments: [{ id: `${id}-comment`, author: user, body: body.body, createdAt: Date.now(), editedAt: null, reactions: {} }] });
      return route.fulfill({ json: { id, commentId: `${id}-comment` } });
    }
    if (path === "/me") return route.fulfill({ json: { user } });
    if (path === "/config") return route.fulfill({ json: { guests: true, guestResolve: true } });
    if (path === "/threads") return route.fulfill({ json: { threads: saved } });
    return route.fulfill({ json: {} });
  });
  return { threads, uploads };
}

async function open(page: Page, query = "") {
  page.setDefaultTimeout(8000);
  await page.goto(`${origin}/${query}`);
  await page.waitForFunction(() => !!(window as any).komo);
}
async function comment(page: Page, target: { x: number; y: number; width: number; height: number }, text: string) {
  await page.keyboard.press("c");
  await page.mouse.move(target.x + target.width / 2, target.y + 12);
  await page.waitForTimeout(150);
  await page.mouse.click(target.x + target.width / 2, target.y + 12);
  await page.locator(".new-comment-composer textarea").waitFor();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}
const kinds = (uploads: Upload[]) => uploads.map((upload) => upload.kind).sort();
const waitFor = async (check: () => boolean, timeout = 15_000) => {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error("Timed out waiting for snapshot uploads");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
const decoded = (dataUrl: string) => Buffer.from(dataUrl.split(",")[1]!, "base64");

/** Decode an uploaded image in the browser: its size and how many pixels are near each colour. */
function inspect(page: Page, dataUrl: string, colors: Record<string, [number, number, number]>) {
  return page.evaluate(async ({ dataUrl, colors }) => {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const counts: Record<string, number> = {};
    for (const [name, [r, g, b]] of Object.entries(colors)) {
      let count = 0;
      for (let i = 0; i < data.length; i += 4)
        if (Math.abs(data[i]! - r) < 24 && Math.abs(data[i + 1]! - g) < 24 && Math.abs(data[i + 2]! - b) < 24) count++;
      counts[name] = count;
    }
    const corner = [...data.slice(0, 3)];
    return { width: bitmap.width, height: bitmap.height, counts, corner };
  }, { dataUrl, colors });
}
const palette = { card: [124, 58, 237], logo: [0, 200, 0], magenta: [255, 0, 255] } as Record<string, [number, number, number]>;

describe.skipIf(!chrome)("comment snapshots", () => {
  it("uploads a WebP image of the element with padding, its trimmed HTML, and leaves komo's UI out", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const chunks: string[] = [];
    page.on("request", (request) => { if (/\/snapshot-[^/]*\.js$/.test(request.url())) chunks.push(request.url()); });
    const api = await mockApi(page);
    await open(page);
    await page.waitForTimeout(300);
    // The capture code is its own chunk, fetched only once a comment is started.
    expect(chunks).toEqual([]);
    await comment(page, (await page.locator("#plain").boundingBox())!, "Tighten the heading");
    await waitFor(() => api.uploads.length === 2);
    expect(api.threads).toEqual([{ id: "thread-1", body: "Tighten the heading" }]);
    expect(kinds(api.uploads)).toEqual(["html", "image"]);
    expect(chunks).toHaveLength(1);
    expect(api.uploads.every((upload) => upload.thread === "thread-1")).toBe(true);
    const image = api.uploads.find((upload) => upload.kind === "image")!;
    expect(image.data).toMatch(/^data:image\/webp;base64,/);
    const bytes = decoded(image.data);
    expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
    expect(bytes.length).toBeLessThanOrEqual(250_000);
    const card = (await page.locator("#plain").evaluate((node: HTMLElement) => [node.offsetWidth, node.offsetHeight]))!;
    await keep("plain", image.data);
    const pixels = await inspect(page, image.data, palette);
    // 2x for the device pixel ratio, with 16px of padding on each side.
    expect(pixels.width).toBe((card[0]! + 32) * 2);
    expect(pixels.height).toBe((card[1]! + 32) * 2);
    // The padding is the page's background; the card and its same-origin image are drawn.
    [248, 250, 252].forEach((value, i) => expect(Math.abs(pixels.corner[i]! - value)).toBeLessThanOrEqual(6));
    expect(pixels.counts.card).toBeGreaterThan(pixels.width * pixels.height * 0.3);
    expect(pixels.counts.logo).toBeGreaterThan(40 * 40 * 4 * 0.8);
    // komo's Design mode stand-in, inside the card on the page, is never drawn.
    expect(pixels.counts.magenta).toBe(0);
    const html = api.uploads.find((upload) => upload.kind === "html")!.data;
    expect(html).toContain("Plain card");
    expect(html).not.toMatch(/ada@example\.test|stand-in|Private notes|data-komo-move-clone/);
    // Nothing of komo's own UI, its host or its sandbox is left on the page or in the snapshot.
    expect(await page.evaluate(() => document.querySelectorAll("[data-komo-snapshot-sandbox]").length)).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it("never captures komo's own UI when the target contains it", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const api = await mockApi(page);
    await open(page);
    // The page body holds komo's host; a comment on it must still leave komo out.
    await page.evaluate(() => (window as any).komo.comment(document.body));
    await page.locator(".new-comment-composer textarea").waitFor();
    await page.keyboard.type("The whole page");
    await page.keyboard.press("Enter");
    await waitFor(() => api.uploads.some((upload) => upload.kind === "html"));
    const html = api.uploads.find((upload) => upload.kind === "html")!.data;
    expect(html).toContain("Plain card");
    expect(html).not.toMatch(/data-branch-comments|Post comment|Tighten|The whole page|stand-in/);
    await page.close();
  }, 60_000);

  it("steps quality and size down to fit maxBytes", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    const api = await mockApi(page);
    await open(page, "?max=12000");
    // The whole grid, not one of its cells.
    await page.evaluate(() => (window as any).komo.comment(document.getElementById("busy")));
    await page.locator(".new-comment-composer textarea").waitFor();
    await page.keyboard.type("Busy grid");
    await page.keyboard.press("Enter");
    await waitFor(() => api.uploads.length >= 1 && api.uploads.some((upload) => upload.kind === "html"));
    await waitFor(() => api.uploads.length === 2 || api.uploads.some((upload) => !!upload.note));
    const image = api.uploads.find((upload) => upload.kind === "image");
    expect(image, JSON.stringify(api.uploads.map(({ kind, note }) => ({ kind, note })))).toBeTruthy();
    expect(decoded(image!.data).length).toBeLessThanOrEqual(12_000);
    await keep("busy", image!.data);
    const pixels = await inspect(page, image!.data, palette);
    // At full size the grid fills the 1200px cap; it had to step down to fit.
    expect(pixels.width).toBeLessThan(1200);
    expect(pixels.width).toBeGreaterThan(100);
    await page.close();
  }, 60_000);

  it("falls back to HTML only, with a note, when the element shows another origin's image", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const api = await mockApi(page);
    await open(page);
    await comment(page, (await page.locator("#foreign").boundingBox())!, "Logo looks off");
    await waitFor(() => api.uploads.length >= 1);
    await page.waitForTimeout(300);
    expect(api.uploads).toEqual([{ thread: "thread-1", kind: "html", data: expect.stringContaining("Foreign image"), note: "cross-origin" }]);
    await page.close();
  }, 60_000);

  it("captures inside Frame's viewport iframe", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const api = await mockApi(page);
    await open(page, "?frame");
    await page.keyboard.press("l");
    await page.waitForFunction(() => {
      const root = [...document.body.children].find((node) => node.shadowRoot)?.shadowRoot;
      const frame = root?.querySelector<HTMLIFrameElement>("iframe[data-komo-viewport]");
      return !!frame?.contentDocument?.getElementById("plain") && !root!.querySelector(".frame-stage[data-loading]");
    });
    const frame = page.frames().find((item) => item.name() === "komo-viewport") as Frame;
    const box = await page.evaluate(() => {
      const root = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
      const frame = root.querySelector<HTMLIFrameElement>("iframe[data-komo-viewport]")!;
      const outer = frame.getBoundingClientRect(), scale = outer.width / frame.offsetWidth;
      const inner = frame.contentDocument!.getElementById("plain")!.getBoundingClientRect();
      return { x: outer.left + inner.left * scale, y: outer.top + inner.top * scale, width: inner.width * scale, height: inner.height * scale };
    });
    // The framed page marks its card so the snapshot can only have come from the frame.
    await frame.evaluate(() => (document.querySelector("#plain h2")!.textContent = "Framed card"));
    await comment(page, box, "In the viewport");
    await waitFor(() => api.uploads.length === 2);
    expect(api.uploads.find((upload) => upload.kind === "html")!.data).toContain("Framed card");
    const image = api.uploads.find((upload) => upload.kind === "image")!;
    expect(image.data).toMatch(/^data:image\/webp;base64,/);
    const size = await frame.evaluate(() => [document.getElementById("plain")!.offsetWidth, document.getElementById("plain")!.offsetHeight]);
    await keep("framed", image.data);
    const pixels = await inspect(page, image.data, palette);
    // Layout pixels of the framed card (1x here), not its scaled size on screen.
    expect([pixels.width, pixels.height]).toEqual([size[0]! + 32, size[1]! + 32]);
    expect(pixels.counts.card).toBeGreaterThan(pixels.width * pixels.height * 0.3);
    await page.close();
  }, 60_000);

  it("still posts the comment when the upload fails", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const logs: string[] = [];
    page.on("console", (message) => logs.push(message.text()));
    const api = await mockApi(page, true);
    await open(page);
    await comment(page, (await page.locator("#plain").boundingBox())!, "Upload fails");
    await waitFor(() => api.uploads.length === 2);
    await page.waitForTimeout(300);
    expect(api.threads).toEqual([{ id: "thread-1", body: "Upload fails" }]);
    expect(logs.filter((text) => text.startsWith("komo: the comment posted without its"))).toHaveLength(2);
    // The thread stays posted: its pin is shown, and no save error appears.
    await page.locator('.pin[data-thread="thread-1"]').waitFor({ state: "attached" });
    expect(await page.evaluate(() => [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!.textContent)).not.toContain("Couldn't save");
    await page.close();
  }, 60_000);
});
