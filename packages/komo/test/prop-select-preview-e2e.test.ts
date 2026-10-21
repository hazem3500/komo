import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

// Declared enum props preview live in real Chrome, like the Design token selects: the option
// under the pointer or the keyboard's active row renders through the component's own state
// callback (a registered Button) or the React preview bridge (a discovered Chip), outside
// history. Click or Enter commits one Undo step; moving off, Escape and an outside click put
// back the opening value, through host renders, and a discovered null or absent prop returns
// exactly. Host callbacks never run.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-prop-preview-"));
  for (const version of [18, 19]) {
    const require = createRequire(resolve(version === 18 ? "../komo-react18-fixture/package.json" : "package.json"));
    await build({
      stdin: { contents: `
        import ${JSON.stringify(resolve("src/adapters/react-preview.ts"))};
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
        import {useKomoInspectable} from ${JSON.stringify(resolve("src/react.ts"))};
        import {discoverReactComponents} from ${JSON.stringify(resolve("src/adapters/react-fiber.ts"))};
        const h=React.createElement;
        const qa=window.qa={clicks:0,changes:0,version:React.version};
        const union=values=>values.map(value=>JSON.stringify(value)).join(' | ');
        const enumProp=(name,values,required=true)=>({name,kind:'enum',required,values,typeLabel:union(values)+(required?'':' | undefined')});
        const definition={id:'Button',name:'Button',source:'fixture/button.tsx',line:1,props:[
          enumProp('variant',['primary','secondary','ghost']),enumProp('color',['neutral','accent','danger']),
          enumProp('size',['sm','md','lg']),enumProp('tone',['calm','bold'],false)]};
        function Button({onPropsChange,onClick,...props}){
          const inspect=useKomoInspectable({component:definition,props,onChange:onPropsChange,enabled:true});
          return h('button',{ref:inspect.ref,'data-komo-inspectable':inspect['data-komo-inspectable'],type:'button',className:'fixture-button',
            'data-variant':props.variant,'data-color':props.color,'data-size':props.size,'data-tone':String(props.tone),onClick},'Example button');
        }
        function Chip(props){
          return h('span',{className:'fixture-chip','data-kind':String(props.kind),'data-size':String(props.size),'data-has-size':String('size' in props),'data-tone':props.tone,onClick:props.onSelect},'Example chip');
        }
        function App(){
          const[props,setProps]=React.useState({variant:'primary',color:'neutral',size:'md'});
          const[tick,setTick]=React.useState(0);
          const onPropsChange=React.useCallback(next=>{qa.changes++;setProps(current=>({...current,...next}))},[]);
          React.useEffect(()=>{qa.rerender=()=>setTick(value=>value+1)},[]);
          return h('section',null,
            h(Button,{...props,onPropsChange,onClick:()=>qa.clicks++}),
            h(Chip,{kind:null,tone:'calm',onSelect:()=>qa.clicks++}),
            h('output',null,tick));
        }
        createRoot(document.querySelector('main')).render(h(App));
        window.fetch=async()=>Response.json({threads:[],guests:true});
        const components=discoverReactComponents({edit:true,schema:identity=>identity.name==='Chip'?[enumProp('kind',['info','warn'],false),enumProp('size',['sm','lg'],false),enumProp('tone',['calm','bold'])]:undefined});
        document.body.append(document.createElement('aside'));
        window.komo=initKomo({endpoint:location.origin,project:'prop-preview',repo:'example/review',branch:'fixture',sidebar:'edge',restoreOpen:false,design:{components}});
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
      response.end(`<style>body{margin:0;font:16px sans-serif}main{min-height:100vh;box-sizing:border-box;padding:80px}section{display:grid;gap:24px;justify-items:start}.fixture-button{padding:12px 18px;border:1px solid #ccc;border-radius:10px;font:inherit}.fixture-chip{padding:6px 10px;border-radius:999px;background:#eee}</style><main></main><script type="module" src="/${version}/entry.js"></script>`);
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

async function open(version: number, target: string) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/?react=${version}`);
  await page.locator(target).waitFor();
  expect(await page.evaluate(() => (window as any).qa.version)).toMatch(new RegExp(`^${version}\\.`));
  await openDesign(page);
  await page.click(target);
  return { page, errors };
}
const tools = (page: Page) => ({
  list: page.locator(".komo-select"),
  option: (name: string) => page.locator(".komo-select").getByRole("option", { name, exact: true }),
  count: () => page.locator(".design-inspector__count").textContent(),
  undo: () => page.getByRole("button", { name: "Undo", exact: true }).click(),
});

describe.skipIf(!chrome).each([18, 19])("component prop select previews in React %s", version => {
  it("previews a registered Button's variant, color and size, cancels every way and commits one Undo step", async () => {
    const { page, errors } = await open(version, ".fixture-button");
    const { list, option, count, undo } = tools(page);
    const attr = (name: string) => page.locator(".fixture-button").getAttribute(`data-${name}`);
    const variant = page.getByRole("combobox", { name: "Button variant", exact: true });
    await variant.waitFor();

    // Pointer hover previews; moving off the list puts the opening value back.
    await variant.click();
    await option("secondary").hover();
    await expect.poll(() => attr("variant")).toBe("secondary");
    expect(await count()).toBe("");
    await page.mouse.move(1200, 780);
    await expect.poll(() => attr("variant")).toBe("primary");
    // Escape restores and closes.
    await option("ghost").hover();
    await expect.poll(() => attr("variant")).toBe("ghost");
    await page.keyboard.press("Escape");
    await list.waitFor({ state: "detached" });
    await expect.poll(() => attr("variant")).toBe("primary");
    expect(await variant.inputValue()).toBe("primary");
    // An outside click restores.
    await variant.click();
    await option("secondary").hover();
    await expect.poll(() => attr("variant")).toBe("secondary");
    const identity = (await page.locator(".design-inspector__identity").boundingBox())!;
    await page.mouse.click(identity.x + identity.width - 4, identity.y + identity.height / 2);
    await list.waitFor({ state: "detached" });
    await expect.poll(() => attr("variant")).toBe("primary");

    // The keyboard's active row previews; opening alone does not.
    await variant.focus();
    await page.keyboard.press("ArrowDown");
    await list.waitFor();
    expect(await attr("variant")).toBe("primary");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => attr("variant")).toBe("secondary");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => attr("variant")).toBe("ghost");
    await page.keyboard.press("Escape");
    await expect.poll(() => attr("variant")).toBe("primary");

    // Host renders during a preview keep it, and cancelling still restores.
    await variant.click();
    const node = await list.elementHandle();
    await option("secondary").hover();
    for (let i = 1; i <= 3; i++) {
      await page.evaluate(() => (window as any).qa.rerender());
      await expect.poll(() => page.locator("output").textContent()).toBe(String(i));
    }
    expect(await attr("variant")).toBe("secondary");
    expect(await list.evaluate((list, node) => list === node, node)).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => attr("variant")).toBe("primary");
    expect(await count()).toBe("");

    // A click commits exactly one history step.
    await variant.click();
    await option("secondary").hover();
    await option("secondary").click();
    await expect.poll(() => attr("variant")).toBe("secondary");
    expect(await count()).toBe("1 change");
    await undo();
    await expect.poll(() => attr("variant")).toBe("primary");
    expect(await count()).toBe("");

    // Color previews and cancels; size commits from the keyboard with Enter.
    const color = page.getByRole("combobox", { name: "Button color", exact: true });
    await color.click();
    await option("danger").hover();
    await expect.poll(() => attr("color")).toBe("danger");
    await page.keyboard.press("Escape");
    await expect.poll(() => attr("color")).toBe("neutral");
    const size = page.getByRole("combobox", { name: "Button size", exact: true });
    await size.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => attr("size")).toBe("lg");
    await page.keyboard.press("Enter");
    await list.waitFor({ state: "detached" });
    expect(await attr("size")).toBe("lg");
    expect(await count()).toBe("1 change");
    await undo();
    await expect.poll(() => attr("size")).toBe("md");

    // An unset optional enum previews, then returns to unset.
    const tone = page.getByRole("combobox", { name: "Button tone", exact: true });
    expect(await tone.inputValue()).toBe("");
    await tone.click();
    await option("bold").hover();
    await expect.poll(() => attr("tone")).toBe("bold");
    await page.keyboard.press("Escape");
    await expect.poll(() => attr("tone")).toBe("undefined");
    await tone.click();
    await option("calm").click();
    await expect.poll(() => attr("tone")).toBe("calm");
    await undo();
    await expect.poll(() => attr("tone")).toBe("undefined");
    expect(await count()).toBe("");

    expect(await page.evaluate(() => (window as any).qa.clicks)).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("returns a discovered component's null and absent props exactly through the preview bridge", async () => {
    const { page, errors } = await open(version, ".fixture-chip");
    const { list, option, count, undo } = tools(page);
    const attr = (name: string) => page.locator(".fixture-chip").getAttribute(`data-${name}`);
    const kind = page.getByRole("combobox", { name: "Chip kind", exact: true });
    await kind.waitFor();
    expect(await kind.inputValue()).toBe("");

    await kind.click();
    await option("warn").hover();
    await expect.poll(() => attr("kind")).toBe("warn");
    await page.keyboard.press("Escape");
    await expect.poll(() => attr("kind")).toBe("null");

    const size = page.getByRole("combobox", { name: "Chip size", exact: true });
    await size.click();
    await option("lg").hover();
    await expect.poll(() => attr("has-size")).toBe("true");
    await page.evaluate(() => (window as any).qa.rerender());
    await expect.poll(() => page.locator("output").textContent()).toBe("1");
    expect(await attr("size")).toBe("lg");
    await page.mouse.move(1200, 780);
    await expect.poll(() => attr("has-size")).toBe("false");
    await page.keyboard.press("Escape");
    await list.waitFor({ state: "detached" });

    // A committed null-to-value edit undoes back to null, and the next host render keeps it.
    await kind.click();
    await option("info").click();
    await expect.poll(() => attr("kind")).toBe("info");
    expect(await count()).toBe("1 change");
    await undo();
    await expect.poll(() => attr("kind")).toBe("null");
    await page.evaluate(() => (window as any).qa.rerender());
    await expect.poll(() => page.locator("output").textContent()).toBe("2");
    expect(await attr("kind")).toBe("null");
    expect(await attr("has-size")).toBe("false");
    expect(await attr("tone")).toBe("calm");

    expect(await page.evaluate(() => (window as any).qa.clicks)).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });
});
