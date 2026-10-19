import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-token-ownership-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { tailwindTokens } from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
      const tokens=tailwindTokens({tokens:[
        {path:'color.base',type:'color',class:'text-base',properties:['color'],value:'#575456',label:'Base'},
        {path:'color.primary',type:'color',class:'text-primary',properties:['color'],value:'#6941c6',label:'Primary'},
        {path:'background.base',type:'color',class:'bg-base',properties:['background-color'],value:'#575456',label:'Base'},
        {path:'background.primary',type:'color',class:'bg-primary',properties:['background-color'],value:'#6941c6',label:'Primary'}
      ]});
      window.fetch=async()=>Response.json({threads:[],guests:true});
      const mode=new URLSearchParams(location.search).get('mode');
      if(mode==='floating')document.body.append(document.createElement('aside'));
      window.komo=initKomo({endpoint:location.origin,project:'ownership',repo:'example/review',branch:'fixture',pageRoot:mode==='floating'?undefined:document.querySelector('main'),sidebar:mode==='floating'?'edge':'background',frame:{scale:mode==='scaled'},restoreOpen:false,design:{tokens}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end('<style>body{margin:0}main{min-height:100vh;box-sizing:border-box;padding:70px}.text-base{color:#575456}.text-primary{color:#6941c6}.bg-base{background-color:#575456}.bg-primary{background-color:#6941c6}</style><main><p id="target" class="text-base bg-base" style="padding: 12px !important;">Example text</p></main><script type="module" src="/entry.js"></script>');
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

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("token ownership in %s", mode => {
  it.each(["color", "background-color"])("applies %s custom/token previews with exact cancellation and chronological Undo", async property => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?mode=${mode}`);
    await page.waitForFunction(() => !!(window as any).komo);
    const original = await page.locator("#target").getAttribute("style");
    await page.keyboard.press("d");
    await page.locator("#target").click();
    const field = page.locator(`[data-field-property="${property}"]`);
    const input = field.locator(`input[data-property="${property}"]`);
    const value = () => page.locator("#target").evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);
    const raw = async (text: string) => {
      if (!await input.isVisible()) await field.getByRole("button", { name: `Edit ${property} value`, exact: true }).click();
      await input.fill(text);
      await input.press("Enter");
    };
    const open = async () => { await field.locator("select[data-picker]").click(); await page.locator(".komo-tokens").waitFor(); };
    const primary = page.locator('.komo-tokens [role="option"]').filter({ hasText: "Primary" });
    await field.locator("select[data-picker]").waitFor();
    await raw("#ef3340");
    expect(await value()).toBe("rgb(239, 51, 64)");
    expect(await field.getAttribute("data-token-mode")).toBe("custom");
    await open();
    await primary.hover();
    expect(await value()).toBe("rgb(105, 65, 198)");
    expect(await field.locator('input[type="color"]').inputValue()).toBe("#6941c6");
    await page.keyboard.press("Escape");
    expect(await value()).toBe("rgb(239, 51, 64)");
    expect(await field.getAttribute("data-token-mode")).toBe("custom");
    await open();
    await primary.click();
    expect(await value()).toBe("rgb(105, 65, 198)");
    expect(await field.getAttribute("data-token-mode")).toBe("token");
    expect(await page.locator("#target").evaluate((node, name) => (node as HTMLElement).style.getPropertyValue(name), property)).toBe("");
    await raw("#2468ff");
    expect(await value()).toBe("rgb(36, 104, 255)");
    expect(await field.getAttribute("data-token-mode")).toBe("custom");
    await page.getByRole("button", { name: "Before", exact: true }).click();
    expect(await value()).toBe("rgb(87, 84, 86)");
    await page.getByRole("button", { name: "After", exact: true }).click();
    expect(await value()).toBe("rgb(36, 104, 255)");
    await page.keyboard.press("v");
    expect(await value()).toBe("rgb(87, 84, 86)");
    await page.keyboard.press("d");
    expect(await value()).toBe("rgb(36, 104, 255)");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await value()).toBe("rgb(105, 65, 198)");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await value()).toBe("rgb(239, 51, 64)");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await value()).toBe("rgb(87, 84, 86)");
    expect(await page.locator("#target").getAttribute("style")).toBe(original);
    expect(await page.locator("#target").getAttribute("class")).toBe("text-base bg-base");
    await raw("#ef3340");
    await input.fill("#2468ff");
    await input.press("Escape");
    expect(await value()).toBe("rgb(239, 51, 64)");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    expect(await page.locator("#target").getAttribute("style")).toBe(original);
    const font = page.locator('input[data-property="font-family"]');
    for (const partial of ["", '"']) {
      await font.fill(partial);
      expect(await page.locator("#target").getAttribute("style")).toBe(original);
    }
    await font.press("Escape");
    expect(await page.locator('.design-inspector__actions [aria-label="Undo"]').isDisabled()).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });
});
