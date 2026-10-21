import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = join(tmpdir(), "komo-frame-size");
let directory: string, origin: string;
let server: Server, browser: Browser;

// A 100vw × 100vh app shell: side panel, header actions, and a scrolling time × day grid.
const page = `<!doctype html><style>body{margin:0;font:14px system-ui;color:#0f172a}
.app{display:flex;width:100vw;height:100vh;background:#fff}.side{width:min(220px,25vw);flex:none;padding:16px;box-sizing:border-box;background:#f1f5f9;border-right:1px solid #cbd5e1}
.main{flex:1;display:flex;flex-direction:column;min-width:0}.bar{display:flex;justify-content:space-between;align-items:center;height:52px;flex:none;padding:0 16px;border-bottom:1px solid #cbd5e1}
.bar div{display:flex;gap:8px}.days,.grid{display:grid;grid-template-columns:56px repeat(7,minmax(0,1fr))}.days{flex:none;height:32px;align-items:center;border-bottom:1px solid #cbd5e1;text-align:center}
.scroller{flex:1;overflow:auto;min-height:0}.grid{grid-auto-rows:60px}.grid>*{border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;box-sizing:border-box}.grid>[data-selected]{background:#ddd6fe}
.time{font-size:11px;color:#64748b;padding:4px}.dialog{position:fixed;left:50%;top:50%;translate:-50% -50%;width:320px;height:180px;box-sizing:border-box;padding:16px;background:#fff;border:2px solid #7c3aed;border-radius:12px}</style>
<main><div class="app" id="app"><aside class="side">Calendars</aside><section class="main"><header class="bar"><strong>Week</strong><div><button id="today">Today</button><button id="create">Create</button></div></header>
<div class="days"><span></span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
<div class="scroller" id="scroller"><div class="grid" id="grid"></div></div></section></div></main>
<div class="dialog" id="dialog" role="dialog" aria-label="New event" hidden><button id="save">Save</button></div><script type="module" src="/entry.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-frame-size-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      import {captureAnchor} from ${JSON.stringify(resolve("src/anchors.ts"))};
      const grid=document.getElementById('grid');
      for(let hour=0;hour<24;hour++){
        const time=document.createElement('span');time.className='time';time.textContent=hour+':00';grid.append(time);
        for(let day=0;day<7;day++){const cell=document.createElement('div');cell.dataset.day=day;cell.dataset.hour=hour;cell.id='cell-'+day+'-'+hour;grid.append(cell);}
      }
      const scroller=document.getElementById('scroller');scroller.scrollTop=8*60;
      // Host selection the way grids do it: by event target, and from client coordinates and rectangles.
      const qa=window.frameQA={selections:[],clicks:[]};
      grid.addEventListener('pointerdown',event=>{
        const cell=event.target.closest('[data-day]');
        const box=grid.getBoundingClientRect(),label=grid.firstElementChild.getBoundingClientRect().width;
        const hour=Math.floor((event.clientY-box.top)/(box.height/24));
        const day=Math.floor((event.clientX-box.left-label)/((box.width-label)/7));
        for(const node of grid.querySelectorAll('[data-selected]'))delete node.dataset.selected;
        if(cell)cell.dataset.selected='';
        qa.selections.push({target:cell&&[+cell.dataset.day,+cell.dataset.hour],coordinates:[day,hour]});
      });
      for(const button of document.querySelectorAll('button'))button.addEventListener('click',()=>qa.clicks.push(button.id));
      document.getElementById('create').addEventListener('click',()=>{document.getElementById('dialog').hidden=false;});
      qa.styles=()=>['main','body','html','#app'].map(selector=>document.querySelector(selector).getAttribute('style'));
      qa.rules=()=>[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules].map(rule=>rule.cssText));
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':frame-size';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      const cell=document.getElementById('cell-4-11'),box=cell.getBoundingClientRect();
      const point={x:box.left+box.width/2,y:box.top+box.height/2};
      const anchor=captureAnchor(cell,point,point);
      const thread=(id,cell,body)=>{const box=cell.getBoundingClientRect(),point={x:box.left+box.width/2,y:box.top+box.height/2};return {id,page:'/',anchor:captureAnchor(cell,point,point),resolved:false,resolvedBy:null,createdAt:1,updatedAt:1,tags:[],comments:[{id:id+'-comment',author:user,body,createdAt:1,editedAt:null,reactions:{}}]};};
      const threads=location.search.includes('pins')?[{...thread('fixture-thread',cell,'Check this slot'),anchor},thread('centre-thread',document.getElementById('cell-3-13'),'And this one')]:[];
      window.fetch=async input=>{
        const path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url).pathname;
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads}:{});
      };
      window.komo=initKomo({endpoint:location.origin,project:'frame-size',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,pollInterval:60000});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(page);
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

const near = (actual: number, expected: number, label: string, tolerance = 1) =>
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
async function open(page: Page, query = "") {
  await page.goto(`${origin}/${query}`);
  await page.waitForFunction(() => !!(window as any).komo);
  const original = await page.evaluate(() => [(window as any).frameQA.styles(), (window as any).frameQA.rules()]);
  await page.keyboard.press("l");
  await page.locator(".frame-bar").waitFor();
  await page.waitForTimeout(350);
  return original;
}
// The frame's visual box, the app's logical layout and the controls' readouts.
function frame(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main")!;
    const rect = main.getBoundingClientRect();
    const shadow = document.querySelector("main ~ div:not(#dialog)")?.shadowRoot ?? [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
    return {
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      logical: [document.getElementById("app")!.offsetWidth, document.getElementById("app")!.offsetHeight],
      scroll: [main.scrollWidth - main.clientWidth, main.scrollHeight - main.clientHeight],
      transform: getComputedStyle(main).transform,
      label: shadow.querySelector(".frame-size-trigger")!.textContent,
      scale: shadow.querySelector(".frame-scale")!.textContent,
      pressed: [...shadow.querySelectorAll(".frame-zoom:not(.frame-mode) button")].map((button) => button.getAttribute("aria-pressed")),
      note: !shadow.querySelector<HTMLElement>(".frame-note")!.hidden,
    };
  });
}
const box = (width: number, height: number) => ({ left: 24, top: 48, width: width - 428, height: height - 72 });
function expectFitted(state: Awaited<ReturnType<typeof frame>>, [width, height]: number[], viewport = [1280, 800]) {
  const available = box(viewport[0], viewport[1]);
  const scale = Math.min(1, available.width / width, available.height / height);
  expect(state.logical).toEqual([width, height]);
  near(state.rect.width, width * scale, "visual width");
  near(state.rect.height, height * scale, "visual height");
  near(state.rect.left, available.left + (available.width - width * scale) / 2, "left");
  near(state.rect.top, available.top + (available.height - height * scale) / 2, "top");
  expect(state.scroll).toEqual([0, 0]);
  expect(state.scale).toBe(`${Math.round(scale * 100)}%`);
}
/** Bring an element into the stage: its scrollers first, then the stage's own pan under the wheel. */
async function reveal(page: Page, selector: string) {
  await page.locator(selector).evaluate((node) => node.scrollIntoView({ block: "center", inline: "center" }));
  for (let step = 0; step < 6; step++) {
    const [target, stage] = await page.evaluate((selector) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      const root = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
      const bars = [...root.querySelectorAll<HTMLElement>(".frame-scroll")].map((bar) => bar.getBoundingClientRect());
      const main = document.querySelector("main")!.getBoundingClientRect();
      const right = Math.min(main.right, ...bars.filter((bar) => bar.height > bar.width).map((bar) => bar.right));
      const bottom = Math.min(main.bottom, ...bars.filter((bar) => bar.width > bar.height).map((bar) => bar.bottom));
      return [{ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, { x: (Math.max(main.left, 24) + right) / 2, y: (Math.max(main.top, 48) + bottom) / 2 }];
    }, selector);
    const dx = target.x - stage.x, dy = target.y - stage.y;
    if (Math.abs(dx) < 40 && Math.abs(dy) < 40) return;
    await page.mouse.move(12, 400);
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(120);
  }
}
async function choose(page: Page, name: string) {
  await page.locator(".frame-size-trigger").click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).click();
  await page.waitForTimeout(100);
}
async function select(page: Page, day: number, hour: number) {
  const cell = await page.locator(`#cell-${day}-${hour}`).boundingBox();
  await page.mouse.click(cell!.x + cell!.width / 2, cell!.y + cell!.height / 2);
  return page.evaluate(() => (window as any).frameQA.selections.at(-1));
}

