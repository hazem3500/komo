import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Clicks anywhere inside the color popup keep it open, in the Tokens view's rows and in the
// element's properties, at Frame Fit and 100%. Only an outside click, Escape or the toggle close it.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-color-clicks-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { discoverCssTokens } from ${JSON.stringify(resolve("src/adapters/css-variables.ts"))};
      import { tailwindTokens } from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
      window.fetch=async()=>Response.json({threads:[],guests:true});
      // A Tailwind adapter that lists only generated classes re-scans when stylesheets change, as the Tokens view's own preview does.
      const tailwind=tailwindTokens({tokens:['primary','secondary','accent'].map(name=>({path:'color.'+name,label:name,type:'color',class:'text-'+name,properties:['color'],value:getComputedStyle(document.documentElement).getPropertyValue('--color-'+name).trim()}))},{onlyGenerated:true});
      // An adapter whose subscribe() reports on any page change, including komo's own previews.
      const base=discoverCssTokens();
      const noisy={...base,id:'noisy',subscribe(onChange){const observer=new MutationObserver(()=>onChange());observer.observe(document,{attributes:true,childList:true,subtree:true,characterData:true});return()=>observer.disconnect()}};
      const kind=new URLSearchParams(location.search).get('adapter');
      const adapter=kind==='tailwind'?tailwind:kind==='noisy'?noisy:base;
      window.komo=initKomo({endpoint:location.origin,project:'color-clicks',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,design:{tokens:adapter}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      const extra = Array.from({ length: 40 }, (_, index) => `--color-extra-${String(index).padStart(2, "0")}:#${(index * 99991).toString(16).padStart(6, "0").slice(-6)};`).join("");
      response.end(`<style>:root{${extra}--color-zz-low:#2b6061;--color-primary:#b02781;--color-secondary:#575456;--color-surface:#f4f4f4;--color-ink:#131213;--color-accent:#2b6061}body{margin:0;font:14px system-ui}main{min-height:100vh;box-sizing:border-box;padding:60px}#card{width:240px;padding:16px;border-radius:8px;background:var(--color-surface);color:var(--color-primary)}.note{color:var(--color-accent)}.text-primary{color:var(--color-primary)}.text-secondary{color:var(--color-secondary)}.text-accent{color:var(--color-accent)}</style><main><article id="card" class="text-primary">Example card</article><p class="note">Accent note</p><p style="color:var(--color-secondary)">Secondary</p></main><script type="module" src="/entry.js"></script>`);
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

/** Points inside the popup: each control's center, its padding corners and the gaps between its parts. */
const regions = (popup: Locator) => popup.evaluate(node => {
  const box = node.getBoundingClientRect(), points: Array<[string, number, number]> = [];
  const center = (name: string, selector: string) => {
    const part = node.querySelector(selector);
    if (!part) return;
    // With tokens above the picker the popup may scroll; the part is brought into its view first.
    part.scrollIntoView({ block: "nearest" });
    const rect = part.getBoundingClientRect();
    points.push([name, rect.left + rect.width / 2, rect.top + rect.height / 2]);
  };
  center("area", ".komo-color__area");
  center("hue", ".komo-color__hue");
  center("opacity", ".komo-color__alpha");
  center("eyedropper", ".komo-color__drop");
  center("chip", ".komo-color__chip");
  center("hex", ".komo-color__channels input");
  center("channel label", ".komo-color__channels span");
  center("document colors heading", ".komo-color__swatches small");
  center("swatch", ".komo-color__swatches button");
  const head = node.querySelector(".komo-tokens__head")?.getBoundingClientRect();
  if (head) points.push(["header padding", head.left + 1, head.top + head.height / 2]);
  const label = node.querySelector(".komo-tokens__label:not([hidden])")?.getBoundingClientRect();
  if (label) points.push(["Custom value heading", label.left + label.width / 2, label.top + label.height / 2]);
  points.push(["top left padding", box.left + 7, box.top + 7], ["bottom right padding", box.right - 7, box.bottom - 7], ["left edge", box.left + 3, box.top + box.height / 2]);
  const row = node.querySelector(".komo-color__row")?.getBoundingClientRect(), value = node.querySelector(".komo-color__value")?.getBoundingClientRect();
  if (row && value) points.push(["gap between sliders and value row", box.left + box.width / 2, (row.bottom + value.top) / 2]);
  const area = node.querySelector(".komo-color__area")?.getBoundingClientRect();
  if (area && row) points.push(["gap between area and sliders", box.left + box.width / 2, (area.bottom + row.top) / 2]);
  return points;
});

describe.skipIf(!chrome).each(["Fit", "100%"].flatMap(zoom => ["css-variables", "tailwind", "noisy"].map(adapter => ({ zoom, adapter }))))("the color popup at Frame $zoom with $adapter tokens", ({ zoom, adapter }) => {
  it.each(["Tokens view row", "element property"])("stays open for clicks inside it from a %s", async where => {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    tab.setDefaultTimeout(5000);
    const errors: string[] = [];
    tab.on("pageerror", error => errors.push(error.message));
    await tab.goto(`${origin}/?adapter=${adapter}`);
    await tab.waitForFunction(() => !!(window as any).komo);
    await tab.keyboard.press("d");
    await settle(tab);
    await tab.getByRole("button", { name: zoom, exact: true }).click();
    await settle(tab);
    let toggle: Locator;
    if (where === "Tokens view row") {
      await tab.getByRole("button", { name: "Edit tokens", exact: true }).click();
      const name = adapter === "tailwind" ? "primary" : "zz-low";
      const row = tab.locator(".design-token-row").filter({ has: tab.locator("b").getByText(name, { exact: true }) });
      await row.scrollIntoViewIfNeeded();
      await settle(tab);
      toggle = row.locator("button").first();
      await toggle.click();
    } else {
      await tab.locator("#card").click();
      const field = tab.locator('[data-field-property="color"]');
      await field.locator(".design-token-binding").waitFor();
      toggle = field.locator("select[data-picker]");
      await toggle.click();
      await tab.locator(".komo-tokens").waitFor();
    }
    const popup = tab.locator(".komo-tokens");
    await popup.locator(".komo-color__swatches button").first().waitFor();
    await settle(tab);
    const node = await popup.elementHandle();
    const stillOpen = async () => (await popup.count()) === 1 && await popup.evaluate((current, original) => current === original, node);
    // Each point is measured just before its click: a click may resize the popup.
    for (const [name] of await regions(popup)) {
      const [, x, y] = (await regions(popup)).find(point => point[0] === name)!;
      await tab.mouse.click(x, y);
      await settle(tab);
      expect(await stillOpen(), `${where}: a click on the ${name} closed the popup`).toBe(true);
    }
    // The format menu opens and picks inside the popup.
    const format = popup.getByRole("combobox", { name: "Color format", exact: true });
    await format.click();
    const list = tab.locator(".komo-select");
    if (await list.count()) await list.locator("[role=option]").filter({ hasText: /^RGB$/ }).click();
    else await format.selectOption("RGB");
    await settle(tab);
    expect(await stillOpen(), `${where}: the format menu closed the popup`).toBe(true);
    expect(await popup.getByRole("textbox", { name: "Red", exact: true }).count()).toBe(1);
    // Scrubbing a channel label and releasing outside the popup keeps it open and keeps once.
    const label = (await popup.locator(".komo-color__channels span").first().boundingBox())!;
    const box = (await popup.boundingBox())!;
    await tab.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
    await tab.mouse.down();
    await tab.mouse.move(label.x + 30, label.y + label.height / 2, { steps: 4 });
    await tab.mouse.move(box.x + box.width + 60, label.y + label.height / 2, { steps: 4 });
    await tab.mouse.up();
    await settle(tab);
    expect(await stillOpen(), `${where}: releasing a scrub outside closed the popup`).toBe(true);
    // Only a real outside click, Escape or the toggle close it.
    await tab.keyboard.press("Escape");
    await expect.poll(() => popup.count()).toBe(0);
    await toggle.click();
    await popup.waitFor();
    await popup.locator(".komo-color__area").waitFor();
    await toggle.click();
    await expect.poll(() => popup.count()).toBe(0);
    await toggle.click();
    await popup.waitFor();
    await settle(tab);
    const outside = (await popup.boundingBox())!;
    await tab.mouse.click(outside.x - 120 > 0 ? outside.x - 120 : outside.x + outside.width + 40, outside.y + 10);
    await expect.poll(() => popup.count()).toBe(0);
    await tab.screenshot({ path: join(tmpdir(), `komo-color-popup-clicks-${adapter}-${where.replace(/\s/g, "-")}-${zoom === "Fit" ? "fit" : "100"}.png`) });
    expect(errors).toEqual([]);
    await tab.close();
  });
});
