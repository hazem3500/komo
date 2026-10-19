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
  directory = await mkdtemp(join(tmpdir(), "komo-pin-move-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { captureAnchor } from ${JSON.stringify(resolve("src/anchors.ts"))};
      const user={id:location.search.includes('guest')?'other':'reviewer',name:'Example reviewer',verified:!location.search.includes('guest')};
      const author={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':pin-move';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      const card=document.querySelector('#card-a'),box=card.getBoundingClientRect();
      const point={x:box.left+box.width/2,y:box.top+box.height/2};
      let anchor=JSON.parse(localStorage.getItem('fixture-anchor')||'null')||captureAnchor(card,point,point);
      const thread=()=>({id:'fixture-thread',page:'/',anchor,resolved:false,resolvedBy:null,createdAt:1,updatedAt:1,tags:[],comments:[{id:'fixture-comment',author,body:'Synthetic placement review',createdAt:1,editedAt:null,reactions:{}}]});
      window.fetch=async(input,init)=>{
        const path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url).pathname;
        if(init?.method==='PATCH'&&path.endsWith('/threads/fixture-thread')){
          anchor=JSON.parse(init.body).anchor;localStorage.setItem('fixture-anchor',JSON.stringify(anchor));
          localStorage.setItem('fixture-writes',String(Number(localStorage.getItem('fixture-writes')||0)+1));
        }
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads:[thread()]}:{});
      };
      window.komo=initKomo({endpoint:location.origin,project:'pin-move',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,pollInterval:60000});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<style>body{margin:0}main{min-height:100vh;box-sizing:border-box;padding:120px;display:flex;gap:80px;align-items:flex-start}article{box-sizing:border-box;width:260px;height:160px;padding:20px;border:1px solid #bbb;border-radius:12px;background:#eee}</style><main><article id="card-a">First review card</article><article id="card-b">Second review card</article></main><script type="module" src="/entry.js"></script>`);
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

it.skipIf(!chrome)("keeps touch drags locked until explicit placement, and hides Move pin from unrelated guests", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const page = await context.newPage();
  await page.goto(origin);
  const pin = page.locator('.pin[data-thread="fixture-thread"]');
  await pin.waitFor();
  const client = await context.newCDPSession(page);
  const drag = async () => {
    const box = (await pin.boundingBox())!;
    const target = (await page.locator("#card-b").boundingBox())!;
    const from = { x: box.x + 17, y: box.y + 17 };
    const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
    for (let i = 1; i <= 6; i++)
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6 }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await drag();
  expect(await page.evaluate(() => Number(localStorage.getItem("fixture-writes") || 0))).toBe(0);
  await pin.tap();
  await page.locator('summary[aria-label="Comment actions"]').tap();
  await page.getByRole("menuitem", { name: "Move pin", exact: true }).tap();
  await page.getByRole("group", { name: "Move pin", exact: true }).waitFor();
  await drag();
  await page.waitForFunction(() => localStorage.getItem("fixture-writes") === "1");
  expect(await pin.getAttribute("data-moving")).toBeNull();
  await context.close();
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(`${origin}/?guest`);
  await guestPage.locator(".pin").click();
  await guestPage.locator('summary[aria-label="Comment actions"]').click();
  expect(await guestPage.getByRole("menuitem", { name: "Move pin", exact: true }).count()).toBe(0);
  await guest.close();
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe.skipIf(!chrome).each([false, true])("explicit pin placement in Frame=%s", frame => {
  it("locks ordinary drags, cancels without a write, commits one move and locks again after reload", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin);
    const pin = page.locator('.pin[data-thread="fixture-thread"]');
    await pin.waitFor();
    if (frame) {
      await page.keyboard.press("l");
      await page.waitForFunction(() => document.querySelector("main")!.getBoundingClientRect().width < innerWidth * .8);
      await page.waitForTimeout(450);
    }
    const writes = () => page.evaluate(() => Number(localStorage.getItem("fixture-writes") || 0));
    const original = await pin.boundingBox();
    const originalPoint = await pin.evaluate(node => [(node as HTMLElement).style.left, (node as HTMLElement).style.top]);
    const drag = async (x: number, y: number) => {
      await pin.waitFor({ state: "visible" });
      const box = (await pin.boundingBox())!;
      await page.mouse.move(box.x + 17, box.y + 17);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 6 });
      await page.mouse.up();
    };
    await drag(original!.x + 100, original!.y + 60);
    expect(await writes()).toBe(0);
    expect(await pin.getAttribute("data-moving")).toBeNull();
    const locked = await pin.boundingBox();
    expect(locked!.x).toBeCloseTo(original!.x, 1);
    expect(locked!.y).toBeCloseTo(original!.y, 1);
    await pin.click();
    const move = async () => {
      await page.locator('.dialog summary[aria-label="Comment actions"]').click();
      await page.getByRole("menuitem", { name: "Move pin", exact: true }).click();
      await page.getByRole("group", { name: "Move pin", exact: true }).waitFor();
      expect(await pin.evaluate(node => node === (node.getRootNode() as ShadowRoot).activeElement)).toBe(true);
      expect(await pin.evaluate(node => ({ pointer: getComputedStyle(node).pointerEvents, opacity: getComputedStyle(node).opacity }))).toEqual({ pointer: "auto", opacity: "1" });
    };
    await move();
    await page.keyboard.press("Shift+ArrowRight");
    expect(await writes()).toBe(0);
    await page.keyboard.press("Escape");
    expect(await page.locator(".pin-move").count()).toBe(0);
    expect(await writes()).toBe(0);
    expect(await pin.evaluate(node => [(node as HTMLElement).style.left, (node as HTMLElement).style.top])).toEqual(originalPoint);
    await move();
    const cancelling = (await pin.boundingBox())!;
    await page.mouse.move(cancelling.x + 17, cancelling.y + 17);
    await page.mouse.down();
    await page.mouse.move(cancelling.x + 90, cancelling.y + 30, { steps: 4 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await writes()).toBe(0);
    expect(await pin.getAttribute("data-moving")).toBeNull();
    expect(await pin.evaluate(node => [(node as HTMLElement).style.left, (node as HTMLElement).style.top])).toEqual(originalPoint);
    await move();
    const target = (await page.locator("#card-b").boundingBox())!;
    const originalCard = await page.locator("#card-b").getAttribute("style");
    await drag(target.x + target.width / 2, target.y + target.height / 2);
    await page.waitForFunction(() => localStorage.getItem("fixture-writes") === "1");
    await page.locator(".floating-notice").filter({ hasText: "Pin moved" }).waitFor();
    const anchor = await page.evaluate(() => JSON.parse(localStorage.getItem("fixture-anchor")!));
    expect(anchor.selector).toBe("#card-b");
    expect(await page.locator("#card-b").getAttribute("style")).toBe(originalCard);
    expect(await pin.getAttribute("data-moving")).toBeNull();
    const moved = (await pin.boundingBox())!;
    await drag(moved.x + 70, moved.y + 40);
    expect(await writes()).toBe(1);
    await page.reload();
    await pin.waitFor();
    expect(await pin.getAttribute("data-moving")).toBeNull();
    const restored = (await pin.boundingBox())!;
    await drag(restored.x + 60, restored.y + 40);
    expect(await writes()).toBe(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fixture-anchor")!).selector)).toBe("#card-b");
    await pin.click();
    await move();
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => localStorage.getItem("fixture-writes") === "2");
    await page.locator(".floating-notice").filter({ hasText: "Pin moved" }).waitFor();
    expect(await pin.getAttribute("data-moving")).toBeNull();
    const keyboardMoved = (await pin.boundingBox())!;
    await drag(keyboardMoved.x + 60, keyboardMoved.y + 40);
    expect(await writes()).toBe(2);
    expect(errors).toEqual([]);
    await context.close();
  });
});
