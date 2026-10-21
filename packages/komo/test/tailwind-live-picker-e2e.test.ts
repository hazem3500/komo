import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

// An open token picker follows the page's stylesheets in real Chrome: a utility whose
// rule arrives in a late <style> (as a dev server's CSS update does) joins the open list.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-tailwind-live-picker-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { tailwindTokens } from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
      const tokens = tailwindTokens({ tokens: [
        { path: "color.text.base", type: "color", class: "text-base", properties: ["color"], value: "#575456", label: "Text base" },
        { path: "color.text.primary", type: "color", class: "text-primary", properties: ["color"], value: "#6941c6", label: "Text primary" },
        { path: "color.text.accent", type: "color", class: "text-accent", properties: ["color"], value: "#0b7a5c", label: "Text accent" },
        ...Array.from({ length: 30 }, (_, index) => ({ path: "color.text.extra" + index, type: "color", class: "text-extra-" + index, properties: ["color"], value: "#123456", label: "Text extra " + index })),
      ] }, { onlyGenerated: true });
      window.fetch = async () => Response.json({ threads: [], guests: true });
      window.komo = initKomo({ endpoint: location.origin, project: "live-picker", repo: "example/review", branch: "fixture", pageRoot: document.querySelector("main"), sidebar: "background", restoreOpen: false, design: { tokens } });
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  const extras = Array.from({ length: 30 }, (_, index) => `.text-extra-${index}{color:#123456}`).join("");
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<!doctype html><style>body{margin:0}main{min-height:100vh;box-sizing:border-box;padding:70px}.text-base{color:#575456}.text-primary{color:#6941c6}${extras}</style><main><p id="target" class="text-base">Example text</p></main><script type="module" src="/entry.js"></script>`);
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

describe.skipIf(!chrome)("onlyGenerated Tailwind picker in Chrome", () => {
  it("adds a class from a late <style> to an open picker, keeping search, scroll, active row and preview", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin);
    await page.waitForFunction(() => !!(window as any).komo);
    const target = page.locator("#target");
    const color = () => target.evaluate(node => getComputedStyle(node).color);
    await openDesign(page);
    await target.click();
    const trigger = page.locator('[data-field-property="color"] select[data-picker]');
    await trigger.waitFor();
    await trigger.click();
    const options = page.locator('.komo-tokens [role="option"]');
    await options.first().waitFor();
    expect(await options.filter({ hasText: "Text accent" }).count()).toBe(0);
    const popup = await page.locator(".komo-tokens").elementHandle();
    const search = page.getByRole("combobox", { name: "Search tokens for color" });
    await search.fill("text");
    await search.press("ArrowDown");
    await search.press("ArrowDown");
    const listbox = page.locator('.komo-tokens [role="listbox"]');
    await listbox.evaluate(node => { node.scrollTop = 40; });
    const scroll = await listbox.evaluate(node => node.scrollTop);
    const active = () => page.locator(".komo-tokens [data-active]").getAttribute("aria-label");
    const row = await active();
    const previewed = await color();
    expect(previewed).not.toBe("rgb(87, 84, 86)");
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = ".text-accent{color:#0b7a5c}";
      document.head.append(style);
    });
    await expect.poll(() => options.filter({ hasText: "Text accent" }).count()).toBe(1);
    expect(await popup!.evaluate(node => node.isConnected)).toBe(true);
    expect(await page.locator(".komo-tokens").count()).toBe(1);
    expect(await search.inputValue()).toBe("text");
    expect(await active()).toBe(row);
    expect(await listbox.evaluate(node => node.scrollTop)).toBe(scroll);
    expect(await color()).toBe(previewed);
    await page.screenshot({ path: join(tmpdir(), "komo-tailwind-live-picker.png") });
    await options.filter({ hasText: "Text accent" }).click();
    expect(await color()).toBe("rgb(11, 122, 92)");
    expect(await target.getAttribute("class")).toBe("text-accent");
    expect(errors).toEqual([]);
    await page.evaluate(() => (window as any).komo.destroy());
    await page.close();
  });
});
