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
const shots = join(tmpdir(), "komo-frame-pan");
let directory: string, origin: string;
let server: Server, browser: Browser;

// An app shell fixed to 100vh: a header with actions, a long inner list, and a drag target.
const page = `<!doctype html><style>body{margin:0;font:14px system-ui;color:#0f172a}
.app{display:flex;flex-direction:column;height:100vh;overflow:hidden;background:#fff}.bar{display:flex;gap:8px;align-items:center;height:52px;flex:none;padding:0 16px;border-bottom:1px solid #cbd5e1}
.body{display:flex;flex:1;min-height:0}.list{width:320px;flex:none;overflow:auto;border-right:1px solid #cbd5e1}.list p{margin:0;padding:12px 16px;border-bottom:1px solid #e2e8f0}
.canvas{position:relative;flex:1}#target{position:absolute;left:900px;top:700px;width:160px;height:90px;background:#ddd6fe;border:2px solid #7c3aed}
#knob{position:absolute;left:400px;top:300px;width:60px;height:60px;background:#fde68a}</style>
<main><div class="app"><header class="bar"><strong>Board</strong><button id="action">Action</button><input id="field" aria-label="Field"></header>
<div class="body"><div class="list" id="list"></div><div class="canvas" id="canvas"><div id="knob"></div><div id="target">Target</div></div></div></div></main>
<script type="module" src="/entry.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-frame-pan-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      import {captureAnchor} from ${JSON.stringify(resolve("src/anchors.ts"))};
      const list=document.getElementById('list');
      for(let index=0;index<60;index++){const row=document.createElement('p');row.textContent='Row '+index;list.append(row);}
      const qa=window.panQA={clicks:0,doubles:0,drags:[]};
      document.getElementById('action').addEventListener('click',()=>qa.clicks++);
      document.getElementById('target').addEventListener('dblclick',()=>qa.doubles++);
      const knob=document.getElementById('knob');
      knob.addEventListener('pointerdown',event=>{
        knob.setPointerCapture(event.pointerId);
        const start={x:event.clientX,y:event.clientY,left:knob.offsetLeft,top:knob.offsetTop};
        const move=event=>{knob.style.left=start.left+event.clientX-start.x+'px';knob.style.top=start.top+event.clientY-start.y+'px';};
        knob.addEventListener('pointermove',move);
        knob.addEventListener('pointerup',()=>{knob.removeEventListener('pointermove',move);qa.drags.push([knob.offsetLeft,knob.offsetTop]);},{once:true});
      });
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':frame-pan';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      // A Custom 1600 x 1200 frame at 100%: larger than its stage on both axes.
      localStorage.setItem('branch-comments:frame-size:frame-pan:example/review',JSON.stringify({v:2,size:[1600,1200],actual:true}));
      const target=document.getElementById('target'),box=target.getBoundingClientRect(),point={x:box.left+20,y:box.top+20};
      const threads=[{id:'pan-thread',page:'/',anchor:captureAnchor(target,point,point),resolved:false,resolvedBy:null,createdAt:1,updatedAt:1,tags:[],comments:[{id:'pan-comment',author:user,body:'On the target',createdAt:1,editedAt:null,reactions:{}}]}];
      window.fetch=async input=>{
        const path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url).pathname;
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads}:{});
      };
      window.komo=initKomo({endpoint:location.origin,project:'frame-pan',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,pollInterval:60000});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      return response.end(page);
    }
    try {
      const file = resolve(directory, `.${path}`);
      if (!file.startsWith(directory + "/")) throw new Error("outside fixture");
      response.setHeader("content-type", "text/javascript");
      response.end(await readFile(file));
    } catch { response.statusCode = 404; response.end(); }
  }).listen(0);
  origin = `http://localhost:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-blink-features=EyeDropperAPI"] });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

