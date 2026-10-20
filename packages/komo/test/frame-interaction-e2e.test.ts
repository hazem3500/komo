import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-frame-interaction-"));
  await build({
    stdin: { contents: `
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      const grid=document.querySelector('#grid'),scroller=document.querySelector('#scroller');
      const tile=document.querySelector('#tile'),popover=document.querySelector('#popover');
      for(let index=0;index<24;index++){const row=document.createElement('div');row.textContent='Row '+index;row.style.cssText='height:60px;box-sizing:border-box;padding:16px;color:#475569';grid.append(row);}
      const qa=window.gridQA={slot:null,events:[],grid,scroller,tile,popover};
      qa.styles=()=>[document.querySelector('main'),document.body,document.documentElement].map(node=>node.getAttribute('style'));
      qa.baseline=qa.styles();
      function position(){
        if(qa.slot===null)return;
        const box=tile.getBoundingClientRect();
        popover.style.transform='translate('+Math.round(box.left+20)+'px,'+Math.round(box.top)+'px)';
      }
      grid.addEventListener('pointerdown',event=>{
        const root=document.querySelector('main');
        qa.events.push({trusted:event.isTrusted,pointer:event.pointerType,y:event.clientY,moving:root.getAnimations().some(animation=>animation.playState==='running'),transform:getComputedStyle(root).transform});
        qa.slot=Math.floor((event.clientY-grid.getBoundingClientRect().top)/60);
        tile.style.top=qa.slot*60+'px';tile.hidden=false;popover.hidden=false;
        popover.textContent='Selected row '+qa.slot;position();
      });
      scroller.scrollTop=500;
      scroller.addEventListener('scroll',position);window.addEventListener('resize',position);
      window.fetch=async()=>Response.json({threads:[],guests:true});
      window.mountGridQA=()=>initKomo({endpoint:location.origin,project:'grid-review',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',frame:{scale:new URLSearchParams(location.search).get('mode')==='scaled'},restoreOpen:false,shortcuts:new URLSearchParams(location.search).has('parity')?{comments:'Shift+L'}:undefined,pollInterval:60000});
      // These cases cover the unscaled in-place frame: the space beside the comments.
      localStorage.setItem('branch-comments:frame-size:grid-review:example/review',JSON.stringify({size:'available'}));
      window.komo=window.mountGridQA();
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<style>html,body{overscroll-behavior:none}body{margin:0;font:16px system-ui}main{height:100vh;overflow:hidden}#scroller{height:100%;overflow:auto}#grid{position:relative;height:1440px;background:repeating-linear-gradient(#fff 0 59px,#cbd5e1 59px 60px)}#tile{position:absolute;left:20px;right:20px;height:58px;background:#e9d7fe;border:1px solid #9e77ed;box-sizing:border-box;pointer-events:none}#popover{position:fixed;left:0;top:0;width:240px;height:120px;box-sizing:border-box;background:#fff;border:1px solid #aaa;border-radius:10px;padding:20px;box-shadow:0 4px 20px #0002}</style><main><div id="scroller"><div id="grid"><div id="tile" hidden></div></div></div></main><div id="popover" role="dialog" aria-label="Grid preview" hidden></div><script type="module" src="/entry.js"></script>`);
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

describe.skipIf(!chrome).each(["reflow", "scaled"])("Frame style attributes in %s", mode => {
  it.each(["no-preference", "reduce"] as const)("matches native pointer and configured shortcut motion with reduced motion=%s", async reducedMotion => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion });
    await page.goto(`${origin}/?mode=${mode}&parity=1`);
    await page.waitForFunction(() => !!(window as any).komo && [...document.body.children].some((node) => node.shadowRoot?.querySelector(".frame-bar")));
    const original = await page.evaluate(() => (window as any).gridQA.styles());
    const trace = async (run: () => Promise<unknown>) => {
      await page.evaluate(() => {
        const trace = (window as any).motionQA = { frames: [] as string[], samples: [] as number[], done: false };
        const root = document.querySelector("main")!;
        let count = 0;
        const sample = () => {
          const transform = getComputedStyle(root).transform;
          trace.samples.push(transform === "none" ? 1 : new DOMMatrix(transform).a);
          for (const animation of root.getAnimations()) {
            const frames = JSON.stringify((animation.effect as KeyframeEffect).getKeyframes());
            if (!trace.frames.includes(frames)) trace.frames.push(frames);
          }
          if (count++ < 24) requestAnimationFrame(sample);
          else trace.done = true;
        };
        requestAnimationFrame(sample);
      });
      await run();
      await page.waitForFunction(() => (window as any).motionQA.done);
      return page.evaluate(() => (window as any).motionQA as { frames: string[]; samples: number[] });
    };
    const key = () => page.keyboard.press("Shift+L");
    const button = () => page.locator('.morphing-menu__shortcut[data-menu-item="comments"]').click();
    for (const opening of [true, false]) {
      if (!opening) { await button(); await page.waitForTimeout(300); }
      const keyboard = await trace(key);
      if (reducedMotion === "reduce") expect(keyboard.frames).toEqual([]);
      else expect(keyboard.frames.length).toBeGreaterThan(0);
      if (mode === "reflow") expect(keyboard.samples.every(value => value === 1)).toBe(true);
      await trace(button);
      const pointer = await trace(button);
      expect(pointer.frames).toEqual(keyboard.frames);
      if (mode === "reflow") expect(pointer.samples.every(value => value === 1)).toBe(true);
      if (opening) await trace(button);
    }
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).gridQA.styles())).toEqual(original);
    expect(await page.locator("main").evaluate(node => node.getAnimations().length)).toBe(0);
    await page.evaluate(() => (window as any).komo.destroy());
    expect(await page.evaluate(() => (window as any).gridQA.styles())).toEqual(original);
    await page.close();
  });

  it.each(["no-preference", "reduce"] as const)("preserves absent attributes through close, dismiss and interrupted motion with reduced motion=%s", async reducedMotion => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion });
    await page.goto(`${origin}/?mode=${mode}`);
    await page.waitForFunction(() => !!(window as any).komo && [...document.body.children].some((node) => node.shadowRoot?.querySelector(".frame-bar")));
    const styles = () => page.evaluate(() => (window as any).gridQA.styles());
    const original = await page.evaluate(() => (window as any).gridQA.baseline);
    expect(original).toEqual([null, null, null]);
    expect(await styles()).toEqual(original);
    await page.keyboard.press("l");
    await page.waitForFunction(() => document.querySelector("main")!.getBoundingClientRect().width < 900);
    await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
    await page.waitForTimeout(550);
    expect(await styles()).toEqual(original);
    for (let index = 0; index < 4; index++) {
      await page.keyboard.press("l");
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(550);
    expect(await styles()).toEqual(original);
    await page.keyboard.press("l");
    await page.waitForFunction(() => document.querySelector("main")!.getBoundingClientRect().width < 900);
    await page.locator('.morphing-menu__shortcut[data-menu-item="dismiss"]').click();
    await page.waitForTimeout(550);
    expect(await styles()).toEqual(original);
    expect(await page.locator("main").evaluate(node => node.getAnimations().length)).toBe(0);
    expect(await page.locator("main").evaluate(node => getComputedStyle(node).transform)).toBe("none");
    await page.evaluate(() => (window as any).komo.destroy());
    expect(await styles()).toEqual(original);
    await page.close();
  });
});

