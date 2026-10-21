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

// A neutral page: a chip whose text color comes from a themed token class and whose fill is a
// plain value with a hover transition, a plain paragraph, and an icon button in a body-level dialog.
const page = `<style>
body{margin:0;font:14px system-ui}
main{min-height:100vh;box-sizing:border-box;padding:40px}
.chip{display:inline-block;margin:0 0 16px;padding:12px 16px;border:2px solid #8a8a8a;border-radius:8px;background-color:#f4f4f4;transition:color .15s,background-color .15s,border-color .15s}
.chip:hover{background-color:#a84c9d;border-color:#5b2153}
[data-mode=dark] .chip{background-color:#2a2a2a;border-color:#555555}
[data-mode=dark] .chip:hover{background-color:#c282b9;border-color:#e0b3d9}
.tone-ink{color:#3a2f8f}[data-mode=dark] .tone-ink{color:#c9c2ff}
#plain{color:#2a4d8f;transition:color .15s}#plain:hover{color:#0b2a66}[data-mode=dark] #plain{color:#9db8ee}[data-mode=dark] #plain:hover{color:#d6e2fa}
.dialog{position:fixed;left:40px;top:300px;padding:24px;border-radius:12px;background:#fff;box-shadow:0 8px 30px #0003}
.icon{display:inline-grid;padding:8px;border:0;background:#eee;color:#131213;transition:color .15s}
.icon:hover{color:#3c393b}[data-mode=dark] .icon{color:#e6e3e5}[data-mode=dark] .icon:hover{color:#bdb9bb}
</style><main><p id="chip" class="chip tone-ink">Example chip</p><p id="plain">Plain paragraph</p></main>
<div class="dialog" role="dialog" aria-modal="true" aria-label="Example dialog"><button class="icon" aria-label="Close example"><svg id="icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
<script type="module" src="/entry.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-color-field-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { tailwindTokens } from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
      import { classTheme } from ${JSON.stringify(resolve("src/adapters/class-theme.ts"))};
      const axis=classTheme({id:'mode',options:[{id:'light',label:'Light',attribute:{'data-mode':'light'}},{id:'dark',label:'Dark',attribute:{'data-mode':'dark'}}]});
      document.documentElement.setAttribute('data-mode','light');
      const tone=(path,label,property,light,dark)=>({path,label,type:'color',class:path.replace('.','-'),properties:[property],value:light,values:{light,dark}});
      const tokens=tailwindTokens({tokens:[
        tone('tone.ink','Ink','color','#3a2f8f','#c9c2ff'),tone('tone.accent','Accent','color','#6941c6','#c1a8ff'),
        tone('surface.base','Surface','background-color','#f4f4f4','#2a2a2a'),tone('edge.base','Edge','border-color','#8a8a8a','#555555'),
        tone('icon.fill','Icon fill','fill','#131213','#e6e3e5'),tone('icon.stroke','Icon stroke','stroke','#131213','#e6e3e5'),
      ]},{themes:[axis]});
      window.fetch=async()=>Response.json({threads:[],guests:true});
      const mode=new URLSearchParams(location.search).get('mode');
      window.komo=initKomo({endpoint:location.origin,project:'color-fields',repo:'example/review',branch:'fixture',pageRoot:mode==='floating'?undefined:document.querySelector('main'),sidebar:mode==='floating'?'edge':'background',frame:{scale:mode==='scaled'},restoreOpen:false,design:{tokens,themes:[axis]}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(page);
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

async function open(mode: string, viewport = { width: 1280, height: 720 }) {
  const tab = await browser.newPage({ viewport });
  tab.setDefaultTimeout(5000);
  const errors: string[] = [];
  tab.on("pageerror", error => errors.push(error.message));
  await tab.goto(`${origin}/?mode=${mode}`);
  await tab.waitForFunction(() => !!(window as any).komo);
  await tab.keyboard.press("d");
  // Design mode's own entrance (Frame or sidebar motion) ends before any popup opens.
  await settle(tab);
  return { tab, errors };
}

const frames = (tab: Page) => tab.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));

/** Every finite animation and transition on the page has finished, and the panel has had two frames to read it. */
const settle = (tab: Page) => tab.evaluate(async () => {
  const running = () => document.getAnimations().filter(animation =>
    (animation.playState === "running" || animation.pending) && animation.effect?.getComputedTiming().endTime !== Infinity);
  for (let animations = running(); animations.length; animations = running())
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
});

/** The field's text, its swatch, the open popup's Custom color and the element's computed value, as canvas colors. */
const read = (tab: Page, selector: string, property: string) => tab.evaluate(([selector, property]) => {
  const root = [...document.querySelectorAll("*")].find(node => node.shadowRoot?.querySelector(".design-inspector"))!.shadowRoot!;
  const field = root.querySelector(`[data-field-property="${property}"]`)!;
  const color = (value: string | undefined) => {
    if (!value) return undefined;
    const context = document.createElement("canvas").getContext("2d")!;
    context.fillStyle = "#010203";
    context.fillStyle = value;
    return context.fillStyle;
  };
  return {
    text: color(field.querySelector<HTMLInputElement>("input[data-property]")!.value),
    swatch: color(field.querySelector<HTMLInputElement>('input[type="color"]')!.value),
    popup: color(root.querySelector(".komo-tokens .komo-color") ? getComputedStyle(root.querySelector(".komo-color")!).getPropertyValue("--color") : undefined),
    computed: color(getComputedStyle(document.querySelector(selector)!).getPropertyValue(property)),
  };
}, [selector, property] as const);

/** Opens the field's popup from the keyboard, so the pointer stays where it is, on its Custom tab. */
async function openCustom(tab: Page, property: string) {
  const trigger = tab.locator(`[data-field-property="${property}"] select[data-picker]`);
  // Bring the field into view first: a scroll that lands after the popup opens closes it.
  await tab.locator(`[data-field-property="${property}"]`).scrollIntoViewIfNeeded();
  await frames(tab);
  await trigger.focus();
  await tab.keyboard.press("Enter");
  await tab.locator(".komo-tokens").waitFor();
  // Custom… from the keyboard, so the pointer stays where the test put it.
  await tab.locator(".komo-tokens__more").focus();
  await tab.keyboard.press("Enter");
  await tab.locator(".komo-tokens .komo-color").waitFor();
}

async function agrees(tab: Page, selector: string, property: string, popup: boolean) {
  if (popup) await openCustom(tab, property);
  await settle(tab);
  await expect.poll(async () => {
    const value = await read(tab, selector, property);
    return [value.text, value.swatch, popup ? value.popup : value.computed];
  }).toEqual(Array(3).fill((await read(tab, selector, property)).computed));
  if (popup) {
    await tab.keyboard.press("Escape");
    await tab.locator(".komo-tokens").waitFor({ state: "detached" });
  }
}

async function switchTheme(tab: Page, label: string) {
  const toggle = tab.locator(".design-theme-toggle");
  if ((await toggle.getAttribute("aria-label")) !== `Theme: ${label}`) await toggle.click();
  await tab.waitForFunction(id => document.documentElement.getAttribute("data-mode") === id, label.toLowerCase());
}

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("color fields in %s", mode => {
  it.each([
    { name: "a token-bound and a Custom field", selector: "#chip", properties: ["color", "background-color"] },
    { name: "a plain element", selector: "#plain", properties: ["color"] },
    { name: "an icon inside a button in a body-level dialog", selector: "#icon", properties: ["color"] },
  ])("text, swatch, popup and computed value agree for $name through hover, pointer exit and themes", async ({ selector, properties }) => {
    const { tab, errors } = await open(mode);
    const target = tab.locator(selector);
    // Selected while hovered, mid-transition: the fields settle on the hovered value.
    await target.hover();
    await target.click();
    await tab.locator(`[data-field-property="${properties[0]}"] .design-token-binding`).waitFor();
    for (const property of properties) await agrees(tab, selector, property, true);
    // A popup opened while hovered follows the settled value once the pointer leaves.
    const last = properties.at(-1)!;
    await openCustom(tab, last);
    const hovered = (await read(tab, selector, last)).popup;
    await tab.mouse.move(2, 700);
    await settle(tab);
    const rest = (await read(tab, selector, last)).computed;
    if (selector !== "#chip" || last === "background-color") expect(rest).not.toBe(hovered);
    await expect.poll(async () => (await read(tab, selector, last)).popup).toBe(rest);
    await tab.keyboard.press("Escape");
    for (const property of properties) await agrees(tab, selector, property, true);
    for (const theme of ["Dark", "Light"]) {
      const before = (await read(tab, selector, properties[0])).computed;
      await switchTheme(tab, theme);
      await settle(tab);
      expect((await read(tab, selector, properties[0])).computed).not.toBe(before);
      for (const property of properties) {
        await agrees(tab, selector, property, false);
        await agrees(tab, selector, property, true);
      }
    }
    if (selector === "#chip")
      expect(await tab.locator('[data-field-property="color"]').getAttribute("data-token-mode")).toBe("connected");
    expect(errors).toEqual([]);
    await tab.evaluate(() => (window as any).komo.destroy());
    await tab.close();
  });

  it.each([
    { name: "wide", viewport: { width: 1280, height: 720 } },
    { name: "narrow", viewport: { width: 420, height: 760 } },
  ])("keeps the open popup above later fields and inside the viewport in a $name panel", async ({ name, viewport }) => {
    const { tab, errors } = await open(mode, viewport);
    const probe = async (property: string, shot: string) => {
      const field = tab.locator(`[data-field-property="${property}"]`);
      await field.scrollIntoViewIfNeeded();
      await frames(tab);
      await field.locator('input[type="color"]').click();
      await tab.locator(".komo-tokens .komo-color__area").waitFor();
      await tab.locator(".komo-tokens").evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
      const result = await tab.evaluate(property => {
        const host = [...document.querySelectorAll("*")].find(node => node.shadowRoot?.querySelector(".design-inspector"))!;
        const root = host.shadowRoot!;
        const popup = root.querySelector<HTMLElement>(".komo-tokens")!;
        const anchor = root.querySelector(`[data-field-property="${property}"]`)!.getBoundingClientRect();
        const rect = popup.getBoundingClientRect();
        const center = (node: Element | null) => {
          const box = node!.getBoundingClientRect();
          return [box.left + box.width / 2, box.top + box.height / 2];
        };
        const points = [
          center(popup.querySelector(".komo-color__area")),
          center(popup.querySelector(".komo-color__hue")),
          center(popup.querySelector(".komo-color__value")),
        ];
        for (const y of [.15, .5, .85]) for (const x of [.1, .5, .9]) points.push([rect.left + rect.width * x, rect.top + rect.height * y]);
        const misses = points.filter(([x, y]) => {
          const hit = root.elementFromPoint(x, y);
          return !hit || !popup.contains(hit) || root.elementsFromPoint(x, y)[0] !== hit || document.elementFromPoint(x, y) !== host;
        });
        return {
          misses, open: popup.matches(":popover-open"), up: popup.hasAttribute("data-up"),
          visible: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
          attached: popup.hasAttribute("data-up") ? Math.abs(rect.bottom - anchor.top) <= 6 : Math.abs(rect.top - anchor.bottom) <= 6,
          roomBelow: innerHeight - anchor.bottom,
        };
      }, property);
      await tab.screenshot({ path: join(tmpdir(), `komo-color-field-${mode}-${name}-${shot}.png`) });
      expect(result).toMatchObject({ misses: [], open: true, visible: true, attached: true });
      await tab.keyboard.press("Escape");
      await tab.locator(".komo-tokens").waitFor({ state: "detached" });
      return result;
    };
    await tab.mouse.move(2, 2);
    await tab.locator("#icon").click();
    await tab.locator('[data-field-property="color"] .design-token-binding').waitFor();
    // The first Appearance field: Fill, Stroke and Stroke width follow it.
    await probe("color", "icon");
    await tab.locator("#chip").click();
    await tab.locator('[data-field-property="background-color"] .design-token-binding').waitFor();
    // The only field in Fill, with the Border section after it.
    await probe("background-color", "fill");
    // The panel scrolled to its end: the last field, near the bottom, opens upward when there is no room below.
    await tab.locator(".design-inspector__controls").evaluate(node => { node.scrollTop = node.scrollHeight; });
    const last = await probe("border-color", "last");
    if (last.roomBelow < 336) expect(last.up).toBe(true);
    expect(errors).toEqual([]);
    await tab.evaluate(() => (window as any).komo.destroy());
    await tab.close();
  });
});
