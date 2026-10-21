// Keyboard shortcut help in real Chrome: every close path, focus restore, layout at
// wide and narrow widths, Frame Fit and 100%, configured keys, platform glyphs,
// filtering and mode-first ordering. Synthetic loopback fixture only.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const tag = process.env.KOMO_SHOT_TAG ?? "after";
const shotRoot = join(tmpdir(), "komo-shots", "shortcut-help");
const shots = join(shotRoot, tag);
let directory: string, origin: string;
let server: Server, browser: Browser;

const html = (dark: boolean, mac: boolean) => `<!doctype html><script>
Object.defineProperty(Navigator.prototype,'platform',{get:()=>${JSON.stringify(mac ? "MacIntel" : "Win32")}});
Object.defineProperty(Navigator.prototype,'userAgentData',{get:()=>({platform:${JSON.stringify(mac ? "macOS" : "Windows")},mobile:false,brands:[]})});
</script><style>html{color-scheme:${dark ? "dark" : "light"}}body{margin:0;font:14px system-ui;background:${dark ? "#121212" : "#fff"};color:${dark ? "#e5e5e5" : "#0f172a"}}
.app{display:flex;width:100vw;height:100vh}.side{width:min(220px,25vw);flex:none;padding:16px;box-sizing:border-box;background:${dark ? "#1c1c1c" : "#f1f5f9"}}
.main{flex:1;padding:24px;min-width:0}.card{width:240px;padding:16px;margin:0 0 16px;border-radius:12px;background:${dark ? "#262626" : "#e2e8f0"}}</style>
<main><div class="app"><aside class="side">Calendars</aside><section class="main"><h1 id="title">Week</h1><p class="card" id="target">Example card</p><p class="card">Second card</p></section></div></main>
<script type="module" src="/entry.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-shortcut-help-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      const query=new URLSearchParams(location.search);
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':help';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      window.fetch=async input=>{
        const path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url).pathname;
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads:[]}:{});
      };
      window.komo=initKomo({endpoint:location.origin,project:'help',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),
        sidebar:'background',restoreOpen:false,pollInterval:60000,...(query.has('keys')?{shortcuts:JSON.parse(query.get('keys'))}:{})});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      response.setHeader("content-type", "text/html");
      response.end(html(url.searchParams.get("theme") === "dark", url.searchParams.get("platform") !== "win"));
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

async function open(query = "", viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  page.setDefaultTimeout(6000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/?${query}`);
  await page.waitForFunction(() => !!(window as any).komo);
  return Object.assign(page, { errors });
}
async function design(page: Page) {
  await page.keyboard.press("d");
  await page.locator(".design-inspector__empty").waitFor();
  await page.waitForTimeout(350);
}
const help = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts" });
const shortcutsLink = (page: Page) => page.locator(".design-inspector__empty").getByRole("button", { name: "Keyboard shortcuts", exact: true });
async function openFromLink(page: Page) {
  await shortcutsLink(page).click();
  await help(page).waitFor();
}
async function openFromMenu(page: Page) {
  await page.locator('[data-menu-item="more"]').evaluate((node: HTMLElement) => { node.focus(); node.click(); });
  await page.locator('[data-menu-item="shortcuts"]').evaluate((node: HTMLElement) => { node.focus(); node.click(); });
  await help(page).waitFor();
}
const shot = (page: Page, name: string) => page.screenshot({ path: join(shots, `${name}.png`) });
const linkFocused = (page: Page) => shortcutsLink(page).evaluate(node => (node.getRootNode() as ShadowRoot).activeElement === node);
const designActive = (page: Page) => page.evaluate(() => document.querySelector("[data-branch-comments]")!.classList.contains("design-active"));
const headings = (page: Page) => help(page).locator("section:not([hidden]) h3").allTextContents();
const row = (page: Page, label: string) => help(page).locator(".komo-shortcuts__row").filter({ has: page.getByText(label, { exact: true }) });
// The dialog's box, its sections' columns, chip heights and where the pinned title sits.
const layout = (page: Page) => help(page).evaluate(dialog => {
  const rect = (node: Element) => { const box = node.getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }; };
  const body = dialog.querySelector(".komo-shortcuts__body")!;
  return {
    dialog: rect(dialog), title: rect(dialog.querySelector("h2")!),
    scrollable: body.scrollHeight > body.clientHeight,
    columns: new Set([...dialog.querySelectorAll("section")].map(section => Math.round(section.getBoundingClientRect().left))).size,
    chips: [...new Set([...dialog.querySelectorAll(".komo-shortcuts__row kbd")].map(cap => cap.getBoundingClientRect().height))],
    gestureChips: [...dialog.querySelectorAll(".komo-shortcuts__row kbd")].filter(cap => /click/i.test(cap.textContent!)).length,
    note: rect(dialog.querySelector(".komo-shortcuts__body > p:last-child")!),
    sections: [...dialog.querySelectorAll("section")].map(rect),
  };
});

