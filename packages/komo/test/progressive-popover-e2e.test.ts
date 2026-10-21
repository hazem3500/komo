import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

// A neutral card with a themed text token, a fill, and a translucent shadow, in a light or dark page.
const html = `<style>
body{margin:0;font:14px system-ui;background:#fafafa;color:#1d1d1f}
[data-mode=dark] body{background:#141414;color:#ededed}
main{min-height:100vh;box-sizing:border-box;padding:40px}
.card{display:inline-block;margin:0 0 16px;padding:16px 20px;border-radius:10px;background-color:#f4f4f4;box-shadow:rgba(209,47,47,.12) 6px 15px 19px 3px}
.tone-ink{color:#3a2f8f}[data-mode=dark] .tone-ink{color:#c9c2ff}
.swatch-a{color:#2b6061}.swatch-b{color:#c2410c}
</style><main><p id="card" class="card tone-ink">Example card</p><p class="swatch-a">Teal note</p><p class="swatch-b">Orange note</p></main>
<script type="module" src="/entry.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-progressive-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { tailwindTokens } from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
      import { classTheme } from ${JSON.stringify(resolve("src/adapters/class-theme.ts"))};
      const query=new URLSearchParams(location.search);
      const axis=classTheme({id:'mode',options:[{id:'light',label:'Light',attribute:{'data-mode':'light'}},{id:'dark',label:'Dark',attribute:{'data-mode':'dark'}}]});
      document.documentElement.setAttribute('data-mode',query.get('theme')??'light');
      const tone=(path,label,property,light,dark)=>({path,label,type:'color',class:path.replace('.','-'),properties:[property],value:light,values:{light,dark},group:'Text'});
      const tokens=tailwindTokens({tokens:[
        tone('tone.ink','Ink','color','#3a2f8f','#c9c2ff'),tone('tone.teal','Teal','color','#2b6061','#7cc4c5'),
        tone('tone.rust','Rust','color','#c2410c','#fb923c'),tone('tone.slate','Slate','color','#334155','#cbd5e1'),
        tone('surface.base','Surface','background-color','#f4f4f4','#2a2a2a'),
      ]},{themes:[axis]});
      window.fetch=async()=>Response.json({threads:[],guests:true});
      window.komo=initKomo({endpoint:location.origin,project:'progressive',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,design:{tokens,themes:[axis]}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(html);
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

async function open(zoom: string, viewport = { width: 1280, height: 760 }) {
  const tab = await browser.newPage({ viewport });
  tab.setDefaultTimeout(5000);
  const errors: string[] = [];
  tab.on("pageerror", error => errors.push(error.message));
  await tab.goto(origin);
  await tab.waitForFunction(() => !!(window as any).komo);
  await openDesign(tab);
  await settle(tab);
  // The card is picked at Fit, where all of it shows, then the zoom changes.
  await tab.locator("#card").click({ force: true });
  await tab.locator('[data-field-property="color"] .design-token-binding').waitFor();
  await tab.getByRole("button", { name: zoom, exact: true }).click();
  await settle(tab);
  await tab.mouse.move(2, 2);
  await settle(tab);
  return { tab, errors };
}

/** The popup's one scroll area: the token list, or the Custom editor. */
const scroller = (popup: Locator) => popup.locator(".komo-tokens__custom:not([hidden]), .komo-tokens__list:not([hidden])").first();

describe.skipIf(!chrome).each(["Fit", "100%"])("the token popup at Frame %s", mode => {
  it("opens on the tokens, swaps to Custom and back, with the keyboard too", async () => {
    const { tab, errors } = await open(mode);
    const field = tab.locator('[data-field-property="color"]');
    await field.locator("select[data-picker]").click();
    const popup = tab.locator(".komo-tokens");
    await popup.locator('[role="option"]').first().waitFor();
    // Tokens first: no picker under the list, no row tooltip, and a Custom… row with the value.
    expect(await popup.locator(".komo-color").count()).toBe(0);
    expect(await popup.locator('[role="option"][title]').count()).toBe(0);
    const more = popup.locator(".komo-tokens__more");
    expect(await more.textContent()).toMatch(/^Custom…[0-9A-F]{6}/);
    // Only the active row shows its path and value.
    const first = popup.locator('[role="option"]').first();
    await first.hover();
    expect(await first.locator(".komo-tokens__sub").isVisible()).toBe(true);
    expect(await popup.locator(".komo-tokens__sub:visible").count()).toBe(1);
    // End, then ArrowDown, reaches Custom…; Enter opens it.
    const list = popup.locator(".komo-tokens__list");
    await list.focus();
    await tab.keyboard.press("End");
    await tab.keyboard.press("ArrowDown");
    expect(await more.evaluate(node => node === (node.getRootNode() as ShadowRoot).activeElement)).toBe(true);
    await tab.keyboard.press("Enter");
    await popup.locator(".komo-color__area").waitFor();
    expect(await popup.locator(".komo-tokens__head").textContent()).toBe("Custom colour");
    expect(await list.isVisible()).toBe(false);
    // Back returns to the tokens with focus on Custom….
    await popup.getByRole("button", { name: "Back to tokens", exact: true }).focus();
    await tab.keyboard.press("Enter");
    await first.waitFor();
    expect(await popup.locator(".komo-color").isVisible()).toBe(false);
    expect(await more.evaluate(node => node === (node.getRootNode() as ShadowRoot).activeElement)).toBe(true);
    // A field's swatch opens straight on the picker.
    await tab.keyboard.press("Escape");
    await field.locator('input[type="color"]').click();
    await popup.locator(".komo-color__area").waitFor();
    // A pointer focuses the area without the keyboard's ring.
    const area = popup.locator(".komo-color__area");
    const box = (await area.boundingBox())!;
    await tab.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await area.evaluate(node => node.matches(":focus") && !node.matches(":focus-visible"))).toBe(true);
    await tab.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await tab.close();
  });

  it("scrolls with the wheel over every control, inside a viewport-high popup", async () => {
    const { tab, errors } = await open(mode, { width: 1280, height: 420 });
    const field = tab.locator('[data-field-property="color"]');
    await field.locator('input[type="color"]').click();
    const popup = tab.locator(".komo-tokens");
    await popup.locator(".komo-color__area").waitFor();
    await settle(tab);
    const rect = (await popup.boundingBox())!;
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.height).toBeLessThanOrEqual(420);
    const area = scroller(popup);
    expect(await area.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    for (const selector of [".komo-color__area", ".komo-color__hue", ".komo-color__alpha", ".komo-color__channels input", ".komo-color__swatches button"]) {
      await area.evaluate(node => { node.scrollTop = 0; });
      const part = popup.locator(selector).first();
      await part.evaluate(node => node.scrollIntoView({ block: "nearest" }));
      await area.evaluate(node => { node.scrollTop = 0; });
      const target = (await part.boundingBox())!;
      const y = Math.min(target.y + target.height / 2, rect.y + rect.height - 4);
      await tab.mouse.move(target.x + target.width / 2, Math.max(y, rect.y + 40));
      await tab.mouse.wheel(0, 120);
      await expect.poll(() => area.evaluate(node => node.scrollTop), { message: `wheel over ${selector}` }).toBeGreaterThan(0);
      expect(await popup.count(), `wheel over ${selector} kept the popup`).toBe(1);
    }
    await tab.keyboard.press("Escape");
    // The shadow editor's scrub inputs scroll it too.
    await tab.locator('[data-field-property="box-shadow"] select[data-picker]').click();
    await popup.getByRole("textbox", { name: "Layer 1 x offset", exact: true }).waitFor();
    await settle(tab);
    const custom = scroller(popup);
    if (await custom.evaluate(node => node.scrollHeight > node.clientHeight)) {
      const x = (await popup.getByRole("textbox", { name: "Layer 1 x offset", exact: true }).boundingBox())!;
      await custom.evaluate(node => { node.scrollTop = 0; });
      await tab.mouse.move(x.x + x.width / 2, x.y + x.height / 2);
      await tab.mouse.wheel(0, 120);
      await expect.poll(() => custom.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    }
    await tab.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await tab.close();
  });

  it("shows one alpha for a shadow color, kept in sync with its picker, and real swatches", async () => {
    const { tab, errors } = await open(mode);
    const shadow = tab.locator('[data-field-property="box-shadow"]');
    await shadow.scrollIntoViewIfNeeded();
    await shadow.locator("select[data-picker]").click();
    const popup = tab.locator(".komo-tokens");
    const color = popup.getByRole("button", { name: "Layer 1 color", exact: true });
    await color.waitFor();
    expect(await color.locator(".komo-typed__alpha").textContent()).toBe("12%");
    expect(await color.locator("span").first().textContent()).toBe("D12F2F");
    await color.click();
    const opacity = popup.getByRole("textbox", { name: "Opacity", exact: true });
    await opacity.waitFor();
    expect(await opacity.inputValue()).toBe("12");
    await opacity.fill("40");
    await opacity.press("Enter");
    await expect.poll(() => color.locator(".komo-typed__alpha").textContent()).toBe("40%");
    // Swatches paint their colors inside the shadow editor too.
    const swatch = popup.locator(".komo-color__swatches button").first();
    await swatch.waitFor();
    expect(await swatch.evaluate(node => getComputedStyle(node).backgroundImage)).toContain("gradient");
    await tab.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await tab.close();
  });
});
