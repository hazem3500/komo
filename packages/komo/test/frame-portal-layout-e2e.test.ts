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
const shots = join(tmpdir(), "komo-frame-portal-layout");
let directory: string, origin: string;
let server: Server, browser: Browser;

// Viewport-relative portals, as dialog, sheet and toast libraries render them into body.
const fixtures = `
  <div id="overlay-root"><div id="overlay" class="overlay"><div id="overlay-card" class="card"></div></div></div>
  <div id="dialog-transform" class="card transformed"></div>
  <div id="panel" class="card panel"></div>
  <div id="toast" class="card toast"></div>
  <div id="dialog" role="dialog" aria-label="Centred" class="card centred"><button id="confirm">Confirm</button></div>`;
const css = `body{margin:0;font:16px system-ui}main{height:100vh;background:repeating-linear-gradient(90deg,#fff 0 99px,#cbd5e1 99px 100px)}
  .card{box-sizing:border-box;background:#fff;border:2px solid #7c3aed;border-radius:10px}
  .overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgb(15 23 42 / 30%)}
  #overlay-card{width:240px;height:140px}
  .centred{position:fixed;left:50%;top:50%;translate:-50% -50%;width:320px;height:200px}
  .transformed{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:300px;height:180px;border-color:#0891b2}
  .panel{position:fixed;right:0;top:0;height:100%;width:280px;border-color:#16a34a}
  .toast{position:fixed;bottom:16px;left:16px;width:240px;height:48px;border-color:#ea580c}`;
// An app shell sized with viewport-unit utilities, a viewport-unit inline nav and a viewport-unit sheet portal.
const shell = (dynamic: boolean) => `<style>body{margin:0;font:16px system-ui}.w-screen{width:100vw}.h-screen{height:100vh}.h-dvh{height:100dvh}
  .shell{display:flex;flex-direction:column;background:#f8fafc}.bar{display:flex;align-items:center;justify-content:space-between;height:56px;padding:0 16px;border-bottom:1px solid #cbd5e1}
  .actions{display:flex;gap:8px}.actions button{height:36px;padding:0 14px}.body{display:flex;flex:1}nav{background:#e2e8f0}
  @media (min-width:1px){.sheet{position:fixed;top:0;left:0;height:calc(100dvh - 0px);background:#ede9fe;opacity:.9}}</style>
  <main><div id="app" class="shell w-screen ${dynamic ? "h-dvh" : "h-screen"}"><header class="bar"><strong>Workspace</strong><div class="actions"><button id="share">Share</button><button id="publish">Publish</button></div></header>
  <div class="body"><nav id="nav" style="width: 20vw; min-width: 0px;">Navigation</nav></div></div></main>
  <div id="sheet" class="sheet" style="width:25vw"></div>
  <script type="module" src="/shell.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-frame-portal-layout-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      window.fetch=async()=>Response.json({threads:[],guests:true});
      const ids=['overlay-root','overlay','overlay-card','dialog','dialog-transform','panel','toast','confirm'];
      window.portalQA={styles:()=>ids.map(id=>document.getElementById(id).getAttribute('style'))};
      window.mountPortalQA=()=>initKomo({endpoint:location.origin,project:'portal-layout',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,pollInterval:60000});
      // These cases cover the unscaled in-place frame: the space beside the comments.
      localStorage.setItem('branch-comments:frame-size:portal-layout:example/review',JSON.stringify({size:'available'}));
      window.komo=window.mountPortalQA();
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  await build({
    stdin: { contents: `
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      window.fetch=async()=>Response.json({threads:[],guests:true});
      window.clicks=[];
      for(const button of document.querySelectorAll('button'))button.addEventListener('click',()=>window.clicks.push(button.id));
      window.shellQA={styles:()=>[...document.querySelectorAll('main,#app,#nav,#sheet,body,html')].map(node=>node.getAttribute('style')),rules:()=>[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules].map(rule=>rule.cssText))};
      localStorage.setItem('branch-comments:frame-size:shell-layout:example/review',JSON.stringify({size:'available'}));
      window.komo=initKomo({endpoint:location.origin,project:'shell-layout',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,pollInterval:60000});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "shell", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/shell" || path === "/shell-dynamic") {
      response.setHeader("content-type", "text/html");
      response.end(shell(path === "/shell-dynamic"));
      return;
    }
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<style>${css}</style><main></main>${fixtures}<script type="module" src="/entry.js"></script>`);
      return;
    }
    try {
      const file = resolve(directory, `.${path}`);
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

type Box = { left: number; top: number; width: number; height: number };
// Every rectangle relative to the box that should act as the viewport: the window, or the frame.
function measure(page: Page, framed: boolean) {
  return page.evaluate((framed) => {
    const box = framed
      ? document.querySelector("main")!.getBoundingClientRect()
      : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const rects = Object.fromEntries(["overlay", "overlay-card", "dialog", "dialog-transform", "panel", "toast"].map((id) => {
      const rect = document.getElementById(id)!.getBoundingClientRect();
      return [id, { left: rect.left - box.left, top: rect.top - box.top, width: rect.width, height: rect.height }];
    }));
    const confirm = document.getElementById("confirm")!.getBoundingClientRect();
    const hit = document.elementFromPoint(confirm.left + confirm.width / 2, confirm.top + confirm.height / 2)?.id;
    return { box: { left: box.left, top: box.top, width: box.width, height: box.height }, rects, hit };
  }, framed);
}
type Measured = Awaited<ReturnType<typeof measure>>;
function expectLayout({ box, rects, hit }: Measured) {
  const near = (actual: number, expected: number, label: string) =>
    expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected} in ${box.width}x${box.height}`).toBeLessThanOrEqual(1);
  const centred = (id: string, width: number, height: number) => {
    const rect = rects[id];
    near(rect.left + rect.width / 2, box.width / 2, `${id} centre x`);
    near(rect.top + rect.height / 2, box.height / 2, `${id} centre y`);
    near(rect.width, width, `${id} width`);
    near(rect.height, height, `${id} height`);
  };
  centred("dialog", 320, 200);
  centred("dialog-transform", 300, 180);
  centred("overlay-card", 240, 140);
  for (const [key, value] of Object.entries({ left: 0, top: 0, width: box.width, height: box.height }))
    near(rects.overlay[key as keyof Box], value, `overlay ${key}`);
  near(rects.panel.left + rects.panel.width, box.width, "panel right");
  near(rects.panel.top, 0, "panel top");
  near(rects.panel.height, box.height, "panel height");
  near(rects.panel.width, 280, "panel width");
  near(rects.toast.left, 16, "toast left");
  near(box.height - rects.toast.top - rects.toast.height, 16, "toast bottom");
  expect(hit).toBe("confirm");
}

