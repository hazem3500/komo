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

// A neutral card with a radius, padding, a two-layer shadow and its own type settings, on a light or dark page.
const html = `<style>
body{margin:0;font:14px system-ui;background:#fafafa;color:#1d1d1f}
[data-mode=dark] body{background:#141414;color:#ededed}
main{min-height:100vh;box-sizing:border-box;padding:40px}
#card{width:240px;padding:12px 16px;border:1px solid #888;border-radius:10px;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,.25),inset 0 1px 0 #ffffff80;font-size:15px;line-height:1.4}
[data-mode=dark] #card{background:#222}
.radius-small{border-radius:8px}
.size-tiny{width:8px}
</style><main><p id="card">Example card text</p></main><script type="module" src="/entry.js"></script>`;

const entry = (src: (path: string) => string) => `
  import { initKomo } from ${JSON.stringify(src("index.ts"))};
  import { tailwindTokens } from ${JSON.stringify(src("adapters/tailwind.ts"))};
  const query=new URLSearchParams(location.search);
  document.documentElement.setAttribute('data-mode',query.get('theme')??'light');
  const tokens=tailwindTokens({tokens:[
    {path:'radius.small',type:'dimension',class:'radius-small',properties:['border-radius'],value:'8px',label:'Small'},
    {path:'shadow.soft',type:'shadow',class:'shadow-soft',properties:['box-shadow'],value:'0px 2px 4px #00000040',label:'Soft'},
    {path:'space.small',type:'dimension',class:'space-small',properties:['padding'],value:'8px',label:'Small'},
    {path:'size.tiny',type:'dimension',class:'size-tiny',properties:['width'],value:'8px',label:'Tiny'},
    {path:'text.body',type:'dimension',class:'text-body',properties:['font-size'],value:'14px',label:'Body'},
    {path:'font.body',type:'fontFamily',class:'font-body',properties:['font-family'],value:'Georgia, serif',label:'Body'},
  ]});
  window.fetch=async()=>Response.json({threads:[],guests:true});
  const mode=query.get('mode');
  window.komo=initKomo({endpoint:location.origin,project:'typed-compact',repo:'example/review',branch:'fixture',pageRoot:mode==='floating'?undefined:document.querySelector('main'),sidebar:mode==='floating'?'edge':'background',frame:{scale:mode==='scaled'},restoreOpen:false,design:{tokens}});
`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-typed-compact-"));
  await build({
    stdin: { contents: entry(path => resolve("src", path)), resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") { response.setHeader("content-type", "text/html"); response.end(html); return; }
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

async function open(mode: string, viewport = { width: 1280, height: 800 }, theme = "light") {
  const tab = await browser.newPage({ viewport });
  tab.setDefaultTimeout(5000);
  const errors: string[] = [];
  tab.on("pageerror", error => errors.push(error.message));
  await tab.goto(`${origin}/?mode=${mode}&theme=${theme}`);
  await tab.waitForFunction(() => !!(window as any).komo);
  await tab.keyboard.press("d");
  await settle(tab);
  await tab.locator("#card").click();
  await tab.locator('[data-field-property="border-radius"] .design-token-binding').waitFor();
  await tab.mouse.move(2, 2);
  await settle(tab);
  return { tab, errors };
}

const trigger = (tab: Page, property: string) => tab.locator(`[data-field-property="${property}"] select[data-picker]`);
async function custom(tab: Page, property: string) {
  const field = tab.locator(`[data-field-property="${property}"]`);
  await field.scrollIntoViewIfNeeded();
  await settle(tab);
  await trigger(tab, property).click();
  await tab.locator(".komo-tokens").waitFor(); if (await tab.locator(".komo-tokens__more").isVisible()) await tab.locator(".komo-tokens__more").click();
  await tab.locator(".komo-custom .komo-typed").first().waitFor();
  await settle(tab);
  return tab.locator(".komo-tokens");
}
const close = async (tab: Page, property: string) => {
  await trigger(tab, property).click();
  await expect.poll(() => tab.locator(".komo-tokens").count()).toBe(0);
};
const card = (tab: Page) => tab.locator("#card");
const style = (tab: Page) => card(tab).evaluate(node => node.getAttribute("style"));
const undo = (tab: Page) => tab.locator('.design-inspector__actions [aria-label="Undo"]');
async function entries(tab: Page) {
  let count = 0;
  while (!(await undo(tab).isDisabled()) && count < 10) { await undo(tab).click(); count++; }
  return count;
}

/** Each visible control of the popup, scrolled to inside the popup's one scroll area, is on screen and hit-testable. */
const unreachable = (popup: ReturnType<Page["locator"]>) => popup.evaluate(node => {
  const root = node.getRootNode() as ShadowRoot, frame = node.getBoundingClientRect();
  const body = node.querySelector<HTMLElement>(".komo-tokens__custom")!;
  return [...node.querySelectorAll<HTMLElement>("input,select,button,summary")]
    .filter(control => control.getClientRects().length && !control.matches("details:not([open]) :not(summary)"))
    .filter(control => {
      const scroller = body.contains(control) ? body : null;
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        let rect = control.getBoundingClientRect();
        if (rect.bottom > box.bottom) scroller.scrollTop += rect.bottom - box.bottom;
        if (rect.top < box.top) scroller.scrollTop -= box.top - rect.top;
      }
      const rect = control.getBoundingClientRect();
      const hit = root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return !(rect.top >= frame.top - .5 && rect.bottom <= frame.bottom + .5 && rect.bottom <= innerHeight && rect.right <= innerWidth && (hit === control || control.contains(hit) || !!hit?.contains(control)));
    }).map(control => control.getAttribute("aria-label") || control.textContent);
});

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("compact typed Custom editors in %s", mode => {
  it("scrubs, nudges and switches units live, keeps the visit as one history entry, and Escape restores", async () => {
    const { tab, errors } = await open(mode);
    const original = await style(tab);
    const popup = await custom(tab, "width");
    expect(await tab.getByRole("button", { name: "Apply custom", exact: true }).count()).toBe(0);
    // The popup's own field: the inspector's field has the same name.
    const value = tab.locator(".komo-tokens").getByRole("textbox", { name: "Width", exact: true });
    const label = popup.locator(".komo-typed__field > span").first();
    const at = (await label.boundingBox())!;
    await tab.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await tab.mouse.down();
    for (const dx of [6, 12, 20]) await tab.mouse.move(at.x + at.width / 2 + dx, at.y + at.height / 2);
    expect(await card(tab).evaluate(node => node.style.width)).toBe("250px");
    expect(await undo(tab).isDisabled()).toBe(true);
    await tab.mouse.up();
    expect(await undo(tab).isDisabled()).toBe(false);
    await value.press("ArrowUp");
    await value.press("Shift+ArrowUp");
    expect(await value.inputValue()).toBe("261");
    await popup.getByRole("combobox", { name: "Width unit", exact: true }).selectOption("rem");
    expect(await card(tab).evaluate(node => node.style.width)).toBe("261rem");
    await close(tab, "width");
    expect(await entries(tab)).toBe(1);
    expect(await style(tab)).toBe(original);

    await custom(tab, "width");
    await value.fill("4");
    await value.press("Enter");
    await value.press("ArrowDown");
    expect(await card(tab).evaluate(node => node.style.width)).toBe("3px");
    await tab.keyboard.press("Escape");
    await expect.poll(() => tab.locator(".komo-tokens").count()).toBe(0);
    expect(await style(tab)).toBe(original);
    expect(await undo(tab).isDisabled()).toBe(true);
    // Typing a value equal to a token keeps the literal: the field stays custom.
    await custom(tab, "width");
    await value.fill("8");
    await value.press("Enter");
    await close(tab, "width");
    expect(await tab.locator('[data-field-property="width"]').getAttribute("data-token-mode")).toBe("custom");
    expect(await card(tab).evaluate(node => [node.className, node.style.width])).toEqual(["", "8px"]);
    expect(await entries(tab)).toBe(1);
    expect(errors).toEqual([]);
    await tab.close();
  });

  it("edits shadow layers in place: 2×2 lengths, inset, the color picker, add and remove", async () => {
    const { tab, errors } = await open(mode);
    const original = await style(tab);
    const popup = await custom(tab, "box-shadow");
    expect(await popup.locator(".komo-typed__layer").count()).toBe(2);
    const grid = (await popup.locator(".komo-typed__layer").first().locator(".komo-typed__grid").boundingBox())!;
    const fields = await popup.locator(".komo-typed__layer").first().locator(".komo-typed__field").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
    expect(new Set(fields.map(Math.round)).size).toBe(2);
    expect(grid.width).toBeLessThan(270);
    const blur = tab.getByRole("textbox", { name: "Layer 1 blur", exact: true });
    await blur.fill("20");
    expect(await card(tab).evaluate(node => node.style.boxShadow)).toContain("20px");
    await blur.press("Tab");
    await popup.getByRole("combobox", { name: "Layer 1 type", exact: true }).selectOption("inner");
    expect(await card(tab).evaluate(node => node.style.boxShadow.match(/inset/g)?.length)).toBe(2);
    expect(await popup.getByRole("button", { name: "Layer 1 color", exact: true }).textContent()).toBe("00000025%");
    // The eye hides a layer from the value and the sample tile, and shows it again.
    const eye = popup.getByRole("button", { name: "Layer 2 visible", exact: true });
    await eye.click();
    expect(await card(tab).evaluate(node => node.style.boxShadow.match(/inset/g)?.length)).toBe(1);
    await eye.click();
    expect(await card(tab).evaluate(node => node.style.boxShadow.match(/inset/g)?.length)).toBe(2);
    expect(await popup.locator(".komo-typed__tile i").evaluate(node => (node as HTMLElement).style.boxShadow)).toContain("inset");
    await popup.getByRole("button", { name: "Layer 1 color", exact: true }).click();
    const hex = popup.locator(".komo-color").getByRole("textbox", { name: "Hex", exact: true });
    await hex.fill("C2410C");
    await hex.press("Enter");
    expect(await card(tab).evaluate(node => node.style.boxShadow)).toContain("rgba(194, 65, 12, 0.25)");
    await popup.getByRole("button", { name: "Remove layer 2", exact: true }).click();
    expect(await popup.locator(".komo-typed__layer").count()).toBe(1);
    await popup.getByRole("button", { name: "Add shadow layer", exact: true }).click();
    expect(await popup.locator(".komo-typed__layer").count()).toBe(2);
    expect(await unreachable(popup)).toEqual([]);
    await close(tab, "box-shadow");
    expect(await entries(tab)).toBe(1);
    expect(await style(tab)).toBe(original);
    expect(errors).toEqual([]);
    await tab.close();
  });

  it.each([{ width: 1280, height: 800 }, { width: 390, height: 844 }])("sizes every editor to its content, keeps each control reachable and Tab inside, at $width px", async viewport => {
    const { tab, errors } = await open(mode, viewport);
    // Font size edits its value in the row; its popup is the token list (font-size-row-e2e).
    for (const property of ["box-shadow", "padding", "width", "font-family"]) {
      const popup = await custom(tab, property);
      const box = (await popup.boundingBox())!, field = (await tab.locator(`[data-field-property="${property}"]`).boundingBox())!;
      // One width for every Custom editor, colors included.
      expect(box.width).toBe(Math.min(256, box.width));
      expect(box.width).toBeGreaterThanOrEqual(Math.min(240, viewport.width - 40));
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      expect(box.y >= field.y + field.height || box.y + box.height <= field.y).toBe(true);
      const body = await popup.locator(".komo-tokens__custom").evaluate(node => ({ client: node.clientHeight, scroll: node.scrollHeight, overflow: getComputedStyle(node).overflowY }));
      expect(body.overflow).toBe("auto");
      expect(body.client).toBeLessThanOrEqual(460);
      expect(await unreachable(popup)).toEqual([]);
      // Tab from the last control wraps to the popup's first, and Shift+Tab back.
      const focusable = popup.locator("button:visible, input:visible, select:visible, summary:visible, [tabindex='0']:visible");
      await focusable.last().focus();
      await tab.keyboard.press("Tab");
      expect(await popup.evaluate(node => node.contains((node.getRootNode() as ShadowRoot).activeElement))).toBe(true);
      await tab.keyboard.press("Shift+Tab");
      expect(await popup.evaluate(node => node.contains((node.getRootNode() as ShadowRoot).activeElement))).toBe(true);
      await tab.keyboard.press("Escape");
      await expect.poll(() => tab.locator(".komo-tokens").count()).toBe(0);
    }
    expect(await undo(tab).isDisabled()).toBe(true);
    expect(errors).toEqual([]);
    await tab.close();
  });
});
