import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string, server: Server, browser: Browser;
const evidence = process.env.KOMO_TYPED_EVIDENCE;
beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-typed-"));
  if (evidence) await mkdir(evidence, { recursive: true });
  await build({ stdin: { contents: `
    import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
    import {tailwindTokens} from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
    const listeners=new Set(); const axis={id:"mode",options:[{id:"light"},{id:"dark"}],current:()=>"light",apply(){listeners.forEach(fn=>fn())},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}};
    const qa=window.qa={writes:[],actions:0,theme:()=>axis.apply()};
    document.querySelector('#target').onclick=()=>qa.actions++;
    const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
    const key='branch-comments:'+location.origin+':typed';
    localStorage.setItem(key,'synthetic-session');localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
    window.fetch=async(input,init)=>{const method=init?.method??'GET';if(method!=='GET'){qa.writes.push(method);throw Error('Unexpected write')}return Response.json({user,threads:[],guests:true})};
    const tokens=tailwindTokens({tokens:[
      {path:'radius.small',type:'dimension',class:'radius-small',properties:['border-radius'],value:'8px',label:'Small'},
      {path:'radius.large',type:'dimension',class:'radius-large',properties:['border-radius'],value:'24px',label:'Large'},
      {path:'space.small',type:'dimension',class:'space-small',properties:['padding'],value:'8px',label:'Small'},
      {path:'layout.flex',type:'other',class:'layout-flex',properties:['display'],value:'flex',label:'Flex'},
      {path:'font.body',type:'fontFamily',class:'font-body',properties:['font-family'],value:'"Body, Face", serif',label:'Body'},
      {path:'shadow.soft',type:'shadow',class:'shadow-soft',properties:['box-shadow'],value:'0px 2px 4px #00000040',label:'Soft'},
      ...Array.from({length:70},(_,i)=>({path:'radius.extra'+i,type:'dimension',class:'radius-extra'+i,properties:['border-radius'],value:i+'px',label:'Extra '+i}))
    ]});
    const mode=new URLSearchParams(location.search).get('mode');if(mode==='floating')document.body.append(document.createElement('aside'));
    window.komo=initKomo({endpoint:location.origin,project:'typed',repo:'example/review',branch:'fixture',pageRoot:mode==='floating'?undefined:document.querySelector('main'),sidebar:mode==='floating'?'edge':'background',frame:{scale:mode==='scaled'},restoreOpen:false,design:{tokens,themes:[axis]}});
  `, resolveDir: process.cwd(), loader: "ts" }, outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022" });
  server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost"), path = url.pathname;
    if (path === "/") { response.setHeader("content-type", "text/html"); response.end(`<style>body{margin:0}main{padding:36px;min-height:100vh;box-sizing:border-box}#target{width:230px;height:100px;background:#eee;border:1px solid #888;font-family:"Acme, Display", "Fallback Sans", sans-serif}.radius-small{border-radius:8px}.radius-large{border-radius:24px}.space-small{padding:8px}.layout-flex{display:flex}.font-body{font-family:"Body, Face",serif!important}.shadow-soft{box-shadow:0px 2px 4px #00000040}</style><main><button id="target" class="radius-small" ${url.searchParams.has("inline") ? 'style="padding:1rem 2rem !important;border:2px solid red !important;margin:3px !important"' : ""}>Synthetic sample</button></main><script type="module" src="/entry.js"></script>`); return; }
    try { const file = resolve(directory, `.${path}`); if (!file.startsWith(directory + "/")) throw Error(); response.setHeader("content-type", "text/javascript"); response.end(await readFile(file)); } catch { response.statusCode = 404; response.end(); }
  }).listen(0);
  origin = `http://localhost:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
});
afterAll(async () => { await browser?.close(); server?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("typed Custom in %s", mode => {
  it.each([1280, 390])("previews and commits exact values at %ipx with chronological Undo", async width => {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(5000);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?mode=${mode}`); await page.waitForFunction(() => !!(window as any).komo);
    await page.keyboard.press("d"); await page.locator("#target").click();
    const target = page.locator("#target"), undo = page.locator('.design-inspector__actions [aria-label="Undo"]');
    const original = await target.getAttribute("style");
    const open = async (property: string) => {
      const trigger = page.locator(`[data-field-property="${property}"] select[data-picker]`);
      await trigger.click(); await page.getByRole("button", { name: "Custom", exact: true }).click();
      await page.locator(".komo-custom").waitFor();
    };
    const exact = page.getByRole("textbox", { name: "CSS value", exact: true });
    const advanced = async () => { const details = page.locator(".komo-typed__advanced"); if (!await details.evaluate(node => (node as HTMLDetailsElement).open)) await details.locator("summary").click(); };
    const apply = page.getByRole("button", { name: "Apply custom", exact: true });
    const radiusTrigger = page.locator('[data-field-property="border-radius"] select[data-picker]');
    await radiusTrigger.click();
    await page.locator('.komo-tokens [role="listbox"]').waitFor();
    if (evidence) await page.screenshot({ path: join(evidence, `tokens-${mode}-${width}.png`) });
    const search = page.getByRole("combobox", { name: "Search tokens for border-radius" });
    await search.fill("Large");
    await page.locator('.komo-tokens [role="option"]').hover();
    expect(await target.evaluate(node => getComputedStyle(node).borderRadius)).toBe("24px");
    expect(await undo.isDisabled()).toBe(true);
    await page.evaluate(() => (window as any).qa.theme());
    expect(await search.inputValue()).toBe("Large");
    await page.keyboard.press("Escape"); expect(await target.getAttribute("style")).toBe(original);
    await radiusTrigger.focus(); await page.keyboard.press("Enter");
    await search.fill("Large"); await search.press("ArrowDown");
    expect(await target.evaluate(node => getComputedStyle(node).borderRadius)).toBe("24px");
    await search.press("Enter"); await undo.click();
    expect(await target.getAttribute("class")).toBe("radius-small");
    await open("border-radius");
    const number = page.getByRole("spinbutton", { name: "Corner radius value" });
    await number.fill(""); await page.evaluate(() => (window as any).qa.theme());
    expect(await number.inputValue()).toBe(""); expect(await apply.isDisabled()).toBe(true);
    await page.getByRole("spinbutton", { name: "Corner radius value" }).fill("120");
    expect(await target.evaluate(node => node.style.borderRadius)).toBe("120px"); expect(await undo.isDisabled()).toBe(true);
    await page.keyboard.press("Escape"); expect(await target.getAttribute("style")).toBe(original);
    await open("border-radius"); await page.getByRole("spinbutton", { name: "Corner radius value" }).fill("8"); await apply.click();
    expect(await page.locator('[data-field-property="border-radius"]').getAttribute("data-token-mode")).toBe("custom");
    await page.getByRole("button", { name: "Use token Small", exact: true }).click();
    expect(await page.locator('[data-field-property="border-radius"]').getAttribute("data-token-mode")).not.toBe("custom");
    await undo.click();
    expect(await page.locator('[data-field-property="border-radius"]').getAttribute("data-token-mode")).toBe("custom");
    await undo.click(); expect(await target.getAttribute("style")).toBe(original);
    await open("border-radius"); await advanced(); await exact.fill("25% 30% / 10px 50%"); await exact.press("Enter");
    expect(await target.evaluate(node => node.style.borderRadius)).toBe("25% 30% / 10px 50%");
    expect(await page.locator('[data-field-property="border-radius"]').getAttribute("data-token-mode")).toBe("custom");
    await undo.click(); expect(await target.getAttribute("style")).toBe(original);
    await open("padding"); await advanced(); await exact.fill("calc(1rem + 2px)"); await apply.click();
    expect(await target.evaluate(node => node.style.padding)).toBe("calc(2px + 1rem)");
    await page.getByRole("button", { name: "Before", exact: true }).click();
    expect(await target.getAttribute("style")).toBe(original);
    await page.getByRole("button", { name: "After", exact: true }).click();
    expect(await target.evaluate(node => node.style.padding)).toBe("calc(2px + 1rem)");
    await page.keyboard.press("v"); expect(await target.getAttribute("style")).toBe(original);
    await page.keyboard.press("d");
    expect(await target.evaluate(node => node.style.padding)).toBe("calc(2px + 1rem)");
    await open("display"); await page.locator('.komo-custom select[aria-label="Layout"]').selectOption("grid"); await apply.click();
    expect(await target.evaluate(node => node.style.display)).toBe("grid");
    await undo.click(); expect(await target.evaluate(node => node.style.padding)).toBe("calc(2px + 1rem)");
    await undo.click(); expect(await target.getAttribute("style")).toBe(original);
    await open("font-family"); expect(await page.locator(".komo-typed__sample span").textContent()).toBe("Acme, Display");
    await advanced(); const stack = '"Other, Face", "Fallback Sans", serif'; await exact.fill(stack);
    if (evidence) await page.screenshot({ path: join(evidence, `font-${mode}-${width}.png`) });
    await page.keyboard.press("Escape"); expect(await target.getAttribute("style")).toBe(original);
    await open("font-family"); await advanced(); await exact.fill(stack); await apply.click();
    expect(await target.evaluate(node => node.style.fontFamily)).toBe(stack);
    await undo.click(); expect(await target.getAttribute("style")).toBe(original);
    await page.getByRole("button", { name: "Add shadow", exact: true }).click(); await open("box-shadow");
    await page.getByRole("spinbutton", { name: "X offset value" }).fill("12");
    if (evidence) await page.screenshot({ path: join(evidence, `shadow-${mode}-${width}.png`) });
    const bounds = await apply.boundingBox(); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
    expect(bounds!.height).toBeGreaterThanOrEqual(24);
    await apply.click(); expect(await target.evaluate(node => node.style.boxShadow)).toContain("12px");
    await undo.click(); await undo.click(); expect(await target.getAttribute("style")).toBe(original);
    await page.getByRole("button", { name: "Add shadow", exact: true }).click(); await open("box-shadow"); await page.getByRole("button", { name: "Add layer", exact: true }).click(); await apply.click();
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await page.locator(".draft-proposal .design-toggle").waitFor();
    await page.locator(".draft-proposal").getByRole("button", { name: "Before", exact: true }).click();
    await expect.poll(() => target.getAttribute("style")).toBe(original);
    await page.locator(".draft-proposal").getByRole("button", { name: "After", exact: true }).click();
    await expect.poll(() => target.evaluate(node => node.style.boxShadow)).not.toBe("");
    await page.keyboard.press("Escape");
    await expect.poll(() => target.getAttribute("style")).toBe(original);
    await page.keyboard.press("d");
    await open("border-radius");
    await page.getByRole("spinbutton", { name: "Corner radius value" }).fill("1");
    await page.locator('.komo-custom select[aria-label="Corner radius unit"]').selectOption("rem");
    await apply.click(); expect(await target.evaluate(node => node.style.borderRadius)).toBe("1rem");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    expect(await target.getAttribute("style")).toBe(original);
    expect(await target.getAttribute("class")).toBe("radius-small");
    expect(await page.evaluate(() => ({writes:(window as any).qa.writes,actions:(window as any).qa.actions}))).toEqual({ writes: [], actions: 0 });
    expect(errors).toEqual([]); await page.close();
  });
  it("preserves host shorthand, unrelated declarations and priorities", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await page.goto(`${origin}/?mode=${mode}&inline`); await page.waitForFunction(() => !!(window as any).komo);
    const target = page.locator("#target"), original = await target.getAttribute("style");
    await page.keyboard.press("d"); await target.click();
    const open = async () => {
      await page.locator('[data-field-property="border-radius"] select[data-picker]').click();
      await page.getByRole("button", { name: "Custom", exact: true }).click();
    };
    await open(); await page.getByRole("spinbutton", { name: "Corner radius value" }).fill("140");
    await page.keyboard.press("Escape"); expect(await target.getAttribute("style")).toBe(original);
    await open(); await page.getByRole("spinbutton", { name: "Corner radius value" }).fill("150");
    await page.getByRole("button", { name: "Apply custom", exact: true }).click();
    expect(await target.evaluate(node => [node.style.padding,node.style.getPropertyPriority("padding"),node.style.border,node.style.getPropertyPriority("border"),node.style.margin])).toEqual(["1rem 2rem","important","2px solid red","important","3px"]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await target.getAttribute("style")).toBe(original);
    await page.close();
  });

});