describe.skipIf(!chrome)("viewport-relative portals in the reflow Frame", () => {
  it("lays out percentage, inset, right and bottom portals against the frame box and restores them exactly", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.waitForFunction(() => !!(window as any).komo && [...document.body.children].some((node) => node.shadowRoot?.querySelector(".frame-bar")));
    const original = await page.evaluate(() => (window as any).portalQA.styles());
    const full = await measure(page, false);
    expectLayout(full);
    const framed = async () => {
      await page.waitForFunction(() => document.querySelector("main")!.getBoundingClientRect().width < innerWidth - 300);
      // Positions hold from the first framed paint, during the fade, not only once it settles.
      expectLayout(await measure(page, true));
      await page.waitForTimeout(400);
      const settled = await measure(page, true);
      expectLayout(settled);
      return settled;
    };
    await page.keyboard.press("l");
    const opened = await framed();
    expect(opened.box).toEqual({ left: 24, top: 48, width: 852, height: 728 });
    await page.screenshot({ path: join(shots, "frame-1280x800.png") });
    console.log(JSON.stringify({ full: full.rects, framed: opened }));

    await page.setViewportSize({ width: 1120, height: 700 });
    await page.waitForTimeout(250);
    const narrow = await framed();
    expect(narrow.box.width).toBe(1120 - 24 - 404);
    await page.screenshot({ path: join(shots, "frame-1120x700.png") });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(250);
    const wide = await framed();
    expect(wide.box.width).toBe(1440 - 24 - 404);
    await page.screenshot({ path: join(shots, "frame-1440x900.png") });

    await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main")!.getBoundingClientRect().width === innerWidth);
    expectLayout(await measure(page, false));
    await page.waitForTimeout(400);
    expectLayout(await measure(page, false));
    expect(await page.evaluate(() => (window as any).portalQA.styles())).toEqual(original);

    await page.keyboard.press("l");
    await framed();
    await page.evaluate(() => (window as any).komo.destroy());
    expect(await page.evaluate(() => (window as any).portalQA.styles())).toEqual(original);
    expectLayout(await measure(page, false));
    expect(errors).toEqual([]);
    await page.close();
  });

  it("keeps host inline geometry changes made while framed and remaps them", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(origin);
    await page.waitForFunction(() => !!(window as any).komo && [...document.body.children].some((node) => node.shadowRoot?.querySelector(".frame-bar")));
    await page.locator("#toast").evaluate((node) => node.style.setProperty("bottom", "24px", "important"));
    await page.keyboard.press("l");
    await page.waitForFunction(() => document.querySelector("main")!.getBoundingClientRect().width < 900);
    await page.locator("#toast").evaluate((node) => { node.style.left = "10%"; });
    await page.waitForTimeout(100);
    const { box, rects } = await measure(page, true);
    expect(Math.abs(rects.toast.left - box.width * 0.1)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - rects.toast.top - rects.toast.height - 24)).toBeLessThanOrEqual(1);
    await page.evaluate(() => (window as any).komo.destroy());
    expect(await page.locator("#toast").evaluate((node) => [node.style.left, node.style.bottom, node.style.getPropertyPriority("bottom")]))
      .toEqual(["10%", "24px", "important"]);
    await page.close();
  });
});

