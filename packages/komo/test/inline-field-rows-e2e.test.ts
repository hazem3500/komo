import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

// Every single-value numeric field works like the font size row: the value stays beside a bound
// token's chip and scrubs live, and the chip's popup is the token list with Edit as CSS collapsed.
// A field holding several values keeps its Custom editor. A touch drag on a field's name scrubs
// it without scrolling the panel.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

const fields = [
  { property: "line-height", token: "Snug" },
  { property: "letter-spacing", token: "Wide" },
  { property: "gap", token: "Gap small" },
  { property: "padding", token: "Medium" },
  { property: "border-radius", token: "Large" },
];

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-inline-rows-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { tailwindTokens } from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
      const token=(path,label,property,value)=>({path,type:'dimension',class:path.replace('.','-'),properties:[property],value,label});
      const tokens=tailwindTokens({tokens:[
        token('leading.snug','Snug','line-height','20px'),token('leading.loose','Loose','line-height','28px'),
        token('tracking.wide','Wide','letter-spacing','1px'),token('tracking.tight','Tight','letter-spacing','-1px'),
        token('gap.small','Gap small','gap','8px'),token('gap.large','Gap large','gap','16px'),
        token('space.medium','Medium','padding','16px'),token('space.large','Spacious','padding','24px'),
        token('radius.large','Large','border-radius','12px'),token('radius.small','Small','border-radius','4px'),
      ]});
      window.fetch=async()=>Response.json({threads:[],guests:true});
      window.komo=initKomo({endpoint:location.origin,project:'inline-rows',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,design:{tokens}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<style>body{margin:0;font:14px system-ui}main{min-height:100vh;box-sizing:border-box;padding:60px}#card,#multi{display:flex;width:240px;margin:0 0 16px;border:1px solid #888}#multi{padding:4px 8px;border-radius:4px 10px}.leading-snug{line-height:20px}.tracking-wide{letter-spacing:1px}.gap-small{gap:8px}.space-medium{padding:16px}.radius-large{border-radius:12px}</style><main><p id="card" class="leading-snug tracking-wide gap-small space-medium radius-large">Example card text</p><p id="multi">Uneven sides</p></main><script type="module" src="/entry.js"></script>`);
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

async function open(width: number, touch = false, target = "#card") {
  const context = await browser.newContext({ viewport: { width, height: 860 }, reducedMotion: "reduce", hasTouch: touch });
  const tab = await context.newPage();
  tab.setDefaultTimeout(5000);
  const errors: string[] = [];
  tab.on("pageerror", error => errors.push(error.message));
  await tab.goto(origin);
  await tab.waitForFunction(() => !!(window as any).komo);
  await openDesign(tab);
  await tab.locator(target).click();
  await tab.mouse.move(2, 2);
  await tab.locator('[data-field-property="padding"] .design-field__unit').waitFor({ state: "attached" });
  return { tab, errors, close: () => context.close() };
}

const inline = (tab: Page, property: string) => tab.locator(`[data-field-property="${property}"]`).evaluate(node => node.hasAttribute("data-inline-token"));

describe.skipIf(!chrome).each([1280, 390])("single-value numeric rows at %ipx", width => {
  it.each(fields)("$property keeps its value beside the chip, scrubs live and opens the token list alone", async ({ property, token }) => {
    const { tab, errors, close } = await open(width);
    const row = tab.locator(`[data-field-property="${property}"]`);
    await row.locator(".design-token-binding").waitFor();
    await row.scrollIntoViewIfNeeded();
    expect(await inline(tab, property)).toBe(true);
    expect(await row.getAttribute("data-token-mode")).toBe("connected");
    const input = row.locator("input[data-property]");
    expect(await input.isVisible()).toBe(true);
    expect(await row.locator(".design-token-chip").isVisible()).toBe(true);
    const value = (await input.boundingBox())!, chip = (await row.locator(".design-token-chip").boundingBox())!;
    expect(value.x).toBeLessThan(chip.x);
    expect(await row.locator(".design-token-chip").textContent()).toContain(token.split(" ")[0]);

    // The chip opens the token list alone; Custom… holds only Edit as CSS, collapsed.
    await row.locator("select[data-picker]").click();
    const popup = tab.locator(".komo-tokens");
    await popup.getByRole("option").first().waitFor();
    expect(await popup.locator(".komo-tokens__head").isVisible()).toBe(false);
    expect(await popup.locator(".komo-custom").count()).toBe(0);
    await popup.locator(".komo-tokens__more").click();
    await popup.locator("details.komo-typed__advanced").waitFor();
    expect(await popup.locator(".komo-custom input:visible").count()).toBe(0);
    expect(await popup.locator("details.komo-typed__advanced").evaluate(node => (node as HTMLDetailsElement).open)).toBe(false);
    expect(await popup.locator("details.komo-typed__advanced summary").isVisible()).toBe(true);
    await tab.keyboard.press("Escape");
    await expect.poll(() => tab.locator(".komo-tokens").count()).toBe(0);

    // An arrow steps the value live, and the edit leaves the token.
    const before = await tab.locator("#card").evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);
    await input.focus();
    await tab.keyboard.press("ArrowUp");
    const after = await tab.locator("#card").evaluate((node, name) => (node as HTMLElement).style.getPropertyValue(name), property);
    expect(after).not.toBe("");
    expect(after).not.toBe(before);
    await tab.keyboard.press("Enter");
    await expect.poll(() => row.getAttribute("data-token-mode")).not.toBe("connected");
    expect(errors).toEqual([]);
    await close();
  });

  it("keeps the Custom editor for fields holding several values", async () => {
    const { tab, errors, close } = await open(width, false, "#multi");
    expect(await inline(tab, "padding")).toBe(false);
    expect(await inline(tab, "border-radius")).toBe(false);
    // The single-value neighbours still sit inline.
    expect(await inline(tab, "font-size")).toBe(true);
    expect(await inline(tab, "border-width")).toBe(true);
    const row = tab.locator('[data-field-property="padding"]');
    await row.scrollIntoViewIfNeeded();
    await row.locator("select[data-picker]").click();
    await tab.locator(".komo-tokens__more").click();
    await tab.locator(".komo-tokens .komo-custom input:visible").first().waitFor();
    expect(await tab.locator(".komo-tokens .komo-custom input:visible").count()).toBeGreaterThanOrEqual(4);
    expect(errors).toEqual([]);
    await close();
  });

  it("scrubs on a touch drag across a field's name without scrolling the panel", async () => {
    const { tab, errors, close } = await open(width, true);
    const row = tab.locator('[data-field-property="border-width"]');
    await row.scrollIntoViewIfNeeded();
    const label = row.locator("label");
    expect(await label.evaluate(node => getComputedStyle(node).touchAction)).toBe("none");
    const scrolls = () => label.evaluate(node => {
      const tops: number[] = [];
      for (let at: Node | null = node; at; at = at.parentNode ?? (at as ShadowRoot).host ?? null)
        if (at instanceof Element && at.scrollHeight > at.clientHeight) tops.push(at.scrollTop);
      return tops;
    });
    const start = await scrolls();
    const box = (await label.boundingBox())!;
    const x = box.x + 8, y = box.y + box.height / 2;
    const cdp = await tab.context().newCDPSession(tab);
    const touch = (type: string, points: Array<{ x: number; y: number }>) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    await touch("touchStart", [{ x, y }]);
    // Mostly sideways, with some vertical travel that would otherwise start a scroll.
    for (let step = 1; step <= 10; step++) await touch("touchMove", [{ x: x + step * 4, y: y - step * 3 }]);
    await touch("touchEnd", []);
    expect(await scrolls()).toEqual(start);
    expect(await tab.locator("#card").evaluate(node => (node as HTMLElement).style.borderWidth)).toBe("21px");
    expect(errors).toEqual([]);
    await close();
  });
});