describe.skipIf(!chrome).each([false, true])("native grid coordinates with touch=%s", touch => {
  it("keeps logical input correct during rapid native key and pointer reflow motion", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: touch, reducedMotion: "no-preference" });
    const page = await context.newPage();
    await page.goto(`${origin}/?parity=1`);
    await page.waitForFunction(() => !!(window as any).komo && [...document.body.children].some((node) => node.shadowRoot?.querySelector(".frame-bar")));
    const original = await page.evaluate(() => (window as any).gridQA.styles());
    const client = touch ? await context.newCDPSession(page) : null;
    for (let index = 0; index < 6; index++) {
      await page.locator("#popover").evaluate(node => { (node as HTMLElement).hidden = true; });
      if (index % 2) await page.locator('.morphing-menu__shortcut[data-menu-item="comments"]').click();
      else await page.keyboard.press("Shift+L");
      const point = await page.locator("#grid").evaluate(node => {
        const box = node.getBoundingClientRect();
        return { x: box.left + 280, y: box.top + 15 * 60 + 15 };
      });
      if (client) {
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else await page.mouse.click(point.x, point.y);
      expect(await page.evaluate(() => (window as any).gridQA.slot)).toBe(15);
      await page.waitForFunction(() => {
        const qa = (window as any).gridQA;
        return Math.abs(qa.tile.getBoundingClientRect().top - qa.popover.getBoundingClientRect().top) < 1;
      });
    }
    expect(await page.evaluate(() => (window as any).gridQA.events.every((event: any) => event.trusted && event.moving && event.transform === "none"))).toBe(true);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).gridQA.styles())).toEqual(original);
    await page.evaluate(() => (window as any).komo.destroy());
    expect(await page.evaluate(() => (window as any).gridQA.styles())).toEqual(original);
    await context.close();
  });

  it("preserves selected local data and virtual-anchor geometry through Frame, scroll, resize and teardown", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: touch });
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => !!(window as any).komo && [...document.body.children].some((node) => node.shadowRoot?.querySelector(".frame-bar")));
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const original = await page.locator("main").getAttribute("style");
    const parent = await page.locator("main").evaluate(node => node.parentElement === document.body);
    const client = touch ? await context.newCDPSession(page) : null;
    const choose = async (slot: number) => {
      await page.locator("#popover").evaluate(node => { (node as HTMLElement).hidden = true; });
      const point = await page.locator("#grid").evaluate((node, slot) => {
        const box = node.getBoundingClientRect();
        return { x: box.left + 280 * box.width / (node as HTMLElement).offsetWidth, y: box.top + (slot * 60 + 15) * box.height / (node as HTMLElement).offsetHeight };
      }, slot);
      if (client) {
        await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else await page.mouse.click(point.x, point.y);
      expect(await page.evaluate(() => (window as any).gridQA.slot)).toBe(slot);
      await page.waitForFunction(() => {
        const qa = (window as any).gridQA;
        return Math.abs(qa.tile.getBoundingClientRect().top - qa.popover.getBoundingClientRect().top) < 1;
      });
      expect(await page.evaluate(() => (window as any).gridQA.grid === document.querySelector("#grid"))).toBe(true);
    };
    await choose(15);
    await page.keyboard.press("l");
    await page.waitForFunction(() => document.querySelector("main")!.getBoundingClientRect().width < 900);
    await page.waitForTimeout(400);
    await choose(15);
    expect(await page.locator("main").evaluate(node => getComputedStyle(node).transform)).toBe("none");
    await page.locator("#scroller").evaluate(node => { node.scrollTop = 620; });
    await choose(17);
    await page.setViewportSize({ width: 1120, height: 700 });
    await page.waitForTimeout(200);
    await choose(17);
    const bounds = await page.locator("main").boundingBox();
    const popup = await page.locator("#popover").boundingBox();
    expect(popup!.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(popup!.x + popup!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
    expect(await page.evaluate(() => (window as any).gridQA.events.every((event: any) => event.trusted && event.pointer === (navigator.maxTouchPoints ? 'touch' : 'mouse')))).toBe(true);
    await page.evaluate(() => (window as any).komo.destroy());
    expect(await page.locator("main").getAttribute("style")).toBe(original);
    expect(await page.locator("main").evaluate(node => node.parentElement === document.body)).toBe(parent);
    await choose(17);
    expect(errors).toEqual([]);
    await context.close();
  });
});

