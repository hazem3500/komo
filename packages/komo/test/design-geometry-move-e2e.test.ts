import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { designEditFromComment, formatDesignEdit } from "../cli/design-edit.mjs";
import { openDesign } from "./design-e2e.js";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = join(tmpdir(), "komo-geometry-move");
let directory: string;
let server: Server;
let browser: Browser;
let origin: string;

const fixture = (version: number) => `<style>
body{margin:0;font:14px/1.4 system-ui;background:#f7f6f3;color:#1d1c1a}
body.dark{color-scheme:dark;background:#161616;color:#ecebe8}
main{display:grid;grid-template-columns:260px 280px 300px;gap:28px;align-items:start;padding:96px 32px 40px;box-sizing:border-box;min-height:100vh}
section{padding:10px;border:1px dashed #b9b4ab}
#list,#rlist{margin:0;padding:8px;list-style:none}
#list li,#rlist li{margin:0 0 6px;padding:7px 10px;border:1px solid #cdc7bd;border-radius:8px;background:#fff}
.dark #list li,.dark #rlist li,.dark #panel{background:#232323;border-color:#3d3d3d}
#panel{min-height:90px;margin-top:10px;padding:12px;border:1px solid #cdc7bd;border-radius:8px;background:#fff}
#panel p{margin:0}
#prose{margin:10px 0 0}
#toolbar{display:flex;gap:8px;padding:6px}
#toolbar button{padding:6px 10px;font:inherit}
#stack{display:flex;flex-direction:column;gap:6px;margin-top:10px;padding:6px}
#stack>div{padding:6px 8px;background:#e7e2d8}
.dark #stack>div{background:#2c2c2c}
#inner{margin-top:8px;padding:6px;background:#dfe8f4}
#grid{display:grid;grid-template-columns:repeat(3,80px);gap:8px}
#grid>div{height:40px;display:grid;place-items:center;background:#dfe8f4}
.dark #grid>div{background:#24303c}
table{margin-top:12px;border-collapse:collapse}
td{padding:4px 10px;border:1px solid #cdc7bd}
</style><main>
<section id="blocks"><ul id="list"><li id="one">One</li><li id="two">Two</li><li id="three">Three</li></ul>
<div id="panel"><p id="note">Drop zone</p></div>
<p id="prose">Text with <span id="inline">an inline run</span> in it.</p></section>
<section id="rows"><div id="toolbar" role="toolbar" aria-label="Views"><button id="today" type="button">Today</button><button id="week" type="button">Week</button><button id="month" type="button">Month</button></div>
<div id="stack"><div id="s1">First</div><div id="s2">Second</div><div id="s3">Third</div></div>
<div id="wrapper" style="display:contents"><div id="inner">Inside a contents wrapper</div></div></section>
<section id="cells"><div id="grid"><div id="g1">1</div><div id="g2">2</div><div id="g3">3</div><div id="g4">4</div><div id="g5">5</div><div id="g6">6</div></div>
<table id="table"><tbody id="body1"><tr id="row1"><td id="c1">A</td><td id="c2">B</td></tr><tr id="row2"><td>C</td><td>D</td></tr></tbody><tbody id="body2"><tr id="row3"><td>E</td><td>F</td></tr></tbody></table>
<div id="react-root"></div></section>
</main><script type="module" src="/${version}/entry.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  await mkdir(shots, { recursive: true });
  directory = await mkdtemp(join(tmpdir(), "komo-geometry-move-"));
  for (const version of [18, 19]) {
    const require = createRequire(resolve(version === 18 ? "../komo-react18-fixture/package.json" : "package.json"));
    await build({
      stdin: { contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
        const h=React.createElement;
        function App(){
          const[count,setCount]=React.useState(0);
          const[extra,setExtra]=React.useState(false);
          React.useEffect(()=>{window.reactQA={version:React.version,bump:()=>setCount(v=>v+1),add:()=>setExtra(true)};},[]);
          return h('ul',{id:'rlist'},
            h('li',{id:'r1',onClick:()=>setCount(v=>v+1),style:{background:count%2?'#fde7e7':'#e7fde9'}},'Item one · '+count),
            h('li',{id:'r2'},'Item two'),
            h('li',{id:'r3'},'Item three'),
            extra?h('li',{id:'r4'},'Item four'):null);
        }
        createRoot(document.getElementById('react-root')).render(h(App));
        const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
        const key='branch-comments:'+location.origin+':move';
        localStorage.setItem(key,'synthetic-session');
        localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
        window.fetch=async input=>{const path=new URL(input instanceof Request?input.url:String(input),location.origin).pathname;return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads:[]}:{});};
        if(location.search.includes('dark'))document.body.classList.add('dark');
        const frame=location.search.includes('frame');
        if(!frame)document.body.append(document.createElement('aside'));
        window.komo=initKomo({endpoint:location.origin,project:'move',repo:'example/review',branch:'fixture',pageRoot:frame?document.querySelector('main'):undefined,sidebar:frame?'background':'edge',frame:{scale:location.search.includes('scaled')},design:{experimentalGeometry:true},restoreOpen:false,pollInterval:60000});
      `, resolveDir: process.cwd(), loader: "ts" },
      alias: { react: dirname(require.resolve("react/package.json")), "react-dom": dirname(require.resolve("react-dom/package.json")) },
      outdir: join(directory, String(version)), entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
    });
  }
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      response.setHeader("content-type", "text/html");
      response.end(fixture(url.searchParams.has("react18") ? 18 : 19));
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

