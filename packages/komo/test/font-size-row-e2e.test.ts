import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The font size row: a T icon and the name scrub, the value reads "14" with "px" inside the
// field, a bound token shows as a chip with a caret beside the value, and the chip's popup is
// the token list alone (Edit as CSS stays collapsed). Every select in the panel opens komo's
// own listbox, from the mouse or the keyboard.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-font-size-row-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { tailwindTokens } from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
      const tokens=tailwindTokens({tokens:[
        {path:'text.body',type:'dimension',class:'text-body',properties:['font-size'],value:'14px',label:'Body'},
        {path:'text.large',type:'dimension',class:'text-large',properties:['font-size'],value:'18px',label:'Large'},
      ]});
      window.fetch=async()=>Response.json({threads:[],guests:true});
      window.komo=initKomo({endpoint:location.origin,project:'font-size-row',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,design:{tokens}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<style>body{margin:0;font:14px system-ui}main{min-height:100vh;box-sizing:border-box;padding:60px}#card{display:block;width:240px;padding:16px;border:1px solid #888;border-radius:10px}.text-body{font-size:14px}.text-large{font-size:18px}</style><main><p id="card" class="text-body">Example card text</p></main><script type="module" src="/entry.js"></script>`);
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

async function open(width: number) {
  const tab = await browser.newPage({ viewport: { width, height: 860 }, reducedMotion: "reduce" });
  tab.setDefaultTimeout(5000);
  const errors: string[] = [];
  tab.on("pageerror", error => errors.push(error.message));
  await tab.goto(origin);
  await tab.waitForFunction(() => !!(window as any).komo);
  await tab.keyboard.press("d");
  await tab.locator("#card").click();
  await tab.mouse.move(2, 2);
  const row = tab.locator('[data-field-property="font-size"]');
  await row.locator(".design-token-binding").waitFor();
  await row.locator(".design-field__unit").waitFor({ state: "attached" });
  await row.scrollIntoViewIfNeeded();
  return { tab, row, errors };
}

const fontSize = (tab: Page) => tab.locator("#card").evaluate(node => (node as HTMLElement).style.fontSize);

describe.skipIf(!chrome).each([1280, 390])("the font size row at %ipx", width => {
  it("shows the value with its unit beside a bound token's chip, and scrubs live", async () => {
    const { tab, row, errors } = await open(width);
    const input = row.locator("input[data-property]");
    expect(await row.locator("label").textContent()).toBe("Font size");
    expect(await row.locator(".design-field__glyph").textContent()).toBe("");
    expect(await input.inputValue()).toBe("14");
    expect(await row.locator(".design-field__unit").textContent()).toBe("px");
    expect(await row.getAttribute("data-token-mode")).toBe("connected");
    // Value, unit and chip all show in the one row, side by side.
    const box = async (selector: string) => (await row.locator(selector).boundingBox())!;
    const [field, value, unit, chip] = await Promise.all([box(":scope"), box("input[data-property]"), box(".design-field__unit"), box(".design-token-chip")]);
    expect(await input.isVisible()).toBe(true);
    expect(await row.locator(".design-field__unit").isVisible()).toBe(true);
    expect(await row.locator(".design-token-chip").textContent()).toContain("Body");
    expect(unit.x + unit.width).toBeLessThanOrEqual(chip.x + 1);
    expect(value.x).toBeLessThan(unit.x);
    expect(chip.y).toBeGreaterThanOrEqual(field.y);
    expect(chip.y + chip.height).toBeLessThanOrEqual(field.y + field.height);
    // The chip carries a caret: it opens the token list.
    expect(await row.locator(".design-token-chip").evaluate(node => getComputedStyle(node).backgroundImage)).toContain("svg");

    // Arrows step by one, Shift by ten, and apply live; a typed value leaves the token.
    await input.focus();
    await tab.keyboard.press("ArrowUp");
    expect(await fontSize(tab)).toBe("15px");
    await tab.keyboard.press("Shift+ArrowUp");
    expect(await fontSize(tab)).toBe("25px");
    await tab.keyboard.press("Shift+ArrowDown");
    await tab.keyboard.press("ArrowDown");
    expect(await fontSize(tab)).toBe("14px");
    await tab.keyboard.press("Enter");

    // Dragging the name scrubs, two pixels a step.
    const label = (await row.locator("label").boundingBox())!;
    await tab.mouse.move(label.x + 10, label.y + label.height / 2);
    await tab.mouse.down();
    await tab.mouse.move(label.x + 30, label.y + label.height / 2, { steps: 5 });
    expect(await fontSize(tab)).toBe("24px");
    await tab.mouse.up();
    expect(await input.inputValue()).toBe("24");
    expect(await row.getAttribute("data-token-mode")).not.toBe("connected");
    expect(errors).toEqual([]);
    await tab.close();
  });

  it("opens the token list alone from the chip, with Edit as CSS collapsed", async () => {
    const { tab, row, errors } = await open(width);
    await row.locator("select[data-picker]").click();
    const popup = tab.locator(".komo-tokens");
    await popup.waitFor();
    await popup.locator(".komo-custom").waitFor({ state: "attached" });
    expect(await popup.getByRole("option").allTextContents()).toEqual([expect.stringContaining("Body"), expect.stringContaining("Large")]);
    // No second heading, label or value field: the row already holds them.
    expect(await popup.locator(".komo-tokens__head").isVisible()).toBe(false);
    expect(await popup.getByText("Custom value", { exact: true }).isVisible()).toBe(false);
    expect(await popup.locator(".komo-custom input:visible").count()).toBe(0);
    const advanced = popup.locator("details.komo-typed__advanced");
    expect(await advanced.locator("summary").textContent()).toBe("Edit as CSS");
    expect(await advanced.evaluate(node => (node as HTMLDetailsElement).open)).toBe(false);
    // Hovering a token previews it; choosing it binds it.
    await popup.getByRole("option").filter({ hasText: "Large" }).click();
    await expect.poll(() => tab.locator("#card").evaluate(node => getComputedStyle(node).fontSize)).toBe("18px");
    await expect.poll(() => row.locator(".design-token-chip").textContent()).toContain("Large");
    expect(await row.locator("input[data-property]").inputValue()).toBe("18");
    expect(errors).toEqual([]);
    await tab.close();
  });

  it("opens komo's listbox for every select, by click or by typing", async () => {
    const { tab, errors } = await open(width);
    const selects = tab.locator(".design-inspector select:visible:not([data-picker])");
    const count = await selects.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index++) {
      await selects.nth(index).scrollIntoViewIfNeeded();
      await selects.nth(index).click();
      await expect.poll(() => tab.locator(".komo-select[role=listbox]").count()).toBe(1);
      await tab.keyboard.press("Escape");
      await expect.poll(() => tab.locator(".komo-select").count()).toBe(0);
    }
    // A letter on a closed select opens the list on its first match; Enter keeps it.
    const layout = tab.locator('select[data-property="display"]');
    await layout.focus();
    await tab.keyboard.press("g");
    await expect.poll(() => tab.locator(".komo-select [data-active]").textContent()).toBe("grid");
    expect(await tab.locator("#card").evaluate(node => (node as HTMLElement).style.display)).toBe("grid");
    await tab.keyboard.press("Enter");
    expect(await tab.locator(".komo-select").count()).toBe(0);
    expect(await tab.locator("#card").evaluate(node => (node as HTMLElement).style.display)).toBe("grid");
    expect(errors).toEqual([]);
    await tab.close();
  });
});