it.skipIf(!chrome)("restores Frame-owned declarations and priorities while retaining independent host styles", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(origin);
  await page.waitForFunction(() => !!(window as any).komo && [...document.body.children].some((node) => node.shadowRoot?.querySelector(".frame-bar")));
  await page.evaluate(() => {
    (window as any).komo.destroy();
    const root = document.querySelector<HTMLElement>("main")!;
    root.style.setProperty("width", "100%", "important");
    root.style.setProperty("background", "rgb(250, 250, 250)", "important");
    document.documentElement.style.setProperty("overflow", "auto", "important");
    document.body.style.setProperty("background", "rgb(245, 245, 245)", "important");
  });
  await page.evaluate(() => { (window as any).komo=(window as any).mountGridQA(); });
  await page.keyboard.press("l");
  await page.waitForFunction(() => document.querySelector("main")!.getBoundingClientRect().width < 900);
  await page.locator("main").evaluate(node => { (node as HTMLElement).style.color = "rgb(1, 2, 3)"; });
  await page.evaluate(() => (window as any).komo.destroy());
  expect(await page.locator("main").evaluate(node => {
    const style = (node as HTMLElement).style;
    return [style.width, style.getPropertyPriority("width"), style.background, style.getPropertyPriority("background"), style.color];
  })).toEqual(["100%", "important", "rgb(250, 250, 250)", "important", "rgb(1, 2, 3)"]);
  expect(await page.locator("html").evaluate(node => (node as HTMLElement).style.getPropertyPriority("overflow"))).toBe("important");
  expect(await page.locator("body").evaluate(node => (node as HTMLElement).style.getPropertyPriority("background"))).toBe("important");
  await page.close();
});
