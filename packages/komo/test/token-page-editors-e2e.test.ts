import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The Tokens view's Custom editors for typography, shadow and dimension tokens, and its row tooltip.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-token-editors-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { tailwindTokens } from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
      document.documentElement.setAttribute('data-mode',new URLSearchParams(location.search).get('theme')??'light');
      const tokens=tailwindTokens({tokens:[
        {path:'typography.p2',type:'typography',class:'text-p2',properties:['font'],value:'500 0.875rem/1.43',label:'p2'},
        {path:'typography.h5',type:'typography',class:'text-h5',properties:['font'],value:'600 1.125rem/1.33',label:'h5'},
        {path:'shadow.raised',type:'shadow',class:'shadow-raised',properties:['box-shadow'],value:'0 1px 3px 0 rgb(0 0 0 / 8%)',label:'raised'},
        {path:'radius.card',type:'dimension',class:'radius-card',properties:['border-radius'],value:'8px',label:'card'},
        {path:'color.ink',type:'color',class:'text-ink',properties:['color'],value:'#131213',label:'ink'},
        ...Array.from({length:12},(_,index)=>({path:'space.s'+index,type:'dimension',class:'space-'+index,properties:['padding'],value:(index*2)+'px',label:'s'+index})),
      ]});
      window.fetch=async()=>Response.json({threads:[],guests:true});
      window.komo=initKomo({endpoint:location.origin,project:'token-editors',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,design:{tokens}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<style>body{margin:0;font:14px system-ui;background:#fafafa}[data-mode=dark] body{background:#141414;color:#eee}main{min-height:100vh;box-sizing:border-box;padding:60px}.text-p2{font:500 0.875rem/1.43 system-ui}.text-h5{font:600 1.125rem/1.33 system-ui}.shadow-raised{box-shadow:0 1px 3px 0 rgb(0 0 0 / 8%)}.radius-card{border-radius:8px}.text-ink{color:#131213}</style><main><p class="text-p2 text-ink">Example body</p><h5 class="text-h5">Heading</h5><div class="shadow-raised radius-card" style="width:120px;height:60px;background:#fff"></div></main><script type="module" src="/entry.js"></script>`);
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

const settle = (tab: Page) => tab.evaluate(async () => {
  const roots = [document, ...[...document.querySelectorAll("*")].flatMap(node => node.shadowRoot ? [node.shadowRoot] : [])];
  const running = () => roots.flatMap(root => root.getAnimations()).filter(animation =>
    (animation.playState === "running" || animation.pending) && animation.effect?.getComputedTiming().endTime !== Infinity);
  for (let animations = running(); animations.length; animations = running())
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
});

async function tokensView(zoom: string, viewport = { width: 1280, height: 860 }) {
  const tab = await browser.newPage({ viewport });
  tab.setDefaultTimeout(5000);
  const errors: string[] = [];
  tab.on("pageerror", error => errors.push(error.message));
  await tab.goto(origin);
  await tab.waitForFunction(() => !!(window as any).komo);
  await tab.keyboard.press("d");
  await settle(tab);
  const zoomButton = tab.getByRole("button", { name: zoom, exact: true });
  if (await zoomButton.count()) { await zoomButton.click(); await settle(tab); }
  await tab.getByRole("button", { name: "Edit tokens", exact: true }).click();
  await tab.locator(".design-token-row").first().waitFor();
  await settle(tab);
  return { tab, errors };
}
const row = (tab: Page, name: string) => tab.locator(".design-token-row").filter({ has: tab.locator("b").getByText(name, { exact: true }) });
async function open(tab: Page, name: string) {
  await row(tab, name).scrollIntoViewIfNeeded();
  await settle(tab);
  await row(tab, name).locator("button").first().click();
  const popup = tab.locator(".komo-tokens");
  await popup.locator(".komo-custom, .komo-color").first().waitFor();
  await settle(tab);
  return popup;
}
const close = async (tab: Page, name: string) => {
  await row(tab, name).locator("button").first().click();
  await expect.poll(() => tab.locator(".komo-tokens").count()).toBe(0);
};

describe.skipIf(!chrome).each(["Fit", "100%"])("Tokens view Custom editors at Frame %s", zoom => {
  it("edits a typography token as family, weight, size and line height, live, with Escape restoring", async () => {
    const { tab, errors } = await tokensView(zoom);
    const popup = await open(tab, "p2");
    expect(await popup.getByText("Custom expression", { exact: false }).count()).toBe(0);
    expect(await popup.getByRole("button", { name: "Apply custom", exact: true }).count()).toBe(0);
    expect(await popup.locator("details").evaluate(node => (node as HTMLDetailsElement).open)).toBe(false);
    expect(await popup.locator("summary").textContent()).toBe("Edit as CSS");
    expect(await popup.locator("input[type=number]").count()).toBe(0);
    await popup.getByRole("combobox", { name: "Font weight", exact: true }).selectOption("700");
    const size = popup.getByRole("textbox", { name: "Font size", exact: true });
    await size.press("ArrowUp");
    expect(await size.inputValue()).toBe("0.975");
    await close(tab, "p2");
    expect(await row(tab, "p2").locator("i").textContent()).toBe("700 0.975rem/1.43");
    expect(await row(tab, "p2").getAttribute("data-changed")).toBe("");
    // Escape restores the value from before the popup opened.
    await open(tab, "p2");
    await popup.getByRole("textbox", { name: "Line height", exact: true }).fill("2");
    await tab.keyboard.press("Escape");
    await expect.poll(() => tab.locator(".komo-tokens").count()).toBe(0);
    expect(await row(tab, "p2").locator("i").textContent()).toBe("700 0.975rem/1.43");
    expect(errors).toEqual([]);
    await tab.close();
  });

  it("edits a shadow token's layer in one compact row with a live sample, and a dimension with a unit suffix", async () => {
    const { tab, errors } = await tokensView(zoom);
    let popup = await open(tab, "raised");
    for (const name of ["Layer 1 type", "Layer 1 color", "Layer 1 visible", "Remove layer 1"]) expect(await popup.getByLabel(name, { exact: true }).count(), name).toBe(1);
    const units = await popup.locator('select[aria-label="Layer 1 x offset unit"] option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value));
    expect(units[0]).toBe("px");
    expect(units).not.toContain("");
    const label = (await popup.locator(".komo-typed__field > span").first().boundingBox())!;
    await tab.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
    await tab.mouse.down();
    await tab.mouse.move(label.x + label.width / 2 + 8, label.y + label.height / 2, { steps: 4 });
    await tab.mouse.up();
    expect(await popup.locator(".komo-typed__tile i").evaluate(node => (node as HTMLElement).style.boxShadow)).toContain("4px 1px 3px");
    await close(tab, "raised");
    expect(await row(tab, "raised").locator("i").textContent()).toContain("4px 1px 3px");
    popup = await open(tab, "card");
    expect(await popup.getByRole("textbox", { name: "border-radius", exact: true }).inputValue()).toBe("8");
    expect(await popup.locator("input[type=number]").count()).toBe(0);
    expect(await popup.getByRole("combobox", { name: "border-radius unit", exact: true }).inputValue()).toBe("px");
    await tab.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await tab.close();
  });

  it.each([{ width: 1280, height: 860 }, { width: 390, height: 844 }])("shows a row's details in a tooltip that covers no row or heading at $width px", async viewport => {
    const { tab, errors } = await tokensView(zoom, viewport);
    const target = row(tab, "h5");
    await target.scrollIntoViewIfNeeded();
    await settle(tab);
    expect(await target.locator("button").first().getAttribute("title")).toBeNull();
    await target.locator("button").first().hover();
    const tip = tab.locator(".sidebar-tooltip[data-open]");
    await tip.waitFor();
    await settle(tab);
    expect(await tip.textContent()).toContain("typography.h5");
    const overlaps = await tip.evaluate(node => {
      const box = node.getBoundingClientRect(), root = node.getRootNode() as ShadowRoot;
      const hits = (rect: DOMRect) => rect.left < box.right && box.left < rect.right && rect.top < box.bottom && box.top < rect.bottom;
      return [...root.querySelectorAll(".design-token-page__list small, .design-token-row")].filter(item => item.getBoundingClientRect().height && hits(item.getBoundingClientRect()) && !item.querySelector("[data-tip]:hover")).map(item => item.textContent);
    });
    expect(overlaps).toEqual([]);
    await tab.mouse.move(2, 2);
    await expect.poll(() => tab.locator(".sidebar-tooltip[data-open]").count()).toBe(0);
    expect(errors).toEqual([]);
    await tab.close();
  });
});
