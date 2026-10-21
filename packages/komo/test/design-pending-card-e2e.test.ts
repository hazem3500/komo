import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

// The pending changes card in real Chrome, on a light and a dark page: nothing pending, one
// change, then several elements plus a token. Rows outline and select their element, Discard all
// waits for ⌘Z (and ⌘⇧Z discards again), and Comment with changes opens the composer.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = process.env.KOMO_SHOT_DIR ?? join(tmpdir(), "komo-pending-card");
let directory: string, origin: string;
let server: Server, browser: Browser;

const html = `<html><style>
:root{--color-text:#131213;--color-surface:240 240 240;--color-page:#fafafa}
[data-mode=dark]{--color-text:#ededed;--color-surface:42 42 42;--color-page:#141414}
body{margin:0;background:var(--color-page);color:var(--color-text);font:16px system-ui,sans-serif}
main{min-height:calc(100vh - 80px);box-sizing:border-box;padding:60px}
h2{margin:0 0 16px;font-size:22px}
#card{width:240px;height:96px;padding:16px;border-radius:10px;background:rgb(var(--color-surface))}
#cta{margin-top:16px;padding:8px 14px;border:0;border-radius:8px;background:#2f6fdf;color:#fff;font:inherit}
</style><main><h2 id="title">Weekly summary</h2><article id="card">Example card</article><button id="cta">Continue</button></main>
<script type="module" src="/entry.js"></script></html>`;

beforeAll(async () => {
  if (!chrome) return;
  await mkdir(shots, { recursive: true });
  directory = await mkdtemp(join(tmpdir(), "komo-pending-card-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { discoverCssTokens } from ${JSON.stringify(resolve("src/adapters/css-variables.ts"))};
      const query=new URLSearchParams(location.search);
      document.documentElement.setAttribute('data-mode',query.get('theme')??'light');
      const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':pending-card';
      localStorage.setItem(key,'synthetic-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
      window.fetch=async(input)=>{const path=new URL(String(input instanceof Request?input.url:input)).pathname;
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads:[]}:{})};
      window.komo=initKomo({endpoint:location.origin,project:'pending-card',repo:'example/review',branch:'fixture',sidebar:'edge',restoreOpen:false,pollInterval:60000,design:{tokens:discoverCssTokens()}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(html);
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

/** A press on empty canvas (the page root's blank area) deselects. */
async function deselect(page: Page) {
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

describe.skipIf(!chrome).each(["light", "dark"])("pending changes card on a %s page", theme => {
  it("lists changes, outlines and selects rows, discards with Undo and Redo, and comments", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?theme=${theme}`);
    await page.waitForFunction(() => !!(window as any).komo);
    const card = page.locator(".design-inspector__pending");
    const heading = card.locator("h3");
    const rows = card.locator(".design-change-row");
    const shot = (name: string) => page.screenshot({ path: join(shots, `${name}-${theme}.png`) });
    const width = (id: string) => page.locator(`#${id}`).evaluate(node => node.style.width);
    const setWidth = async (id: string, value: string) => {
      await page.locator(`#${id}`).click();
      const field = page.locator('.design-inspector [data-property="width"]');
      await field.fill(value);
      await field.press("Enter");
      await expect.poll(() => width(id)).toBe(`${value}px`);
    };
    const setHeight = async (value: string) => {
      const field = page.locator('.design-inspector [data-property="height"]');
      await field.fill(value);
      await field.press("Enter");
    };

    // Nothing pending: the empty state only.
    await openDesign(page);
    await page.locator(".design-inspector__empty").waitFor();
    expect(await card.isHidden()).toBe(true);
    await shot("pending-card-0");

    // One change.
    await setWidth("cta", "180");
    await deselect(page);
    await card.waitFor();
    expect(await heading.textContent()).toBe("1 unsaved change");
    expect(await rows.evaluateAll(nodes => nodes.map(node => [node.getAttribute("aria-label"), node.getBoundingClientRect().height])))
      .toEqual([["Button “Continue” · 1 change", 28]]);
    await shot("pending-card-1");

    // Several elements, then a page token from the Tokens view.
    await setWidth("card", "300");
    await setHeight("120");
    await deselect(page);
    await page.getByRole("button", { name: /^Edit tokens/ }).click();
    const surface = page.locator(".design-token-row").filter({ has: page.locator("b").getByText("surface", { exact: true }) });
    await surface.locator("button").first().click();
    const hex = page.locator('.komo-color input[aria-label="Hex"]');
    await hex.fill("ffd9a8");
    await hex.press("Enter");
    await surface.locator("button").first().click();
    await page.locator(".komo-color").waitFor({ state: "detached" });
    // Leaving and re-entering Design mode keeps every preview pending and shows the card.
    await page.keyboard.press("Escape");
    await openDesign(page);
    await card.waitFor();
    expect(await heading.textContent()).toBe("4 unsaved changes");
    expect(await rows.evaluateAll(nodes => nodes.map(node => [node.getAttribute("aria-label"), (node as HTMLElement).dataset.kind])))
      .toEqual([["“Example card” · 2 changes", "style"], ["Button “Continue” · 1 change", "style"], ["Token changes · 1 change", "token"]]);
    expect(await card.textContent()).not.toMatch(/runtime|proposal/i);
    await page.mouse.move(400, 700);
    await shot("pending-card-many");

    // Hover outlines the element in the selection colour; a click selects it.
    await rows.first().hover();
    const outline = page.locator(".design-outline:not(.design-outline--prospective)");
    await outline.waitFor();
    const [box, target] = [(await outline.boundingBox())!, (await page.locator("#card").boundingBox())!];
    expect(Math.abs(box.x + box.width / 2 - (target.x + target.width / 2))).toBeLessThan(4);
    expect(await outline.evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
    await shot("pending-card-hover");
    await rows.first().click();
    expect(await page.locator(".design-inspector__target").textContent()).toBe("article#card");
    // The element view's token chip is the same row component.
    const chip = page.locator(".design-inspector__token-chip");
    expect(await chip.getAttribute("aria-label")).toBe("Token changes · 1 change");
    expect((await chip.boundingBox())!.height).toBe(28);
    await page.mouse.move(400, 700);
    await shot("pending-card-chip");
    await deselect(page);

    // Discard all without a confirm; ⌘Z brings everything back, ⌘⇧Z discards again.
    await card.getByRole("button", { name: "Discard all", exact: true }).click();
    await card.waitFor({ state: "hidden" });
    await expect.poll(async () => [await width("card"), await width("cta")]).toEqual(["", ""]);
    await expect.poll(() => page.locator('.sr-only[aria-live="polite"]').textContent()).toBe("4 changes discarded");
    await page.keyboard.press("ControlOrMeta+z");
    await card.waitFor();
    await expect.poll(async () => [await width("card"), await width("cta")]).toEqual(["300px", "180px"]);
    expect(await heading.textContent()).toBe("4 unsaved changes");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await card.waitFor({ state: "hidden" });
    await expect.poll(() => width("card")).toBe("");
    await page.keyboard.press("ControlOrMeta+z");
    await card.waitFor();

    // Comment with changes opens the composer with every change.
    await card.getByRole("button", { name: "Comment with changes", exact: true }).click();
    await page.locator(".draft-proposal .design-card").first().waitFor();
    expect(await page.locator(".draft-proposal .design-card").count()).toBe(3);
    await shot("pending-card-composer");
    expect(errors).toEqual([]);
    await page.close();
  });
});
