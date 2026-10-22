// All-pages comments on persistent layout, in a two-page pushState SPA sharing a sidebar.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-persistent-regions-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { captureAnchor } from ${JSON.stringify(resolve("src/anchors.ts"))};
      const mode=new URLSearchParams(location.search).get('mode');
      const app=document.querySelector('#app'),aside=app.querySelector('aside'),main=app.querySelector('main');
      const render=()=>{
        const path=location.pathname;
        if(path==='/bare')aside.remove();else if(!aside.isConnected)app.prepend(aside);
        main.querySelector('h1').textContent=path==='/b'?'Reports page':path==='/bare'?'Bare page':'Overview page';
        main.querySelector('#copy').textContent=path==='/b'?'Beta copy':'Alpha copy';
      };
      const qa=window.scopeQA={writes:[],calls:[],threads:[],route(url){history.pushState({},'',url);render();dispatchEvent(new PopStateEvent('popstate'))}};
      render();
      for(const link of aside.querySelectorAll('a'))link.onclick=event=>{event.preventDefault();qa.route(link.getAttribute('href'))};
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':scope-e2e';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      const comment=(id,body)=>({id:id+'-comment',body,author:user,createdAt:1,editedAt:null,reactions:{}});
      // A record from before scopes: page-only, anchored in the sidebar.
      const nav=aside.querySelector('#nav-a'),box=nav.getBoundingClientRect(),point={x:box.left+box.width/2,y:box.top+box.height/2};
      qa.threads.push({id:'legacy',page:'/a',anchor:captureAnchor(nav,point,point),tags:[],resolved:false,resolvedBy:null,createdAt:1,updatedAt:1,comments:[comment('legacy','Legacy sidebar note')]});
      let next=0;
      window.fetch=async(input,init)=>{
        const path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url).pathname;
        const method=init?.method??'GET',body=init?.body?JSON.parse(init.body):undefined;
        if(method!=='GET')qa.writes.push({method,path,body});
        if(method==='POST'&&path==='/threads'){
          if(Object.keys(body).some(field=>!['body','page','anchor','tags','scope'].includes(field)))return Response.json({error:'Unexpected request fields.'},{status:400});
          const id='t'+(++next),now=Date.now();
          qa.threads.push({id,page:body.page,anchor:body.anchor,tags:body.tags??[],...(body.scope==='all'?{scope:'all'}:{}),resolved:false,resolvedBy:null,createdAt:now,updatedAt:now,comments:[{...comment(id,body.body),createdAt:now}]});
          return Response.json({id,commentId:id+'-comment'},{status:201});
        }
        if(method==='PATCH'&&path.startsWith('/threads/')){
          const thread=qa.threads.find(item=>item.id===path.split('/')[2]);
          if('scope' in body){if(body.scope==='all')thread.scope='all';else delete thread.scope;thread.updatedAt=Date.now();return Response.json({ok:true,scope:body.scope})}
          return Response.json({ok:true});
        }
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path==='/threads'?{threads:structuredClone(qa.threads)}:{});
      };
      window.komo=initKomo({endpoint:location.origin,project:'scope-e2e',repo:'example/review',branch:'fixture',pageRoot:app,
        sidebar:mode==='floating'?'edge':'background',frame:{scale:mode==='scaled'},restoreOpen:false,pollInterval:60000,
        persistentRegions:['[data-sidebar]'],navigate:url=>{qa.calls.push(url.pathname+url.search);qa.route(url.pathname+url.search+url.hash)}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.endsWith(".js")) {
      response.setHeader("content-type", "text/html");
      response.end(`<style>html,body{overscroll-behavior:none}body{margin:0;font:15px system-ui;color:#1d2939}#app{display:flex;min-height:100vh}aside{box-sizing:border-box;width:240px;padding:32px 20px;display:flex;flex-direction:column;gap:12px;background:#f2f4f7}aside a,aside button{display:block;padding:10px 12px;font:inherit;text-align:left;border:1px solid #d0d5dd;border-radius:8px;background:#fff;color:inherit;text-decoration:none}main{flex:1;padding:64px}#copy{padding:24px;max-width:360px;background:#f9fafb}</style><div id="app"><aside data-sidebar><a href="/a" id="nav-a">Overview</a><a href="/b" id="nav-b">Reports</a><button type="button" id="search">Search projects</button></aside><main><h1></h1><p id="copy"></p></main></div><script type="module" src="/entry.js"></script>`);
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

const qa = (page: Page) => page.evaluate(() => {
  const state = (window as any).scopeQA;
  return { calls: [...state.calls] as string[], writes: structuredClone(state.writes) as { method: string; path: string; body: Record<string, unknown> }[], path: location.pathname };
});
const blur = (page: Page) => page.evaluate(() => (document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement as HTMLElement | null)?.blur());
const route = (page: Page, path: string) => page.evaluate((path) => (window as any).scopeQA.route(path), path);
const card = (page: Page, id: string) => page.locator(`.list .thread-item[data-thread="${id}"]`);
const pin = (page: Page, id: string) => page.locator(`.pin[data-thread="${id}"]`);
async function comment(page: Page, selector: string, text: string) {
  const posted = async () => (await qa(page)).writes.filter((write) => write.method === "POST").length;
  const before = await posted();
  await blur(page);
  if (await page.locator(".catch").isHidden()) await page.keyboard.press("c");
  const box = (await page.locator(selector).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const input = page.getByRole("textbox", { name: "Comment", exact: true });
  await input.fill(text);
  await input.press("Enter");
  await expect.poll(posted).toBe(before + 1);
  await pin(page, `t${before + 1}`).waitFor();
  await input.waitFor({ state: "detached" });
}
async function openList(page: Page) {
  await blur(page);
  if (!(await page.locator(".list").isVisible())) await page.keyboard.press("l");
  await page.locator(".list").waitFor();
}
async function pagesFilter(page: Page, label: "This page" | "All pages") {
  // A confirmation toast can cover the header; the page filter sits in the sidebar search.
  await page.locator(".toast").waitFor({ state: "hidden", timeout: 10000 });
  const search = page.getByRole("button", { name: "Search comments", exact: true });
  if (await page.locator(".scope-slot[inert]").count()) await search.click();
  await page.locator(".scope-slot summary").click();
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
  await expect.poll(() => page.locator(".scope-slot .selection-label").textContent()).toBe(label);
}
async function scopeAction(page: Page, label: string) {
  await page.locator('.dialog-head summary[aria-label="Comment actions"]').click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("persistent layout comments in %s", (mode) => {
  it("follows the shared sidebar to every page, toggles both ways, and navigates only when needed", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/a?mode=${mode}`);
    await pin(page, "legacy").waitFor();

    // A comment inside the sidebar is stored for all pages; one in the page body is not.
    await comment(page, "#search", "Search needs a shortcut hint");
    await comment(page, "#copy", "Tighten the overview copy");
    await expect.poll(async () => (await qa(page)).writes.filter((write) => write.method === "POST").length).toBe(2);
    const posts = (await qa(page)).writes.filter((write) => write.method === "POST").map((write) => write.body);
    expect(posts.map(({ page, scope }) => ({ page, scope }))).toEqual([{ page: "/a", scope: "all" }, { page: "/a", scope: undefined }]);
    await pin(page, "t1").waitFor();
    await pin(page, "t2").waitFor();
    await blur(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press("v");

    // Page B shares the sidebar: only the all-pages comment shows, over the same control.
    await route(page, "/b");
    await page.locator("h1", { hasText: "Reports page" }).waitFor();
    await pin(page, "t1").waitFor();
    await expect.poll(() => pin(page, "t2").count()).toBe(0);
    expect(await pin(page, "legacy").count()).toBe(0);
    const search = (await page.locator("#search").boundingBox())!;
    const shown = (await pin(page, "t1").boundingBox())!;
    expect(Math.abs(shown.x - (search.x + search.width / 2))).toBeLessThan(60);
    expect(Math.abs(shown.y - (search.y + search.height / 2))).toBeLessThan(60);
    await page.screenshot({ path: join(tmpdir(), `komo-persistent-${mode}-page-b.png`) });

    // Each thread is listed once; the all-pages one is labelled and never "not found".
    await openList(page);
    expect(await page.locator(".list .thread-item").count()).toBe(3);
    expect(await card(page, "t1").locator(".card-page-row .page").textContent()).toBe("All pages");
    expect(await card(page, "t1").locator(".card-page-row").isVisible()).toBe(true);
    expect(await card(page, "t1").locator(".card-page-url").textContent()).toBe(`${origin}/a`);
    expect(await card(page, "t1").locator(".card-status").isHidden()).toBe(true);
    expect(await card(page, "t2").locator(".card-page-row .page").textContent()).toBe("a");
    await pagesFilter(page, "This page");
    await expect.poll(() => page.locator(".list .thread-item").count()).toBe(1);
    expect(await card(page, "t1").count()).toBe(1);
    await pagesFilter(page, "All pages");
    await expect.poll(() => page.locator(".list .thread-item").count()).toBe(3);
    await page.screenshot({ path: join(tmpdir(), `komo-persistent-${mode}-list.png`) });

    // Where its anchor exists it opens in place, without the host router.
    await card(page, "t1").locator(".thread-card").click();
    await page.locator(".thread-title", { hasText: "Search needs a shortcut hint" }).waitFor();
    expect(await page.locator(".thread-navigation").count()).toBe(0);
    expect((await qa(page)).calls).toEqual([]);
    expect((await qa(page)).path).toBe("/b");

    // Only on its own page: it leaves page B.
    await scopeAction(page, "Only on its own page");
    await expect.poll(async () => (await qa(page)).writes.filter((write) => write.method === "PATCH").map((write) => write.body)).toEqual([{ scope: "page" }]);
    await expect.poll(() => pin(page, "t1").count()).toBe(0);
    await blur(page);
    await page.keyboard.press("Escape");
    await openList(page);
    await expect.poll(() => card(page, "t1").locator(".card-page-row .page").textContent()).toBe("a");

    // Elsewhere, opening it navigates to the page it was made on.
    await card(page, "t1").locator(".thread-card").click();
    await expect.poll(async () => (await qa(page)).path).toBe("/a");
    expect((await qa(page)).calls).toEqual(["/a?comment=t1"]);
    await page.locator(".thread-title", { hasText: "Search needs a shortcut hint" }).waitFor();
    await pin(page, "t1").waitFor();

    // Show on all pages again, from its own page.
    await scopeAction(page, "Show on all pages");
    await expect.poll(async () => (await qa(page)).writes.filter((write) => write.method === "PATCH").map((write) => write.body)).toEqual([{ scope: "page" }, { scope: "all" }]);
    await page.locator('.dialog-head summary[aria-label="Comment actions"]').click();
    await page.getByRole("menuitem", { name: "Only on this page", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await blur(page);
    await page.keyboard.press("Escape");

    // A page without the sidebar simply omits it: no pin and no "Not found on page".
    await route(page, "/bare");
    await page.locator("h1", { hasText: "Bare page" }).waitFor();
    await expect.poll(() => pin(page, "t1").count()).toBe(0);
    await openList(page);
    expect(await card(page, "t1").locator(".card-status").isHidden()).toBe(true);
    expect(await card(page, "t1").locator(".card-page-row .page").textContent()).toBe("All pages");
    await pagesFilter(page, "This page");
    await expect.poll(() => page.locator(".list .thread-item").count()).toBe(0);
    await pagesFilter(page, "All pages");

    await route(page, "/b");
    await pin(page, "t1").waitFor();
    expect(await pin(page, "t2").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.evaluate(() => (window as any).komo.destroy());
    await page.close();
  }, 60000);
});
