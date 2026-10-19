import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-router-preview-"));
  await build({
    stdin: { contents: `
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      const query=new URLSearchParams(location.search),scenario=query.get('scenario'),mode=query.get('mode');
      const main=document.querySelector('main'),content=main.querySelector('article');
      const qa=window.navigationQA={calls:[],writes:[],actions:0,main,document,pending:[]};
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{qa.copied=value}}});
      const target=()=>{content.innerHTML='<h1>Neutral router fixture</h1><button id="target" style="color:rgb(68,85,102)">Unrelated page element</button>';content.querySelector('button').onclick=()=>qa.actions++};
      qa.render=target;
      target();
      const route=(url,missing=false)=>{history.pushState({router:true},'',url);if(missing)content.replaceChildren();else target();window.dispatchEvent(new PopStateEvent('popstate'))};
      qa.finish=index=>{const item=qa.pending[index];if(item){route(item.url);item.resolve()}};
      main.querySelector('[data-action=first]').onclick=()=>qa.finish(0);
      main.querySelector('[data-action=second]').onclick=()=>qa.finish(1);
      main.querySelector('[data-action=redirect]').onclick=()=>route('/fallback');
      const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
      const anchor={selector:'#target',text:'',x:.5,y:.5,width:0,height:0,pageX:0,pageY:0,viewportWidth:1280};
      const thread=(id,page,body)=>({id,page,anchor,resolved:false,resolvedBy:null,createdAt:Date.now(),updatedAt:Date.now(),comments:[{id:id+'-comment',body,author:user,createdAt:Date.now(),editedAt:null,reactions:{}}]});
      const threads=[thread('away','/destination','Destination conversation'),thread('second','/second','Second conversation'),thread('design-away','/destination','Proposed style changes (preview only)\\nTarget: #target\\n- color: rgb(68, 85, 102) → #ef3340')];
      const key='branch-comments:'+location.origin+':router-preview';
      localStorage.setItem(key,'synthetic-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
      localStorage.setItem(key+':'+JSON.stringify(['example/review','local'])+':threads',JSON.stringify({token:'synthetic-session',threads}));
      window.fetch=async(input,init)=>{const path=new URL(input instanceof Request?input.url:String(input)).pathname;const method=init?.method??(input instanceof Request?input.method:'GET');if(method!=='GET'){qa.writes.push(method);throw Error('Unexpected fixture write')}return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads}:{});};
      window.komo=initKomo({endpoint:location.origin,project:'router-preview',repo:'example/review',branch:'fixture',pageRoot:main,sidebar:mode==='floating'?'edge':'background',frame:{scale:mode==='scaled'},restoreOpen:false,navigate:async url=>{
        qa.calls.push(url.href);
        if(scenario==='reject')throw Error('Synthetic guard rejected navigation');
        if(scenario==='pending')return new Promise(resolve=>qa.pending.push({url,resolve}));
        if(scenario==='redirect'){route(url);await new Promise(resolve=>setTimeout(resolve,30));route('/fallback');return}
        if(scenario==='canonical'){route(url.pathname+'/'+url.search+url.hash);return}
        route(url,scenario==='missing');
        if(scenario==='late')setTimeout(()=>route('/fallback'),150);
      }});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.endsWith(".js")) {
      response.setHeader("content-type", "text/html");
      response.end('<style>body{margin:0;font:16px system-ui}main{min-height:100vh;box-sizing:border-box;padding:64px}nav{display:flex;gap:8px}nav button{padding:8px}article{padding-top:24px}#target{padding:16px}</style><main><nav><button data-action="first">Finish first navigation</button><button data-action="second">Finish second navigation</button><button data-action="redirect">Redirect now</button></nav><article></article></main><script type="module" src="/entry.js"></script>');
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

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("native retained router thread in %s", mode => {
  it.each(["reject", "redirect", "canonical", "late", "missing"])("keeps the final conversation visible after %s", async scenario => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(scenario === "missing" ? 6500 : 5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?mode=${mode}&scenario=${scenario}`);
    await page.keyboard.press("l");
    await page.locator(".thread-card").filter({ hasText: "Destination conversation" }).click();
    await page.locator(".thread-title").filter({ hasText: "Destination conversation" }).waitFor();
    if (scenario !== "canonical" && scenario !== "missing") {
      await page.locator(".thread-navigation:not(.thread-anchor-status)").waitFor();
      const link = page.getByRole("link", { name: `Open destination: ${origin}/destination`, exact: true });
      expect(await link.getAttribute("href")).toBe(`${origin}/destination`);
      await link.focus();
      expect(await link.getAttribute("title")).toBe(`${origin}/destination`);
      if (scenario === "reject") {
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => (window as any).navigationQA.calls.length === 2);
        await page.locator('.dialog-head summary[aria-label="Comment actions"]').click();
        await page.getByRole("menuitem", { name: "Copy link", exact: true }).click();
        expect(await page.evaluate(() => (window as any).navigationQA.copied)).toBe(`${origin}/destination?comment=away`);
      }
    } else if (scenario === "missing") {
      expect(await page.locator(".thread-anchor-status").textContent()).toContain("could not be found on this page");
      expect(await page.locator(".thread-destination").count()).toBe(0);
      expect(await page.locator("#target").count()).toBe(0);
      await page.evaluate(() => (window as any).navigationQA.render());
      await page.waitForFunction(() => [...document.body.children].find(node => node.shadowRoot)?.shadowRoot?.querySelector<HTMLElement>(".thread-anchor-status")?.hidden);
    } else {
      expect(await page.locator(".thread-navigation").count()).toBe(0);
      expect(new URL(page.url()).pathname).toBe("/destination/");
    }
    await page.waitForTimeout(200);
    expect(await page.locator(".thread-title").textContent()).toBe("Destination conversation");
    expect(await page.evaluate(() => {
      const qa = (window as any).navigationQA;
      return { sameDocument: document === qa.document, sameRoot: document.querySelector("main") === qa.main, calls: qa.calls.length, actions: qa.actions, writes: qa.writes };
    })).toEqual({ sameDocument: true, sameRoot: true, calls: scenario === "reject" ? 2 : 1, actions: 0, writes: [] });
    if (scenario !== "missing") expect(await page.locator("#target").getAttribute("style")).toBe("color:rgb(68,85,102)");
    expect(errors).toEqual([]);
    await page.evaluate(() => (window as any).komo.destroy());
    await page.close();
  });

  it("keeps a newer selection and explicit dismissal ahead of stale router promises", async () => {
    for (const cancel of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      page.setDefaultTimeout(5000);
      await page.goto(`${origin}/?mode=${mode}&scenario=pending`);
      await page.keyboard.press("l");
      await page.locator(".thread-card").filter({ hasText: "Destination conversation" }).click();
      if (cancel) await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
      else {
        await page.locator(".thread-card").filter({ hasText: "Second conversation" }).click();
        await page.getByRole("button", { name: "Finish second navigation", exact: true }).click();
        await page.locator(".thread-title").filter({ hasText: "Second conversation" }).waitFor();
        await page.getByRole("textbox", { name: "Reply", exact: true }).fill("Unsent synthetic reply");
      }
      // The obsolete host router settles independently of a new outside-pointer dismissal.
      await page.evaluate(() => (window as any).navigationQA.finish(0));
      await page.waitForTimeout(250);
      if (cancel) expect(await page.locator(".thread-title").count()).toBe(0);
      else {
        expect(await page.locator(".thread-title").textContent()).toBe("Second conversation");
        expect(await page.getByRole("textbox", { name: "Reply", exact: true }).inputValue()).toBe("Unsent synthetic reply");
        expect(await page.locator(".thread-navigation").textContent()).toContain("different page");
      }
      expect(await page.evaluate(() => ({ calls: (window as any).navigationQA.calls.length, writes: (window as any).navigationQA.writes }))).toEqual({ calls: cancel ? 1 : 2, writes: [] });
      await page.evaluate(() => (window as any).komo.destroy());
      await page.close();
    }
  });

  it("does not preview a matching selector from an unreachable page", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(5000);
    await page.goto(`${origin}/fallback?mode=${mode}&scenario=redirect&comment=design-away&comment-view=design`);
    await page.locator(".thread-navigation").waitFor();
    expect(await page.locator('.design-inspector[aria-hidden="false"]').count()).toBe(0);
    await page.getByRole("button", { name: "After", exact: true }).click();
    expect(await page.getByRole("button", { name: "Before", exact: true }).getAttribute("aria-pressed")).toBe("true");
    expect(await page.locator("#target").getAttribute("style")).toBe("color:rgb(68,85,102)");
    expect(await page.evaluate(() => ({ calls: (window as any).navigationQA.calls.length, actions: (window as any).navigationQA.actions, writes: (window as any).navigationQA.writes }))).toEqual({ calls: 0, actions: 0, writes: [] });
    await page.evaluate(() => (window as any).komo.destroy());
    await page.close();
  });
});
