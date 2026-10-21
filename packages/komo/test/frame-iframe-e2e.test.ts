import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = join(tmpdir(), "komo-frame-iframe");
let directory: string, origin: string, elsewhere: string;
let server: Server, browser: Browser;

// An app with a 768px breakpoint: a desktop sidebar, or a menu button for a mobile drawer.
const app = `<!doctype html><html><head><style>:root{--brand:#7c3aed}body{margin:0;font:14px system-ui;color:#0f172a}
.app{display:flex;min-height:100vh}.sidebar{width:220px;flex:none;padding:16px;box-sizing:border-box;background:#ede9fe}.drawer-toggle{display:none}
.content{flex:1;min-width:0;padding:16px 16px 600px}.card{height:120px;margin:12px 0;padding:12px;box-sizing:border-box;border-radius:8px;background:var(--brand);color:#fff}
@media (max-width:767px){.sidebar{display:none}.drawer-toggle{display:block}}</style></head>
<body><main id="root"><div class="app"><aside class="sidebar" id="sidebar">Sidebar</aside><section class="content"><button class="drawer-toggle" id="drawer">Menu</button>
<h1 id="title">Home</h1><a id="next" href="/other">Other page</a> <input id="field" aria-label="Field" placeholder="Type here">
<div class="card" id="card-1">One</div><div class="card" id="card-2">Two</div><div class="card" id="card-3">Three</div><div class="card" id="card-4">Four</div><div class="card" id="card-5">Five</div><div class="card" id="card-6">Six</div></section></div></main>
<div id="toast" role="status" style="position:fixed;right:12px;bottom:12px;width:40vw;height:40px;background:#0f172a;color:#fff">Saved</div>
<script type="module" src="/entry.js"></script></body></html>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-frame-iframe-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      import {discoverCssTokens} from ${JSON.stringify(resolve("src/adapters/css-variables.ts"))};
      const qa=window.qa={resizes:0,booted:(window.qa?.booted??0)+1};
      addEventListener('resize',()=>qa.resizes++);
      // A client-side router: links push history and render the route.
      const render=()=>{document.getElementById('title').textContent=location.pathname==='/other'?'Other':'Home';};
      document.getElementById('next').addEventListener('click',event=>{event.preventDefault();history.pushState({},'',event.currentTarget.getAttribute('href'));render();});
      addEventListener('popstate',render);render();
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':frame-iframe';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      const stored=()=>JSON.parse(localStorage.getItem('qa-threads')||'[]');
      window.fetch=async(input,init)=>{
        const method=init?.method||'GET',path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url,location.origin).pathname;
        if(method==='POST'&&path.endsWith('/threads')){
          const body=JSON.parse(init.body),threads=stored(),id='thread-'+(threads.length+1);
          threads.push({id,page:body.page,anchor:body.anchor,resolved:false,resolvedBy:null,createdAt:Date.now(),updatedAt:Date.now(),tags:[],comments:[{id:id+'-comment',author:user,body:body.body,createdAt:Date.now(),editedAt:null,reactions:{}}]});
          localStorage.setItem('qa-threads',JSON.stringify(threads));
          return Response.json({id,commentId:id+'-comment'});
        }
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads:stored()}:{});
      };
      const params=new URLSearchParams(location.search);
      window.komo=initKomo({endpoint:location.origin,project:'frame-iframe',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,pollInterval:60000,
        design:{tokens:discoverCssTokens()},
        frame:{mode:params.has('transform')?'transform':'iframe',...(params.get('url')?{iframeUrl:()=>params.get('url')}:{})}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/deny") {
      response.setHeader("x-frame-options", "DENY");
      response.setHeader("content-type", "text/html");
      return response.end(app);
    }
    if (url.pathname === "/away") {
      response.statusCode = 302;
      response.setHeader("location", `${elsewhere}/`);
      return response.end();
    }
    if (!url.pathname.endsWith(".js")) {
      response.setHeader("content-type", "text/html");
      return response.end(app);
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
  // The same server under another host name is another origin.
  elsewhere = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

const shadow = (page: Page) => page.evaluateHandle(() => [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!);
async function viewportFrame(page: Page): Promise<Frame> {
  await page.waitForFunction(() => {
    const root = [...document.body.children].find((node) => node.shadowRoot)?.shadowRoot;
    const frame = root?.querySelector<HTMLIFrameElement>("iframe[data-komo-viewport]");
    return !!frame?.contentDocument?.getElementById("title") && !root!.querySelector(".frame-stage[data-loading]");
  });
  const frame = page.frames().find((item) => item.name() === "komo-viewport");
  expect(frame).toBeTruthy();
  return frame!;
}
async function open(page: Page, query = "") {
  page.setDefaultTimeout(6000);
  await page.goto(`${origin}/${query}`);
  await page.waitForFunction(() => !!(window as any).komo);
  await page.keyboard.press("l");
  await page.locator(".frame-bar").waitFor();
}
async function choose(page: Page, name: string) {
  await page.locator(".frame-size-trigger").click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).click();
  await page.waitForTimeout(150);
}
/** Layout inside the viewport iframe: what the page itself sees. */
const inside = (frame: Frame) => frame.evaluate(() => ({
  innerWidth,
  innerHeight,
  mobile: matchMedia("(max-width: 767px)").matches,
  sidebar: getComputedStyle(document.getElementById("sidebar")!).display,
  drawer: getComputedStyle(document.getElementById("drawer")!).display,
  resizes: (window as any).qa.resizes,
  // A body-level fixed portal lays out against the frame's own viewport.
  toast: (({ right, bottom, width }) => [Math.round(right), Math.round(bottom), Math.round(width)])(document.getElementById("toast")!.getBoundingClientRect()),
  komoHosts: [...document.body.children].filter((node) => node.shadowRoot).length,
}));

describe.skipIf(!chrome)("Frame viewport mode", () => {
  it("renders the page in a same-origin iframe whose media queries, matchMedia, innerWidth and resize events follow the chosen size", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    const frame = await viewportFrame(page);
    // The default is the window's own size at Fit: the desktop layout, scaled down.
    expect(await inside(frame)).toMatchObject({ innerWidth: 1280, innerHeight: 800, mobile: false, sidebar: "block", drawer: "none", komoHosts: 0 });
    expect(await page.locator(".frame-note").isVisible()).toBe(false);
    await page.screenshot({ path: join(shots, "viewport-default-fit.png") });
    for (const [name, width, height, mobile] of [["Mobile", 390, 844, true], ["Tablet", 768, 1024, false], ["Wide", 1440, 900, false]] as const) {
      const before = (await inside(frame)).resizes;
      await choose(page, name);
      await page.waitForTimeout(150);
      const state = await inside(frame);
      expect(state, name).toMatchObject({ innerWidth: width, innerHeight: height, mobile, sidebar: mobile ? "none" : "block", drawer: mobile ? "block" : "none" });
      expect(state.resizes, `${name} resize events`).toBeGreaterThan(before);
      expect(state.toast, `${name} portal`).toEqual([width - 12, height - 12, Math.round(width * 0.4)]);
      await page.screenshot({ path: join(shots, `viewport-${name.toLowerCase()}-fit.png`) });
    }
    // The page stays inert-free: komo inside the frame never mounts a second instance.
    expect((await inside(frame)).komoHosts).toBe(0);
    expect(errors).toEqual([]);
    // Before: in place, the same sizes keep the browser window's desktop layout.
    await page.goto(`${origin}/?transform`);
    await page.waitForFunction(() => !!(window as any).komo);
    await page.keyboard.press("l");
    await page.locator(".frame-bar").waitFor();
    for (const name of ["Mobile", "Tablet", "Wide"]) {
      await choose(page, name);
      await page.waitForTimeout(150);
      expect(await page.locator("#sidebar").evaluate((node) => getComputedStyle(node).display), `${name} in place`).toBe("block");
      await page.screenshot({ path: join(shots, `inplace-${name.toLowerCase()}-fit.png`) });
    }
    // A before/after contact sheet of the two modes.
    const image = async (file: string) => `data:image/png;base64,${(await readFile(join(shots, file))).toString("base64")}`;
    const rows = await Promise.all(["mobile", "tablet", "wide"].map(async (name) =>
      `<tr><th>${name}</th><td><img src="${await image(`inplace-${name}-fit.png`)}"></td><td><img src="${await image(`viewport-${name}-fit.png`)}"></td></tr>`));
    const sheet = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    await sheet.setContent(`<style>body{margin:0;background:#111;color:#eee;font:16px system-ui}table{border-spacing:12px}img{width:640px;border-radius:6px}th{font-weight:500}</style><table><tr><th></th><th>In place (before)</th><th>Viewport (after)</th></tr>${rows.join("")}</table>`);
    await sheet.screenshot({ path: join(shots, "contact-sheet.png"), fullPage: true });
    await sheet.close();
    await page.close();
  }, 60_000);

  it("picks, outlines and pins page elements inside the frame at Fit and 100%, and comments resolve in both modes", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    const frame = await viewportFrame(page);
    await comment(page, "card-3", "From the viewport");
    const pin = page.locator('.pin[data-thread="thread-1"]');
    await pin.waitFor();
    expectOn(await pin.boundingBox(), await framed(page, "card-3"), "viewport pin at Fit");
    await page.screenshot({ path: join(shots, "viewport-pin-fit.png") });
    // 100%: the frame pans inside its port, and the pin follows the card.
    await page.getByRole("button", { name: "100%", exact: true }).click();
    await page.waitForTimeout(200);
    expectOn(await pin.boundingBox(), await framed(page, "card-3"), "viewport pin at 100%");
    await page.evaluate(() => [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!.querySelector(".frame-port")!.scrollBy(0, 120));
    await frame.evaluate(() => scrollBy(0, 80));
    await page.waitForTimeout(300);
    expectOn(await pin.boundingBox(), await framed(page, "card-3"), "viewport pin after scrolling");
    // Picking at 100% outlines the card where it is on screen, too.
    await page.keyboard.press("c");
    const card = await framed(page, "card-2");
    await page.mouse.move(card.x + 40, card.y + 40);
    await page.waitForTimeout(150);
    expectNear((await page.locator(".component-hover").boundingBox())!, card, "100% outline", 4);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: join(shots, "viewport-pin-100.png") });
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.waitForTimeout(200);
    // The same comment resolves on the same element in place.
    await page.goto(`${origin}/?transform`);
    await page.waitForFunction(() => !!(window as any).komo);
    await page.keyboard.press("l");
    await page.locator(".frame-bar").waitFor();
    await pin.waitFor();
    await page.waitForTimeout(400);
    expect(await page.locator("iframe[data-komo-viewport]").count()).toBe(0);
    expectOn(await pin.boundingBox(), (await page.locator("#card-3").boundingBox())!, "in-place pin");
    // A comment made in place resolves in the viewport.
    await comment(page, "card-4", "From in place", false);
    await page.locator('.pin[data-thread="thread-2"]').waitFor();
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => !!(window as any).komo);
    await page.keyboard.press("l");
    await viewportFrame(page);
    await page.locator('.pin[data-thread="thread-2"]').waitFor();
    await page.waitForTimeout(300);
    expectOn(await page.locator('.pin[data-thread="thread-2"]').boundingBox(), await framed(page, "card-4"), "in-place comment in the viewport");
    expectOn(await pin.boundingBox(), await framed(page, "card-3"), "viewport comment after reload");
    const anchors = await page.evaluate(() => JSON.parse(localStorage.getItem("qa-threads")!).map((thread: any) => [thread.page, thread.anchor.selector]));
    expect(anchors).toEqual([["/", "#card-3"], ["/", "#card-4"]]);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("runs Design mode inside the frame: inspector, edit, Undo, Before/After and page token previews", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    const frame = await viewportFrame(page);
    const color = () => frame.locator("#card-2").evaluate((node) => getComputedStyle(node).color);
    for (const zoom of ["Fit", "100%"]) {
      await page.getByRole("button", { name: zoom, exact: true }).click();
      await page.waitForTimeout(200);
      await page.keyboard.press("d");
      await page.waitForSelector('.design-inspector[aria-hidden="false"]');
      const card = await framed(page, "card-2");
      await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
      await page.waitForTimeout(150);
      await page.mouse.click(card.x + card.width / 2, card.y + card.height / 2);
      await page.waitForTimeout(150);
      expect(await page.locator(".design-inspector__target").textContent()).toContain("div#card-2");
      const outline = (await page.locator(".design-outline:not([hidden])").first().boundingBox())!;
      expectNear(outline, await framed(page, "card-2"), `${zoom} outline`);
      await page.locator('.design-inspector [data-property="color"]').fill("#ef3340");
      await page.locator(".design-inspector__target").click();
      expect(await color(), `${zoom} edit`).toBe("rgb(239, 51, 64)");
      await page.getByRole("button", { name: "Before", exact: true }).click();
      expect(await color(), `${zoom} Before`).toBe("rgb(255, 255, 255)");
      await page.getByRole("button", { name: "After", exact: true }).click();
      expect(await color(), `${zoom} After`).toBe("rgb(239, 51, 64)");
      await page.screenshot({ path: join(shots, `viewport-design-${zoom === "Fit" ? "fit" : "100"}.png`) });
      await page.locator('.design-inspector__actions [aria-label="Undo"]').click();
      expect(await color(), `${zoom} Undo`).toBe("rgb(255, 255, 255)");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
    // The Tokens view previews page-wide inside the frame, not on this page.
    await page.keyboard.press("d");
    // Re-entry brings the last selection back; a press on the backdrop around the frame deselects.
    await expect.poll(() => page.locator(".design-inspector__target").textContent()).toContain("div#card-2");
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    const outer = (await page.locator("iframe").first().boundingBox())!;
    await page.mouse.click(outer.x + outer.width / 2, outer.y + outer.height + 8);
    await page.getByRole("button", { name: "Edit tokens", exact: true }).click();
    const row = page.locator(".design-token-row").filter({ has: page.locator("b").getByText("brand", { exact: true }) });
    await row.waitFor();
    await row.locator("button").first().click();
    const hex = page.locator('.komo-color input[aria-label="Hex"]');
    await hex.fill("ff8000");
    await hex.press("Enter");
    await row.locator("button").first().click();
    await expect.poll(() => frame.locator("#card-1").evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 128, 0)");
    expect(await frame.locator("style[data-komo-token-preview]").count()).toBe(1);
    expect(await page.locator("style[data-komo-token-preview]").count()).toBe(0);
    await page.screenshot({ path: join(shots, "viewport-tokens.png") });
    const bar = page.locator(".design-token-bar");
    await bar.getByRole("button", { name: "Before", exact: true }).click();
    expect(await frame.locator("#card-1").evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(124, 58, 237)");
    await bar.getByRole("button", { name: "After", exact: true }).click();
    expect(await frame.locator("#card-1").evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 128, 0)");
    // The preview belongs to the page, so it holds at 100%.
    await page.getByRole("button", { name: "100%", exact: true }).click();
    await page.waitForTimeout(200);
    expect(await frame.locator("#card-1").evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 128, 0)");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("handles shortcuts with focus inside the frame, follows client-side navigation there, and keeps typing for the page", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("qa-threads", JSON.stringify([{ id: "home", page: "/", anchor: { selector: "#card-1", text: "One", x: 0.5, y: 0.5, width: 0, height: 0, pageX: 400, pageY: 300, viewportWidth: 1280 }, resolved: false, resolvedBy: null, createdAt: 1, updatedAt: 1, tags: [], comments: [{ id: "home-comment", author: { id: "reviewer", name: "Example reviewer", verified: true }, body: "Home", createdAt: 1, editedAt: null, reactions: {} }] }])));
    await open(page);
    const frame = await viewportFrame(page);
    const pin = page.locator('.pin[data-thread="home"]');
    await pin.waitFor();
    // Focus inside the frame: komo's shortcuts still work.
    await frame.locator("#title").click();
    expect(await frame.evaluate(() => document.hasFocus())).toBe(true);
    await page.keyboard.press("c");
    await page.locator(".catch").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".catch").waitFor({ state: "hidden" });
    // Typing in the page's own field stays with the page.
    await frame.locator("#field").click();
    await page.keyboard.type("cv");
    expect(await frame.locator("#field").inputValue()).toBe("cv");
    expect(await page.locator(".catch").isVisible()).toBe(false);
    // A client-side route inside the frame is a new page for komo; the parent URL stays.
    await frame.locator("#next").click();
    await expect.poll(() => frame.evaluate(() => location.pathname)).toBe("/other");
    await pin.waitFor({ state: "detached" });
    expect(new URL(page.url()).pathname).toBe("/");
    await frame.evaluate(() => history.back());
    await pin.waitFor();
    expect(await frame.locator("#title").textContent()).toBe("Home");
    await context.close();
  });

  it("lays out Fit and 100% in Viewport and In place, for frames smaller and larger than the stage", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    // A stored size larger than the window, at 100%, opens straight into Viewport mode.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("branch-comments:frame-size:frame-iframe:example/review", JSON.stringify({ v: 2, size: [1600, 1200], actual: true }));
      localStorage.setItem("qa-threads", JSON.stringify([{ id: "card", page: "/", anchor: { selector: "#card-3", text: "Three", x: 0.1, y: 0.5, width: 0, height: 0, pageX: 400, pageY: 300, viewportWidth: 1280 }, resolved: false, resolvedBy: null, createdAt: 1, updatedAt: 1, tags: [], comments: [{ id: "card-comment", author: { id: "reviewer", name: "Example reviewer", verified: true }, body: "Card", createdAt: 1, editedAt: null, reactions: {} }] }]));
    });
    const stage = { left: 24, top: 48, width: 852, height: 728 };
    const layout = () => page.evaluate(() => {
      const root = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
      const port = root.querySelector<HTMLElement>(".frame-port");
      const iframe = root.querySelector<HTMLIFrameElement>("iframe[data-komo-viewport]");
      const box = (node: Element | null) => node && (({ left, top, width, height }) => ({ left, top, width, height }))(node.getBoundingClientRect());
      return {
        port: box(port), iframe: box(iframe), main: box(document.querySelector("main")),
        scroll: port && [port.scrollLeft, port.scrollTop, port.scrollWidth, port.scrollHeight, port.clientWidth, port.clientHeight],
        bars: [...root.querySelectorAll<HTMLElement>(".frame-scroll")].filter((bar) => !bar.hidden).length,
      };
    });
    const near = (actual: number, expected: number, label: string) => expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(1.5);
    await open(page);
    await viewportFrame(page);
    await page.waitForTimeout(300);
    // Viewport, 100%, larger on both axes: the port is the stage, it scrolls exactly the frame, from its top-left.
    let state = await layout();
    expect(await page.locator(".frame-size-trigger").textContent()).toBe("Custom · 1600 × 1200");
    for (const key of ["left", "top", "width", "height"] as const) near(state.port![key], stage[key], `port ${key}`);
    expect(state.scroll).toEqual([0, 0, 1600, 1200, state.scroll![4], state.scroll![5]]);
    near(state.iframe!.left, stage.left, "iframe left");
    near(state.iframe!.top, stage.top, "iframe top");
    expect(state.bars).toBe(0);
    await page.screenshot({ path: join(shots, "viewport-100-larger.png") });
    // Pins in the frame follow the port's scroll.
    const pin = page.locator('.pin[data-thread="card"]');
    await pin.waitFor();
    await page.evaluate(() => [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!.querySelector(".frame-port")!.scrollBy(200, 150));
    await page.waitForTimeout(250);
    const card = await framed(page, "card-3"), dot = (await pin.boundingBox())!;
    expect(dot.x).toBeGreaterThanOrEqual(card.x - dot.width);
    expect(dot.x).toBeLessThanOrEqual(card.x + card.width);
    // Fit: the whole frame inside the stage, no scrolling.
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.waitForTimeout(250);
    state = await layout();
    // A fitted frame never scrolls its port, even programmatically (overflow: clip).
    expect(state.scroll!.slice(0, 2)).toEqual([0, 0]);
    expect(state.iframe!.left).toBeGreaterThanOrEqual(stage.left - 0.5);
    expect(state.iframe!.left + state.iframe!.width).toBeLessThanOrEqual(stage.left + stage.width + 0.5);
    // Fit back to 100% starts from the frame's top-left in Viewport mode.
    await page.mouse.move(500, 500);
    await page.getByRole("button", { name: "100%", exact: true }).click();
    await page.waitForTimeout(250);
    state = await layout();
    near(state.port!.left, stage.left, "100% again port left");
    near(state.iframe!.left, stage.left, "100% again iframe left");
    // Smaller than the stage on both axes: centred, nothing to scroll.
    await page.locator(".frame-size-trigger").click();
    await page.getByLabel("Width", { exact: true }).fill("400");
    await page.getByLabel("Height", { exact: true }).fill("500");
    await page.getByRole("button", { name: "Set" }).click();
    await page.waitForTimeout(300);
    state = await layout();
    near(state.port!.left, stage.left + (stage.width - 400) / 2, "small port left");
    near(state.port!.top, stage.top + (stage.height - 500) / 2, "small port top");
    near(state.port!.width, 400, "small port width");
    expect(state.scroll!.slice(0, 2)).toEqual([0, 0]);
    expect(state.scroll![2]).toBe(state.scroll![4]);
    await page.screenshot({ path: join(shots, "viewport-100-smaller.png") });
    // In place, 100%, larger: the stage pans the page itself, with its own scrollbars.
    await page.locator(".frame-size-trigger").click();
    await page.getByLabel("Width", { exact: true }).fill("1600");
    await page.getByLabel("Height", { exact: true }).fill("1200");
    await page.getByRole("button", { name: "Set" }).click();
    await page.getByRole("button", { name: "In place", exact: true }).click();
    await page.waitForTimeout(400);
    state = await layout();
    expect(state.port).toBeNull();
    expect(state.bars).toBe(2);
    expect(state.main!.left).toBeLessThanOrEqual(stage.left + 0.5);
    expect(state.main!.left + state.main!.width).toBeGreaterThanOrEqual(stage.left + stage.width - 0.5);
    await page.screenshot({ path: join(shots, "inplace-100-larger.png") });
    // Closing and reopening Frame, then back to Viewport, keeps the layout right.
    await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
    await page.waitForTimeout(400);
    await page.keyboard.press("l");
    await page.locator(".frame-bar").waitFor();
    await page.getByRole("button", { name: "Viewport", exact: true }).click();
    await viewportFrame(page);
    await page.waitForTimeout(300);
    state = await layout();
    for (const key of ["left", "top", "width", "height"] as const) near(state.port![key], stage[key], `reopened port ${key}`);
    near(state.iframe!.left, stage.left, "reopened iframe left");
    expect(state.bars).toBe(0);
    await context.close();
  });

  it.each([
    ["deny", "X-Frame-Options: DENY"],
    ["away", "redirected to another origin"],
  ])("falls back in place with a specific reason when the frame can't show /%s", async (route, reason) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await open(page, `?url=/${route}`);
    const note = page.locator(".frame-note");
    await expect.poll(() => note.textContent()).toContain("Viewport unavailable");
    expect(await page.locator(".frame-tip").textContent()).toContain(reason);
    expect(await page.locator("iframe[data-komo-viewport]").count()).toBe(0);
    // In place: the page itself is framed and scaled to Fit.
    expect(await page.locator("main").evaluate((node) => getComputedStyle(node).transform)).not.toBe("none");
    await page.getByRole("button", { name: "Why the viewport is unavailable" }).hover();
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(shots, `fallback-${route}.png`) });
    await page.close();
  });

  it("exits exactly: removes the iframe, restores the page and its scroll, and keeps a draft across modes", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(6000);
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => !!(window as any).komo);
    await page.evaluate(() => scrollTo(0, 240));
    const snapshot = () => page.evaluate(() => [scrollY, ...["main", "body", "html"].map((selector) => document.querySelector(selector)!.getAttribute("style"))]);
    const original = await snapshot();
    await page.keyboard.press("l");
    const frame = await viewportFrame(page);
    // The frame opens where the reviewer was reading.
    expect(original[0]).toBe(240);
    expect(await frame.evaluate(() => scrollY)).toBe(240);
    // A draft in the viewport survives switching to In place and back.
    await page.keyboard.press("c");
    const card = await framed(page, "card-2");
    await page.mouse.click(card.x + 20, card.y + 20);
    await page.locator(".new-comment-composer textarea").waitFor();
    await page.keyboard.type("Keep me");
    await page.getByRole("button", { name: "In place", exact: true }).click();
    await page.waitForTimeout(300);
    expect(await page.locator("iframe[data-komo-viewport]").count()).toBe(0);
    expect(await page.locator(".new-comment-composer textarea").inputValue()).toBe("Keep me");
    await page.getByRole("button", { name: "Viewport", exact: true }).click();
    await viewportFrame(page);
    expect(await page.locator(".new-comment-composer textarea").inputValue()).toBe("Keep me");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
    await page.waitForTimeout(400);
    expect(await page.locator("iframe[data-komo-viewport]").count()).toBe(0);
    expect(await page.locator(".frame-stage").count()).toBe(0);
    expect(await snapshot()).toEqual(original);
    await page.evaluate(() => (window as any).komo.destroy());
    expect(await snapshot()).toEqual(original);
    await page.close();
  });
});

