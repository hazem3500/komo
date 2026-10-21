// Design mode review shortcuts by focus target, with real key events in Chrome: B, ?, ⌘Z,
// ⌘⇧Z and Escape fire from the canvas and any panel control and pause only in true text
// entry. Synthetic loopback fixture only.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

const html = `<!doctype html><style>body{margin:0;font:14px system-ui}main{min-height:100vh;padding:40px;box-sizing:border-box}
#target{width:240px;padding:16px;border-radius:12px;background:#e2e8f0;font-weight:400}textarea{display:block;margin-top:24px}</style>
<main><p id="target">Example card</p><textarea id="notes" aria-label="Notes"></textarea></main><script type="module" src="/entry.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-shortcut-focus-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':focus';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      window.fetch=async input=>{
        const path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url).pathname;
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads:[]}:{});
      };
      window.komo=initKomo({endpoint:location.origin,project:'focus',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,pollInterval:60000});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
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

type Outcome = { b: boolean; help: boolean; undo: boolean; redo: boolean; escape: boolean };
const root = "document.querySelector('[data-branch-comments]').shadowRoot";

async function design(page: Page) {
  await page.goto(origin);
  await page.waitForFunction(() => !!(window as any).komo);
  await openDesign(page);
  await page.locator(".design-inspector__empty").waitFor();
  await page.locator("#target").click();
  const weight = page.locator('[data-field-property="font-weight"] select');
  await weight.waitFor();
  // A real choice from the shared listbox: the select keeps focus once it commits.
  await weight.click();
  await page.locator('.komo-select [role="option"]', { hasText: /700|Bold/ }).first().click();
  await expect.poll(() => page.locator("#target").evaluate(node => getComputedStyle(node).fontWeight)).toBe("700");
  expect(await weight.evaluate(node => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
  await page.locator(".design-inspector__compare").waitFor({ state: "visible" });
  // Every keydown, read once dispatch is over, so stopped events still report defaultPrevented.
  await page.evaluate(() => { const log: KeyboardEvent[] = (window as any).keys = []; addEventListener("keydown", event => log.push(event), true); });
}
const before = (page: Page) => page.locator(".design-inspector__compare button", { hasText: "Before" }).getAttribute("aria-pressed");
const active = (page: Page) => page.evaluate(() => document.querySelector("[data-branch-comments]")!.classList.contains("design-active"));
const focused = (page: Page) => page.evaluate(() => {
  let node: Element | null = document.activeElement;
  while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
  return node === document.body ? "body" : `${node?.tagName}${node?.id ? "#" + node.id : ""}${node?.getAttribute("role") ? "[" + node.getAttribute("role") + "]" : ""}`;
});

// Press each key at the focused target and report what komo did with it.
async function outcomes(page: Page, focus: () => Promise<void>): Promise<Outcome & { kept: string; value?: string }> {
  await focus();
  const target = await focused(page);
  const value = () => page.locator('[data-field-property="font-weight"] select').inputValue();
  const startValue = await value();
  const was = await before(page);
  await page.keyboard.press("b");
  const b = (await before(page)) !== was;
  if (b) await page.keyboard.press("b");
  await page.keyboard.press("?");
  // Help loads on demand, so give it a moment to open.
  const help = await page.locator("dialog.komo-shortcuts").waitFor({ timeout: 700 }).then(() => true, () => false);
  if (help) {
    await page.keyboard.press("Escape");
    expect(await focused(page), "help returns focus").toBe(target);
  }
  const selectValue = await value();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  const redo = await page.evaluate(() => (window as any).keys.at(-1).defaultPrevented);
  await page.keyboard.press("ControlOrMeta+z");
  const undo = (await page.locator("#target").evaluate(node => getComputedStyle(node).fontWeight)) !== "700";
  const kept = await focused(page);
  await page.keyboard.press("Escape");
  const escape = !(await active(page));
  return { b, help, undo, redo, escape, kept, value: selectValue === startValue ? undefined : `${startValue} -> ${selectValue}` };
}

const panel = (page: Page, selector: string) => page.evaluate(([css, query]) => {
  const node = eval(css).querySelector(query) as HTMLElement;
  node.focus();
}, [root, selector] as const);
// Panel markup komo has no instance of yet (a switch, scrub fields), added to the footer bar,
// which undo does not redraw.
const inject = (page: Page, markup: string) => page.evaluate(([css, html]) => {
  const bar = eval(css).querySelector(".design-inspector__bar") as HTMLElement;
  bar.insertAdjacentHTML("beforeend", html);
  (bar.lastElementChild as HTMLElement).focus();
}, [root, markup] as const);

const fire: Outcome = { b: true, help: true, undo: true, redo: false, escape: true };
const pause: Outcome = { b: false, help: false, undo: false, redo: false, escape: false };
const cases: [string, (page: Page) => Promise<void>, Outcome][] = [
  ["canvas", page => page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); }), fire],
  ["panel button", page => panel(page, '.design-inspector button[aria-label="Copy CSS"], .design-inspector button:not([disabled])[title="Copy CSS"]'), fire],
  ["switch", page => inject(page, '<button type="button" role="switch" aria-checked="false">Wrap</button>'), fire],
  ["closed select", page => panel(page, '[data-field-property="font-weight"] select'), fire],
  ["open listbox", async page => { await panel(page, '[data-field-property="font-weight"] select'); await page.keyboard.press("ArrowDown"); await page.locator(".komo-select").waitFor(); }, pause],
  ["text input", page => panel(page, '[data-field-property="width"] input'), pause],
  // Escape in a text field lets go of focus first; the next one leaves.
  ["textarea", page => page.locator("#notes").focus(), pause],
  ["inline text edit", async page => { await page.locator("#target").dblclick(); await page.locator('#target[contenteditable="true"]').waitFor(); }, pause],
  ["scrub field, idle", page => inject(page, '<input type="text" data-scrub readonly aria-label="Scrub" value="10">'), fire],
  ["scrub field, editing", page => inject(page, '<input type="text" data-scrub data-editing aria-label="Scrub" value="10">'), pause],
];

describe.skipIf(!chrome)("Design mode shortcuts by focus target, with real keys", () => {
  for (const [name, focus, expected] of cases) {
    it(`${name}: ${Object.entries(expected).map(([key, on]) => `${key} ${on ? "fires" : "pauses"}`).join(", ")}`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      page.setDefaultTimeout(6000);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await design(page);
      const result = await outcomes(page, () => focus(page));
      const { kept, value, ...fired } = result;
      expect(fired).toEqual(expected);
      // A closed select never takes komo's keys as type-ahead.
      expect(value).toBeUndefined();
      if (expected.undo && name !== "canvas") expect(kept, "undo leaves focus on the control").not.toBe("body");
      expect(errors).toEqual([]);
      await page.close();
    }, 30000);
  }
});