describe.skipIf(!chrome)("Frame size controls", () => {
  it("opens on the window's own size at Fit, applies presets and a custom size at Fit and 100%, and restores exactly", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const original = await open(page);
    // The window's own layout, scaled down until all of it is visible.
    const fitted = await frame(page);
    expectFitted(fitted, [1280, 800]);
    expect(fitted.transform).not.toBe("none");
    expect(fitted.label).toBe("Desktop · 1280 × 800");
    expect(fitted.scale).toBe("67%");
    expect(fitted.pressed).toEqual(["true", "false"]);
    expect(fitted.note).toBe(false);
    expect(await select(page, 2, 9)).toEqual({ target: [2, 9], coordinates: [2, 9] });
    await page.screenshot({ path: join(shots, "default-window-fit.png") });
    // 100% shows the same viewport in CSS pixels and pans.
    await page.getByRole("button", { name: "100%", exact: true }).click();
    await page.waitForTimeout(100);
    const window100 = await frame(page);
    expect(window100.logical).toEqual([1280, 800]);
    expect(window100.scale).toBe("100%");
    expect(window100.transform).toBe("none");
    await page.screenshot({ path: join(shots, "default-window-100.png") });
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.waitForTimeout(100);
    expectFitted(await frame(page), [1280, 800]);
    // The space beside the comments, unscaled: the page reflows in place.
    await choose(page, "Available space");
    const available = await frame(page);
    expectFitted(available, [852, 728]);
    expect(available.transform).toBe("none");
    expect(available.label).toBe("Available · 852 × 728");
    expect(available.note).toBe(true);
    for (const [name, width, height] of [["Wide", 1440, 900], ["Laptop", 1280, 800], ["Tablet", 768, 1024], ["Mobile", 390, 844]] as const) {
      await choose(page, name);
      const state = await frame(page);
      expectFitted(state, [width, height]);
      expect(state.label).toBe(`${name} · ${width} × ${height}`);
      expect(state.note).toBe(width !== 1280);
      expect(await select(page, 2, 9)).toEqual({ target: [2, 9], coordinates: [2, 9] });
      await page.screenshot({ path: join(shots, `preset-${name.toLowerCase()}-fit.png`) });
    }
    // In place, a narrower viewport cannot change media queries; the bar says why.
    await page.getByRole("button", { name: "Why the layout follows your browser window" }).hover();
    await page.waitForTimeout(200);
    const tip = page.getByRole("tooltip");
    expect(await tip.isVisible()).toBe(true);
    expect(await tip.textContent()).toContain("Media queries");
    await page.screenshot({ path: join(shots, "preset-mobile-note.png") });
    await page.mouse.move(10, 10);
    await page.locator(".frame-size-trigger").click();
    await page.getByLabel("Width", { exact: true }).fill("1000");
    await page.getByLabel("Height", { exact: true }).fill("700");
    await page.getByRole("button", { name: "Set" }).click();
    await page.waitForTimeout(100);
    const custom = await frame(page);
    expectFitted(custom, [1000, 700]);
    expect(custom.label).toBe("Custom · 1000 × 700");
    await page.screenshot({ path: join(shots, "custom-1000x700-fit.png") });

    await choose(page, "Wide");
    await page.getByRole("button", { name: "100%", exact: true }).click();
    await page.waitForTimeout(100);
    const actual = await frame(page);
    expect(actual.logical).toEqual([1440, 900]);
    expect(actual.transform).toBe("none");
    expect(actual.scale).toBe("100%");
    expect(actual.pressed).toEqual(["false", "true"]);
    // Switching to 100% keeps the last point under the pointer in view, within the stage's pan range.
    expect(actual.rect.left).toBeLessThanOrEqual(24.5);
    expect(actual.rect.left).toBeGreaterThanOrEqual(24 - (1440 - 852) - 0.5);
    // The stage pans under the wheel over its margin; host selection and portals follow the moved frame.
    await page.mouse.move(12, 400);
    await page.mouse.wheel(100, 60);
    await page.waitForTimeout(150);
    const panned = await frame(page);
    near(panned.rect.left, Math.max(24 - (1440 - 852), actual.rect.left - 100), "panned left");
    near(panned.rect.top, Math.max(48 - (900 - 728), actual.rect.top - 60), "panned top");
    // The document itself never scrolls: the frame pans inside its stage.
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    expect(await select(page, 3, 10)).toEqual({ target: [3, 10], coordinates: [3, 10] });
    await page.screenshot({ path: join(shots, "preset-wide-100.png") });
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.waitForTimeout(100);
    expectFitted(await frame(page), [1440, 900]);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);

    await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => [(window as any).frameQA.styles(), (window as any).frameQA.rules()])).toEqual(original);
    expect(await page.locator(".frame-bar").isVisible()).toBe(false);
    await page.keyboard.press("l");
    await page.waitForTimeout(350);
    expectFitted(await frame(page), [1440, 900]);
    await page.evaluate(() => (window as any).komo.destroy());
    expect(await page.evaluate(() => [(window as any).frameQA.styles(), (window as any).frameQA.rules()])).toEqual(original);
    expect(await page.locator(".frame-bar").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("ignores a size saved by an older version and remembers only explicit choices", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const key = "branch-comments:frame-size:frame-size:example/review";
    const stored = () => page.evaluate((key) => localStorage.getItem(key), key);
    await page.goto(`${origin}/`);
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ size: [879, 848], actual: false })), key);
    await open(page);
    const state = await frame(page);
    expectFitted(state, [1280, 800]);
    expect(state.label).toBe("Desktop · 1280 × 800");
    expect(state.scale).toBe("67%");
    expect(state.note).toBe(false);
    // The old entry is gone, and opening at the default stores nothing.
    expect(await stored()).toBeNull();
    await page.reload();
    await open(page);
    expect(await stored()).toBeNull();
    await choose(page, "Tablet");
    expect(JSON.parse((await stored())!)).toEqual({ v: 2, size: [768, 1024], actual: false });
    // Choosing the window again forgets the entry instead of pinning the default.
    await choose(page, "Your window");
    expect(await stored()).toBeNull();
    await context.close();
  });

  it("tips once that a scaled frame may offset floating UI, with 100% one click away", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await open(page);
    const hint = page.locator(".frame-hint");
    expect(await hint.isVisible()).toBe(true);
    expect(await hint.textContent()).toContain("Some floating UI may be offset while scaled. Use 100% to check exact positions.");
    // It sits inside the stage's bottom-left, clear of the bar and the page's header.
    const tip = (await hint.boundingBox())!;
    expect(tip.x).toBeGreaterThanOrEqual(24);
    expect(tip.y + tip.height).toBeLessThanOrEqual(48 + 728);
    expect(tip.y).toBeGreaterThan(400);
    await page.screenshot({ path: join(shots, "scaled-tip.png") });
    await hint.getByRole("button", { name: "Use 100%", exact: true }).click();
    await page.waitForTimeout(150);
    expect((await frame(page)).scale).toBe("100%");
    expect(await hint.isVisible()).toBe(false);
    // Seen through once, it stays away, also back at Fit and after a reload.
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.waitForTimeout(150);
    expect(await hint.isVisible()).toBe(false);
    await page.reload();
    await open(page);
    expect(await hint.isVisible()).toBe(false);
    await context.close();
  });

  it("resizes with edge and corner handles and arrow keys, and remembers the size per project", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await open(page);
    const edge = page.getByRole("slider", { name: "Frame width" });
    // At the default Fit scale a drag moves the edge with the pointer, in logical pixels.
    const scaled = (await edge.boundingBox())!;
    await page.mouse.move(scaled.x + scaled.width / 2, scaled.y + scaled.height / 2);
    await page.mouse.down();
    await page.mouse.move(scaled.x + scaled.width / 2 - 200, scaled.y + scaled.height / 2, { steps: 5 });
    await page.mouse.up();
    expectFitted(await frame(page), [Math.round(1280 - 200 / (852 / 1280)), 800]);
    await choose(page, "Available space");
    const handle = (await edge.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 - 200, handle.y + handle.height / 2, { steps: 5 });
    await page.waitForTimeout(50);
    expect(await page.locator(".frame-readout").textContent()).toBe("652 × 728");
    expect(await page.locator(".frame-readout").isVisible()).toBe(true);
    await page.mouse.up();
    expectFitted(await frame(page), [652, 728]);
    const corner = (await page.locator(".frame-corner").boundingBox())!;
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down();
    await page.mouse.move(corner.x + corner.width / 2 - 100, corner.y + corner.height / 2 - 128, { steps: 4 });
    await page.mouse.up();
    expectFitted(await frame(page), [552, 600]);
    await edge.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    expectFitted(await frame(page), [662, 600]);
    expect(await edge.getAttribute("aria-valuenow")).toBe("662");
    await page.locator(".frame-corner").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+ArrowLeft");
    expectFitted(await frame(page), [562, 610]);
    expect(await select(page, 6, 12)).toEqual({ target: [6, 12], coordinates: [6, 12] });

    await page.reload();
    await page.waitForFunction(() => !!(window as any).komo);
    await page.keyboard.press("l");
    await page.locator(".frame-bar").waitFor();
    await page.waitForTimeout(350);
    expectFitted(await frame(page), [562, 610]);
    expect((await frame(page)).label).toBe("Custom · 562 × 610");
    await page.close();
  });

  it("maps selection, pins, picking and portals through a fitted scale and follows window resizes", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await open(page, "?pins");
    await choose(page, "Wide");
    const state = await frame(page);
    expectFitted(state, [1440, 900]);
    expect(state.transform).not.toBe("none");
    // The grid is scrolled; both target and coordinate-derived selection stay logical.
    expect(await page.locator("#scroller").evaluate((node) => node.scrollTop)).toBe(480);
    for (const [day, hour] of [[0, 8], [3, 10], [6, 13]]) expect(await select(page, day, hour)).toEqual({ target: [day, hour], coordinates: [day, hour] });
    await page.locator("#scroller").evaluate((node) => { node.scrollTop = 620; });
    await page.waitForTimeout(250);
    expect(await select(page, 4, 14)).toEqual({ target: [4, 14], coordinates: [4, 14] });
    // A pin anchored to a slot sits on that slot.
    await page.locator("#scroller").evaluate((node) => { node.scrollTop = 480; });
    await page.waitForTimeout(400);
    const pin = (await page.locator('.pin[data-thread="fixture-thread"]').boundingBox())!;
    const slot = (await page.locator("#cell-4-11").boundingBox())!;
    expect(pin.x).toBeGreaterThanOrEqual(slot.x - pin.width);
    expect(pin.x).toBeLessThanOrEqual(slot.x + slot.width);
    expect(pin.y).toBeGreaterThanOrEqual(slot.y - pin.height);
    expect(pin.y).toBeLessThanOrEqual(slot.y + slot.height);
    // Comment picking outlines the hovered slot in its scaled position.
    await page.keyboard.press("c");
    const target = (await page.locator("#cell-2-9").boundingBox())!;
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.waitForTimeout(200);
    const outline = (await page.locator(".component-hover").boundingBox())!;
    near(outline.x, target.x, "outline left", 3);
    near(outline.y, target.y, "outline top", 3);
    near(outline.width, target.width, "outline width", 6);
    await page.keyboard.press("Escape");
    await page.keyboard.press("v");
    // A centred portal dialog sits centred in the scaled frame at the frame's scale.
    await page.locator("#create").click();
    await page.waitForTimeout(150);
    const dialog = (await page.locator("#dialog").boundingBox())!;
    const ratio = state.rect.width / 1440;
    near(dialog.x + dialog.width / 2, state.rect.left + state.rect.width / 2, "dialog centre x");
    near(dialog.y + dialog.height / 2, state.rect.top + state.rect.height / 2, "dialog centre y");
    near(dialog.width, 320 * ratio, "dialog width");
    await page.screenshot({ path: join(shots, "fit-desktop-portal-pin.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    const resized = await frame(page);
    expectFitted(resized, [1440, 900], [1440, 900]);
    expect(resized.note).toBe(false);
    const moved = (await page.locator("#dialog").boundingBox())!;
    near(moved.x + moved.width / 2, resized.rect.left + resized.rect.width / 2, "resized dialog centre x");
    expect(await select(page, 1, 9)).toEqual({ target: [1, 9], coordinates: [1, 9] });
    await page.screenshot({ path: join(shots, "fit-desktop-1440x900-window.png") });
    await page.close();
  });

  it("opens cards beside their pin, unscaled and inside the review area, at Fit and 100%", async () => {
    // A review area narrower than a card beside the pin on either side, and a roomy one.
    for (const viewport of [{ width: 946, height: 800 }, { width: 1280, height: 800 }]) {
      const page = await browser.newPage({ viewport });
      await open(page, "?pins");
      const shadow = (selector: string) => page.evaluate((selector) => {
        const node = [...document.body.children].find((child) => child.shadowRoot)!.shadowRoot!.querySelector(selector);
        if (!node) return null;
        const { left, top, right, bottom } = node.getBoundingClientRect();
        return { left, top, right, bottom, scale: getComputedStyle(node).scale, transform: getComputedStyle(node).transform };
      }, selector);
      const area = async () => {
        const main = await page.locator("main").evaluate((node) => node.getBoundingClientRect().bottom);
        return { left: 12, top: 12, right: viewport.width - 396, bottom: Math.min(viewport.height, main) - 12 };
      };
      const gap = (a: { left: number; top: number; right: number; bottom: number }, b: { x: number; y: number; width: number; height: number }) =>
        Math.hypot(Math.max(0, a.left - b.x - b.width, b.x - a.right), Math.max(0, a.top - b.y - b.height, b.y - a.bottom));
      const expectBeside = async (card: Awaited<ReturnType<typeof shadow>>, target: { x: number; y: number; width: number; height: number }, label: string) => {
        expect(card, label).not.toBeNull();
        const bounds = await area();
        expect(card!.left, `${label} left`).toBeGreaterThanOrEqual(bounds.left - 1);
        expect(card!.right, `${label} right`).toBeLessThanOrEqual(bounds.right + 1);
        expect(card!.top, `${label} top`).toBeGreaterThanOrEqual(bounds.top - 1);
        expect(card!.bottom, `${label} bottom`).toBeLessThanOrEqual(bounds.bottom + 1);
        expect(gap(card!, target), `${label} gap to its pin`).toBeLessThanOrEqual(24);
        // Beside the pin, never over it or the point it marks.
        const overlap = Math.max(0, Math.min(card!.right, target.x + target.width) - Math.max(card!.left, target.x)) *
          Math.max(0, Math.min(card!.bottom, target.y + target.height) - Math.max(card!.top, target.y));
        expect(overlap, `${label} covers its pin`).toBeLessThanOrEqual(target.width * target.height > 1 ? 4 : 0);
        expect([card!.transform, card!.scale].every((value) => value === "none" || value === "matrix(1, 0, 0, 1, 0, 0)" || value === "1"), `${label} unscaled`).toBe(true);
      };
      for (const [name, zoom] of [["custom", "Fit"], ["custom", "100%"], ["Wide", "Fit"], ["Mobile", "Fit"], ["Available space", "Fit"], ["Wide", "100%"]]) {
        if (name === "custom") {
          await page.locator(".frame-size-trigger").click();
          await page.getByLabel("Width", { exact: true }).fill("978");
          await page.getByLabel("Height", { exact: true }).fill("887");
          await page.getByRole("button", { name: "Set" }).click();
        } else await choose(page, name);
        await page.getByRole("button", { name: zoom, exact: true }).click();
        await page.waitForTimeout(150);
        const state = await frame(page);
        for (const [thread, cellId] of [["fixture-thread", "cell-4-11"], ["centre-thread", "cell-3-13"]]) {
          const pin = page.locator(`.pin[data-thread="${thread}"]`);
          if (zoom === "100%") {
            await reveal(page, `#${cellId}`);
            await page.waitForTimeout(400);
          }
          const label = `${viewport.width}px window, ${state.label} at ${state.scale}, ${thread}`;
          await page.mouse.move(2, 2);
          await page.waitForTimeout(150);
          await pin.hover();
          await page.waitForTimeout(400);
          const target = (await pin.boundingBox())!;
          await expectBeside(await shadow(".pin-preview:not([hidden])"), target, `${label} hover card`);
          await page.screenshot({ path: join(shots, `cards-${viewport.width}-${name.split(" ")[0].toLowerCase()}-${zoom === "Fit" ? "fit" : "100"}-${thread.split("-")[0]}-hover.png`) });
          // The new-comment composer opens beside the point that was clicked.
          await page.mouse.move(2, 2);
          await page.keyboard.press("c");
          const cell = (await page.locator("#cell-3-10").boundingBox())!;
          const point = { x: Math.max(cell.x + 4, Math.min(cell.x + cell.width / 2, viewport.width - 400)), y: cell.y + cell.height / 2 };
          await page.mouse.click(point.x, point.y);
          await page.waitForTimeout(300);
          await expectBeside(await shadow(".new-comment-composer"), { x: point.x - 0.5, y: point.y - 0.5, width: 1, height: 1 }, `${label} composer`);
          await page.screenshot({ path: join(shots, `cards-${viewport.width}-${name.split(" ")[0].toLowerCase()}-${zoom === "Fit" ? "fit" : "100"}-${thread.split("-")[0]}-composer.png`) });
          await page.keyboard.press("Escape");
          await page.keyboard.press("Escape");
          await page.keyboard.press("v");
          // Design mode opens threads as floating cards rather than in the sidebar.
          await openDesign(page);
          await page.waitForTimeout(400);
          if (zoom === "100%") {
            await reveal(page, `#${cellId}`);
            await page.waitForTimeout(400);
          }
          await pin.click({ force: true });
          await page.waitForTimeout(400);
          await expectBeside(await shadow(".dialog:has(.messages)"), (await pin.boundingBox())!, `${label} thread card`);
          await page.screenshot({ path: join(shots, `cards-${viewport.width}-${name.split(" ")[0].toLowerCase()}-${zoom === "Fit" ? "fit" : "100"}-${thread.split("-")[0]}-thread.png`) });
          await page.keyboard.press("Escape");
          await page.keyboard.press("Escape");
          await page.keyboard.press("d");
          await page.waitForTimeout(400);
        }
      }
      await page.close();
    }
  }, 120_000);
});
