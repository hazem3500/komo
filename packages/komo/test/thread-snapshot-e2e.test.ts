import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

/** A 240×120 striped PNG: what the mocked API returns for every image snapshot. */
function stripes() {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(240, 0);
  header.writeUInt32BE(120, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.concat(Array.from({ length: 120 }, (_, y) =>
    Buffer.from([0, ...Array.from({ length: 240 }, (_, x) => ((x + y) >> 4) % 2 ? [124, 58, 237] : [248, 250, 252]).flat()])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
const png = stripes();
const note = "<!-- komo: no image snapshot, the element shows images from another origin. -->";
const markup = `${note}<div class="card"><b id="injected">Bold text</b><img src="x" onerror="window.injected=1"></div>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-thread-snapshot-"));
  await build({
    stdin: { contents: `
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      const params=new URLSearchParams(location.search);
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+'/api:thread-snapshots';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      window.blobs={created:[],revoked:[]};
      const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
      URL.createObjectURL=blob=>{const url=create.call(URL,blob);window.blobs.created.push(url);return url};
      URL.revokeObjectURL=url=>{window.blobs.revoked.push(url);return revoke.call(URL,url)};
      window.komo=initKomo({endpoint:location.origin+'/api',project:'thread-snapshots',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),
        sidebar:'background',restoreOpen:false,pollInterval:60000,...(params.has('capture')?{snapshots:{image:true,html:true}}:{})});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.endsWith(".js")) {
      response.setHeader("content-type", "text/html; charset=utf-8");
      return response.end(`<!doctype html><style>body{margin:0;font:16px system-ui}main{padding:48px}#hero{width:320px;padding:16px;border-radius:12px;background:rgb(124,58,237);color:#fff}</style>
        <main><article id="hero"><h2>Plans</h2><button id="cta">Start building</button></article></main><script type="module" src="/entry.js"></script>`);
    }
    try {
      const file = resolve(directory, `.${url.pathname}`);
      if (!file.startsWith(directory + "/")) throw new Error("outside fixture");
      response.setHeader("content-type", "text/javascript");
      response.end(await readFile(file));
    } catch { response.statusCode = 404; response.end(); }
  }).listen(0);
  origin = `http://localhost:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

const user = { id: "reviewer", name: "Example reviewer", verified: true };
type Fixture = { id: string; selector: string; body: string; updatedAt: number; snapshot?: { image?: string; html?: string } };
const snapshotUrl = (id: string, kind: string, version = 1) =>
  `${origin}/api/threads/${id}/snapshot/${kind}?project=thread-snapshots&repo=example%2Freview&branch=fixture&v=${version}`;
const thread = (item: Fixture) => ({
  id: item.id, page: "/", resolved: false, resolvedBy: null, createdAt: item.updatedAt, updatedAt: item.updatedAt, tags: [],
  anchor: { selector: item.selector, text: item.selector === "#cta" ? "Start building" : "", x: 0.5, y: 0.5, width: 0, height: 0, pageX: 80, pageY: 80, viewportWidth: 1280 },
  comments: [{ id: `${item.id}-comment`, author: user, body: item.body, createdAt: item.updatedAt, editedAt: null, reactions: {} }],
  ...(item.snapshot ? { snapshot: item.snapshot } : {}),
});

/** The comments API, mocked: snapshot reads, deletes and uploads are recorded. */
async function mockApi(page: Page, fixtures: Fixture[], options: { legacy?: boolean } = {}) {
  const reads: { id: string; kind: string; auth: string | undefined; v: string | null }[] = [];
  const deletes: string[] = [];
  const uploads: string[] = [];
  const posted: object[] = [];
  await page.route(`${origin}/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();
    const read = path.match(/^\/threads\/([^/]+)\/snapshot\/(image|html)$/);
    if (read && method === "GET") {
      reads.push({ id: read[1]!, kind: read[2]!, auth: request.headers().authorization, v: url.searchParams.get("v") });
      return read[2] === "image"
        ? route.fulfill({ status: 200, contentType: "image/png", body: png })
        : route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: markup });
    }
    if (read && method === "DELETE") {
      deletes.push(`${read[1]}/${read[2]}`);
      const item = fixtures.find((entry) => entry.id === read[1]);
      if (item?.snapshot) delete item.snapshot[read[2] as "image" | "html"];
      if (item?.snapshot && !Object.keys(item.snapshot).length) delete item.snapshot;
      return route.fulfill({ json: { ok: true, deleted: 1 } });
    }
    if (/\/snapshot$/.test(path) && method === "POST") {
      uploads.push(url.searchParams.get("kind") ?? "");
      return route.fulfill({ status: 201, json: { ok: true } });
    }
    if (path === "/threads" && method === "POST") {
      const body = request.postDataJSON();
      const id = `posted-${posted.length + 1}`;
      posted.push(body);
      fixtures.push({ id, selector: body.anchor.selector, body: body.body, updatedAt: Date.now() });
      return route.fulfill({ json: { id, commentId: `${id}-comment` } });
    }
    if (path === "/me") return route.fulfill({ json: { user } });
    if (path === "/config")
      return route.fulfill({ json: options.legacy ? { guests: true, guestResolve: true } : { guests: true, guestResolve: true, snapshots: { guests: false, maxImageBytes: 262_144, maxHtmlBytes: 32_768 } } });
    if (path === "/threads") return route.fulfill({ json: { threads: fixtures.map(thread) } });
    return route.fulfill({ json: {} });
  });
  return { reads, deletes, uploads, posted };
}

