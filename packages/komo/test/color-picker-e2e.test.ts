import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

// A neutral card with a themed text token, a plain fill and a border, in a light and a dark page.
const html = `<style>
body{margin:0;font:14px system-ui;background:#fafafa;color:#1d1d1f}
[data-mode=dark] body{background:#141414;color:#ededed}
main{min-height:100vh;box-sizing:border-box;padding:40px}
.card{display:inline-block;margin:0 0 16px;padding:16px 20px;border:2px solid #8a8a8a;border-radius:10px;background-color:#f4f4f4}
[data-mode=dark] .card{background-color:#2a2a2a;border-color:#555555}
.tone-ink{color:#3a2f8f}[data-mode=dark] .tone-ink{color:#c9c2ff}
.swatch-a{color:#2b6061}.swatch-b{color:#c2410c}
</style><main><p id="card" class="card tone-ink">Example card</p><p class="swatch-a">Teal note</p><p class="swatch-b">Orange note</p></main>
<script type="module" src="/entry.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-color-picker-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { tailwindTokens } from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
      import { classTheme } from ${JSON.stringify(resolve("src/adapters/class-theme.ts"))};
      const query=new URLSearchParams(location.search);
      const axis=classTheme({id:'mode',options:[{id:'light',label:'Light',attribute:{'data-mode':'light'}},{id:'dark',label:'Dark',attribute:{'data-mode':'dark'}}]});
      document.documentElement.setAttribute('data-mode',query.get('theme')??'light');
      const tone=(path,label,property,light,dark)=>({path,label,type:'color',class:path.replace('.','-'),properties:[property],value:light,values:{light,dark}});
      const tokens=tailwindTokens({tokens:[
        tone('tone.ink','Ink','color','#3a2f8f','#c9c2ff'),tone('tone.teal','Teal','color','#2b6061','#7cc4c5'),
        tone('surface.base','Surface','background-color','#f4f4f4','#2a2a2a'),tone('surface.teal','Teal surface','background-color','#2b6061','#2b6061'),
        tone('edge.base','Edge','border-color','#8a8a8a','#555555'),
      ]},{themes:[axis]});
      window.fetch=async()=>Response.json({threads:[],guests:true});
      const mode=query.get('mode');
      window.komo=initKomo({endpoint:location.origin,project:'color-picker',repo:'example/review',branch:'fixture',pageRoot:mode==='floating'?undefined:document.querySelector('main'),sidebar:mode==='floating'?'edge':'background',frame:{scale:mode==='scaled'},restoreOpen:false,design:{tokens,themes:[axis]}});
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

/** Every running finite animation, on the page and in komo's shadow root, has finished, and two frames have passed. */
const settle = (tab: Page) => tab.evaluate(async () => {
  const roots = [document, ...[...document.querySelectorAll("*")].flatMap(node => node.shadowRoot ? [node.shadowRoot] : [])];
  const running = () => roots.flatMap(root => root.getAnimations()).filter(animation =>
    (animation.playState === "running" || animation.pending) && animation.effect?.getComputedTiming().endTime !== Infinity);
  for (let animations = running(); animations.length; animations = running())
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
});

async function open(mode: string, { theme = "light", viewport = { width: 1280, height: 760 } } = {}) {
  const tab = await browser.newPage({ viewport });
  tab.setDefaultTimeout(5000);
  const errors: string[] = [];
  tab.on("pageerror", error => errors.push(error.message));
  await tab.goto(`${origin}/?mode=${mode}&theme=${theme}`);
  await tab.waitForFunction(() => !!(window as any).komo);
  await tab.evaluate(() => localStorage.clear());
  await tab.keyboard.press("d");
  await settle(tab);
  await tab.locator("#card").click();
  await tab.locator('[data-field-property="background-color"] .design-token-binding').waitFor();
  await tab.mouse.move(2, 2);
  await settle(tab);
  return { tab, errors };
}

/** Opens a field's color popup on Custom from its swatch, once the field is in view. */
async function picker(tab: Page, property: string) {
  const field = tab.locator(`[data-field-property="${property}"]`);
  await field.scrollIntoViewIfNeeded();
  await settle(tab);
  await field.locator('input[type="color"]').click();
  const custom = tab.locator(".komo-tokens__tabs button").filter({ hasText: "Custom" });
  if (await custom.getAttribute("aria-pressed") !== "true") await custom.click();
  await tab.locator(".komo-color__area").waitFor();
  await settle(tab);
  return tab.locator(".komo-tokens");
}

const style = (tab: Page) => tab.locator("#card").evaluate(node => node.getAttribute("style"));
const undo = (tab: Page) => tab.locator('.design-inspector__actions [aria-label="Undo"]');
const closeFrom = async (tab: Page, property: string) => {
  await tab.locator(`[data-field-property="${property}"] select[data-picker]`).click();
  await expect.poll(() => tab.locator(".komo-tokens").count()).toBe(0);
};
/** Undo presses until Undo is disabled: how many entries the history held. */
async function entries(tab: Page) {
  let count = 0;
  while (!(await undo(tab).isDisabled()) && count < 10) { await undo(tab).click(); count++; }
  return count;
}

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("the color picker in %s", mode => {
  it("previews a drag live and keeps it as one history entry on pointer-up", async () => {
    const { tab, errors } = await open(mode);
    const original = await style(tab);
    await picker(tab, "background-color");
    const area = (await tab.locator(".komo-color__area").boundingBox())!;
    await tab.mouse.move(area.x + area.width * .2, area.y + area.height * .2);
    await tab.mouse.down();
    for (const step of [.3, .45, .6, .75]) await tab.mouse.move(area.x + area.width * step, area.y + area.height * (1 - step));
    const dragging = await style(tab);
    expect(dragging).toContain("background-color");
    expect(await undo(tab).isDisabled()).toBe(true);
    await tab.mouse.up();
    expect(await undo(tab).isDisabled()).toBe(false);
    const kept = await style(tab);
    await closeFrom(tab, "background-color");
    expect(await style(tab)).toBe(kept);
    expect(await entries(tab)).toBe(1);
    expect(await style(tab)).toBe(original);
    expect(errors).toEqual([]);
    await tab.close();
  });

  it("previews typing, keeps it on Enter or blur, and Escape restores the value from before the popup opened", async () => {
    const { tab, errors } = await open(mode);
    const original = await style(tab);
    await picker(tab, "background-color");
    const hex = tab.getByRole("textbox", { name: "Hex", exact: true });
    await hex.fill("2B6061");
    expect(await style(tab)).toContain("rgb(43, 96, 97)");
    expect(await undo(tab).isDisabled()).toBe(true);
    await hex.press("Tab");
    expect(await undo(tab).isDisabled()).toBe(false);
    const opacity = tab.getByRole("textbox", { name: "Opacity", exact: true });
    await opacity.fill("50");
    await opacity.press("Enter");
    expect(await style(tab)).toContain("rgba(43, 96, 97, 0.5)");
    // The popup offers the token whose value the color now matches only when it does.
    await expect.poll(() => tab.locator(".komo-color__match").isHidden()).toBe(true);
    await closeFrom(tab, "background-color");
    expect(await entries(tab)).toBe(1);
    expect(await style(tab)).toBe(original);

    await picker(tab, "background-color");
    const area = (await tab.locator(".komo-color__area").boundingBox())!;
    await tab.mouse.click(area.x + area.width * .8, area.y + area.height * .3);
    await tab.getByRole("textbox", { name: "Hex", exact: true }).fill("C2410C");
    await tab.keyboard.press("Escape");
    await expect.poll(() => tab.locator(".komo-tokens").count()).toBe(0);
    expect(await style(tab)).toBe(original);
    expect(await undo(tab).isDisabled()).toBe(true);
    expect(await tab.locator('[data-field-property="background-color"] select[data-picker]').evaluate(node => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
    expect(errors).toEqual([]);
    await tab.close();
  });

  it("drives the area and sliders from the keyboard and keeps Tab inside the popup", async () => {
    const { tab, errors } = await open(mode);
    await picker(tab, "background-color");
    const area = tab.getByRole("slider", { name: "Saturation and brightness", exact: true });
    const hue = tab.getByRole("slider", { name: "Hue", exact: true });
    const opacity = tab.getByRole("slider", { name: "Opacity", exact: true });
    await area.focus();
    await area.press("End");
    await area.press("Shift+ArrowDown");
    await area.press("ArrowLeft");
    expect(await area.getAttribute("aria-valuetext")).toBe("Saturation 99%, brightness 86%");
    await hue.focus();
    await hue.press("End");
    expect(await hue.getAttribute("aria-valuetext")).toBe("Hue 360°");
    await hue.press("Home");
    await hue.press("Shift+ArrowRight");
    await hue.press("ArrowRight");
    expect(await hue.getAttribute("aria-valuetext")).toBe("Hue 11°");
    await opacity.focus();
    await opacity.press("PageDown");
    expect(await opacity.getAttribute("aria-valuetext")).toBe("Opacity 90%");
    expect(await tab.getByRole("textbox", { name: "Opacity", exact: true }).inputValue()).toBe("90");
    // From the popup's last control, Tab wraps to its first and Shift+Tab back.
    const last = tab.locator(".komo-color__swatches button").last();
    await last.focus();
    await tab.keyboard.press("Tab");
    const active = () => tab.evaluate(() => {
      const root = [...document.querySelectorAll("*")].find(node => node.shadowRoot?.querySelector(".komo-tokens"))!.shadowRoot!;
      return [!!root.activeElement?.closest(".komo-tokens"), root.activeElement?.textContent];
    });
    expect(await active()).toEqual([true, "Tokens"]);
    await tab.keyboard.press("Shift+Tab");
    expect((await active())[0]).toBe(true);
    await tab.keyboard.press("Escape");
    expect(await undo(tab).isDisabled()).toBe(true);
    expect(errors).toEqual([]);
    await tab.close();
  });

  it("offers document and recent swatches, and the token a swatch matches", async () => {
    const { tab, errors } = await open(mode);
    await picker(tab, "background-color");
    const teal = tab.getByRole("button", { name: "Document color #2b6061", exact: true });
    await teal.waitFor();
    await teal.click();
    expect(await style(tab)).toContain("rgb(43, 96, 97)");
    const use = tab.locator(".komo-color__match").getByRole("button", { name: "Use token Teal surface", exact: true });
    await use.waitFor();
    expect(await tab.locator(".komo-color__match").textContent()).toContain("Matches Teal surface");
    await use.click();
    await expect.poll(() => tab.locator(".komo-tokens").count()).toBe(0);
    await expect.poll(() => tab.locator('[data-field-property="background-color"]').getAttribute("data-token-mode")).toBe("token");
    expect(await entries(tab)).toBe(1);
    await picker(tab, "background-color");
    await tab.getByRole("button", { name: "Document color #c2410c", exact: true }).click();
    await closeFrom(tab, "background-color");
    await picker(tab, "border-color");
    await tab.getByRole("button", { name: "Recent color #c2410c", exact: true }).waitFor();
    await tab.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await tab.close();
  });

  it.each(["light", "dark"])("stays 256px wide like every Custom editor, inside the viewport and off the field near the panel bottom (%s page)", async theme => {
    const { tab, errors } = await open(mode, { theme, viewport: { width: 1280, height: 700 } });
    await tab.locator(".design-inspector__controls").evaluate(node => { node.scrollTop = node.scrollHeight; });
    await settle(tab);
    const popup = await picker(tab, "border-color");
    const box = (await popup.boundingBox())!, field = (await tab.locator('[data-field-property="border-color"]').boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(256);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(700);
    expect(box.y + box.height <= field.y || box.y >= field.y + field.height).toBe(true);
    expect(await popup.evaluate(node => node.matches(":popover-open"))).toBe(true);
    // Each part answers hit-tests over the panel beneath it.
    expect(await popup.evaluate(node => [".komo-color__area", ".komo-color__hue", ".komo-color__alpha", ".komo-color__value", ".komo-tokens__tabs"].every(selector => {
      const rect = node.querySelector(selector)!.getBoundingClientRect(), root = node.getRootNode() as ShadowRoot;
      return node.contains(root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    }))).toBe(true);
    await tab.screenshot({ path: join(tmpdir(), `komo-color-picker-after-${mode}-${theme}.png`) });
    await tab.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await tab.close();
  });
});