describe.skipIf(!chrome).each(["shell", "shell-dynamic"])("viewport-unit app shells in the reflow Frame (%s)", (route) => {
  it("fits 100vw/100vh content and viewport-unit portals to the frame and restores rules and attributes", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/${route}`);
    await page.waitForFunction(() => !!(window as any).komo && [...document.body.children].some((node) => node.shadowRoot?.querySelector(".frame-bar")));
    const original = await page.evaluate(() => [(window as any).shellQA.styles(), (window as any).shellQA.rules()]);
    const check = async (framed: boolean) => {
      const { box, app, nav, sheet, buttons } = await page.evaluate((framed) => {
        const box = framed
          ? document.querySelector("main")!.getBoundingClientRect()
          : { left: 0, top: 0, width: innerWidth, height: innerHeight, right: innerWidth, bottom: innerHeight };
        const rect = (id: string) => document.getElementById(id)!.getBoundingClientRect();
        return {
          box: { left: box.left, top: box.top, width: box.width, height: box.height, right: box.right, bottom: box.bottom },
          app: rect("app"), nav: rect("nav"), sheet: rect("sheet"),
          buttons: ["share", "publish"].map((id) => ({ ...rect(id).toJSON(), id })),
        };
      }, framed);
      const near = (actual: number, expected: number, label: string) =>
        expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(1);
      near(app.left, box.left, "shell left");
      near(app.top, box.top, "shell top");
      near(app.width, box.width, "shell width");
      near(app.height, box.height, "shell height");
      near(nav.width, box.width * 0.2, "nav width");
      near(sheet.left, box.left, "sheet left");
      near(sheet.top, box.top, "sheet top");
      near(sheet.width, box.width * 0.25, "sheet width");
      near(sheet.height, box.height, "sheet height");
      near(buttons[1].right, box.right - 16, "publish right");
      for (const button of buttons) {
        expect(button.left).toBeGreaterThanOrEqual(box.left);
        expect(button.right).toBeLessThanOrEqual(box.right);
        await page.evaluate(() => { (window as any).clicks = []; });
        await page.mouse.click(button.left + button.width / 2, button.top + button.height / 2);
        expect(await page.evaluate(() => (window as any).clicks)).toEqual([button.id]);
      }
      return { box, app: app.width, nav: nav.width, sheet: sheet.width, publish: buttons[1].right };
    };
    const full = await check(false);
    const open = async () => {
      await page.waitForFunction(() => document.querySelector("main")!.getBoundingClientRect().width < innerWidth - 300);
      await page.waitForTimeout(400);
      return check(true);
    };
    await page.keyboard.press("l");
    const opened = await open();
    await page.screenshot({ path: join(shots, `${route}-1280x800.png`) });
    console.log(JSON.stringify({ route, full, opened }));
    await page.setViewportSize({ width: 1120, height: 700 });
    await page.waitForTimeout(250);
    await open();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(250);
    await open();
    await page.screenshot({ path: join(shots, `${route}-1440x900.png`) });
    await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main")!.getBoundingClientRect().width === innerWidth);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => [(window as any).shellQA.styles(), (window as any).shellQA.rules()])).toEqual(original);
    await check(false);
    await page.keyboard.press("l");
    await open();
    await page.evaluate(() => (window as any).komo.destroy());
    expect(await page.evaluate(() => [(window as any).shellQA.styles(), (window as any).shellQA.rules()])).toEqual(original);
    await check(false);
    expect(errors).toEqual([]);
    await page.close();
  });
});
