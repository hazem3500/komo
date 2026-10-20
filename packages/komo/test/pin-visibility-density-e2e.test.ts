// Native Hide comments and pin density checks; uses only a synthetic loopback fixture.
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

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-pin-density-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { captureAnchor } from ${JSON.stringify(resolve("src/anchors.ts"))};
      const query=new URLSearchParams(location.search),layout=query.get('layout')??'reflow';
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':density';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      const authors=[{id:'author-a',name:'Avery Example',verified:true,accentColor:'#7f56d9'},{id:'author-b',name:'Blake Sample',verified:true,accentColor:'#f79009'},{id:'author-c',name:'Casey Demo',verified:true,accentColor:'#12b76a'}];
      const threads=[...document.querySelectorAll('article')].map((card,index)=>{
        const box=card.getBoundingClientRect(),point={x:box.left+40,y:box.top+40};
        return {id:'thread-'+index,page:'/',anchor:captureAnchor(card,point,point),resolved:false,resolvedBy:null,createdAt:index+1,updatedAt:index+1,tags:[],
          comments:[{id:'comment-'+index,author:authors[index],body:'Synthetic note '+(index+1)+'\\nSecond line',createdAt:index+1,editedAt:null,reactions:{}}]};
      });
      window.fetch=async input=>{
        const path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url).pathname;
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads}:{});
      };
      if(layout==='floating')document.body.append(document.createElement('aside'));
      const size=query.get('size'),visibility=query.get('visibility');
      window.komo=initKomo({endpoint:location.origin,project:'density',repo:'example/review',branch:'fixture',
        pageRoot:layout==='floating'?undefined:document.querySelector('main'),sidebar:layout==='floating'?'edge':'background',
        ...(layout==='scaled'?{frame:{scale:true}}:{}),restoreOpen:'session',pollInterval:60000,
        ...(size?{pins:{size}}:{}),...(visibility?{shortcuts:{visibility:visibility==='false'?false:visibility}}:{})});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      const dark = url.searchParams.get("theme") === "dark";
      response.setHeader("content-type", "text/html");
      response.end(`<style>html,body{overscroll-behavior:none;color-scheme:${dark ? "dark" : "light"}}body{margin:0;font:15px system-ui;background:${dark ? "#121212" : "#fff"};color:${dark ? "#e5e5e5" : "#1d2939"}}main{min-height:100vh;box-sizing:border-box;padding:120px 96px;display:flex;flex-wrap:wrap;gap:56px;align-items:flex-start}article{box-sizing:border-box;width:240px;height:150px;padding:20px;border-radius:12px;background:${dark ? "#1f1f1f" : "#f2f4f7"};border:1px solid ${dark ? "#333" : "#d0d5dd"}}</style><main><article>First card</article><article>Second card</article><article>Third card</article></main><script type="module" src="/entry.js"></script>`);
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
  await page.locator(".pin").first().waitFor();
  return page;
}
const blur = (page: Page) => page.evaluate(() => (document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement as HTMLElement | null)?.blur());
const hiddenState = (page: Page) => page.evaluate(() => ({
  hidden: document.querySelector("[data-branch-comments]")!.hasAttribute("data-comments-hidden"),
  pins: document.querySelector("[data-branch-comments]")!.shadowRoot!.querySelectorAll(".pin").length,
  toolbar: getComputedStyle(document.querySelector("[data-branch-comments]")!.shadowRoot!.querySelector(".toolbar")!).display,
  pageWidth: document.querySelector("main")!.getBoundingClientRect().width,
}));
const box = (page: Page, selector: string) => page.locator(selector).first().evaluate(node => {
  const rect = node.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
});
const settle = (page: Page) => page.waitForTimeout(400);
// The drawer hides away from the pointer, so open More as a keyboard user would.
async function openMore(page: Page) {
  await page.locator('[data-menu-item="more"]').evaluate((node: HTMLElement) => { node.focus(); node.click(); });
  await page.locator('.morphing-menu__panel[aria-hidden="false"]').waitFor();
}

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("Hide comments in %s", layout => {
  it("hides pins, cards and the review layout, and Show restores drafts, selection and list state", async () => {
    const page = await open(`layout=${layout}`);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const width = (await hiddenState(page)).pageWidth;
    // An open thread in the list with an unsent reply.
    await page.keyboard.press("l");
    await page.locator(".thread-card", { hasText: "Synthetic note 2" }).click();
    const reply = page.locator(".thread-pane textarea, .dialog textarea").first();
    await reply.fill("Unsent reply");
    await blur(page);
    await settle(page);
    const framedWidth = (await hiddenState(page)).pageWidth;
    if (layout !== "floating") expect(framedWidth).toBeLessThan(width * 0.9);
    await page.keyboard.press("h");
    await settle(page);
    let state = await hiddenState(page);
    expect(state).toMatchObject({ hidden: true, pins: 0 });
    expect(state.toolbar).not.toBe("none");
    // The review layout steps aside: Frame releases the page, Floating parks.
    expect(state.pageWidth).toBeCloseTo(width, 0);
    expect(await page.locator(".dialog:visible, .thread-pane:visible").count()).toBe(0);
    // Escape and page clicks belong to the page while comments are hidden.
    await page.keyboard.press("Escape");
    await page.mouse.click(1200, 760);
    expect(await page.evaluate(() => sessionStorage.getItem("branch-comments:comments-hidden:density:example/review"))).toBe("1");
    await page.keyboard.press("h");
    await settle(page);
    state = await hiddenState(page);
    expect(state.hidden).toBe(false);
    expect(state.pins).toBe(3);
    if (layout !== "floating") expect(state.pageWidth).toBeCloseTo(framedWidth, 0);
    expect(await page.locator(".pin.active").getAttribute("aria-label")).toBe("Comment 2 by Blake Sample: Synthetic note 2");
    expect(await reply.inputValue()).toBe("Unsent reply");
    // A new comment's unsent text survives the same round trip, from More.
    await blur(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await settle(page);
    await page.keyboard.press("c");
    const card = (await page.locator("article").nth(2).boundingBox())!;
    await page.mouse.click(card.x + card.width - 30, card.y + card.height - 30);
    const body = page.getByRole("textbox", { name: "Comment", exact: true });
    await body.fill("Unsent draft");
    await blur(page);
    await openMore(page);
    const hide = page.getByRole("button", { name: "Hide comments", exact: true });
    expect(await hide.locator("kbd").allTextContents()).toEqual(["H"]);
    await hide.click();
    await settle(page);
    expect(await body.isVisible()).toBe(false);
    await page.keyboard.press("h");
    await settle(page);
    expect(await body.isVisible()).toBe(true);
    expect(await body.inputValue()).toBe("Unsent draft");
    await blur(page);
    await page.keyboard.press("h");
    await page.reload();
    await page.locator(".toolbar").waitFor();
    // Hidden for this tab across a reload; nothing reveals it by itself.
    await page.waitForTimeout(600);
    expect((await hiddenState(page)).hidden).toBe(true);
    await openMore(page);
    await page.getByRole("button", { name: "Show comments", exact: true }).click();
    await settle(page);
    expect((await hiddenState(page)).pins).toBe(3);
    expect(errors).toEqual([]);
    await page.close();
  }, 60000);
});

it.skipIf(!chrome)("lists Hide comments in shortcut help with the configured key, and honors false", async () => {
  const page = await open(`visibility=${encodeURIComponent("Shift+H")}`);
  await page.keyboard.press("h");
  expect((await hiddenState(page)).hidden).toBe(false);
  await page.keyboard.press("Shift+H");
  expect((await hiddenState(page)).hidden).toBe(true);
  await page.keyboard.press("Shift+H");
  await openMore(page);
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  const line = help.locator("div", { hasText: "Hide comments" });
  expect(await line.locator(".komo-kbd").getAttribute("aria-label")).toBe("Shift + H");
  expect((await line.locator("kbd").allTextContents()).at(-1)).toBe("H");
  await page.close();
  const disabled = await open("visibility=false");
  await disabled.keyboard.press("h");
  expect((await hiddenState(disabled)).hidden).toBe(false);
  await openMore(disabled);
  expect(await disabled.getByRole("button", { name: "Hide comments", exact: true }).locator("kbd").count()).toBe(0);
  await disabled.close();
}, 60000);

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("pin density in %s", layout => {
  it("draws compact and dot pins in a 24px target that expands in place on hover, focus, proximity and selection", async () => {
    for (const size of ["compact", "dot"] as const) {
      const page = await open(`layout=${layout}&size=${size}`);
      const pin = page.locator(".pin").first();
      const rest = await box(page, ".pin");
      expect(rest).toMatchObject({ width: 24, height: 24 });
      const face = await box(page, ".pin .avatar");
      expect(face.width).toBe(size === "compact" ? 20 : 12);
      // The whole 24x24 target, corners included, belongs to the pin.
      for (const [dx, dy] of [[1, 1], [23, 1], [1, 23], [23, 23], [12, 12]])
        expect(await page.evaluate(([x, y]) => document.querySelector("[data-branch-comments]")!.shadowRoot!
          .elementFromPoint(x, y)?.closest(".pin")?.getAttribute("data-thread"), [rest.x + dx, rest.y + dy])).toBe("thread-0");
      expect(await pin.getAttribute("aria-label")).toBe("Comment 1 by Avery Example: Synthetic note 1");
      // Proximity: within 24px expands, farther away collapses, without moving the tip.
      const right = (await pin.getAttribute("data-pointer")) === "right";
      await page.mouse.move(right ? rest.x + 42 : rest.x - 18, rest.y + 12);
      await settle(page);
      expect(await pin.getAttribute("data-near")).toBe("");
      const near = await box(page, ".pin");
      expect(near).toMatchObject({ width: 34, height: 34 });
      expect(right ? near.x + near.width : near.x).toBeCloseTo(right ? rest.x + rest.width : rest.x, 0);
      expect(near.y + near.height).toBeCloseTo(rest.y + rest.height, 0);
      // Inside the expanded pin never collapses it (no jitter at the edge).
      for (const [dx, dy] of [[33, 1], [1, 1], [33, 33]]) {
        await page.mouse.move(near.x + dx, near.y + dy);
        await page.waitForTimeout(160);
        expect((await box(page, ".pin")).width).toBe(34);
      }
      await page.mouse.move(rest.x - 80, rest.y + 120);
      await settle(page);
      expect(await pin.getAttribute("data-near")).toBeNull();
      expect((await box(page, ".pin")).width).toBe(24);
      // Hover inside the target.
      await page.mouse.move(rest.x + 12, rest.y + 12);
      await settle(page);
      expect((await box(page, ".pin")).width).toBe(34);
      await page.mouse.move(rest.x - 300, rest.y + 300);
      await settle(page);
      // Keyboard focus expands with a visible ring.
      await page.keyboard.press("Shift");
      await pin.focus();
      await settle(page);
      expect((await box(page, ".pin")).width).toBe(34);
      expect(await pin.evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
      await blur(page);
      // The open thread's pin stays full.
      await pin.click();
      await page.mouse.move(rest.x - 300, rest.y + 300);
      await settle(page);
      expect(await box(page, ".pin.active")).toMatchObject({ width: 34, height: 34 });
      await page.close();
    }
  }, 60000);
});

it.skipIf(!chrome)("fills unread dots, quiets read ones, switches auto pins, and keeps a reviewer's size over the host default", async () => {
  const page = await open("size=dot");
  const fill = (index: number) => page.locator(".pin .avatar").nth(index).evaluate(node => [getComputedStyle(node).backgroundColor, getComputedStyle(node).opacity]);
  expect(await fill(0)).toEqual(["rgb(127, 86, 217)", "1"]);
  await page.locator(".pin").first().click();
  await page.keyboard.press("Escape");
  await page.mouse.move(10, 790);
  await settle(page);
  expect(await page.locator(".pin").first().getAttribute("data-read")).toBe("");
  expect(await fill(0)).toEqual(["rgb(127, 86, 217)", "0.5"]);
  expect(await fill(1)).toEqual(["rgb(247, 144, 9)", "1"]);
  // Reviewer choice from More wins over the host default after a reload.
  await openMore(page);
  await page.getByRole("button", { name: "Pin size: Dot" }).click();
  expect(await page.getByRole("button", { name: "Dot", exact: true }).getAttribute("aria-pressed")).toBe("true");
  await page.getByRole("button", { name: "Compact", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("branch-comments:pin-size:density:example/review"))).toBe("compact");
  await page.reload();
  await page.locator(".pin").first().waitFor();
  expect(await page.locator(".pins").getAttribute("data-size")).toBe("compact");
  await page.evaluate(() => localStorage.setItem("branch-comments:pin-size:density:example/review", "auto"));
  await page.reload();
  await page.locator(".pin").first().waitFor();
  expect(await page.locator(".pins").getAttribute("data-size")).toBe("dot");
  await page.keyboard.press("c");
  expect(await page.locator(".pins").getAttribute("data-size")).toBeNull();
  await page.keyboard.press("v");
  expect(await page.locator(".pins").getAttribute("data-size")).toBe("dot");
  await page.keyboard.press("l");
  expect(await page.locator(".pins").getAttribute("data-size")).toBeNull();
  await page.close();
}, 60000);

it.skipIf(!chrome)("captures each density in light and dark, at rest and hover-expanded", async () => {
  for (const theme of ["light", "dark"])
    for (const size of ["full", "compact", "dot"]) {
      const page = await open(`size=${size}&theme=${theme}`);
      await page.locator(".pin").nth(1).click();
      await page.keyboard.press("Escape");
      await page.mouse.move(10, 790);
      await settle(page);
      const clip = { x: 60, y: 60, width: 920, height: 140 };
      await page.screenshot({ path: join(shots, `pins-${size}-${theme}.png`), clip });
      const target = await box(page, ".pin");
      await page.mouse.move(target.x + 12, target.y + 12);
      await settle(page);
      await page.screenshot({ path: join(shots, `pins-${size}-${theme}-hover.png`), clip });
      expect(existsSync(join(shots, `pins-${size}-${theme}-hover.png`))).toBe(true);
      if (size === "dot") {
        await openMore(page);
        await page.getByRole("button", { name: "Pin size: Dot" }).click();
        await settle(page);
        await page.screenshot({ path: join(shots, `pin-size-menu-${theme}.png`), clip: { x: 440, y: 360, width: 400, height: 440 } });
      }
      await page.close();
    }
}, 90000);
