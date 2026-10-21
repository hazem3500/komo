// Design mode keys with real key events in Chrome: redo across prop, style, resize and move
// edits; ← Before and → After from any focus target that doesn't edit with arrows; Tab and
// Enter for the selection only on the page; and Escape closing the innermost thing first.
// Synthetic loopback fixture only. Never touches the eyedropper.
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

const html = `<!doctype html><style>body{margin:0;font:14px system-ui}main{display:flex;flex-direction:column;gap:12px;min-height:100vh;padding:40px;box-sizing:border-box}
.card{display:block;width:240px;padding:16px;border-radius:12px;background:#e2e8f0}.card[data-variant=secondary]{background:#c7d2fe}</style>
<main><div class="card" id="card" data-variant="primary"><span id="title">Weekly summary</span> <span id="meta">3 items</span></div><div class="card" id="second">Second card</div><div class="card" id="third">Third card</div></main>
<script type="module" src="/entry.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-design-keys-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':keys';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      window.fetch=async input=>{
        const path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url).pathname;
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads:[]}:{});
      };
      // A generic component editor: the card's variant prop renders as a data attribute.
      const card=document.getElementById('card');
      const components={
        identify:element=>element===card?{name:'Card',element:card}:null,
        editor:()=>({schema:[{name:'variant',kind:'enum',required:false,values:['primary','secondary'],typeLabel:'"primary" | "secondary"'}],
          read:()=>({variant:card.dataset.variant}),apply:next=>{card.dataset.variant=next.variant??'primary'}}),
      };
      window.komo=initKomo({endpoint:location.origin,project:'keys',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,pollInterval:60000,
        design:{components,experimentalGeometry:true}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.endsWith(".js")) {
      response.setHeader("content-type", "text/html");
      response.end(html);
      return;
    }
    try {
      const file = resolve(directory, `.${url.pathname}`);
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

const mac = process.platform === "darwin";
const UNDO = "ControlOrMeta+z", REDO = mac ? "Meta+Shift+z" : "Control+y";

async function design(select = "#card") {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(6000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => !!(window as any).komo);
  await page.keyboard.press("d");
  await page.locator(".design-inspector__empty").waitFor();
  await page.locator(select).click({ position: { x: 4, y: 4 } });
  await page.locator(".design-inspector__target").waitFor();
  return Object.assign(page, { errors });
}
const target = (page: Page) => page.locator(".design-inspector__target").textContent();
const active = (page: Page) => page.evaluate(() => document.querySelector("[data-branch-comments]")!.classList.contains("design-active"));
const before = (page: Page) => page.locator(".design-inspector__compare button", { hasText: "Before" }).getAttribute("aria-pressed");
const width = (page: Page) => page.locator("#card").evaluate(node => (node as HTMLElement).style.width);
const blur = (page: Page) => page.evaluate(() => (document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement as HTMLElement | null)?.blur());
/** After a panel edit, the selection frame returns once the pointer is back on the canvas. */
async function canvas(page: Page) {
  const box = (await page.locator("#card").boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.move(box.x + 12, box.y + 12);
}
async function setWidth(page: Page, value: string) {
  const input = page.locator('[data-field-property="width"] input');
  await input.fill(value);
  await input.press("Enter");
}

describe.skipIf(!chrome)("Design mode keys", () => {
  it("redoes props, styles and moves with the keys and the footer button, and a new edit clears redo", async () => {
    const page = await design();
    // The footer's tools hide until there are changes, so find Redo by its label.
    const redo = page.locator('[aria-label="Redo"]');
    expect(await redo.isDisabled()).toBe(true);
    // Prop: primary → secondary, undo, redo.
    const variant = page.locator(".design-react-field select").first();
    await variant.selectOption("secondary");
    await expect.poll(() => page.locator("#card").getAttribute("data-variant")).toBe("secondary");
    await blur(page);
    await page.keyboard.press(UNDO);
    expect(await page.locator("#card").getAttribute("data-variant")).toBe("primary");
    expect(await redo.isDisabled()).toBe(false);
    await page.keyboard.press(REDO);
    expect(await page.locator("#card").getAttribute("data-variant")).toBe("secondary");
    // Style from the panel, redone from a focused panel button.
    await setWidth(page, "320");
    expect(await width(page)).toBe("320px");
    await page.getByRole("button", { name: "Copy CSS" }).focus();
    await page.keyboard.press(UNDO);
    expect(await width(page)).toBe("");
    await page.keyboard.press(REDO);
    expect(await width(page)).toBe("320px");
    // In a text field, the keys stay native.
    const input = page.locator('[data-field-property="height"] input');
    await input.focus();
    await page.keyboard.press(UNDO);
    expect(await width(page)).toBe("320px");
    // A new edit after an undo clears redo.
    await blur(page);
    await page.keyboard.press(UNDO);
    await setWidth(page, "300");
    expect(await redo.isDisabled()).toBe(true);
    // A structural move: M focuses the selection, Alt+↓ moves it after its next sibling.
    await blur(page);
    await canvas(page);
    await page.keyboard.press("m");
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(() => page.locator("[data-komo-move-clone]").count()).toBe(1);
    await page.keyboard.press("Escape");
    await page.keyboard.press(UNDO);
    await expect.poll(() => page.locator("[data-komo-move-clone]").count()).toBe(0);
    await page.keyboard.press(REDO);
    await expect.poll(() => page.locator("[data-komo-move-clone]").count()).toBe(1);
    expect(await active(page)).toBe(true);
    expect(page.errors).toEqual([]);
    await page.close();
  }, 40000);

  it("walks the selection with Tab, Shift+Tab, Enter and Shift+Enter only from the page", async () => {
    const page = await design("#title");
    expect(await target(page)).toContain("span#title");
    await page.keyboard.press("Tab");
    expect(await target(page)).toContain("span#meta");
    await page.keyboard.press("Shift+Tab");
    expect(await target(page)).toContain("span#title");
    await page.keyboard.press("Shift+Enter");
    expect(await target(page)).toContain("div#card");
    await page.keyboard.press("Enter");
    expect(await target(page)).toContain("span#title");
    await page.keyboard.press("Alt+ArrowUp");
    expect(await target(page)).toContain("div#card");
    await page.keyboard.press("Alt+ArrowDown");
    expect(await target(page)).toContain("span#title");
    // In the panel, Tab moves focus as usual and leaves the selection alone.
    await page.locator('[data-field-property="width"] input').focus();
    await page.keyboard.press("Tab");
    expect(await target(page)).toContain("span#title");
    await page.close();
  }, 30000);

  // ← Before and → After by focus target; each target either compares or keeps its arrows.
  const targets: Array<[string, (page: Page) => Promise<void>, boolean]> = [
    ["canvas", blur, true],
    ["panel button", page => page.getByRole("button", { name: "Copy CSS" }).focus(), true],
    ["panel select", page => page.locator('[data-field-property="display"] select').focus(), true],
    ["text input", page => page.locator('[data-field-property="height"] input').focus(), false],
    ["focused selection", async page => {
      await blur(page);
      await canvas(page);
      await page.keyboard.press("m");
      await page.waitForFunction(() => document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement?.classList.contains("design-geometry__frame"));
    }, false],
    ["open listbox", async page => { await page.locator('[data-field-property="display"] select').focus(); await page.keyboard.press("ArrowDown"); await page.locator(".komo-select").waitFor(); }, false],
    ["shortcuts dialog", async page => { await blur(page); await page.keyboard.press("?"); await page.locator("dialog.komo-shortcuts").waitFor(); }, false],
  ];
  for (const [name, focus, compares] of targets) {
    it(`${compares ? "compares" : "keeps its arrows"} on ← and → from the ${name}, and Escape closes the innermost thing`, async () => {
      const page = await design();
      await setWidth(page, "300");
      const select = page.locator('[data-field-property="display"] select');
      const display = await select.inputValue();
      await focus(page);
      expect(await before(page)).toBe("false");
      await page.keyboard.press("ArrowLeft");
      expect(await before(page)).toBe(compares ? "true" : "false");
      await page.keyboard.press("ArrowRight");
      expect(await before(page)).toBe("false");
      expect(await select.inputValue()).toBe(display);
      await page.keyboard.press("Escape");
      // Text fields, lists, the focused selection and the dialog close first; anything else leaves at once.
      expect(await active(page)).toBe(!compares);
      if (!compares) {
        await page.keyboard.press("Escape");
        if (name === "text input") await page.keyboard.press("Escape");
        expect(await active(page)).toBe(false);
      }
      // The selection comes back on the next entry.
      await page.keyboard.press("d");
      await expect.poll(() => target(page)).toContain("div#card");
      expect(page.errors).toEqual([]);
      await page.close();
    }, 30000);
  }

  it("deselects on a click on empty canvas", async () => {
    const page = await design();
    await page.mouse.click(1000, 860);
    await page.locator(".design-inspector__empty").waitFor();
    expect(await active(page)).toBe(true);
    await page.close();
  }, 30000);
});
