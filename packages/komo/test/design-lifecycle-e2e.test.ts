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
let directory: string;
let server: Server;
let browser: Browser;
let origin: string;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-design-lifecycle-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':lifecycle';
      localStorage.setItem(key,'synthetic-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
      window.fetch=async input=>{const path=new URL(typeof input==='string'?input:input.url).pathname;return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads:[]}:{});};
      const frame=location.search.includes('frame');
      if(!frame)document.body.append(document.createElement('aside'));
      window.komo=initKomo({endpoint:location.origin,project:'lifecycle',repo:'example/review',branch:'fixture',pageRoot:frame?document.querySelector('main'):undefined,sidebar:frame?'background':'edge',frame:{scale:true},restoreOpen:false,pollInterval:60000});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<style>body{margin:0}main{min-height:calc(100vh - 80px);padding:60px;box-sizing:border-box}a{display:inline-flex;margin:20px;padding:20px;color:#575456}svg{width:32px;height:32px;fill:currentColor}</style><main><a href="#first"><svg id="first"><path id="shape" d="M2 2h28v28H2z"/></svg></a><a href="#second"><svg id="second"><path d="M2 2h28v28H2z"/></svg></a></main><script type="module" src="/entry.js"></script>`);
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

/** A press on empty canvas (the page root's blank area, or outside the page) deselects; re-entry brings the selection back. */
async function deselect(page: import("playwright-core").Page) {
  const point = await page.evaluate(() => {
    for (let y = innerHeight - 4; y > 0; y -= 24) for (let x = 4; x < innerWidth; x += 24) {
      const node = document.elementFromPoint(x, y);
      if (node === document.body || node === document.documentElement || node === document.querySelector("main")) return [x, y];
    }
    return null;
  });
  if (!point) throw new Error("No empty canvas to click");
  await page.mouse.click(point[0], point[1]);
  await page.locator(".design-inspector__empty").waitFor();
}

describe.skipIf(!chrome).each([false, true])("SVG lifecycle in Frame=%s", frame => {
  it("resumes synchronized controls, hands SVG previews to drafts and restores exact styles", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/${frame ? "?frame" : ""}`);
    await page.waitForFunction(() => !!(window as any).komo);
    if (frame) await page.locator("#shape").evaluate(node => (node as SVGElement).style.setProperty("transition", "opacity 120ms linear", "important"));
    const original = await page.locator("#shape").getAttribute("style");
    const edit = async (selector: string, color: string, precise = false) => {
      await page.click(selector, { modifiers: precise ? ["Meta"] : [] });
      await page.locator('.design-inspector [data-property="color"]').fill(color);
      await page.locator(".design-inspector__target").click();
    };
    const computed = (selector: string) => page.locator(selector).evaluate(node => getComputedStyle(node).color);
    await page.keyboard.press("d");
    await page.waitForSelector('.design-inspector[aria-hidden="false"]');
    await edit("#shape", "#ef3340", true);
    await page.keyboard.press("v");
    expect(await page.locator("#shape").getAttribute("style")).toBe(original);
    await page.keyboard.press("d");
    await page.waitForTimeout(450);
    expect(await computed("#shape")).toBe("rgb(239, 51, 64)");
    for (const property of ["color", "fill"]) {
      const field = page.locator(`.design-inspector [data-field-property="${property}"]`);
      expect(await field.locator("[data-property]").inputValue()).toBe("#ef3340");
      expect(await field.locator('input[type="color"]').inputValue()).toBe("#ef3340");
    }
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Before", exact: true }).click();
      await page.getByRole("button", { name: "After", exact: true }).click();
      await page.keyboard.press("v");
      await page.keyboard.press("d");
    }
    await edit("#second", "#2468ff");
    await page.locator(".design-inspector__actions button:last-child").click();
    await page.waitForSelector(".draft-proposal .design-toggle");
    expect(await computed("#shape")).toBe("rgb(87, 84, 86)");
    expect(await computed("#second")).toBe("rgb(36, 104, 255)");
    await page.locator(".draft-proposal").getByRole("button", { name: "Before", exact: true }).click();
    await page.waitForTimeout(520);
    expect(await computed("#second")).toBe("rgb(87, 84, 86)");
    await page.locator(".draft-proposal").getByRole("button", { name: "After", exact: true }).click();
    await page.waitForTimeout(520);
    expect(await computed("#second")).toBe("rgb(36, 104, 255)");
    await page.keyboard.press("Escape");
    expect(await page.locator("#second").getAttribute("style")).toBeNull();
    await page.keyboard.press("d");
    expect(await computed("#shape")).toBe("rgb(239, 51, 64)");
    await page.keyboard.press("Escape");
    await page.keyboard.press("d");
    await deselect(page);
    await page.getByRole("button", { name: "Discard all", exact: true }).click();
    await page.getByRole("button", { name: "Exit design mode", exact: true }).click();
    await page.waitForTimeout(450);
    expect(await page.locator("#shape").getAttribute("style")).toBe(original);
    expect(await page.locator("#second").getAttribute("style")).toBeNull();
    expect(errors).toEqual([]);
    await page.close();
  });
});