async function open(query = "") {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // React reports reconciliation trouble (for example a foreign node it can't remove) on the console.
  page.on("console", message => { if (message.type() === "error" && /removeChild|insertBefore|not a child|hydrat/i.test(message.text())) errors.push(message.text()); });
  page.setDefaultTimeout(5000);
  await page.goto(`${origin}/?${query}`);
  await page.waitForFunction(() => !!(window as any).komo && !!(window as any).reactQA);
  await openDesign(page);
  return { page, errors };
}

const inspector = (page: Page, name: string) => page.locator(".design-inspector").getByRole("button", { name, exact: true });
const chip = (page: Page) => page.locator(".design-geometry__chip");
const line = (page: Page) => page.locator(".design-geometry__line");
const live = (page: Page) => page.locator('.sr-only[aria-live="polite"]');
async function pick(page: Page, id: string) {
  // A row is reached from its first cell through the inspector's parent button.
  if (id === "row1") { await pick(page, "c1"); await page.locator(".design-inspector__parent").click(); }
  else await page.locator(`#${id}`).click();
  await expect.poll(() => page.locator(".design-inspector__target").textContent()).toMatch(new RegExp(`#${id}$`));
}
/** Visible children in order (by text), with preview clones marked. */
const order = (page: Page, id: string) => page.locator(`#${id}`).evaluate(node => [...node.children]
  .filter(child => getComputedStyle(child).display !== "none")
  .map(child => `${child.textContent!.trim()}${child.hasAttribute("data-komo-move-clone") ? "*" : ""}`));