// The stage beside the comments in a 1280 x 800 window, and what the frame has beyond it.
const stage = { left: 24, top: 48, width: 852, height: 728 };
const range = [1600 - stage.width, 1200 - stage.height];
async function open(tab: Page) {
  tab.setDefaultTimeout(6000);
  await tab.goto(`${origin}/`);
  await tab.waitForFunction(() => !!(window as any).komo);
  await tab.keyboard.press("l");
  await tab.locator(".frame-bar").waitFor();
  await tab.waitForTimeout(350);
}
const frame = (tab: Page) => tab.locator("main").evaluate((node) => {
  const rect = node.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, scroll: [scrollX, scrollY] };
});
/** The pan, from where the frame sits against the stage. */
const panOf = async (tab: Page) => {
  const rect = await frame(tab);
  return [Math.round(stage.left - rect.left), Math.round(stage.top - rect.top)];
};
const margin = { x: 12, y: 400 };
async function wheel(tab: Page, at: { x: number; y: number }, dx: number, dy: number) {
  await tab.mouse.move(at.x, at.y);
  await tab.mouse.wheel(dx, dy);
  await tab.waitForTimeout(120);
}
/** Panning applies on the next animation frame. */
async function press(tab: Page, key: string) {
  await tab.keyboard.press(key);
  await tab.waitForTimeout(80);
}
const center = async (tab: Page, selector: string) => {
  const box = (await tab.locator(selector).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

describe.skipIf(!chrome)("panning a 100% Frame inside its stage", () => {
  it("shows scrollbars and pans on both axes with the wheel, Shift+wheel and the keyboard, never scrolling the document", async () => {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    await open(tab);
    expect(await tab.locator(".frame-bar .frame-size-trigger").textContent()).toBe("Custom · 1600 × 1200");
    expect(await tab.locator('.frame-scroll[data-axis="x"]').isVisible()).toBe(true);
    expect(await tab.locator('.frame-scroll[data-axis="y"]').isVisible()).toBe(true);
    const start = await panOf(tab);
    await wheel(tab, margin, 200, 120);
    expect(await panOf(tab)).toEqual([Math.min(range[0], start[0] + 200), Math.min(range[1], start[1] + 120)]);
    // Shift turns the wheel horizontal.
    const before = await panOf(tab);
    await tab.keyboard.down("Shift");
    await wheel(tab, margin, 0, 100);
    await tab.keyboard.up("Shift");
    const shifted = await panOf(tab);
    expect(shifted[1]).toBe(before[1]);
    expect(shifted[0]).toBe(Math.min(range[0], before[0] + 100));
    // The frame's far corner is reachable.
    await wheel(tab, margin, 5000, 5000);
    expect(await panOf(tab)).toEqual(range);
    const end = await frame(tab);
    expect(Math.round(end.bottom)).toBe(stage.top + stage.height);
    expect(Math.round(end.right)).toBe(stage.left + stage.width);
    expect(end.scroll).toEqual([0, 0]);
    await tab.screenshot({ path: join(shots, "panned-corner.png") });
    // Clicking the margin focuses the stage; the keys pan.
    await tab.mouse.click(margin.x, margin.y);
    expect(await tab.evaluate(() => [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!.activeElement?.className)).toBe("frame-scroll");
    await press(tab, "Home");
    expect((await panOf(tab))[1]).toBe(0);
    await press(tab, "PageDown");
    expect((await panOf(tab))[1]).toBe(Math.min(range[1], Math.round(stage.height * 0.9)));
    await press(tab, "End");
    expect((await panOf(tab))[1]).toBe(range[1]);
    await press(tab, "ArrowLeft");
    expect((await panOf(tab))[0]).toBe(range[0] - 40);
    await press(tab, "Shift+Home");
    expect((await panOf(tab))[0]).toBe(0);
    // Keyboard focus beyond the stage brings it into view.
    await press(tab, "End");
    await tab.locator("#action").focus();
    await tab.waitForTimeout(80);
    const action = (await tab.locator("#action").boundingBox())!;
    expect(action.y).toBeGreaterThanOrEqual(stage.top);
    expect(action.y + action.height).toBeLessThanOrEqual(stage.top + stage.height);
    // Back to Fit resets the pan.
    await tab.getByRole("button", { name: "Fit", exact: true }).click();
    await tab.waitForTimeout(150);
    expect(await tab.locator('.frame-scroll[data-axis="y"]').isVisible()).toBe(false);
    expect(errors).toEqual([]);
    await tab.close();
  });

  it("lets the app's own scrollers go first and chains to the stage at their end, so a 100vh shell's bottom is reachable", async () => {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await open(tab);
    await wheel(tab, margin, -5000, -5000);
    expect(await panOf(tab)).toEqual([0, 0]);
    const list = await center(tab, "#list");
    await wheel(tab, list, 0, 300);
    expect(await tab.locator("#list").evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    expect(await panOf(tab)).toEqual([0, 0]);
    // At the list's end the stage takes over.
    await tab.locator("#list").evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await wheel(tab, list, 0, 300);
    expect((await panOf(tab))[1]).toBe(300);
    // Over the app's non-scrolling canvas, the stage pans straight away.
    await wheel(tab, { x: 700, y: 400 }, 0, 1000);
    expect((await panOf(tab))[1]).toBe(range[1]);
    await tab.close();
  });

  it("pans with Space+drag from anywhere without clicking through, and leaves Space to text fields", async () => {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await open(tab);
    await wheel(tab, margin, 300, 200);
    const before = await panOf(tab);
    // Over the app's knob, which would otherwise drag.
    const action = await center(tab, "#knob");
    await tab.mouse.move(action.x, action.y);
    await tab.keyboard.down(" ");
    expect(await tab.locator(".frame-hand").isVisible()).toBe(true);
    expect(await tab.locator(".frame-hand").evaluate((node) => getComputedStyle(node).cursor)).toBe("grab");
    await tab.mouse.down();
    expect(await tab.locator(".frame-hand").evaluate((node) => getComputedStyle(node).cursor)).toBe("grabbing");
    await tab.mouse.move(action.x + 120, action.y + 80, { steps: 4 });
    await tab.mouse.up();
    await tab.keyboard.up(" ");
    await tab.waitForTimeout(100);
    expect(await panOf(tab)).toEqual([before[0] - 120, before[1] - 80]);
    expect(await tab.locator(".frame-hand").isVisible()).toBe(false);
    expect(await tab.evaluate(() => (window as any).panQA.drags)).toEqual([]);
    // Typing keeps its spaces.
    await wheel(tab, margin, -5000, -5000);
    await tab.locator("#field").click();
    await tab.keyboard.type("a b");
    expect(await tab.locator("#field").inputValue()).toBe("a b");
    expect(await tab.locator(".frame-hand").isVisible()).toBe(false);
    await tab.close();
  });

  it("keeps the point under the pointer when Fit switches to 100%", async () => {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await open(tab);
    await tab.getByRole("button", { name: "Fit", exact: true }).click();
    await tab.waitForTimeout(200);
    const target = await center(tab, "#target");
    await tab.mouse.move(target.x, target.y);
    await tab.waitForTimeout(50);
    await tab.getByRole("button", { name: "100%", exact: true }).click();
    await tab.waitForTimeout(200);
    // The target's middle stays under where the pointer was.
    const after = (await tab.locator("#target").boundingBox())!;
    expect(target.x).toBeGreaterThanOrEqual(after.x - 1);
    expect(target.x).toBeLessThanOrEqual(after.x + after.width + 1);
    expect(target.y).toBeGreaterThanOrEqual(after.y - 1);
    expect(target.y).toBeLessThanOrEqual(after.y + after.height + 1);
    await tab.close();
  });

  it("keeps clicks, double-clicks, drags and pins on the app after panning, with pins moving in the same frame", async () => {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await open(tab);
    // The header's action is in view at the top-left; pan right a little first.
    await wheel(tab, margin, -5000, -5000);
    await wheel(tab, margin, 30, 0);
    const action = await center(tab, "#action");
    await tab.mouse.click(action.x, action.y);
    expect(await tab.evaluate(() => (window as any).panQA.clicks)).toBe(1);
    const knob = await center(tab, "#knob");
    await tab.mouse.move(knob.x, knob.y);
    await tab.mouse.down();
    await tab.mouse.move(knob.x + 50, knob.y + 30, { steps: 3 });
    await tab.mouse.up();
    expect(await tab.evaluate(() => (window as any).panQA.drags)).toEqual([[450, 330]]);
    await wheel(tab, margin, 500, 400);
    const target = await center(tab, "#target");
    await tab.mouse.dblclick(target.x, target.y);
    expect(await tab.evaluate(() => (window as any).panQA.doubles)).toBe(1);
    // The pin and its element move together within one animation frame of the wheel.
    const pin = tab.locator('.pin[data-thread="pan-thread"]');
    await pin.waitFor();
    await tab.mouse.move(margin.x, margin.y);
    const offsets = await tab.evaluate(async () => {
      const root = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
      const read = () => {
        const pin = root.querySelector('.pin[data-thread="pan-thread"]')!.getBoundingClientRect();
        const target = document.getElementById("target")!.getBoundingClientRect();
        return [Math.round(pin.left - target.left), Math.round(pin.top - target.top)];
      };
      const before = read();
      document.elementFromPoint(12, 400)!.dispatchEvent(new WheelEvent("wheel", { deltaX: -60, deltaY: -40, bubbles: true, cancelable: true, clientX: 12, clientY: 400 }));
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      return [before, read()];
    });
    expect(offsets[1]).toEqual(offsets[0]);
    await tab.screenshot({ path: join(shots, "panned-pin.png") });
    await tab.close();
  });
});
