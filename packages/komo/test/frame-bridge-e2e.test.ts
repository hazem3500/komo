import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// React registrations made inside Frame's viewport iframe (useKomoInspectable,
// useKomoDesignTokens) reach komo in the parent window through the frame bridge.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = join(tmpdir(), "komo-frame-bridge");
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-frame-bridge-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      import {useKomoInspectable,useKomoDesignTokens,cssVariableTokens} from ${JSON.stringify(resolve("src/react.ts"))};
      const h=React.createElement;
      const definition={id:'option',name:'Option',source:'fixture/option.tsx',line:1,props:[{name:'selected',kind:'boolean',required:true,typeLabel:'boolean'}]};
      const tokens=[{path:'color.accent',cssVariable:'--accent',type:'color',properties:['background-color'],impactSelector:'.card'}];
      // Only the framed copy registers its tokens, as an app rendered only in the frame would.
      const framed=window.name==='komo-viewport';
      function App(){
        const[props,setProps]=React.useState({selected:false});
        const inspect=useKomoInspectable({component:definition,props,onChange:next=>setProps(current=>({...current,...next})),enabled:true});
        useKomoDesignTokens({tokens,enabled:framed});
        return h('section',{className:'card',id:'card'},h('button',{ref:inspect.ref,'data-komo-inspectable':inspect['data-komo-inspectable'],id:'option',type:'button','data-selected':String(props.selected)},'Example option'));
      }
      createRoot(document.querySelector('main')).render(h(App));
      window.fetch=async()=>Response.json({threads:[],guests:true});
      window.komo=initKomo({endpoint:location.origin,project:'frame-bridge',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,pollInterval:60000,
        design:{tokens:cssVariableTokens()},frame:{mode:'iframe'}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      response.setHeader("content-type", "text/html");
      return response.end(`<style>:root{--accent:#7c3aed}body{margin:0;font:16px system-ui}main{min-height:100vh;box-sizing:border-box;padding:80px}.card{padding:24px;border-radius:12px;background-color:var(--accent)}#option{padding:12px 18px;font:inherit}</style><main></main><script type="module" src="/entry.js"></script>`);
    }
    try {
      const file = resolve(directory, `.${url.pathname}`);
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

async function viewport(page: Page): Promise<Frame> {
  page.setDefaultTimeout(6000);
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => !!(window as any).komo);
  await page.keyboard.press("l");
  await page.waitForFunction(() => {
    const root = [...document.body.children].find((node) => node.shadowRoot)?.shadowRoot;
    const frame = root?.querySelector<HTMLIFrameElement>("iframe[data-komo-viewport]");
    return !!frame?.contentDocument?.getElementById("option") && !root!.querySelector(".frame-stage[data-loading]");
  });
  return page.frames().find((item) => item.name() === "komo-viewport")!;
}
/** An element inside the viewport iframe, on screen. */
const framed = (page: Page, id: string) => page.evaluate((id) => {
  const root = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
  const frame = root.querySelector<HTMLIFrameElement>("iframe[data-komo-viewport]")!;
  const outer = frame.getBoundingClientRect(), scale = outer.width / frame.offsetWidth;
  const inner = frame.contentDocument!.getElementById(id)!.getBoundingClientRect();
  return { x: outer.left + (inner.left + inner.width / 2) * scale, y: outer.top + (inner.top + inner.height / 2) * scale };
}, id);

describe.skipIf(!chrome)("Frame bridge", () => {
  it("edits React props registered inside the viewport iframe, through that app's own state", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const frame = await viewport(page);
    await page.keyboard.press("d");
    const option = await framed(page, "option");
    await page.mouse.move(option.x, option.y);
    await page.waitForTimeout(150);
    await page.mouse.click(option.x, option.y);
    const selected = page.getByRole("switch", { name: "Option selected", exact: true });
    await selected.waitFor();
    await selected.click();
    // The framed app re-renders with the new prop; the copy on this page doesn't.
    await expect.poll(() => frame.locator("#option").getAttribute("data-selected")).toBe("true");
    expect(await page.locator("main #option").getAttribute("data-selected")).toBe("false");
    await page.screenshot({ path: join(shots, "bridge-props.png") });
    expect(errors).toEqual([]);
    await page.close();
  });

  it("reads and previews design tokens registered inside the viewport iframe", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const frame = await viewport(page);
    await page.keyboard.press("d");
    const card = await framed(page, "card");
    await page.mouse.move(card.x, card.y - 30);
    await page.waitForTimeout(150);
    await page.mouse.click(card.x, card.y - 30);
    await expect.poll(() => page.locator(".design-inspector__target").textContent()).toContain("#card");
    // The card's fill reads as the frame's registered token.
    await expect.poll(() => page.locator(".design-inspector").textContent()).toContain("accent");
    // The Tokens view lists the frame's tokens and previews them on its root.
    // A press on the stage outside the frame deselects.
    const outer = (await page.locator("iframe[data-komo-viewport]").boundingBox())!;
    await page.mouse.click(outer.x + outer.width / 2, outer.y + outer.height + 8);
    await page.getByRole("button", { name: "Edit tokens", exact: true }).click();
    const row = page.locator(".design-token-row").filter({ hasText: "accent" });
    await row.waitFor();
    await row.locator("button").first().click();
    const hex = page.locator('.komo-color input[aria-label="Hex"]');
    await hex.fill("ff8000");
    await hex.press("Enter");
    await row.locator("button").first().click();
    await expect.poll(() => frame.locator("#card").evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 128, 0)");
    expect(await page.locator("main #card").evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(124, 58, 237)");
    await page.screenshot({ path: join(shots, "bridge-tokens.png") });
    await page.close();
  });
});