const clones = (page: Page) => page.locator("[data-komo-move-clone]").count();
/** Press inside the selected element, drag to a point inside `to` (fractions of its box), inspect, then drop or cancel. */
async function drag(page: Page, from: string, to: string, fx: number, fy: number, during?: () => Promise<void>, cancel = false) {
  const start = (await page.locator(`#${from}`).boundingBox())!;
  const end = (await page.locator(`#${to}`).boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 2, start.y + start.height / 2 + 1);
  await page.mouse.move(end.x + end.width * fx, end.y + end.height * fy, { steps: 8 });
  await during?.();
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

describe.skipIf(!chrome)("structural move", () => {
  it.each(["floating", "frame", "frame-scaled"])("drop feedback per flow, nearest valid target, clone preview and exact restoration: %s", async mode => {
    const { page, errors } = await open(mode);
    try {
      // Block flow: a horizontal insertion line after the third item.
      await pick(page, "one");
      expect(await page.locator("#one").evaluate(node => getComputedStyle(node).cursor)).toBe("move");
      await drag(page, "one", "three", 0.5, 0.8, async () => {
        expect(await chip(page).textContent()).toBe("After List item “Three”");
        const rule = await box(page, ".design-geometry__line"), three = await box(page, "#three");
        expect(rule.height).toBeCloseTo(2, 0);
        expect(rule.width).toBeCloseTo(three.width, 0);
        expect(rule.y).toBeGreaterThan(three.y + three.height - 2);
        if (mode === "floating") await page.screenshot({ path: join(shots, "drop-block.png") });
      });
      expect(await order(page, "list")).toEqual(["Two", "Three", "One*"]);
      await expect.poll(() => live(page).textContent()).toBe("Moved after List item “Three”");
      const stand = page.locator("#list [data-komo-move-clone]");
      expect(await stand.evaluate(node => [node.getAttribute("aria-hidden"), (node as HTMLElement).inert, node.id, node.querySelectorAll("[id]").length])).toEqual(["true", true, "", 0]);
      // The selection outline follows the stand-in.
      const clone = (await stand.boundingBox())!;
      await expect.poll(async () => Math.abs(((await page.locator(".design-geometry__frame").boundingBox())?.y ?? 0) - clone.y)).toBeLessThan(1);
      expect(await page.locator(".design-inspector .design-geometry-note p").textContent()).toBe("Move List item “One”: from ul#list (1st) → ul#list (3rd)");
      expect(await page.locator(".design-inspector").getByText("1 change").count()).toBe(1);
      await inspector(page, "Before").click();
      await expect.poll(() => order(page, "list")).toEqual(["One", "Two", "Three"]);
      await inspector(page, "After").click();
      await expect.poll(() => order(page, "list")).toEqual(["Two", "Three", "One*"]);
      await inspector(page, "Undo").click();
      await expect.poll(() => clones(page)).toBe(0);
      expect(await page.locator("#one").getAttribute("style")).toBeNull();

      // Flex row: an upright line, labelled by the button's name.
      await pick(page, "today");
      await drag(page, "today", "month", 0.8, 0.5, async () => {
        expect(await chip(page).textContent()).toBe("After Button “Month”");
        expect((await box(page, ".design-geometry__line")).width).toBeCloseTo(2, 0);
        if (mode === "floating") await page.screenshot({ path: join(shots, "drop-row.png") });
      });
      expect(await order(page, "toolbar")).toEqual(["Week", "Month", "Today*"]);
      await inspector(page, "Undo").click();

      // Grid: before the third cell, upright between cells of one row.
      await pick(page, "g1");
      await drag(page, "g1", "g3", 0.2, 0.5, async () => {
        expect(await chip(page).textContent()).toBe("Before “3”");
        expect((await box(page, ".design-geometry__line")).width).toBeCloseTo(2, 0);
        if (mode === "floating") await page.screenshot({ path: join(shots, "drop-grid.png") });
      });
      expect(await order(page, "grid")).toEqual(["2", "1*", "3", "4", "5", "6"]);
      await inspector(page, "Undo").click();

      // Into a container: its outline highlights and the chip names the position.
      await pick(page, "two");
      await drag(page, "two", "panel", 0.5, 0.85, async () => {
        expect(await chip(page).textContent()).toBe("Into div#panel · position 2");
        expect(await page.locator(".design-geometry__drop").isVisible()).toBe(true);
        const outline = await box(page, ".design-geometry__drop"), panel = await box(page, "#panel");
        expect(Math.abs(outline.width - panel.width)).toBeLessThan(1);
        if (mode === "floating") await page.screenshot({ path: join(shots, "drop-into.png") });
      });
      expect(await order(page, "panel")).toEqual(["Drop zone", "Two*"]);
      await inspector(page, "Undo").click();

      // Nearest valid target: never into a paragraph's text run or a display: contents wrapper.
      await pick(page, "s1");
      await drag(page, "s1", "inline", 0.5, 0.5, async () => {
        expect(await chip(page).textContent()).toMatch(/^(Before|After) Paragraph “Text with an inline/);
      }, true);
      await drag(page, "s1", "inner", 0.5, 0.5, async () => {
        expect(await chip(page).textContent()).toMatch(/^Into section#rows · position \d$/);
      }, true);
      await drag(page, "s1", "s1", 0.4, 0.5, async () => {
        expect(await chip(page).isVisible()).toBe(false);
      });
      expect(await clones(page)).toBe(0);
      expect(await page.locator("#s1").getAttribute("style")).toBeNull();

      // Reset, Browse suspension and destroy all hand the page back exactly.
      await pick(page, "three");
      await drag(page, "three", "one", 0.5, 0.2);
      expect(await order(page, "list")).toEqual(["Three*", "One", "Two"]);
      await page.keyboard.press("d");
      await expect.poll(() => clones(page)).toBe(0);
      expect(await page.locator("#three").getAttribute("style")).toBeNull();
      await openDesign(page);
      await expect.poll(() => order(page, "list")).toEqual(["Three*", "One", "Two"]);
      await page.evaluate(() => (window as any).komo.destroy());
      expect(await clones(page)).toBe(0);
      expect(await page.locator("#blocks [style], #rows [style], #cells [style]").evaluateAll(nodes => nodes.map(node => node.id))).toEqual(["wrapper", "r1"]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("moves from the keyboard on the focused selection, announces it, and leaves canvas keys alone", async () => {
    const { page, errors } = await open();
    try {
      await pick(page, "two");
      // On the canvas, Alt+↑ still selects the parent.
      await page.keyboard.press("Alt+ArrowUp");
      await expect.poll(() => page.locator(".design-inspector__target").textContent()).toBe("ul#list");
      await pick(page, "two");
      await page.keyboard.press("m");
      expect(await page.evaluate(() => document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement?.className)).toBe("design-geometry__frame");
      await page.keyboard.press("Alt+ArrowUp");
      await expect.poll(() => live(page).textContent()).toBe("Moved before List item “One”");
      expect(await order(page, "list")).toEqual(["Two*", "One", "Three"]);
      await page.keyboard.press("Alt+ArrowUp");
      await expect.poll(() => live(page).textContent()).toBe("Already first");
      await page.keyboard.press("Alt+ArrowDown");
      await page.keyboard.press("Alt+ArrowDown");
      await expect.poll(() => live(page).textContent()).toBe("Moved after List item “Three”");
      expect(await order(page, "list")).toEqual(["One", "Three", "Two*"]);
      for (let index = 0; index < 3; index++) await inspector(page, "Undo").click();
      expect(await clones(page)).toBe(0);

      await pick(page, "s2");
      await page.keyboard.press("m");
      await page.keyboard.press("Alt+Shift+ArrowDown");
      await expect.poll(() => live(page).textContent()).toBe("Moved into div#s1");
      expect(await page.locator("#s1 [data-komo-move-clone]").textContent()).toBe("Second");
      await page.keyboard.press("Alt+Shift+ArrowUp");
      await expect.poll(() => live(page).textContent()).toMatch(/^Moved after “First/);
      expect(await order(page, "stack")).toEqual(["First", "Second*", "Third"]);
      // Escape returns to the canvas without leaving Design mode.
      await page.keyboard.press("Escape");
      expect(await page.locator(".design-inspector").isVisible()).toBe(true);
      expect(await page.evaluate(() => document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement?.className ?? "")).not.toBe("design-geometry__frame");
      await inspector(page, "Reset").click();
      expect(await clones(page)).toBe(0);
      expect(await page.locator("#s2").getAttribute("style")).toBeNull();

      // Table cells move within their row; rows stay in their section.
      await pick(page, "c1");
      await page.keyboard.press("m");
      await page.keyboard.press("Alt+ArrowDown");
      expect(await order(page, "row1")).toEqual(["B", "A*"]);
      await inspector(page, "Undo").click();
      await pick(page, "row1");
      await drag(page, "row1", "row3", 0.5, 0.5, async () => {
        expect(await chip(page).isVisible()).toBe(false);
      });
      expect(await clones(page)).toBe(0);
      await drag(page, "row1", "row2", 0.5, 0.8);
      expect(await order(page, "body1")).toEqual(["CD", "AB*"]);
      await inspector(page, "Undo").click();
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it.each([18, 19])("survives React %s re-renders and leaves its handlers working", async version => {
    const { page, errors } = await open(version === 18 ? "react18" : "");
    try {
      expect(await page.evaluate(() => (window as any).reactQA.version)).toMatch(new RegExp(`^${version}\\.`));
      await pick(page, "r1");
      await page.keyboard.press("m");
      await page.keyboard.press("Alt+ArrowDown");
      expect(await order(page, "rlist")).toEqual(["Item two", "Item one · 0*", "Item three"]);
      await page.evaluate(() => (window as any).reactQA.bump());
      await expect.poll(() => order(page, "rlist")).toEqual(["Item two", "Item one · 1*", "Item three"]);
      expect(await page.locator("#r1").evaluate(node => [node.textContent, getComputedStyle(node).display])).toEqual(["Item one · 1", "none"]);
      await page.evaluate(() => (window as any).reactQA.add());
      await expect.poll(() => order(page, "rlist")).toEqual(["Item two", "Item one · 1*", "Item three", "Item four"]);
      // A renderer that rewrites the style attribute does not bring the original back.
      await page.locator("#r1").evaluate(node => node.setAttribute("style", "background: rgb(253, 231, 231);"));
      await expect.poll(() => page.locator("#r1").evaluate(node => getComputedStyle(node).display)).toBe("none");
      await inspector(page, "Before").click();
      await expect.poll(() => order(page, "rlist")).toEqual(["Item one · 1", "Item two", "Item three", "Item four"]);
      await inspector(page, "After").click();
      await expect.poll(() => clones(page)).toBe(1);
      await inspector(page, "Reset").click();
      await expect.poll(() => clones(page)).toBe(0);
      expect(await order(page, "rlist")).toEqual(["Item one · 1", "Item two", "Item three", "Item four"]);
      // Leave Design mode: React still owns its node and its click handler.
      await page.keyboard.press("d");
      await page.locator("#r1").click();
      await expect.poll(() => page.locator("#r1").textContent()).toBe("Item one · 2");
      expect(await page.locator("#r1").evaluate(node => getComputedStyle(node).display)).toBe("list-item");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("undoes drag and keyboard moves with ⌘Z / Ctrl+Z, one at a time, from the focused selection and the canvas", async () => {
    const { page, errors } = await open();
    try {
      const restored = async () => {
        await expect.poll(() => clones(page)).toBe(0);
        expect(await order(page, "list")).toEqual(["One", "Two", "Three"]);
        expect(await page.locator("#one, #two, #three").evaluateAll(nodes => nodes.map(node => node.getAttribute("style")))).toEqual([null, null, null]);
      };
      // Drag, release, ⌘Z: the stand-in goes, the original returns and stays selected.
      await pick(page, "one");
      await drag(page, "one", "three", 0.5, 0.8);
      expect(await order(page, "list")).toEqual(["Two", "Three", "One*"]);
      await page.keyboard.press("ControlOrMeta+z");
      await restored();
      expect(await page.locator(".design-inspector__target").textContent()).toMatch(/#one$/);
      await expect.poll(async () => Math.abs(((await page.locator(".design-geometry__frame").boundingBox())?.y ?? 0) - (await page.locator("#one").boundingBox())!.y)).toBeLessThan(1);
      // ⌘⇧Z (Ctrl+Shift+Z) redoes the move; ⌘Z takes it back again.
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await expect.poll(() => order(page, "list")).toEqual(["Two", "Three", "One*"]);
      await page.keyboard.press("ControlOrMeta+z");
      await restored();

      // Keyboard: M, ⌥↓, then ⌘Z with the selection still focused, and again after Escape.
      await pick(page, "two");
      await page.keyboard.press("m");
      await page.keyboard.press("Alt+ArrowDown");
      expect(await order(page, "list")).toEqual(["One", "Three", "Two*"]);
      await page.keyboard.press("ControlOrMeta+z");
      await restored();
      expect(await page.evaluate(() => document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement?.className)).toBe("design-geometry__frame");
      await page.keyboard.press("Alt+ArrowUp");
      await page.keyboard.press("Escape");
      await page.keyboard.press("ControlOrMeta+z");
      await restored();

      // Consecutive moves undo one at a time; a panel edit after a move undoes first.
      // Focus went back to the canvas, so canvas keys still work.
      expect(await page.evaluate(() => document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement)).toBeNull();
      await page.keyboard.press("m");
      await page.keyboard.press("Alt+ArrowUp");
      await page.keyboard.press("Alt+ArrowDown");
      await page.keyboard.press("Alt+ArrowDown");
      expect(await order(page, "list")).toEqual(["One", "Three", "Two*"]);
      const width = page.locator('.design-inspector [data-property="width"]').first();
      await width.fill("120");
      await width.press("Enter");
      await expect.poll(() => page.locator("#list [data-komo-move-clone]").evaluate(node => (node as HTMLElement).style.width)).toBe("120px");
      // Leave the text field, which keeps its own ⌘Z.
      await page.locator(".design-inspector__target").click();
      for (const expected of [["One", "Three", "Two*"], ["One", "Two*", "Three"], ["Two*", "One", "Three"]]) {
        await page.keyboard.press("ControlOrMeta+z");
        await expect.poll(() => order(page, "list")).toEqual(expected);
      }
      expect(await page.locator("#list [data-komo-move-clone]").evaluate(node => (node as HTMLElement).style.width)).not.toBe("120px");
      // Before/After still work after an undo, and the proposal follows the remaining move.
      await inspector(page, "Before").click();
      await expect.poll(() => order(page, "list")).toEqual(["One", "Two", "Three"]);
      await inspector(page, "After").click();
      await expect.poll(() => order(page, "list")).toEqual(["Two*", "One", "Three"]);
      await page.keyboard.press("ControlOrMeta+z");
      await restored();

      // Reset all restores everything.
      await pick(page, "three");
      await drag(page, "three", "one", 0.5, 0.2);
      await pick(page, "today");
      await drag(page, "today", "month", 0.8, 0.5);
      await page.locator(".design-inspector__close").click();
      await openDesign(page);
      await page.locator(".design-inspector__pending").getByRole("button", { name: "Reset all previews" }).click();
      await restored();
      expect(await order(page, "toolbar")).toEqual(["Today", "Week", "Month"]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("drops the move line from the proposal once the move is undone", async () => {
    const { page, errors } = await open();
    try {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await pick(page, "today");
      await drag(page, "today", "month", 0.8, 0.5);
      await pick(page, "week");
      await drag(page, "week", "month", 0.8, 0.5);
      // Two stand-ins at the end of one parent keep a stable order.
      expect(await order(page, "toolbar")).toEqual(["Month", "Today*", "Week*"]);
      await page.waitForTimeout(100);
      expect(await order(page, "toolbar")).toEqual(["Month", "Today*", "Week*"]);
      await page.keyboard.press("ControlOrMeta+z");
      await page.locator(".design-inspector__close").click();
      await openDesign(page);
      await page.locator(".design-inspector__pending").getByRole("button", { name: "Copy pending proposals" }).click();
      const text = await page.evaluate(() => navigator.clipboard.readText());
      expect(text).toContain("- Move Button “Today”");
      expect(text).not.toContain("- Move Button “Week”");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("records the move for agents and the CLI, without a display row", async () => {
    const { page, errors } = await open();
    try {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await pick(page, "today");
      await drag(page, "today", "month", 0.8, 0.5);
      await page.locator(".design-inspector__close").click();
      await openDesign(page);
      await page.locator(".design-inspector__pending").getByRole("button", { name: "Copy pending proposals" }).click();
      const text = await page.evaluate(() => navigator.clipboard.readText());
      expect(text).toContain("Proposed geometry changes (preview only)\nTarget: #today\nLayout: flex item, row\n- Move Button “Today”: from Toolbar “Views” (1st) → Toolbar “Views” (3rd)\nFrom: #toolbar · index 0\nTo: #toolbar · index 2 · after");
      expect(text).not.toMatch(/display/);
      const edit = designEditFromComment(text, "#today");
      expect(edit?.changes).toContainEqual({ kind: "move", target: "#today", label: "Button “Today”",
        from: { parent: "#toolbar", index: 0, label: "Toolbar “Views”" }, to: { parent: "#toolbar", index: 2, position: "after", label: "Toolbar “Views”" } });
      expect(formatDesignEdit(edit!)).toContain("move the element's markup");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("explains limits in the panel and offers Select parent", async () => {
    const { page, errors } = await open();
    try {
      await pick(page, "inline");
      const note = page.locator(".design-inspector .design-geometry-note");
      await expect.poll(() => note.textContent()).toContain("Inline text runs can't be moved. Select the paragraph or the block around them.");
      await page.locator("#inline").hover();
      await page.mouse.down(); await page.mouse.move(600, 600, { steps: 4 }); await page.mouse.up();
      expect(await clones(page)).toBe(0);
      await pick(page, "blocks");
      await page.locator(".design-inspector__parent").click();
      await expect.poll(() => page.locator(".design-inspector__target").textContent()).toBe("main");
      await expect.poll(() => note.textContent()).toContain("The page and app roots can't be moved.");
      await pick(page, "row1");
      await page.locator(".design-inspector__parent").click();
      await expect.poll(() => page.locator(".design-inspector__target").textContent()).toBe("tbody#body1");
      await expect.poll(() => note.textContent()).toContain("Table sections can't be moved. Select the table.");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
});

describe.skipIf(!chrome)("structural move screenshots", () => {
  it.each(["light", "dark"])("captures a moved card and the drop chip: %s", async scheme => {
    const { page } = await open(scheme === "dark" ? "dark" : "");
    try {
      await pick(page, "two");
      await drag(page, "two", "panel", 0.5, 0.85, async () => {
        await page.screenshot({ path: join(shots, `into-${scheme}.png`), clip: { x: 0, y: 60, width: 960, height: 420 } });
      });
      await page.screenshot({ path: join(shots, `moved-${scheme}.png`), clip: { x: 0, y: 60, width: 960, height: 420 } });
    } finally { await page.close(); }
  });

  it("lays the captures out on one contact sheet", async () => {
    const files = (await readdir(shots)).filter(file => file.endsWith(".png") && file !== "contact-sheet.png").sort();
    const cells = await Promise.all(files.map(async file => `<figure><img src="data:image/png;base64,${(await readFile(join(shots, file))).toString("base64")}"><figcaption>${file.replace(".png", "")}</figcaption></figure>`));
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.setContent(`<style>body{margin:16px;font:12px system-ui;background:#fff;display:grid;grid-template-columns:repeat(3,1fr);gap:12px}figure{margin:0}img{max-width:100%;border:1px solid #ddd}</style>${cells.join("")}`);
      await page.screenshot({ path: join(shots, "contact-sheet.png"), fullPage: true });
    } finally { await page.close(); }
  });
});
