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
      const threads=location.search.includes('pins')?[{id:'fixture-thread',page:'/',anchor,resolved:false,resolvedBy:null,createdAt:1,updatedAt:1,tags:[],comments:[{id:'fixture-comment',author:user,body:'Check this slot',createdAt:1,editedAt:null,reactions:{}}]}]:[];
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
      pressed: [...shadow.querySelectorAll(".frame-zoom button")].map((button) => button.getAttribute("aria-pressed")),
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
  it("fits by default, applies presets and a custom size at Fit and 100%, and restores exactly", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const original = await open(page);
    const fitted = await frame(page);
    expectFitted(fitted, [852, 728]);
    expect(fitted.transform).toBe("none");
    expect(fitted.label).toBe("Fit · 852 × 728");
    expect(fitted.pressed).toEqual(["true", "false"]);
    await page.screenshot({ path: join(shots, "fit-default.png") });
    for (const [name, width, height] of [["Desktop", 1440, 900], ["Laptop", 1280, 800], ["Tablet", 768, 1024], ["Mobile", 390, 844]] as const) {
      await choose(page, name);
      const state = await frame(page);
      expectFitted(state, [width, height]);
      expect(state.label).toBe(`${name} · ${width} × ${height}`);
      expect(await select(page, 2, 9)).toEqual({ target: [2, 9], coordinates: [2, 9] });
      await page.screenshot({ path: join(shots, `preset-${name.toLowerCase()}-fit.png`) });
    }
    await page.locator(".frame-size-trigger").click();
    await page.getByLabel("Width", { exact: true }).fill("1000");
    await page.getByLabel("Height", { exact: true }).fill("700");
    await page.getByRole("button", { name: "Set" }).click();
    await page.waitForTimeout(100);
    const custom = await frame(page);
    expectFitted(custom, [1000, 700]);
    expect(custom.label).toBe("Custom · 1000 × 700");
    await page.screenshot({ path: join(shots, "custom-1000x700-fit.png") });

    await choose(page, "Desktop");
    await page.getByRole("button", { name: "100%", exact: true }).click();
    await page.waitForTimeout(100);
    const actual = await frame(page);
    expect(actual.logical).toEqual([1440, 900]);
    expect(actual.transform).toBe("none");
    expect(actual.scale).toBe("100%");
    expect(actual.pressed).toEqual(["false", "true"]);
    near(actual.rect.left, 24, "100% left");
    // The page pans; host selection and portals follow the moved frame.
    await page.mouse.wheel(0, 0);
    await page.evaluate(() => window.scrollTo(400, 120));
    await page.waitForTimeout(100);
    const panned = await frame(page);
    near(panned.rect.left, 24 - 400, "panned left");
    near(panned.rect.top, 48 - 120, "panned top");
    expect(await select(page, 3, 10)).toEqual({ target: [3, 10], coordinates: [3, 10] });
    await page.screenshot({ path: join(shots, "preset-desktop-100.png") });
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

  it("resizes with edge and corner handles and arrow keys, and remembers the size per project", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await open(page);
    const edge = page.getByRole("slider", { name: "Frame width" });
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
    await choose(page, "Desktop");
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
    const moved = (await page.locator("#dialog").boundingBox())!;
    near(moved.x + moved.width / 2, resized.rect.left + resized.rect.width / 2, "resized dialog centre x");
    expect(await select(page, 1, 9)).toEqual({ target: [1, 9], coordinates: [1, 9] });
    await page.screenshot({ path: join(shots, "fit-desktop-1440x900-window.png") });
    await page.close();
  });
});
