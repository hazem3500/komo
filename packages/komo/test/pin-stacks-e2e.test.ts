// Same-target stacks and collision bubbles in real Chrome; uses only a synthetic loopback fixture.
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

// Three comments on one row, five on another (collapses to "+4"), two pins on neighbouring
// chips whose hit areas overlap, two pins 30px apart that only collide once Frame scales the
// page down, and three on a card at the right edge.
const fixture = `
  import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
  import { captureAnchor } from ${JSON.stringify(resolve("src/anchors.ts"))};
  const query=new URLSearchParams(location.search),layout=query.get('layout')??'reflow';
  const user={id:'reviewer',name:'Example reviewer',verified:true};
  const key='branch-comments:'+location.origin+':stacks';
  localStorage.setItem(key,'fixture-session');
  localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
  const authors=[{id:'author-a',name:'Avery Example',verified:true,accentColor:'#7f56d9'},{id:'author-b',name:'Blake Sample',verified:true,accentColor:'#f79009'},{id:'author-c',name:'Casey Demo',verified:true,accentColor:'#12b76a'}];
  const stored=JSON.parse(localStorage.getItem('fixture-anchors')||'{}');
  const at=(selector,dx)=>{const node=document.querySelector(selector),box=node.getBoundingClientRect(),point={x:dx<0?box.right+dx:box.left+dx,y:box.top+box.height/2};return captureAnchor(node,point,point);};
  const plan=[['#row',40],['#row',100],['#row',160],['#wide',40],['#wide',90],['#wide',140],['#wide',190],['#wide',240],['#chip-a',-6],['#chip-b',6],['#chip-c',10],['#chip-d',10],['#edge',-20],['#edge',-40],['#edge',-60]];
  const threads=plan.map(([selector,dx],index)=>({id:'t'+(index+1),page:'/',anchor:stored['t'+(index+1)]??at(selector,dx),resolved:false,resolvedBy:null,createdAt:index+1,updatedAt:index+1,tags:[],
    comments:[{id:'c'+index,author:authors[index%3],body:'Synthetic note '+(index+1),createdAt:index+1,editedAt:null,reactions:{}}]}));
  window.fetch=async(input,init)=>{
    const path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url).pathname;
    if(init?.method==='PATCH'){
      const id=path.split('/').pop(),anchor=JSON.parse(init.body).anchor;
      localStorage.setItem('fixture-anchors',JSON.stringify({...JSON.parse(localStorage.getItem('fixture-anchors')||'{}'),[id]:anchor}));
      localStorage.setItem('fixture-writes',String(Number(localStorage.getItem('fixture-writes')||0)+1));
      return Response.json({});
    }
    if(init?.method&&init.method!=='GET')localStorage.setItem('fixture-writes',String(Number(localStorage.getItem('fixture-writes')||0)+1));
    return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads}:{});
  };
  const size=query.get('size'),cluster=query.get('cluster');
  window.komo=initKomo({endpoint:location.origin,project:'stacks',repo:'example/review',branch:'fixture',
    pageRoot:layout==='floating'?undefined:document.querySelector('main'),sidebar:layout==='floating'?'edge':'background',
    ...(layout==='scaled'?{frame:{scale:true}}:{}),restoreOpen:false,pollInterval:60000,
    pins:{...(size?{size}:{}),...(cluster?{cluster:cluster!=='false'}:{})}});
`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-pin-stacks-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: fixture, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      const dark = url.searchParams.get("theme") === "dark";
      response.setHeader("content-type", "text/html");
      response.end(`<style>html,body{overscroll-behavior:none;color-scheme:${dark ? "dark" : "light"}}body{margin:0;font:15px system-ui;background:${dark ? "#121212" : "#fff"};color:${dark ? "#e5e5e5" : "#1d2939"}}main{position:relative;min-height:100vh}main>*{position:absolute;box-sizing:border-box;margin:0;padding:16px;border-radius:10px;background:${dark ? "#1f1f1f" : "#f2f4f7"};border:1px solid ${dark ? "#333" : "#d0d5dd"}}#row{left:96px;top:140px;width:600px;height:56px}#wide{left:96px;top:260px;width:600px;height:56px}#chip-a,#chip-b,#chip-c,#chip-d{top:400px;width:40px;height:32px;padding:0}#chip-a{left:96px}#chip-b{left:142px}#chip-c{left:360px}#chip-d{left:390px;width:30px}#edge{right:10px;top:520px;width:220px;height:56px}</style><main><article id="row">First row</article><article id="wide">Second row</article><span id="chip-a"></span><span id="chip-b"></span><span id="chip-c"></span><span id="chip-d"></span><article id="edge">Edge card</article></main><script type="module" src="/entry.js"></script>`);
      return;
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

