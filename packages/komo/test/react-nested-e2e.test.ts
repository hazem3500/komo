import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-nested-props-"));
  for (const version of [18, 19]) {
    const require = createRequire(resolve(version === 18 ? "../komo-react18-fixture/package.json" : "package.json"));
    await build({
      stdin: { contents: `
        import ${JSON.stringify(resolve("src/adapters/react-preview.ts"))};
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
        import {discoverReactComponents} from ${JSON.stringify(resolve("src/adapters/react-fiber.ts"))};
        import {tailwindTokens} from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
        const Slot=React.forwardRef(function Slot(props,ref){return React.cloneElement(React.Children.only(props.children),{ref});});
        const ActionButton=React.forwardRef(function ActionButton(props,ref){return React.createElement('button',{ref,className:'button-'+props.variant,'aria-label':props['aria-label'],type:'button'},'Example action');});
        ActionButton.displayName='ActionButton';
        const StableBranch=React.memo(function StableBranch(){return React.createElement(Slot,null,React.createElement(ActionButton,{variant:'tertiary','aria-label':'Original action'}));});
        function App(){
          const[tick,setTick]=React.useState(0);
          React.useEffect(()=>{const timer=setInterval(()=>setTick(v=>v+1),250);return()=>clearInterval(timer)},[]);
          return React.createElement('section',null,React.createElement(StableBranch),React.createElement('output',{'data-parent-commit':tick},tick));
        }
        createRoot(document.querySelector('main')).render(React.createElement(App));
        const adapter=discoverReactComponents({edit:true});
        window.nestedQA={adapter,version:React.version};
        window.fetch=async()=>Response.json({threads:[],guests:true});
        const frame=new URLSearchParams(location.search).has('frame');
        const reflow=new URLSearchParams(location.search).has('reflow');
        if(!frame&&!reflow)document.body.append(document.createElement('aside'));
        const tokens=tailwindTokens({tokens:[{path:'color.primary',label:'Primary',type:'color',class:'text-primary',properties:['color'],value:'#b42318'},{path:'color.secondary',label:'Secondary',type:'color',class:'text-secondary',properties:['color'],value:'#2468ff'},...Array.from({length:8},(_,index)=>({path:'color.fixture'+index,label:'Supplemental '+index,type:'color',class:'text-fixture-'+index,properties:['color'],value:'#123456'}))]});
        window.komo=initKomo({endpoint:location.origin,project:'nested-props',repo:'example/review',branch:'fixture',pageRoot:frame||reflow?document.querySelector('main'):undefined,sidebar:frame||reflow?'background':'edge',frame:{scale:frame},restoreOpen:false,design:{components:adapter,tokens}});
      `, resolveDir: process.cwd(), loader: "ts" },
      alias: { react: dirname(require.resolve("react/package.json")), "react-dom": dirname(require.resolve("react-dom/package.json")) },
      outdir: join(directory, String(version)), entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
    });
  }
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const version = url.searchParams.get("react") === "18" ? 18 : 19;
    if (url.pathname === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<style>body{margin:0}main{min-height:100vh;box-sizing:border-box;padding:80px}button{font:inherit}.button-tertiary{padding:18px;background:#eee;border:1px solid #ccc;border-radius:10px}.button-primary{padding:18px;background:#6941c6;color:white;border:1px solid #53389e;border-radius:10px}.text-primary{color:#b42318}.text-secondary{color:#2468ff}[class*=text-fixture-]{color:#123456}output{display:block;margin-top:16px}</style><main></main><script type="module" src="/${version}/entry.js"></script>`);
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

describe.skipIf(!chrome).each([18, 19])("nested renderer previews in React %s", version => {
  it.each(["floating", "reflow", "scaled"])("keeps popup nodes, search and active previews stable through parent commits in %s", async mode => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    await page.goto(`${origin}/?react=${version}${mode === "reflow" ? "&reflow" : mode === "scaled" ? "&frame" : ""}`);
    const target = page.locator("main button");
    await target.waitFor();
    const baseline = await target.evaluate(node => ({ style: node.getAttribute("style"), className: node.className, color: getComputedStyle(node).color, display: getComputedStyle(node).display }));
    await page.keyboard.press("d");
    await target.click();
    await page.locator('[data-property="display"]').click();
    const layout = page.locator(".komo-select");
    await layout.waitFor();
    await layout.evaluate(node => (window as any).popupQA = { layout: node });
    const grid = layout.getByRole("option", { name: "grid", exact: true });
    await grid.hover();
    expect(await target.evaluate(node => getComputedStyle(node).display)).toBe("grid");
    const tick = await page.locator("[data-parent-commit]").textContent();
    await page.waitForFunction(previous => Number(document.querySelector("output")?.textContent) >= Number(previous) + 2, tick);
    expect(await layout.evaluate(node => node === (window as any).popupQA.layout)).toBe(true);
    await page.keyboard.press("Escape");
    expect(await target.evaluate(node => getComputedStyle(node).display)).toBe(baseline.display);
    const field = page.locator('[data-field-property="color"]');
    await field.locator("select[data-picker]").click();
    const popup = page.locator(".komo-tokens");
    await popup.waitFor();
    await popup.getByRole("button", { name: "Tokens", exact: true }).click();
    const search = popup.getByRole("combobox", { name: "Search tokens for color", exact: true });
    await search.fill("Primary");
    await popup.evaluate(node => (window as any).popupQA.tokens = node);
    const primary = popup.getByRole("option").filter({ hasText: "Primary" });
    await primary.hover();
    expect(await target.evaluate(node => getComputedStyle(node).color)).toBe("rgb(180, 35, 24)");
    const active = await search.getAttribute("aria-activedescendant");
    const next = await page.locator("[data-parent-commit]").textContent();
    await page.waitForFunction(previous => Number(document.querySelector("output")?.textContent) >= Number(previous) + 2, next);
    expect(await popup.evaluate(node => node === (window as any).popupQA.tokens)).toBe(true);
    expect(await search.inputValue()).toBe("Primary");
    expect(await search.getAttribute("aria-activedescendant")).toBe(active);
    expect(await page.locator('.design-inspector__actions [aria-label="Undo"]').isDisabled()).toBe(true);
    await search.press("ArrowDown");
    await search.press("Escape");
    expect(await target.getAttribute("class")).toBe(baseline.className);
    expect(await target.getAttribute("style")).toBe(baseline.style);
    await field.locator("select[data-picker]").click();
    await popup.getByRole("button", { name: "Tokens", exact: true }).click();
    await popup.getByRole("option").filter({ hasText: "Primary" }).click();
    expect(await target.evaluate(node => getComputedStyle(node).color)).toBe("rgb(180, 35, 24)");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await target.getAttribute("class")).toBe(baseline.className);
    expect(await target.getAttribute("style")).toBe(baseline.style);
    expect(await target.evaluate(node => getComputedStyle(node).color)).toBe(baseline.color);
    await page.close();
  });

  it.each([false, true])("retains real DOM edits and reversible controls in Frame=%s", async frame => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(4000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?react=${version}${frame ? "&frame" : ""}`);
    await page.locator("main button").waitFor();
    await page.waitForFunction(() => Number(document.querySelector("output")?.textContent) > 1);
    await page.keyboard.press("d");
    await page.locator('.design-inspector[aria-hidden="false"]').waitFor();
    await page.locator("main button").click();
    const variant = page.getByRole("textbox", { name: "ActionButton variant", exact: true });
    await variant.fill("primary");
    await variant.press("Enter");
    await page.waitForFunction(() => document.querySelector("main button")?.className === "button-primary");
    expect(await page.evaluate(() => (window as any).nestedQA.adapter.identify(document.querySelector("main button")).props.variant)).toBe("primary");
    const commit = await page.locator("output").textContent();
    await page.waitForFunction(previous => document.querySelector("output")?.textContent !== previous, commit);
    expect(await page.locator("main button").getAttribute("class")).toBe("button-primary");
    const label = page.getByRole("textbox", { name: "ActionButton aria-label", exact: true });
    await label.fill("Preview action");
    await label.press("Enter");
    await page.waitForFunction(() => document.querySelector("main button")?.getAttribute("aria-label") === "Preview action");
    await page.getByRole("button", { name: "Before", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main button")?.className === "button-tertiary");
    await page.getByRole("button", { name: "After", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main button")?.getAttribute("aria-label") === "Preview action");
    await page.keyboard.press("v");
    await page.waitForFunction(() => document.querySelector("main button")?.className === "button-tertiary");
    await page.keyboard.press("d");
    await page.waitForFunction(() => document.querySelector("main button")?.className === "button-primary");
    expect(await variant.inputValue()).toBe("primary");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main button")?.getAttribute("aria-label") === "Original action");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main button")?.className === "button-tertiary");
    expect(await variant.inputValue()).toBe("tertiary");
    expect(await page.locator(".design-react-discovered").count()).toBe(0);
    await variant.fill("primary");
    await variant.press("Enter");
    await page.waitForFunction(() => document.querySelector("main button")?.className === "button-primary");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main button")?.className === "button-tertiary");
    expect(await page.locator("main button").getAttribute("style")).toBeNull();
    expect(await variant.inputValue()).toBe("tertiary");
    if (frame) expect(await page.locator("main").evaluate(node => node.getBoundingClientRect().width)).toBeCloseTo(852);
    expect(errors).toEqual([]);
    await page.close();
  });
});
