import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

// The header theme control in real Chrome, in the Design panel and the Tokens view: one
// light/dark axis is a sun/moon switch, two other options a two-segment switch, more
// options or axes the compact menu, and no themes no control. One click switches, the
// komo tooltip names the next state, and leaving Design mode restores the page's theme.
// Header screenshots land in <tmpdir>/komo-theme-toggle.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;
const shots = join(tmpdir(), "komo-theme-toggle");

beforeAll(async () => {
  if (!chrome) return;
  await mkdir(shots, { recursive: true });
  directory = await mkdtemp(join(tmpdir(), "komo-theme-toggle-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { discoverCssTokens } from ${JSON.stringify(resolve("src/adapters/css-variables.ts"))};
      import { classTheme } from ${JSON.stringify(resolve("src/adapters/class-theme.ts"))};
      const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':themes';
      localStorage.setItem(key,'synthetic-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
      window.fetch=async(input)=>{const path=new URL(String(input instanceof Request?input.url:input)).pathname;
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads:[]}:{})};
      const query=new URLSearchParams(location.search), layout=query.get('layout')??'floating';
      if(layout==='floating')document.body.append(document.createElement('aside'));
      const html=document.documentElement;
      const axis=(id,options,label)=>({id,label,options,current:()=>html.dataset[id]??options[0].id,apply(value){html.dataset[id]=value}});
      const mode=classTheme({id:'mode',options:[{id:'light'},{id:'dark',class:'dark'}]});
      const density=axis('density',[{id:'cozy',label:'Cozy'},{id:'compact',label:'Compact'}]);
      const themes={
        lightdark:[mode],
        labels:[axis('appearance',[{id:'day',label:'Light'},{id:'night',label:'Dark'}])],
        density:[density],
        three:[axis('scheme',[{id:'light'},{id:'dark'},{id:'contrast'}])],
        axes:[mode,density],
        none:undefined,
      }[query.get('themes')];
      window.komo=initKomo({endpoint:location.origin,project:'themes',repo:'example/review',branch:'fixture',pageRoot:layout==='floating'?undefined:document.querySelector('main'),sidebar:layout==='floating'?'edge':'background',frame:{scale:layout==='scaled'},restoreOpen:false,pollInterval:60000,design:{tokens:discoverCssTokens({scopes:{dark:'.dark'}}),...(themes?{themes}:{})}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<html><style>:root{--color-text:#131213;--color-surface:#f0f0f0}.dark{--color-text:#e6e6e6;--color-surface:#131213}body{margin:0;background:var(--color-surface)}main{min-height:100vh;box-sizing:border-box;padding:70px}#card{width:240px;height:96px;padding:16px;border-radius:8px;background:var(--color-surface);color:var(--color-text);font:16px sans-serif;box-shadow:0 0 0 1px #8884}</style><main><article id="card">Example card</article></main><script type="module" src="/entry.js"></script></html>`);
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

async function open(themes: string, layout = "floating", viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce", deviceScaleFactor: 2 });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/?themes=${themes}&layout=${layout}`);
  await page.waitForFunction(() => !!(window as any).komo);
  await openDesign(page);
  await page.getByRole("button", { name: "Edit tokens", exact: true }).waitFor();
  return { page, errors };
}
const heading = (page: Page) => page.locator(".design-inspector__heading");
const control = (page: Page) => heading(page).locator(".design-theme-toggle, .design-theme-switch");
/** The page's theme state: <html>'s class and the fixture axes' data attributes. */
const html = (page: Page) => page.evaluate(() => {
  const { className, dataset } = document.documentElement;
  return { className, data: Object.fromEntries(["mode", "appearance", "density", "scheme"].flatMap(key => dataset[key] ? [[key, dataset[key]]] : [])) };
});
const tip = (page: Page) => page.locator(".sidebar-tooltip[data-open]");
/** The Design panel with the card picked, or the Tokens view. */
async function show(page: Page, view: "panel" | "tokens") {
  if (view === "tokens") {
    await page.getByRole("button", { name: "Edit tokens", exact: true }).click();
    await page.locator(".design-token-row").first().waitFor();
    expect(await page.locator(".design-inspector__target").textContent()).toBe("Tokens");
  } else {
    await page.click("#card");
    // Token bindings attach after the header control, so the header is settled.
    await page.locator('[data-field-property="color"] .design-token-binding').waitFor({ state: "attached" });
  }
}

describe.skipIf(!chrome).each(["panel", "tokens"] as const)("header theme control in the %s", view => {
  it.each(["floating", "reflow", "scaled"])("switches one light/dark axis with one click in %s and restores it on exit", async layout => {
    const { page, errors } = await open("lightdark", layout);
    await show(page, view);
    const toggle = heading(page).getByRole("switch", { name: "Theme: Light", exact: true });
    expect(await control(page).count()).toBe(1);
    expect(await toggle.getAttribute("aria-checked")).toBe("false");
    expect(await toggle.locator("svg").count()).toBe(1);
    expect(await toggle.evaluate(node => node.nextElementSibling?.classList.contains("design-inspector__close"))).toBe(true);
    await toggle.hover();
    await expect.poll(() => tip(page).textContent()).toBe("Switch to Dark");
    const [box, tipBox] = [await toggle.boundingBox(), await tip(page).boundingBox()];
    expect(tipBox!.y).toBeGreaterThan(box!.y + box!.height);
    await heading(page).screenshot({ path: join(shots, `${view}-${layout}-light.png`) });
    await toggle.click();
    await expect.poll(() => html(page)).toEqual({ className: "dark", data: {} });
    const dark = heading(page).getByRole("switch", { name: "Theme: Dark", exact: true });
    expect(await dark.getAttribute("aria-checked")).toBe("true");
    expect(await dark.getAttribute("data-tip")).toBe("Switch to Light");
    // Focus stays on the switch, so the keyboard flips it straight back.
    expect(await dark.evaluate(node => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
    await page.mouse.move(0, 0);
    await heading(page).screenshot({ path: join(shots, `${view}-${layout}-dark.png`) });
    await page.keyboard.press("Enter");
    await expect.poll(() => html(page)).toEqual({ className: "", data: {} });
    await page.keyboard.press("Space");
    await expect.poll(() => html(page)).toEqual({ className: "dark", data: {} });
    expect(await page.locator(".design-inspector__count").first().textContent()).toBe("");
    await page.getByRole("button", { name: "Exit design mode", exact: true }).click();
    await expect.poll(() => html(page)).toEqual({ className: "", data: {} });
    expect(errors).toEqual([]);
    await page.close();
  });

  it("matches light/dark by label and keeps the supplied labels", async () => {
    const { page, errors } = await open("labels");
    await show(page, view);
    const toggle = heading(page).getByRole("switch", { name: "Theme: Light", exact: true });
    expect(await toggle.locator("svg").count()).toBe(1);
    await toggle.click();
    await expect.poll(() => html(page)).toEqual({ className: "", data: { appearance: "night" } });
    expect(await heading(page).getByRole("switch").getAttribute("aria-label")).toBe("Theme: Dark");
    await page.getByRole("button", { name: "Exit design mode", exact: true }).click();
    await expect.poll(() => html(page)).toEqual({ className: "", data: { appearance: "day" } });
    expect(errors).toEqual([]);
    await page.close();
  });

  it("shows two other options as a two-segment switch", async () => {
    const { page, errors } = await open("density", "floating", { width: 390, height: 844 });
    await show(page, view);
    const toggle = heading(page).getByRole("switch", { name: "Theme: Cozy", exact: true });
    expect(await toggle.locator("span").allTextContents()).toEqual(["Cozy", "Compact"]);
    expect(await toggle.locator("svg").count()).toBe(0);
    expect(await toggle.getAttribute("data-tip")).toBe("Switch to Compact");
    await heading(page).screenshot({ path: join(shots, `${view}-narrow-segments.png`) });
    await toggle.click();
    await expect.poll(() => html(page)).toEqual({ className: "", data: { density: "compact" } });
    expect(await heading(page).getByRole("switch").getAttribute("data-on")).toBe("1");
    await page.getByRole("button", { name: "Exit design mode", exact: true }).click();
    await expect.poll(() => html(page)).toEqual({ className: "", data: { density: "cozy" } });
    expect(errors).toEqual([]);
    await page.close();
  });

  it.each([
    ["three options", "three", "Light", "Contrast", { scheme: "light" }],
    ["two axes", "axes", "Light +1", "Compact", { density: "cozy" }],
  ])("keeps %s in the compact menu", async (_, themes, summary, choice, restored) => {
    const { page, errors } = await open(themes);
    await show(page, view);
    expect(await heading(page).getByRole("switch").count()).toBe(0);
    const menu = heading(page).locator(".design-theme-switch");
    expect(await menu.locator("summary").textContent()).toBe(summary);
    await menu.locator("summary").click();
    await menu.getByRole("button", { name: choice, exact: true }).click();
    await expect.poll(() => html(page)).not.toEqual({ className: "", data: {} });
    await heading(page).screenshot({ path: join(shots, `${view}-${themes}-menu.png`) });
    // Escape closes the menu, not Design mode.
    await page.keyboard.press("Escape");
    expect(await menu.getAttribute("open")).toBeNull();
    expect(await page.locator(".design-inspector").getAttribute("aria-hidden")).toBe("false");
    await page.getByRole("button", { name: "Exit design mode", exact: true }).click();
    await expect.poll(() => html(page)).toEqual({ className: "", data: restored });
    expect(errors).toEqual([]);
    await page.close();
  });

  it("shows no control without themes", async () => {
    const { page, errors } = await open("none");
    await show(page, view);
    expect(await control(page).count()).toBe(0);
    expect(await page.getByText("System", { exact: true }).count()).toBe(0);
    await heading(page).screenshot({ path: join(shots, `${view}-none.png`) });
    expect(errors).toEqual([]);
    await page.close();
  });
});