async function open(query = "", page?: Page) {
  page ??= await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${origin}/?${query}`);
  await page.locator(".pin-stack").first().waitFor();
  return page;
}
const settle = (page: Page, ms = 450) => page.waitForTimeout(ms);
const box = (page: Page, selector: string) => page.locator(selector).first().evaluate(node => {
  const rect = node.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
});
const writes = (page: Page) => page.evaluate(() => Number(localStorage.getItem("fixture-writes") || 0));
const away = (page: Page) => page.mouse.move(900, 760);
const row = '.pin-stack[aria-label="3 comments on First row"]';
const wide = '.pin-stack[aria-label="5 comments on Second row"]';
const chips = '.pin-cluster[data-cluster="t9 t10"]';
const center = (rect: { x: number; y: number; width: number; height: number }) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const focused = (page: Page, selector: string) => page.locator(selector).first().evaluate(node => node === (node.getRootNode() as ShadowRoot).activeElement);
const pinBoxes = (page: Page, selector: string) => page.locator(`${selector} .pin`).evaluateAll(nodes => nodes.map(node => {
  const rect = node.getBoundingClientRect();
  return { id: (node as HTMLElement).dataset.thread, x: rect.x, width: rect.width, visible: getComputedStyle(node).display !== "none", label: node.getAttribute("aria-label") };
}));
// Reflow and scaled Frame are framed with the list open; Floating keeps the page as is.
async function frame(page: Page, layout: string) {
  if (layout === "floating") return;
  await page.keyboard.press("l");
  await page.waitForFunction(() => document.querySelector("main")!.getBoundingClientRect().width < innerWidth * .8);
  await settle(page, 700);
}
async function hover(page: Page, selector: string) {
  const target = center(await box(page, `${selector} .pin`));
  await page.mouse.move(target.x, target.y);
  await settle(page);
}

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("pin stacks in %s", layout => {
  it("stacks same-target comments in each density, fans them out in creation order and opens each without writes", async () => {
    for (const size of ["full", "compact", "dot"]) {
      const page = await open(`layout=${layout}&size=${size}`);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await frame(page, layout);
      await away(page);
      await settle(page);
      const face = size === "dot" ? 12 : 20;
      let pins = await pinBoxes(page, row);
      expect(pins.map(pin => pin.id)).toEqual(["t1", "t2", "t3"]);
      expect(pins.every(pin => Math.abs(pin.width - face) < 0.5)).toBe(true);
      // Each face overlaps the previous one by about 60%.
      expect(Math.abs(pins[1]!.x - pins[0]!.x - face * 0.4)).toBeLessThan(1.5);
      const stack = await box(page, row);
      expect(stack.width).toBeGreaterThanOrEqual(24);
      expect(stack.height).toBeGreaterThanOrEqual(24);
      // Five comments collapse to the first author and "+4".
      expect(await page.locator(wide).getAttribute("data-more")).toBe("+4");
      expect((await pinBoxes(page, wide)).filter(pin => pin.visible).map(pin => pin.id)).toEqual(["t4"]);
      // Distinct neighbouring targets merge into one count.
      const bubble = page.locator(`${chips} > summary`);
      expect(await bubble.getAttribute("aria-label")).toBe("2 comments nearby");
      expect(await bubble.textContent()).toBe("2");
      const count = await box(page, `${chips} > summary`);
      expect(Math.min(count.width, count.height)).toBeGreaterThanOrEqual(24);
      // Hover fans the stack out at full size.
      await hover(page, row);
      pins = await pinBoxes(page, row);
      expect(pins.map(pin => Math.round(pin.width))).toEqual([34, 34, 34]);
      expect(pins[1]!.x - pins[0]!.x).toBeCloseTo(38, 0);
      expect(pins.map(pin => pin.label)).toEqual([1, 2, 3].map(n => `Comment ${n} by ${["Avery Example", "Blake Sample", "Casey Demo"][n - 1]}: Synthetic note ${n}`));
      // The pointer travels along the fanned row without it folding, then opens the third.
      const y = (await box(page, row)).y + 20;
      for (let step = 1; step <= 8; step++) {
        await page.mouse.move(pins[0]!.x + 17 + ((pins[2]!.x - pins[0]!.x) * step) / 8, y);
        await page.waitForTimeout(40);
      }
      expect((await pinBoxes(page, row)).map(pin => Math.round(pin.width))).toEqual([34, 34, 34]);
      await page.locator(`${row} .pin[data-thread="t3"]`).click();
      await page.locator('.pin.active[data-thread="t3"]').waitFor();
      await away(page);
      await settle(page);
      // The open comment keeps its stack fanned (docked in the list, its own pin steps back)
      // and, floating, its card clear of the other pins.
      pins = await pinBoxes(page, row);
      expect(pins.slice(0, 2).map(pin => Math.round(pin.width))).toEqual([34, 34]);
      if (layout === "floating") {
        const card = await box(page, ".dialog");
        const fannedRow = await box(page, row);
        const clear = card.x >= fannedRow.x + fannedRow.width || card.x + card.width <= fannedRow.x
          || card.y >= fannedRow.y + fannedRow.height || card.y + card.height <= fannedRow.y;
        expect(clear).toBe(true);
      }
      await page.keyboard.press("Escape");
      if (layout !== "floating") await page.keyboard.press("Escape");
      await away(page);
      await settle(page, 700);
      expect((await pinBoxes(page, row)).every(pin => Math.abs(pin.width - face) < 0.5)).toBe(true);
      // A larger stack shows everyone once fanned.
      await hover(page, wide);
      expect((await pinBoxes(page, wide)).filter(pin => pin.visible)).toHaveLength(5);
      expect(await writes(page)).toBe(0);
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 90000);

  it("opens a keyboard-navigable list from the count bubble and keeps focus on its controls", async () => {
    const page = await open(`layout=${layout}`);
    await frame(page, layout);
    await page.keyboard.press("Shift");
    // Focus fans a stack, with a visible ring, and Tab walks its comments.
    await page.locator(`${row} .pin[data-thread="t1"]`).focus();
    await settle(page);
    expect((await pinBoxes(page, row)).map(pin => Math.round(pin.width))).toEqual([34, 34, 34]);
    expect(await page.locator(`${row} .pin[data-thread="t1"]`).evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
    await page.keyboard.press("Tab");
    expect(await focused(page, `${row} .pin[data-thread="t2"]`)).toBe(true);
    const summary = page.locator(`${chips} > summary`);
    await summary.focus();
    expect(await summary.evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "2 comments nearby" });
    await menu.waitFor();
    expect(await summary.getAttribute("aria-expanded")).toBe("true");
    const items = menu.getByRole("menuitem");
    expect(await items.allTextContents()).toEqual(["CDCasey Demo: Synthetic note 9", "AEAvery Example: Synthetic note 10"]);
    expect(await focused(page, `${chips} [role=menuitem]`)).toBe(true);
    await page.keyboard.press("ArrowDown");
    expect(await items.nth(1).evaluate(node => node === (node.getRootNode() as ShadowRoot).activeElement)).toBe(true);
    await page.keyboard.press("Escape");
    expect(await menu.isVisible()).toBe(false);
    expect(await focused(page, `${chips} > summary`)).toBe(true);
    // Enter opens the chosen comment; its pin steps out of the bubble to its own anchor.
    await settle(page, 100);
    await page.keyboard.press("Enter");
    await menu.waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.locator('.pins > .pin.active[data-thread="t10"]').waitFor({ state: "attached" });
    expect(await page.locator(chips).count()).toBe(0);
    await page.keyboard.press("Escape");
    if (layout !== "floating") await page.keyboard.press("Escape");
    // Pointer travel between the bubble and its list keeps the list open.
    await page.locator(chips).waitFor();
    await page.locator(`${chips} > summary`).click();
    await menu.waitFor();
    const list = (await menu.boundingBox())!;
    await page.mouse.move(list.x + 20, list.y + 12, { steps: 6 });
    const back = center(await box(page, `${chips} > summary`));
    await page.mouse.move(back.x, back.y, { steps: 6 });
    await page.mouse.move(list.x + 20, list.y + 12, { steps: 6 });
    expect(await menu.isVisible()).toBe(true);
    await items.first().click();
    await page.locator('.pins > .pin.active[data-thread="t9"]').waitFor({ state: "attached" });
    expect(await writes(page)).toBe(0);
    await page.close();
  }, 60000);
});

it.skipIf(!chrome)("merges pins that collide only once the scaled Frame brings them together", async () => {
  const page = await open("layout=scaled");
  expect(await page.locator('.pins > .pin[data-thread="t11"]').count()).toBe(1);
  expect(await page.locator('.pin-cluster[data-cluster="t11 t12"]').count()).toBe(0);
  await frame(page, "scaled");
  await page.locator('.pin-cluster[data-cluster="t11 t12"]').waitFor();
  expect(await page.locator('.pins > .pin[data-thread="t11"]').count()).toBe(0);
  // Closing the list releases the scale and the pins again.
  await page.keyboard.press("l");
  await settle(page, 900);
  expect(await page.locator('.pin-cluster[data-cluster="t11 t12"]').count()).toBe(0);
  await page.close();
}, 60000);

it.skipIf(!chrome)("fans a stack away from the page edge, by tap on touch, and draws every pin with cluster off", async () => {
  const page = await open();
  const edge = '.pin-stack[aria-label="3 comments on Edge card"]';
  expect(await page.locator(edge).getAttribute("data-pointer")).toBe("right");
  await hover(page, edge);
  const fanned = await pinBoxes(page, edge);
  expect(fanned.map(pin => Math.round(pin.width))).toEqual([34, 34, 34]);
  expect(Math.max(...fanned.map(pin => pin.x + pin.width))).toBeLessThanOrEqual(1280);
  await page.close();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const touch = await context.newPage();
  await touch.goto(`${origin}/`);
  const stack = touch.locator(row);
  await stack.waitFor();
  const rest = (await stack.boundingBox())!;
  await touch.touchscreen.tap(rest.x + 8, rest.y + rest.height / 2);
  await settle(touch);
  expect(await stack.getAttribute("data-open")).toBe("");
  expect(await touch.locator(".pin.active").count()).toBe(0);
  await touch.locator(`${row} .pin[data-thread="t2"]`).tap();
  await touch.locator('.pin.active[data-thread="t2"]').waitFor();
  await context.close();
  const plain = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await plain.goto(`${origin}/?cluster=false`);
  await plain.locator(".pin").first().waitFor();
  await settle(plain);
  expect(await plain.locator(".pin-stack, .pin-cluster").count()).toBe(0);
  expect(await plain.locator(".pins > .pin").count()).toBe(15);
  await plain.close();
}, 60000);

it.skipIf(!chrome)("hides with comments, and a moved pin leaves its stack for good", async () => {
  const page = await open("layout=reflow");
  await page.keyboard.press("h");
  await settle(page);
  expect(await page.locator(".pin-stack, .pin-cluster").count()).toBe(0);
  await page.keyboard.press("h");
  await page.locator(row).waitFor();
  await hover(page, row);
  await page.locator(`${row} .pin[data-thread="t2"]`).click();
  await page.locator('.dialog summary[aria-label="Comment actions"]').click();
  await page.getByRole("menuitem", { name: "Move pin", exact: true }).click();
  await page.getByRole("group", { name: "Move pin", exact: true }).waitFor();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => localStorage.getItem("fixture-writes") === "1");
  await page.reload();
  await page.locator('.pin-stack[aria-label="2 comments on First row"]').waitFor();
  expect(await page.locator('.pins > .pin[data-thread="t2"]').count()).toBe(1);
  expect(await writes(page)).toBe(1);
  await page.evaluate(() => localStorage.removeItem("fixture-anchors"));
  await page.evaluate(() => localStorage.removeItem("fixture-writes"));
  await page.close();
}, 60000);

it.skipIf(!chrome)("captures stacks and bubbles in each density, light and dark, with a contact sheet", async () => {
  const files: string[] = [];
  const clip = { x: 60, y: 110, width: 700, height: 340 };
  for (const theme of ["light", "dark"])
    for (const size of ["full", "compact", "dot"]) {
      const page = await open(`size=${size}&theme=${theme}`);
      await away(page);
      await settle(page);
      for (const state of ["rest", "fanned"]) {
        if (state === "fanned") await hover(page, row);
        const file = join(shots, `stacks-${size}-${theme}-${state}.png`);
        await page.screenshot({ path: file, clip });
        files.push(file);
      }
      if (size === "full") {
        await away(page);
        await page.locator(`${chips} > summary`).click();
        await page.getByRole("menu").waitFor();
        const file = join(shots, `stacks-menu-${theme}.png`);
        await page.screenshot({ path: file, clip: { ...clip, x: 0, width: 760, height: 420 } });
        files.push(file);
      }
      await page.close();
    }
  const sheet = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const cells = await Promise.all(files.map(async file =>
    `<figure><img src="data:image/png;base64,${(await readFile(file)).toString("base64")}"><figcaption>${file.split(/[\\/]/).pop()}</figcaption></figure>`));
  await sheet.setContent(`<style>body{margin:16px;font:12px system-ui;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;background:#ddd}img{width:100%;display:block;border:1px solid #999}figure{margin:0}</style>${cells.join("")}`);
  await sheet.screenshot({ path: join(shots, "stacks-contact-sheet.png"), fullPage: true });
  expect(existsSync(join(shots, "stacks-contact-sheet.png"))).toBe(true);
  await sheet.close();
}, 120000);