/** An element inside the viewport iframe, on screen. */
function framed(page: Page, id: string) {
  return page.evaluate((id) => {
    const root = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
    const frame = root.querySelector<HTMLIFrameElement>("iframe[data-komo-viewport]")!;
    const outer = frame.getBoundingClientRect(), scale = outer.width / frame.offsetWidth;
    const inner = frame.contentDocument!.getElementById(id)!.getBoundingClientRect();
    return { x: outer.left + inner.left * scale, y: outer.top + inner.top * scale, width: inner.width * scale, height: inner.height * scale };
  }, id);
}
type Box = { x: number; y: number; width: number; height: number };
/** A pin sits on its element: its point is inside the element's box. */
function expectOn(pin: Box | null, element: Box, label: string) {
  expect(pin, label).toBeTruthy();
  const point = { x: pin!.x, y: pin!.y + pin!.height };
  expect(point.x, `${label} x`).toBeGreaterThanOrEqual(element.x - pin!.width);
  expect(point.x, `${label} x`).toBeLessThanOrEqual(element.x + element.width + 1);
  expect(point.y, `${label} y`).toBeGreaterThanOrEqual(element.y - 1);
  expect(point.y, `${label} y`).toBeLessThanOrEqual(element.y + element.height + pin!.height);
}
function expectNear(actual: Box, expected: Box, label: string, tolerance = 3) {
  for (const key of ["x", "y", "width", "height"] as const)
    expect(Math.abs(actual[key] - expected[key]), `${label} ${key}: ${actual[key]} vs ${expected[key]}`).toBeLessThanOrEqual(tolerance);
}
/** Comment on an element: in the viewport iframe, or on this page in place. */
async function comment(page: Page, id: string, text: string, viewport = true) {
  await page.keyboard.press("c");
  const target = viewport ? await framed(page, id) : (await page.locator(`#${id}`).boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.waitForTimeout(150);
  // Picking outlines the element where it is on screen.
  expectNear((await page.locator(".component-hover").boundingBox())!, target, `${id} outline`, 4);
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
  await page.locator(".new-comment-composer textarea").waitFor();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await page.waitForFunction((text) => (localStorage.getItem("qa-threads") ?? "").includes(text), text);
  await page.keyboard.press("Escape");
}