describe.skipIf(!chrome)("keyboard shortcut help", () => {
  it("closes from the close button, Escape, a click outside and ? again, keeping Design mode and restoring focus", async () => {
    const page = await open("theme=light");
    await design(page);
    const paths: [string, () => Promise<void>][] = [
      ["close button", async () => {
        const close = help(page).getByRole("button", { name: "Close", exact: true });
        // The dialog takes pointer events although komo's host lets them pass through.
        const box = (await close.boundingBox())!;
        expect(await close.evaluate((node, [x, y]) => (node.getRootNode() as ShadowRoot).elementFromPoint(x!, y!)?.closest("button") === node, [box.x + box.width / 2, box.y + box.height / 2])).toBe(true);
        await close.click();
      }],
      ["Escape", () => page.keyboard.press("Escape")],
      ["click outside", () => page.mouse.click(12, 450)],
      ["? again", () => page.keyboard.press("?")],
    ];
    for (const [name, close] of paths) {
      await openFromLink(page);
      expect(await help(page).getAttribute("aria-modal"), name).toBe("true");
      await close();
      // Gone at once, not after the queued close event, so the next key reaches the page.
      expect(await page.locator("dialog.komo-shortcuts").count(), name).toBe(0);
      expect(await designActive(page), name).toBe(true);
      expect(await page.locator(".design-inspector__empty").count(), name).toBe(1);
      expect(await linkFocused(page), name).toBe(true);
    }
    // ? opens help from the canvas and closes it again.
    await page.evaluate(() => (document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("?");
    await help(page).waitFor();
    await page.keyboard.press("?");
    await help(page).waitFor({ state: "detached" });
    expect(await designActive(page)).toBe(true);
    // Tab stays inside the open dialog.
    await openFromLink(page);
    for (let step = 0; step < 5; step++) {
      await page.keyboard.press("Tab");
      expect(await help(page).evaluate(dialog => dialog.contains((dialog.getRootNode() as ShadowRoot).activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    expect(page.errors).toEqual([]);
    await page.close();
  }, 30000);

  it("opens centred above the Frame and panel with a pinned header, two columns wide and one narrow", async () => {
    const page = await open("theme=dark");
    await design(page);
    for (const zoom of ["Fit", "100%"]) {
      await page.getByRole("button", { name: zoom, exact: true }).click();
      await page.waitForTimeout(200);
      await openFromLink(page);
      const state = await layout(page);
      expect(Math.abs(state.dialog.left + state.dialog.width / 2 - 720), zoom).toBeLessThanOrEqual(1);
      expect(Math.abs(state.dialog.top + state.dialog.height / 2 - 450), zoom).toBeLessThanOrEqual(1);
      expect(state.dialog.width).toBe(720);
      expect(state.dialog.height).toBeLessThanOrEqual(900 - 32);
      expect(state.columns, zoom).toBe(2);
      expect(state.chips).toEqual([20]);
      expect(state.gestureChips).toBe(0);
      expect(state.note.top).toBeGreaterThanOrEqual(Math.max(...state.sections.map(section => section.bottom)) - 1);
      // The modal sits above the page and the Design panel: the panel area hits komo's backdrop.
      expect(await page.evaluate(() => document.elementFromPoint(1300, 450)?.closest("[data-branch-comments]") !== null)).toBe(true);
      await page.keyboard.press("Escape");
      await help(page).waitFor({ state: "detached" });
    }
    await page.close();

    const narrow = await open("theme=light", { width: 390, height: 844 });
    await openFromMenu(narrow);
    const before = await layout(narrow);
    expect(before.columns).toBe(1);
    expect(before.dialog.width).toBeLessThanOrEqual(390 - 24);
    expect(before.dialog.height).toBeLessThanOrEqual(844 - 24);
    expect(before.scrollable).toBe(true);
    await help(narrow).locator(".komo-shortcuts__body").evaluate(body => { body.scrollTop = body.scrollHeight; });
    const after = await layout(narrow);
    expect(after.title).toEqual(before.title);
    expect(after.title.top).toBeGreaterThanOrEqual(after.dialog.top);
    expect(after.note.bottom).toBeLessThanOrEqual(after.dialog.bottom);
    await shot(narrow, "narrow-390-scrolled");
    await narrow.close();
  }, 30000);

  it("lists the current mode's groups first", async () => {
    const page = await open("theme=light");
    await openFromMenu(page);
    expect(await headings(page)).toEqual(["General", "Comments", "Design canvas", "Experimental geometry", "Text editing", "Compare"]);
    await page.keyboard.press("Escape");
    await help(page).waitFor({ state: "detached" });
    // Focus returned to More; the page takes the next shortcut.
    await page.evaluate(() => (document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("c");
    await openFromMenu(page);
    expect((await headings(page))[0]).toBe("Comments");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await design(page);
    await openFromLink(page);
    expect(await headings(page)).toEqual(["Design canvas", "Experimental geometry", "Text editing", "Compare", "General", "Comments"]);
    await shot(page, "design-first");
    await page.close();
  }, 30000);

  for (const platform of ["mac", "win"]) {
    it(`shows configured keys with ${platform} modifier glyphs`, async () => {
      const keys = encodeURIComponent(JSON.stringify({ restore: "Shift+J", design: "Alt+Shift+D", comments: "Ctrl+L" }));
      const page = await open(`theme=light&platform=${platform}&keys=${keys}`);
      await openFromMenu(page);
      const caps = (label: string) => row(page, label).locator("kbd").allTextContents();
      const name = (label: string) => row(page, label).locator(".komo-kbd").getAttribute("aria-label");
      const mac = platform === "mac";
      expect(await caps("Restore feedback")).toEqual(mac ? ["⇧", "J"] : ["Shift", "J"]);
      expect(await caps("Design mode")).toEqual(mac ? ["⌥", "⇧", "D"] : ["Alt", "Shift", "D"]);
      expect(await name("Design mode")).toBe(mac ? "Option + Shift + D" : "Alt + Shift + D");
      expect(await caps("All comments")).toEqual(mac ? ["⌃", "L"] : ["Ctrl", "L"]);
      expect(await caps("Select inner element")).toEqual([mac ? "⌘" : "Ctrl"]);
      expect(await row(page, "Select inner element").locator(".komo-kbd span").textContent()).toBe("Click");
      expect(await name("Select inner element")).toBe(mac ? "Command + Click" : "Control + Click");
      expect(await caps("Add comment")).toEqual(["C"]);
      await shot(page, `keys-${platform}`);
      await page.close();
    }, 30000);
  }

  it("filters rows by label or key, and ? types into the filter", async () => {
    const page = await open("theme=dark");
    await design(page);
    await openFromLink(page);
    const filter = help(page).getByRole("searchbox", { name: "Filter shortcuts" });
    await filter.click();
    await filter.pressSequentially("parent");
    const visible = () => help(page).locator(".komo-shortcuts__row:visible > span:first-child").allTextContents();
    expect(await visible()).toEqual(["Parent element", "Parent element (alternative)", "Move out, after its parent"]);
    await filter.fill("esc");
    expect(await visible()).toEqual(["Exit Design mode", "Back to the canvas", "Cancel text edit"]);
    await shot(page, "filter-esc");
    await filter.fill("");
    await filter.press("?");
    expect(await filter.inputValue()).toBe("?");
    expect(await visible()).toEqual(["Keyboard shortcuts"]);
    await filter.fill("zzz");
    expect(await help(page).getByRole("status").textContent()).toBe("No matching shortcuts");
    await page.keyboard.press("Escape");
    await help(page).waitFor({ state: "detached" });
    expect(await designActive(page)).toBe(true);
    await page.close();
  }, 30000);

  it("captures the dialog at wide and narrow widths, in Frame Fit and 100%, on light and dark pages", async () => {
    for (const theme of ["light", "dark"]) {
      const page = await open(`theme=${theme}`);
      await design(page);
      await openFromLink(page);
      await shot(page, `design-fit-${theme}`);
      if (tag === "after") {
        await help(page).getByRole("button", { name: "Close", exact: true }).hover();
        await page.waitForTimeout(700);
        await shot(page, `close-tooltip-${theme}`);
      }
      await page.keyboard.press("Escape");
      await help(page).waitFor({ state: "detached" });
      await page.getByRole("button", { name: "100%", exact: true }).click();
      await page.waitForTimeout(200);
      await openFromLink(page);
      await shot(page, `design-100-${theme}`);
      await page.keyboard.press("Escape");
      expect(page.errors).toEqual([]);
      await page.close();
    }
    const narrow = await open("theme=light", { width: 390, height: 844 });
    await openFromMenu(narrow);
    await shot(narrow, "narrow-390");
    await narrow.close();
    const general = await open("theme=dark");
    await openFromMenu(general);
    await shot(general, "review-wide-dark");
    await general.close();

    // A before/after contact sheet, when a before run sits beside this one.
    const image = async (path: string) => existsSync(path) ? `<img src="data:image/png;base64,${(await readFile(path)).toString("base64")}">` : "<div></div>";
    const names = ["design-fit-light", "design-100-dark", "narrow-390", "review-wide-dark"];
    const details = ["design-first", "filter-esc", "keys-win", "close-tooltip-dark", "narrow-390-scrolled"];
    let sheet = `<style>body{margin:0;padding:16px;background:#1a1a1a;color:#ddd;font:14px system-ui}h2{margin:12px 0 6px;font-size:14px}.row{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;align-items:start}img{width:100%;max-height:560px;object-fit:contain;object-position:top;border:1px solid #333;border-radius:6px}</style>`;
    for (const run of ["before", "after"].filter(run => existsSync(join(shotRoot, run))))
      sheet += `<h2>${run}</h2><div class="row">${(await Promise.all(names.map(name => image(join(shotRoot, run, `${name}.png`))))).join("")}</div>`;
    if (tag === "after") sheet += `<h2>after · details</h2><div class="row">${(await Promise.all(details.map(name => image(join(shots, `${name}.png`))))).join("")}</div>`;
    const sheetPage = await browser.newPage({ viewport: { width: 2000, height: 600 } });
    await sheetPage.setContent(sheet);
    await sheetPage.waitForFunction(() => [...document.images].every(image => image.complete));
    await sheetPage.screenshot({ path: join(shotRoot, "contact-sheet.png"), fullPage: true });
    await writeFile(join(shotRoot, "contact-sheet.html"), sheet);
    await sheetPage.close();
  }, 90000);
});
