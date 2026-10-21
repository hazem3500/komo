import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// komo's select menus show every label in full: in the color popup's format menu, in a unit
// select inside a Custom popup, and in the panel's own selects. Only the viewport may cut one short.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-select-labels-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { tailwindTokens } from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
      const tokens=tailwindTokens({tokens:[
        {path:'color.ink',type:'color',class:'text-ink',properties:['color'],value:'#131213',label:'Ink'},
        {path:'radius.small',type:'dimension',class:'radius-small',properties:['border-radius'],value:'8px',label:'Small'},
      ]});
      window.fetch=async()=>Response.json({threads:[],guests:true});
      window.komo=initKomo({endpoint:location.origin,project:'select-labels',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,design:{tokens}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<style>body{margin:0;font:14px system-ui}main{min-height:100vh;box-sizing:border-box;padding:60px}#card{width:240px;padding:16px;border:1px solid #888;border-radius:10px;color:#2b6061}</style><main><p id="card">Example card text</p></main><script type="module" src="/entry.js"></script>`);
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

/** Opens a komo select with the mouse and reads its list: labels, truncation, rows and the check column. */
async function menu(tab: Page, trigger: Locator) {
  await trigger.click();
  const list = tab.locator(".komo-select");
  await list.waitFor();
  await settle(tab);
  return list.evaluate((node, triggerWidth) => {
    const rows = [...node.querySelectorAll<HTMLElement>("[role=option]")];
    return {
      labels: rows.map(row => row.querySelector("span")!.textContent),
      truncated: rows.filter(row => { const label = row.querySelector("span")!; return label.scrollWidth > label.clientWidth; }).map(row => row.textContent),
      heights: [...new Set(rows.map(row => Math.round(row.getBoundingClientRect().height)))],
      wide: node.getBoundingClientRect().width >= triggerWidth - 1 && node.getBoundingClientRect().right <= innerWidth,
      // The check sits in a fixed column on the right, after every label.
      check: rows.every(row => {
        const label = row.querySelector("span")!.getBoundingClientRect(), check = getComputedStyle(row, "::after");
        return check.content !== "none" && parseFloat(check.width) > 0 && label.left - row.getBoundingClientRect().left < 12;
      }),
      selected: rows.find(row => row.getAttribute("aria-selected") === "true")?.textContent,
    };
  }, (await trigger.boundingBox())!.width);
}

describe.skipIf(!chrome).each([{ width: 1280, height: 860 }, { width: 390, height: 844 }])("komo select labels at $width px", viewport => {
  it("shows each menu's options in full: the color format, a Custom unit and a panel select", async () => {
    const tab = await browser.newPage({ viewport });
    tab.setDefaultTimeout(5000);
    const errors: string[] = [];
    tab.on("pageerror", error => errors.push(error.message));
    await tab.goto(origin);
    await tab.waitForFunction(() => !!(window as any).komo);
    await tab.keyboard.press("d");
    await settle(tab);
    await tab.locator("#card").click();
    await tab.mouse.move(2, 2);
    const shots: string[] = [];
    const shot = async (name: string) => {
      const path = join(tmpdir(), `komo-select-labels-${name}-${viewport.width}.png`);
      await tab.screenshot({ path });
      shots.push(path);
    };

    // The color popup's format menu.
    const color = tab.locator('[data-field-property="color"]');
    await color.locator(".design-token-binding").waitFor();
    await color.scrollIntoViewIfNeeded();
    await settle(tab);
    await color.locator('input[type="color"]').click();
    const format = tab.locator(".komo-tokens").getByRole("combobox", { name: "Color format", exact: true });
    await format.waitFor();
    await settle(tab);
    const formats = await menu(tab, format);
    await shot("color-format");
    expect(formats).toMatchObject({ labels: ["Hex", "RGB", "HSL", "HSB", "CSS"], truncated: [], heights: [28], wide: true, check: true, selected: "Hex" });
    await tab.keyboard.press("Escape");
    await tab.keyboard.press("Escape");
    await expect.poll(() => tab.locator(".komo-tokens").count()).toBe(0);

    // A unit select inside the Custom popup.
    const radius = tab.locator('[data-field-property="border-radius"]');
    await radius.scrollIntoViewIfNeeded();
    await settle(tab);
    await radius.locator("select[data-picker]").click();
    const custom = tab.locator(".komo-tokens__tabs button").filter({ hasText: "Custom" });
    await custom.waitFor();
    if (await custom.getAttribute("aria-pressed") !== "true") await custom.click();
    const unit = tab.locator(".komo-tokens select").filter({ has: tab.locator("option[value=rem]") }).first();
    await unit.waitFor();
    await settle(tab);
    const units = await menu(tab, unit);
    await shot("custom-unit");
    expect(units.truncated).toEqual([]);
    expect(units.labels).toContain("rem");
    expect(units).toMatchObject({ wide: true, check: true });
    await tab.keyboard.press("Escape");
    await tab.keyboard.press("Escape");
    await expect.poll(() => tab.locator(".komo-tokens").count()).toBe(0);

    // A select in the panel itself.
    const layout = tab.locator('select[data-property="display"]');
    await layout.scrollIntoViewIfNeeded();
    await settle(tab);
    const displays = await menu(tab, layout);
    await shot("panel-layout");
    expect(displays).toMatchObject({ truncated: [], wide: true, check: true });
    expect(displays.labels).toEqual(expect.arrayContaining(["block", "flex", "grid", "inline-flex", "inline-grid"]));
    await tab.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await tab.close();
  });
});
