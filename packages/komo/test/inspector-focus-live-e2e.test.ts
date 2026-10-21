import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The inspector in real Chrome: a redraw (⌘Z, Before/After, a theme switch) puts focus back on
// the control that had it, and Undo or Reset with nothing left to focus moves it to the
// selection, never to Exit. Field token captions are plain text the controls are described
// by; komo keeps one polite live region for deliberate announcements such as applied tokens.

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-inspector-focus-"));
  await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      import {useKomoInspectable} from ${JSON.stringify(resolve("src/react.ts"))};
      import {discoverCssTokens} from ${JSON.stringify(resolve("src/adapters/css-variables.ts"))};
      import {classTheme} from ${JSON.stringify(resolve("src/adapters/class-theme.ts"))};
      const h=React.createElement;
      const definition={id:'button',name:'Button',source:'fixture/button.tsx',line:1,props:[
        {name:'variant',kind:'enum',required:true,values:['primary','secondary','ghost'],typeLabel:'"primary" | "secondary" | "ghost"'},
        {name:'busy',kind:'boolean',required:true,typeLabel:'boolean'}]};
      function Button(initial){
        const[props,setProps]=React.useState(initial);
        const inspect=useKomoInspectable({component:definition,props,onChange:next=>setProps(current=>({...current,...next})),enabled:true});
        return h('button',{ref:inspect.ref,'data-komo-inspectable':inspect['data-komo-inspectable'],type:'button',className:'fixture-button','data-variant':props.variant},'Example button');
      }
      createRoot(document.querySelector('main')).render(h(Button,{variant:'primary',busy:false}));
      window.fetch=async()=>Response.json({threads:[],guests:true});
      document.body.append(document.createElement('aside'));
      const mode=classTheme({id:'mode',options:[{id:'light'},{id:'dark',class:'dark'}]});
      window.komo=initKomo({endpoint:location.origin,project:'inspector-focus',repo:'example/review',branch:'fixture',sidebar:'edge',restoreOpen:false,design:{tokens:discoverCssTokens({scopes:{dark:'.dark'}}),themes:[mode]}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<style>:root{--color-text:#131213;--color-surface:#f0f0f0;--space-3:12px}.dark{--color-text:#e6e6e6;--color-surface:#131213}body{margin:0;font:16px sans-serif;background:var(--color-surface)}main{min-height:100vh;box-sizing:border-box;padding:80px}.fixture-button{padding:var(--space-3);color:var(--color-text);border:1px solid #888;border-radius:10px;font:inherit}</style><main></main><script type="module" src="/entry.js"></script>`);
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
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-blink-features=EyeDropperAPI"] });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.locator(".fixture-button").waitFor();
  await page.keyboard.press("d");
  await page.click(".fixture-button");
  await page.getByRole("combobox", { name: "Button variant", exact: true }).waitFor();
  await page.locator('[data-field-property="color"] .design-token-binding').waitFor({ state: "attached" });
  return { page, errors };
}
/** The deepest focused element's accessible name: its aria-label, data-property or tag. */
const focused = (page: Page) => page.evaluate(() => {
  let node: Element | null = document.activeElement;
  while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
  return node && (node.getAttribute("aria-label") ?? node.getAttribute("data-property") ?? node.className);
});
const variant = (page: Page) => page.getByRole("combobox", { name: "Button variant", exact: true });
const announced = (page: Page) => page.locator('.sr-only[aria-live="polite"]').textContent();

describe.skipIf(!chrome)("inspector focus and announcements", () => {
  it("keeps one polite live region and describes each field by its token caption", async () => {
    const { page, errors } = await open();
    const regions = await page.evaluate(() => {
      const host = [...document.querySelectorAll("*")].find(node => node.shadowRoot?.querySelector(".design-inspector"))!;
      const root = host.shadowRoot!;
      const live = [...root.querySelectorAll('[aria-live]:not([aria-live="off"]),[role=status],[role=alert],[role=log]')].map(node => node.className);
      const captions = [...root.querySelectorAll<HTMLElement>(".design-token-binding__state")].map(caption => ({
        id: caption.id,
        live: caption.getAttribute("aria-live"),
        text: caption.textContent,
        by: [...root.querySelectorAll(`[aria-describedby~="${caption.id}"]`)].map(node => node.localName),
      }));
      return { live, captions };
    });
    expect(regions.live.length).toBeLessThanOrEqual(2);
    expect(regions.live).toEqual(expect.arrayContaining(["sr-only"]));
    expect(regions.captions.length).toBeGreaterThan(4);
    expect(regions.captions.some(caption => /^(Uses|Not from a token)/.test(caption.text ?? ""))).toBe(true);
    for (const caption of regions.captions) {
      expect(caption.live).toBeNull();
      // The token select and the field's own value control both point at the caption.
      expect(caption.by).toContain("select");
      expect(caption.by.length).toBeGreaterThanOrEqual(2);
    }

    // Applying a token is a deliberate announcement in that one region.
    const tokens = page.locator('[data-field-property="color"] .design-token-binding select');
    const path = await tokens.evaluate((select: HTMLSelectElement) => [...select.options].find(option => option.value && option.value !== "custom")!.value);
    await tokens.evaluate((select: HTMLSelectElement, path) => { select.value = path; select.dispatchEvent(new Event("change", { bubbles: true })); }, path);
    await expect.poll(() => announced(page)).toMatch(/^color uses /);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("keeps focus on a prop select through ⌘Z, Before/After and a theme switch", async () => {
    const { page, errors } = await open();
    await variant(page).focus();
    await variant(page).selectOption("secondary");
    await expect.poll(() => page.locator(".fixture-button").getAttribute("data-variant")).toBe("secondary");
    expect(await focused(page)).toBe("Button variant");

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => page.locator(".fixture-button").getAttribute("data-variant")).toBe("primary");
    await page.waitForTimeout(450);
    expect(await focused(page)).toBe("Button variant");
    await expect.poll(() => announced(page)).toBe("Undone");

    // Before/After from the keyboard on the same control.
    await variant(page).selectOption("ghost");
    await page.keyboard.press("b");
    await expect.poll(() => page.locator(".design-inspector").getAttribute("data-before")).toBe("");
    await page.keyboard.press("b");
    await expect.poll(() => page.locator(".design-inspector").getAttribute("data-before")).toBeNull();
    await page.waitForTimeout(450);
    expect(await focused(page)).toBe("Button variant");

    // A theme switch redraws the fields while focus stays put.
    await page.locator(".design-theme-toggle").evaluate((toggle: HTMLElement) => toggle.click());
    await expect.poll(() => page.evaluate(() => document.documentElement.className)).toContain("dark");
    await page.waitForTimeout(450);
    expect(await focused(page)).toBe("Button variant");

    // A style field keeps focus through ⌘Z too.
    const weight = page.locator('select[data-property="font-weight"]');
    await weight.focus();
    await weight.selectOption("700");
    await expect.poll(() => page.locator(".fixture-button").evaluate(node => node.style.fontWeight)).toBe("700");
    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForTimeout(450);
    expect(await focused(page)).toBe("Weight");
    expect(await page.locator(".fixture-button").evaluate(node => node.style.fontWeight)).toBe("");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("sends focus to the selection, never Exit, when Undo or Reset leaves nothing to focus", async () => {
    const { page, errors } = await open();
    const undo = page.locator(".design-inspector").getByRole("button", { name: "Undo", exact: true });
    const reset = page.locator(".design-inspector").getByRole("button", { name: "Reset", exact: true });
    await variant(page).selectOption("secondary");
    await undo.click();
    await expect.poll(() => page.locator(".fixture-button").getAttribute("data-variant")).toBe("primary");
    expect(await focused(page)).toBe("design-inspector__target");

    await variant(page).selectOption("ghost");
    await reset.click();
    await expect.poll(() => page.locator(".fixture-button").getAttribute("data-variant")).toBe("primary");
    expect(await focused(page)).toBe("design-inspector__target");
    expect(errors).toEqual([]);
    await page.close();
  });
});
