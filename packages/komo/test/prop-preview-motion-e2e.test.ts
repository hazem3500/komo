import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

// A design-system button with its own color, background and border transitions. Previewing its
// color prop option by option (pointer or arrow keys) renders each option at once: no host
// transition runs, reads are final values, the panel never moves and no animation notice shows.
// Committing or Escape hands the host its transitions back and leaves no attribute or style behind.
// Host motion komo did not start is named only once it lasts, as a dot that takes no space.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = join(tmpdir(), "komo-prop-motion");
const phase = process.env.KOMO_SHOT_PHASE ?? "after";
let directory: string, origin: string;
let server: Server, browser: Browser;

const COLORS = ["unset", "default", "destructive", "affirmative", "accent"];
const fixture = `<style>
body{margin:0;font:16px sans-serif;background:#f4f3f1}
main{min-height:100vh;box-sizing:border-box;padding:80px;display:grid;gap:32px;align-content:start;justify-items:start}
.fixture-button{padding:12px 18px;border:2px solid #c9c6c0;border-radius:10px;background:#fff;color:#1d1c1a;font:inherit;transition:color 150ms,background-color 150ms,border-color 150ms}
.fixture-button span{transition:color 150ms}
.fixture-button[data-color=default]{background:#e9e7e3;border-color:#a9a59d}
.fixture-button[data-color=destructive]{background:#d92d20;border-color:#912018;color:#fff}
.fixture-button[data-color=affirmative]{background:#079455;border-color:#05603a;color:#fff}
.fixture-button[data-color=accent]{background:#6941c6;border-color:#42307d;color:#fff}
#box{width:200px;height:60px;background:#d9d4ca}
</style><main></main><script type="module" src="/entry.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  await mkdir(shots, { recursive: true });
  directory = await mkdtemp(join(tmpdir(), "komo-prop-motion-"));
  await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      import {useKomoInspectable} from ${JSON.stringify(resolve("src/react.ts"))};
      const h=React.createElement;
      const enumProp=(name,values,required=true)=>({name,kind:'enum',required,values,typeLabel:values.map(value=>JSON.stringify(value)).join(' | ')+(required?'':' | undefined')});
      const definition={id:'Button',name:'Button',source:'fixture/button.tsx',line:1,props:[
        enumProp('variant',['primary','secondary']),enumProp('color',${JSON.stringify(COLORS.slice(1))},false),enumProp('size',['sm','md','lg'])]};
      function Button({onPropsChange,...props}){
        const inspect=useKomoInspectable({component:definition,props,onChange:onPropsChange,enabled:true});
        return h('button',{ref:inspect.ref,'data-komo-inspectable':inspect['data-komo-inspectable'],type:'button',className:'fixture-button',
          'data-variant':props.variant,'data-color':props.color,'data-size':props.size},h('span',null,'Example button'));
      }
      function App(){
        const[props,setProps]=React.useState({variant:'secondary',size:'md'});
        const onPropsChange=React.useCallback(next=>setProps(current=>({...current,...next})),[]);
        return h(React.Fragment,null,h(Button,{...props,onPropsChange}),h('div',{id:'box'}));
      }
      createRoot(document.querySelector('main')).render(h(App));
      window.fetch=async()=>Response.json({threads:[],guests:true});
      document.body.append(document.createElement('aside'));
      window.komo=initKomo({endpoint:location.origin,project:'prop-motion',repo:'example/review',branch:'fixture',sidebar:'edge',restoreOpen:false,design:{experimentalGeometry:true}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      response.setHeader("content-type", "text/html");
      response.end(fixture);
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

async function open(target: string, video = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(video ? { recordVideo: { dir: shots, size: { width: 1280, height: 800 } } } : {}) });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.locator(target).waitFor();
  await openDesign(page);
  // The button's corner, not its label, so the button itself is selected.
  await page.click(target, { position: { x: 4, y: 4 } });
  // Experimental geometry loads after Design mode opens.
  await page.locator(".design-geometry").waitFor({ state: "attached" });
  return { page, context, errors };
}

/** Sample every frame: running host animations, the button's paint, any wait notice and panel positions. */
async function sample(page: Page) {
  await page.evaluate(() => {
    const root = [...document.querySelectorAll("*")].find(node => node.shadowRoot?.querySelector(".design-inspector"))!.shadowRoot!;
    const button = document.querySelector(".fixture-button")!;
    const tops = (selector: string) => [...root.querySelectorAll(selector)].map(node => Math.round(node.getBoundingClientRect().top)).join(",");
    const state = { stop: false, frames: [] as Array<Record<string, unknown>> };
    (window as any).sampling = state;
    const frame = () => {
      const note = root.querySelector(".design-geometry-note");
      state.frames.push({
        transitions: button.getAnimations({ subtree: true }).length,
        paint: getComputedStyle(button).backgroundColor,
        notice: /animation/i.test(note && !(note as HTMLElement).hidden ? note.textContent ?? "" : "") || !!root.querySelector(".design-geometry-wait:not([hidden])"),
        sections: tops(".design-section"),
        rows: tops(".design-react-row"),
        list: tops(".komo-select"),
      });
      if (!state.stop) requestAnimationFrame(frame);
    };
    frame();
  });
  return async () => page.evaluate(() => {
    const state = (window as any).sampling;
    state.stop = true;
    return state.frames as Array<{ transitions: number; paint: string; notice: boolean; sections: string; rows: string; list: string }>;
  });
}

const PAINTS = ["rgb(255, 255, 255)", "rgb(233, 231, 227)", "rgb(217, 45, 32)", "rgb(7, 148, 85)", "rgb(105, 65, 198)"];
const residue = (page: Page) => page.evaluate(() => {
  const button = document.querySelector(".fixture-button")!;
  // Other komo features adopt sheets of their own; only the hold's must be gone.
  const sheets = document.adoptedStyleSheets.filter(sheet => [...sheet.cssRules].some(rule => rule.cssText.includes("data-komo-still"))).length;
  return { still: button.hasAttribute("data-komo-still"), style: button.getAttribute("style"), sheets, duration: getComputedStyle(button).transitionDuration };
});

describe.skipIf(!chrome)("host motion while komo previews a component prop", () => {
  it("previews five options by pointer and keys at once, with no notice or reflow, then commits and Escapes cleanly", async () => {
    const { page, context, errors } = await open(".fixture-button", !!process.env.KOMO_SHOT_PHASE);
    try { await previews(page, errors); } finally {
      await context.close();
      await page.video()?.saveAs(join(shots, `${phase}-previews.webm`));
      await page.video()?.delete();
    }
  });

  async function previews(page: Page, errors: string[]) {
    const option = (name: string) => page.locator(".komo-select").getByRole("option", { name, exact: true });
    const color = page.getByRole("combobox", { name: "Button color", exact: true });
    const attr = () => page.locator(".fixture-button").getAttribute("data-color");
    await color.waitFor();
    await page.waitForTimeout(800);

    // Pointer across all five options, slower than the host's 150ms transitions.
    const pointer = await sample(page);
    await color.click();
    for (const name of [...COLORS.slice(1), "default", COLORS[0]]) {
      await option(name).hover();
      if (name === "destructive") {
        await page.waitForTimeout(60);
        await page.screenshot({ path: join(shots, `${phase}-hover.png`) });
      }
      await page.waitForTimeout(220);
    }
    const hovered = await pointer();
    await page.keyboard.press("Escape");
    await page.locator(".komo-select").waitFor({ state: "detached" });

    // Arrow keys through the same five.
    const keys = await sample(page);
    await color.focus();
    await page.keyboard.press("ArrowDown");
    await page.locator(".komo-select").waitFor();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(220);
    }
    const arrowed = await keys();
    expect(await attr()).toBe("accent");

    for (const [name, frames] of [["pointer", hovered], ["keys", arrowed]] as const) {
      expect.soft(frames.length, name).toBeGreaterThan(20);
      expect.soft(frames.filter(frame => frame.transitions), name).toEqual([]);
      expect.soft(frames.filter(frame => frame.notice), name).toEqual([]);
      // Every read is a final paint, never one between two options.
      expect.soft(frames.filter(frame => !PAINTS.includes(frame.paint)), name).toEqual([]);
      expect.soft(new Set(frames.map(frame => frame.paint)).size, name).toBe(5);
      for (const key of ["sections", "rows"] as const) expect.soft(new Set(frames.map(frame => frame[key])).size, `${name} ${key}`).toBe(1);
      expect.soft(new Set(frames.map(frame => frame.list).filter(Boolean)).size, `${name} list`).toBe(1);
    }

    // Enter commits; the host gets its transitions back and nothing of komo's stays on the button.
    await page.keyboard.press("Enter");
    await page.locator(".komo-select").waitFor({ state: "detached" });
    expect(await page.locator(".design-inspector__count").textContent()).toBe("1 change");
    await page.waitForTimeout(100);
    expect(await residue(page)).toEqual({ still: false, style: null, sheets: 0, duration: "0.15s, 0.15s, 0.15s" });
    const transitions = () => page.evaluate(() => document.querySelector(".fixture-button")!.getAnimations().length);
    await page.evaluate(() => document.querySelector(".fixture-button")!.setAttribute("data-color", "destructive"));
    expect(await transitions()).toBeGreaterThan(0);
    await page.evaluate(() => document.querySelector(".fixture-button")!.setAttribute("data-color", "accent"));
    await page.waitForTimeout(200);

    // Escape puts the committed value back the same way.
    await color.click();
    await option("affirmative").hover();
    await expect.poll(attr).toBe("affirmative");
    await page.keyboard.press("Escape");
    await expect.poll(attr).toBe("accent");
    await page.waitForTimeout(100);
    expect(await residue(page)).toEqual({ still: false, style: null, sheets: 0, duration: "0.15s, 0.15s, 0.15s" });
    await page.evaluate(() => document.querySelector(".fixture-button")!.setAttribute("data-color", "default"));
    expect(await transitions()).toBeGreaterThan(0);
    await page.screenshot({ path: join(shots, `${phase}-settled.png`) });
    expect(errors).toEqual([]);
  }

  it("names host motion it did not start only once it lasts, as a dot that takes no space", async () => {
    const { page, context, errors } = await open("#box");
    const dot = page.locator(".design-geometry-wait");
    const layout = () => page.evaluate(() => {
      const root = [...document.querySelectorAll("*")].find(node => node.shadowRoot?.querySelector(".design-inspector"))!.shadowRoot!;
      return [...root.querySelectorAll(".design-section")].map(node => Math.round(node.getBoundingClientRect().top)).join(",");
    });
    // The panel has finished sliding in.
    await page.waitForTimeout(800);
    const before = await layout();
    const animate = (duration: number) => page.evaluate(duration => { document.getElementById("box")!.animate([{ width: "200px" }, { width: "260px" }], { duration }); }, duration);
    // A brief resize ends before the wait is due.
    await animate(150);
    for (let i = 0; i < 6; i++) {
      expect(await dot.isVisible()).toBe(false);
      await page.waitForTimeout(100);
    }
    // A long one is named after it has lasted, and the panel stays put.
    await animate(1600);
    await page.waitForTimeout(150);
    expect(await dot.isVisible()).toBe(false);
    await expect.poll(() => dot.isVisible(), { timeout: 1000 }).toBe(true);
    expect(await dot.getAttribute("title")).toBe("Wait for this element's animation to finish.");
    // Only resizing waits: the selection can still be moved, and no resize handle shows.
    expect(await page.locator(".design-geometry__frame").getAttribute("aria-label")).toMatch(/^Move or resize div#box:/);
    expect(await page.locator(".design-geometry__handle:visible").count()).toBe(0);
    expect(await page.locator(".design-geometry-note").evaluate(note => note.textContent)).not.toMatch(/animation/);
    expect(await layout()).toBe(before);
    await page.screenshot({ path: join(shots, `${phase}-host-motion.png`) });
    await expect.poll(() => dot.isVisible(), { timeout: 2000 }).toBe(false);
    expect(await layout()).toBe(before);
    expect(errors).toEqual([]);
    await context.close();
  });
});
