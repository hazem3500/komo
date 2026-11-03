import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

// The generic react-fiber adapter with `{ edit: true, schema }` keeps a discovered
// component's enum and boolean props editable in every Frame mode. In Viewport the
// component renders in the iframe's realm, through that realm's React and DevTools
// hook; previews, Reset, Undo/Redo and the posted proposal match In place, and the
// copy of the app outside the frame is never touched.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = join(tmpdir(), "komo-viewport-fiber-props");
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-viewport-fiber-props-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import ${JSON.stringify(resolve("src/adapters/react-preview.ts"))};
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      import {isShell} from ${JSON.stringify(resolve("src/shell.ts"))};
      import {discoverReactComponents} from ${JSON.stringify(resolve("src/adapters/react-fiber.ts"))};
      import {useKomoInspectable} from ${JSON.stringify(resolve("src/react.ts"))};
      const params=new URLSearchParams(location.search);
      const mode=params.get('mode')||'inplace';
      const project='viewport-props';
      if(window===top)window.qa={posts:[]};
      const shell=mode==='shell'&&isShell(project);
      const h=React.createElement;
      function Button({variant,pill,children}){
        return h('button',{type:'button',className:'fixture-button','data-variant':variant,'data-pill':String(pill)},children);
      }
      // A registered component beside it publishes the frame bridge's registries, which must not hide discovered ones.
      const tag={id:'Tag',name:'Tag',source:'fixture/tag.tsx',line:1,props:[{name:'label',kind:'string',required:true,typeLabel:'string'}]};
      function Tag(){
        const[props,setProps]=React.useState({label:'Example tag'});
        const inspect=useKomoInspectable({component:tag,props,onChange:next=>setProps(current=>({...current,...next})),enabled:true});
        return h('span',{ref:inspect.ref,'data-komo-inspectable':inspect['data-komo-inspectable'],id:'tag'},props.label);
      }
      function App(){
        return h('section',null,h('p',{id:'copy'},'Page copy'),h(Button,{variant:'primary',pill:false},'Example button'),h(Tag));
      }
      if(!shell)createRoot(document.querySelector('main')).render(h(App));
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':'+project;
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      window.fetch=async(input,init)=>{
        const path=new URL(String(input instanceof Request?input.url:input),location.origin).pathname,method=init?.method??'GET';
        if(method==='POST'&&path.endsWith('/threads')){top.qa.posts.push(JSON.parse(init.body));return Response.json({id:'posted-thread',commentId:'posted-comment'});}
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads:[]}:{});
      };
      const schema=identity=>identity.name==='Button'?[
        {name:'variant',kind:'enum',required:true,values:['primary','secondary','ghost'],typeLabel:'"primary" | "secondary" | "ghost"'},
        {name:'pill',kind:'boolean',required:true,typeLabel:'boolean'}]:undefined;
      window.komo=initKomo({endpoint:location.origin,project,repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,pollInterval:60000,
        design:{components:discoverReactComponents({edit:true,schema})},
        ...(mode==='inplace'?{}:{frame:{mode:'iframe',shell:mode==='shell'}})});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.endsWith(".js")) {
      response.setHeader("content-type", "text/html");
      return response.end(`<!doctype html><style>body{margin:0;font:16px system-ui}main{min-height:100vh;box-sizing:border-box;padding:80px}.fixture-button{padding:12px 18px;font:inherit}</style><main></main><script type="module" src="/entry.js"></script>`);
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

type Mode = "inplace" | "viewport" | "shell";

/** Loads the fixture in `mode`; resolves to where the reviewed app renders. */
async function load(page: Page, mode: Mode): Promise<Page | Frame> {
  page.setDefaultTimeout(8000);
  await page.goto(`${origin}/?mode=${mode}`);
  await page.waitForFunction(() => !!(window as any).komo);
  if (mode === "inplace") return page;
  if (mode === "shell") page.once("dialog", (dialog) => void dialog.accept());
  await page.keyboard.press("l");
  if (mode === "shell") {
    await page.waitForURL(/komo-shell=[0-9a-f]{32}/);
    await page.waitForFunction(() => !!(window as any).komo);
  }
  await page.waitForFunction(() => {
    const root = [...document.body.children].find((node) => node.shadowRoot)?.shadowRoot;
    const frame = root?.querySelector<HTMLIFrameElement>("iframe[data-komo-viewport]");
    return !!frame?.contentDocument?.querySelector(".fixture-button") && !root!.querySelector(".frame-stage[data-loading]");
  });
  return page.frames().find((item) => item.name() === "komo-viewport")!;
}

/** The centre of `selector` on screen, inside the viewport iframe when one shows the page. */
const onScreen = (page: Page, selector: string) => page.evaluate((selector) => {
  const root = [...document.body.children].find((node) => node.shadowRoot)?.shadowRoot;
  const frame = root?.querySelector<HTMLIFrameElement>("iframe[data-komo-viewport]");
  const outer = frame?.getBoundingClientRect(), scale = frame && outer ? outer.width / frame.offsetWidth : 1;
  const inner = (frame?.contentDocument ?? document).querySelector(selector)!.getBoundingClientRect();
  return { x: (outer?.left ?? 0) + (inner.left + inner.width / 2) * scale, y: (outer?.top ?? 0) + (inner.top + inner.height / 2) * scale };
}, selector);

const expected = [
  "Props: variant=\"primary\", pill=false",
  "Component: Button",
  '- variant: "primary" → "secondary" [custom value]\n- pill: false → true [custom value]',
];
/** Posted bodies by mode; Viewport must post what In place posts. */
const bodies = new Map<string, string>();

describe.skipIf(!chrome)("Discovered React props across Frame modes", () => {
  it.each(["inplace", "viewport", "shell"] as const)("edits enum and boolean props with preview, Reset, Undo and Redo in %s", async (mode) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const app = await load(page, mode);
    const attr = (name: string) => app.locator(".fixture-button").getAttribute(`data-${name}`);
    // In two-copy Viewport the app also runs beneath the frame; that copy never changes.
    const outside = () => page.locator("main .fixture-button").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("data-variant"), node.getAttribute("data-pill")].join()));
    const untouched = mode === "viewport" ? ["primary,false"] : mode === "shell" ? [] : undefined;

    await openDesign(page);
    const button = await onScreen(page, ".fixture-button");
    await page.mouse.move(button.x, button.y);
    await page.waitForTimeout(100);
    await page.mouse.click(button.x, button.y);
    const variant = page.getByRole("combobox", { name: "Button variant", exact: true });
    await variant.waitFor();
    expect(await page.locator(".design-react-status").count()).toBe(0);
    expect(await page.locator(".design-react-group input[readonly]").count()).toBe(0);

    // Hover previews in the reviewed app; choosing commits.
    await variant.click();
    await page.locator(".komo-select").getByRole("option", { name: "ghost", exact: true }).hover();
    await expect.poll(() => attr("variant")).toBe("ghost");
    await page.locator(".komo-select").getByRole("option", { name: "secondary", exact: true }).hover();
    await expect.poll(() => attr("variant")).toBe("secondary");
    await page.locator(".komo-select").getByRole("option", { name: "secondary", exact: true }).click();
    await page.locator(".komo-select").waitFor({ state: "detached" });
    expect(await attr("variant")).toBe("secondary");
    await page.getByRole("switch", { name: "Button pill", exact: true }).click();
    await expect.poll(() => attr("pill")).toBe("true");
    if (untouched) expect(await outside()).toEqual(untouched);

    // Reset, then Undo and Redo through the keyboard.
    await page.getByRole("button", { name: "Reset Button variant", exact: true }).click();
    await expect.poll(() => attr("variant")).toBe("primary");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => attr("variant")).toBe("secondary");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => attr("pill")).toBe("false");
    expect(await attr("variant")).toBe("secondary");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
    await expect.poll(() => attr("pill")).toBe("true");
    if (untouched) expect(await outside()).toEqual(untouched);
    await page.screenshot({ path: join(shots, `${mode}.png`) });

    // The proposal carries the same before and after values in every mode.
    await page.locator(".design-inspector__bar:not(.design-token-bar)").getByRole("button", { name: "Comment", exact: true }).click();
    await page.locator(".draft-proposal").waitFor();
    if (untouched) expect(await outside()).toEqual(untouched);
    await page.getByRole("button", { name: "Post comment", exact: true }).click();
    await page.waitForFunction(() => (window as any).qa.posts.length === 1);
    const posted = await page.evaluate(() => (window as any).qa.posts[0].body as string);
    expect(posted).toMatch(/^Proposed React prop changes \(preview only\)\n/);
    for (const line of expected) expect(posted).toContain(line);
    bodies.set(mode, posted);
    if (bodies.has("inplace")) expect(posted).toBe(bodies.get("inplace"));
    if (untouched) expect(await outside()).toEqual(untouched);
    expect(errors).toEqual([]);
    await page.close();
  });
});