async function open(page: Page, query = "") {
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/${query}`);
  await page.waitForFunction(() => !!(window as any).komo);
  return errors;
}
const shadowEval = <T,>(page: Page, script: string) =>
  page.evaluate((source) => new Function("root", source)([...document.body.children].find((node) => node.shadowRoot)!.shadowRoot), script) as Promise<T>;

describe.skipIf(!chrome)("thread snapshots in the review UI", () => {
  it("loads list thumbnails lazily with the bearer token, only for rows on screen", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    const fixtures: Fixture[] = Array.from({ length: 30 }, (_, index) => ({
      id: `row-${index}`, selector: "#cta", body: `Row ${index} feedback`, updatedAt: 10_000 - index,
      snapshot: { image: snapshotUrl(`row-${index}`, "image", index + 1) },
    }));
    // A snapshot URL on another origin never receives the token.
    fixtures[1]!.snapshot = { image: `http://127.0.0.1:1/threads/row-1/snapshot/image?v=1` };
    const api = await mockApi(page, fixtures);
    const errors = await open(page);
    await page.keyboard.press("l");
    await page.locator(".thread-card").filter({ hasText: "Row 0 feedback" }).waitFor();
    await page.locator('.thread-item[data-thread="row-0"] .komo-snapshot[data-ready] img').waitFor();
    await page.waitForTimeout(300);
    const first = api.reads.map((read) => read.id);
    expect(first.length).toBeGreaterThan(1);
    expect(first.length).toBeLessThan(15);
    expect(first).not.toContain("row-29");
    expect(first).not.toContain("row-1");
    expect(new Set(api.reads.map((read) => read.auth))).toEqual(new Set(["Bearer fixture-session"]));
    expect(api.reads.every((read) => read.kind === "image")).toBe(true);
    // The thumbnail is a fixed small size with alt text naming the element.
    const thumb = page.locator('.thread-item[data-thread="row-0"] .komo-snapshot img');
    expect(await thumb.getAttribute("alt")).toBe("Snapshot of “Start building” when the comment was left");
    expect(await thumb.getAttribute("src")).toMatch(/^blob:/);
    expect(await thumb.evaluate((node) => [node.getBoundingClientRect().width, node.getBoundingClientRect().height])).toEqual([72, 48]);
    // Scrolling to the end loads the rows that came into view, not the ones already shown again.
    await shadowEval(page, `root.querySelector(".list").scrollTop = 1e6`);
    await page.locator('.thread-item[data-thread="row-29"] .komo-snapshot[data-ready] img').waitFor();
    const ids = api.reads.map((read) => read.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("opens the full image on Enter, closes on Escape and revokes blob URLs once unmounted", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const fixtures: Fixture[] = [{ id: "hero", selector: "#cta", body: "Tighten the button", updatedAt: 5000, snapshot: { image: snapshotUrl("hero", "image"), html: snapshotUrl("hero", "html") } }];
    const api = await mockApi(page, fixtures);
    const errors = await open(page);
    await page.keyboard.press("l");
    await page.locator(".thread-card").filter({ hasText: "Tighten the button" }).click();
    const card = page.locator(".dialog .message .komo-snapshot[data-ready] img");
    await card.waitFor();
    const src = (await card.getAttribute("src"))!;
    expect(src).toMatch(/^blob:/);
    // Shown on the list row and the card, but fetched once: reads are cached per URL.
    expect(api.reads.filter((read) => read.kind === "image")).toHaveLength(1);
    await page.locator(".dialog .message .komo-snapshot").focus();
    await page.keyboard.press("Enter");
    const viewer = page.locator("dialog.komo-snapshot-viewer[open]");
    await viewer.waitFor();
    expect(await viewer.locator("img").getAttribute("alt")).toBe("Snapshot of “Start building” when the comment was left");
    expect(await viewer.locator("img").getAttribute("src")).toMatch(/^blob:/);
    const viewerSrc = (await viewer.locator("img").getAttribute("src"))!;
    await page.keyboard.press("Escape");
    await viewer.waitFor({ state: "detached" });
    expect(await shadowEval<string | undefined>(page, `return root.activeElement?.className`)).toBe("komo-snapshot");
    expect(await page.evaluate(() => (window as any).blobs.revoked)).toContain(viewerSrc);
    // Closing the card unmounts its thumbnail: its blob URL is revoked.
    await page.locator(".dialog .thread-back").click();
    await page.waitForFunction((url) => (window as any).blobs.revoked.includes(url), src);
    // The list row's thumbnail comes back from the cache, without another read.
    await page.locator('.thread-item[data-thread="hero"] .komo-snapshot[data-ready] img').waitFor();
    expect(api.reads.filter((read) => read.kind === "image")).toHaveLength(1);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("shows the snapshot and its route when the element is not on the page, and HTML only as text", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const fixtures: Fixture[] = [
      { id: "gone", selector: "#removed", body: "The banner is gone", updatedAt: 5000, snapshot: { image: snapshotUrl("gone", "image") } },
      { id: "markup", selector: "#also-removed", body: "Only markup here", updatedAt: 4000, snapshot: { html: snapshotUrl("markup", "html") } },
    ];
    await mockApi(page, fixtures);
    const errors = await open(page);
    await page.keyboard.press("l");
    await page.locator(".thread-card").filter({ hasText: "The banner is gone" }).click();
    const status = page.locator(".dialog .thread-anchor-status");
    await status.locator(".komo-snapshot[data-ready] img").waitFor();
    expect(await status.textContent()).toContain("Element not found on this page");
    const route = status.locator("a.thread-route");
    expect(await route.textContent()).toBe("/");
    expect(await route.getAttribute("href")).toBe(`${origin}/?comment=gone`);
    expect(await status.locator(".komo-snapshot img").getAttribute("alt")).toBe("Snapshot of the commented element when the comment was left");
    // The message's own thumbnail steps aside for the larger fallback.
    expect(await page.locator(".dialog .message .komo-snapshot").isVisible()).toBe(false);

    await page.locator(".dialog .thread-back").click();
    await page.locator(".thread-card").filter({ hasText: "Only markup here" }).click();
    const code = page.locator(".dialog .thread-anchor-status pre.komo-snapshot-code");
    await code.waitFor();
    expect(await code.textContent()).toBe(markup.slice(note.length));
    expect(await page.locator(".dialog .thread-anchor-status").textContent()).toContain("No image snapshot, the element shows images from another origin.");
    expect(await shadowEval<number>(page, `return root.querySelectorAll("#injected, .komo-snapshot-code img").length`)).toBe(0);
    expect(await page.evaluate(() => (window as any).injected)).toBeUndefined();
    // The card has no image to show, so its HTML opens as text too.
    await page.locator(".dialog .komo-snapshot-text").click();
    await page.locator("dialog.komo-snapshot-viewer[open] pre").waitFor();
    expect(await page.locator("dialog.komo-snapshot-viewer pre").textContent()).toContain("<b id=\"injected\">");
    await page.locator('dialog.komo-snapshot-viewer button[aria-label="Close snapshot"]').click();
    expect(errors).toEqual([]);
    await page.close();
  });

  it("removes a snapshot after confirming, at once", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const fixtures: Fixture[] = [{ id: "hero", selector: "#cta", body: "Tighten the button", updatedAt: 5000, snapshot: { image: snapshotUrl("hero", "image"), html: snapshotUrl("hero", "html") } }];
    const api = await mockApi(page, fixtures);
    const errors = await open(page);
    await page.keyboard.press("l");
    await page.locator(".thread-card").filter({ hasText: "Tighten the button" }).click();
    await page.locator(".dialog .message .komo-snapshot[data-ready]").waitFor();
    await page.locator('.dialog-head summary[aria-label="Comment actions"]').click();
    await page.getByRole("menuitem", { name: "Remove snapshot", exact: true }).click();
    // Nothing is removed until the reviewer confirms.
    await page.locator(".toast").filter({ hasText: "Remove this comment’s snapshot?" }).waitFor();
    expect(api.deletes).toEqual([]);
    await page.locator(".toast button").filter({ hasText: "Remove" }).click();
    await page.locator(".dialog .komo-snapshot").waitFor({ state: "detached" });
    await expect.poll(() => api.deletes.sort()).toEqual(["hero/html", "hero/image"]);
    await page.waitForTimeout(300);
    expect(await page.locator(".komo-snapshot").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("works with an older server: no snapshot field, no snapshot support", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const fixtures: Fixture[] = [
      { id: "plain", selector: "#cta", body: "Plain feedback", updatedAt: 5000 },
      { id: "plain-gone", selector: "#removed", body: "Missing element", updatedAt: 4000 },
    ];
    const api = await mockApi(page, fixtures, { legacy: true });
    const errors = await open(page, "?capture=1");
    await page.keyboard.press("l");
    await page.locator(".thread-card").filter({ hasText: "Missing element" }).click();
    await page.locator(".dialog .thread-anchor-status a.thread-route").waitFor();
    await page.locator(".dialog .thread-back").click();
    await page.locator(".thread-card").filter({ hasText: "Plain feedback" }).click();
    await page.locator(".dialog .message").first().waitFor();
    await page.waitForTimeout(300);
    expect(await page.locator(".komo-snapshot, .komo-snapshot-view, .komo-snapshot-text").count()).toBe(0);
    await page.locator('.dialog-head summary[aria-label="Comment actions"]').click();
    expect(await page.getByRole("menuitem", { name: "Remove snapshot" }).count()).toBe(0);
    expect(api.reads).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("previews the pending capture in the composer and drops it before posting", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const api = await mockApi(page, []);
    const errors = await open(page, "?capture=1");
    const box = (await page.locator("#hero").boundingBox())!;
    await page.keyboard.press("c");
    await page.mouse.move(box.x + 40, box.y + 20);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x + 40, box.y + 20);
    await page.locator(".new-comment-composer textarea").waitFor();
    const preview = page.locator(".new-comment-composer .komo-snapshot-draft");
    await preview.waitFor({ timeout: 15_000 });
    expect(await preview.textContent()).toContain("Snapshot and HTML attached");
    expect(await preview.locator("img").getAttribute("src")).toMatch(/^data:image\/webp/);
    await preview.locator('button[aria-label="Remove snapshot"]').click();
    await preview.waitFor({ state: "detached" });
    expect(await shadowEval<string | undefined>(page, `return root.activeElement?.localName`)).toBe("textarea");
    await page.keyboard.type("No snapshot please");
    await page.keyboard.press("Enter");
    await expect.poll(() => api.posted.length).toBe(1);
    await page.waitForTimeout(800);
    expect(api.uploads).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });
});
