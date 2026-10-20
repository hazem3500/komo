import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
const user={id:'fixture',name:'Alex Morgan',verified:true};
const anchor={selector:'#target',text:'',x:.5,y:.5,width:0,height:0,pageX:0,pageY:0,viewportWidth:1280};
const comment=(id,body,name='Alex Morgan')=>({id,body,author:{...user,name},createdAt:Date.now()-600000,editedAt:null,reactions:{}});
const thread=(id,page,body,replies=[],tags=[])=>({id,page,anchor,resolved:false,resolvedBy:null,createdAt:Date.now(),updatedAt:Date.now(),tags,comments:[comment(id,body),...replies]});
const threads=[thread('one','/reports/123/summary','The summary needs a little more context. Could we show which period these figures cover?',[comment('reply','Agreed. A date range beside the heading would help.','Sam Lee')],['content','review']),thread('many','/','@Alex the longer explanation should wrap naturally.\\nKeep the description together with the relevant actions.',[comment('r2','This is a second point with a longer explanation that wraps across several lines.','Sam Lee'),comment('r3','Thanks, that makes sense.','Taylor Reed')],['accessibility','a-long-tag-that-still-needs-to-wrap-without-overflow']),thread('zero','/','The empty state is clear and easy to read.')];
window.qa={writes:[],navigation:[],threads};
const key='branch-comments:'+location.origin+':neutral-conversation';
localStorage.setItem(key,'synthetic-session');
localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>window.qa.copied=value}});
window.fetch=async(input,init)=>{const method=init?.method||'GET',path=new URL(String(input),location.origin).pathname;
if(method!=='GET') { const body=JSON.parse(init.body);window.qa.writes.push({method,path,body});const t=threads.find(t=>path.includes('/threads/'+t.id));if(method==='PATCH')Object.assign(t,body);if(method==='POST'&&path.endsWith('/comments'))t.comments.push(comment('saved',body.body));return Response.json({id:'saved'}); }
return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads}:{});};
window.komo=initKomo({endpoint:location.origin,project:'neutral-conversation',repo:'example/fixture',branch:'local',restoreOpen:false,sidebar:new URLSearchParams(location.search).get('mode')==='frame'?'background':'edge',pageRoot:document.querySelector('main'),pageLabel:new URLSearchParams(location.search).has('fallback')?undefined:url=>{const mode=new URLSearchParams(location.search).get('label');if(mode==='throw')throw Error('fixture');if(mode==='reject')return Promise.reject(Error('fixture'));if(mode==='empty')return ' ';if(mode==='undefined')return undefined;if(mode==='malicious')return '<img src=x onerror=alert(1)>';return url.pathname==='/reports/123/summary'&&new URLSearchParams(location.search).has('deferred')?new Promise(resolve=>window.qa.resolveLabel=resolve):url.pathname==='/reports/123/summary'?'Reports › Summary':undefined;},navigate:url=>{window.qa.navigation.push(url.href);if(new URLSearchParams(location.search).has('slow'))return new Promise(resolve=>window.qa.finishRoute=()=>{history.pushState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'));resolve()});history.pushState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'));}});
window.komo.open();
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.endsWith(".js")) {
      response.setHeader("content-type", "text/html");
      response.end('<style>body{margin:0;font:16px system-ui}main{min-height:100vh;box-sizing:border-box;padding:64px}nav{display:flex;gap:8px}nav button{padding:8px}article{padding-top:24px}#target{padding:16px}</style><main><h1>Reports</h1><article><button id="target">Summary for October</button></article></main><script type="module" src="/entry.js"></script>');
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


describe.skipIf(!chrome)("conversation polling", () => {
  it("keeps the composing input connected while incoming content updates", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    try {
      await page.goto(origin);
      await page.getByRole("button", { name: "Show 1 reply", exact: true }).click();
      const input = page.locator('.thread-item[data-thread="one"] textarea');
      await input.fill("Valid pathname polling draft");
      await input.evaluate((e: HTMLTextAreaElement) => {
        const w = window as any;
        w.qa.input = e; w.qa.form = e.parentElement; w.qa.blurs = 0;
        const list = e.closest('.list')!;
        list.scrollTop = 35;
        w.qa.scroll = list.scrollTop;
        e.addEventListener("blur", () => w.qa.blurs++);
        e.setSelectionRange(3, 8, "backward");
        e.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        w.qa.threads[1].comments[0].body = "Incoming other thread update";
        w.qa.threads[0].comments.push({...w.qa.threads[0].comments[1], id: "incoming", body: "Incoming reply"});
        w.qa.threads[0].tags = ["new-tag"];
        w.qa.threads.forEach((t: any) => t.updatedAt++);
        w.komo.refresh();
      });
      await page.getByText("Incoming other thread update", {exact:true}).waitFor();
      await page.getByText("Incoming reply", {exact:true}).waitFor();
      expect(await input.evaluate((e: HTMLTextAreaElement) => ({same:e===(window as any).qa.input,form:e.parentElement===(window as any).qa.form,focused:(e.getRootNode() as ShadowRoot).activeElement===e,blurs:(window as any).qa.blurs,value:e.value,start:e.selectionStart,end:e.selectionEnd,direction:e.selectionDirection}))).toEqual({same:true,form:true,focused:true,blurs:0,value:"Valid pathname polling draft",start:3,end:8,direction:"backward"});
      expect(await input.evaluate(e => e.closest('.list')!.scrollTop === (window as any).qa.scroll)).toBe(true);
      await input.press("Escape");
      expect(await page.locator('.thread-item[data-thread="one"]').getByRole("button", {name:"Show 2 replies",exact:true}).getAttribute("aria-expanded")).toBe("false");
    } finally { await page.close(); }
  });
  it.each(["fallback=1", "label=throw", "label=reject", "label=empty", "label=undefined"])("gives readable context for %s", async query => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + "/?" + query);
      await expect.poll(() => page.locator('.thread-item[data-thread="one"] .page').textContent()).toBe("reports › 123 › summary");
    } finally { await page.close(); }
  });
});

it.skipIf(!chrome)("native actions, drafts, exact links and visual conversation states", async () => {
  const page = await browser.newPage({viewport:{width:1280,height:900},reducedMotion:"reduce"});
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(origin);
    const one = page.locator('.thread-item[data-thread="one"]');
    const many = page.locator('.thread-item[data-thread="many"]');
    const zero = page.locator('.thread-item[data-thread="zero"]');
    await one.locator('.card-reply-toggle').click();
    await many.locator('.card-reply-toggle').click();
    await zero.locator('.card-reply-toggle').click();
    await one.getByRole("button", {name:"Copy page URL"}).click();
    expect(await page.evaluate(() => (window as any).qa.copied)).toBe(origin + "/reports/123/summary");
    expect(await page.evaluate(() => (window as any).qa.navigation)).toEqual([]);
    await page.keyboard.press('Shift+Tab');
    expect(await one.locator('.card-page-url').isVisible()).toBe(true);
    await page.keyboard.press("Tab");
    expect(await one.locator('.card-page-copy').evaluate(e => (e.getRootNode() as ShadowRoot).activeElement === e)).toBe(true);
    const draft = 'A long draft with @Alex and 123.\n'.repeat(9);
    await many.locator('textarea').fill(draft);
    await many.locator('.thread-card').click();
    await page.locator('.dialog textarea').fill(draft + 'Full thread edit');
    if (process.env.KOMO_CONVERSATION_EVIDENCE) await page.screenshot({path:join(process.env.KOMO_CONVERSATION_EVIDENCE,'selected.png')});
    await page.locator('summary[aria-label="Comment actions"]').click();
    await page.getByRole('menuitem',{name:'Open in Design',exact:true}).click();
    await page.getByRole('button',{name:'Back to comment',exact:true}).click();
    await expect.poll(() => page.locator('.dialog textarea').inputValue()).toBe(draft + 'Full thread edit');
    await page.locator('.thread-back').click();
    await expect.poll(() => many.locator('textarea').inputValue()).toBe(draft + 'Full thread edit');
    await page.getByRole('button',{name:'Close sidebar',exact:true}).click();
    await page.keyboard.press('l');
    await expect.poll(() => many.locator('textarea').inputValue()).toBe(draft + 'Full thread edit');
    await many.locator('textarea').fill('Native submitted reply');
    await many.locator('textarea').press('Enter');
    await expect.poll(() => many.locator('textarea').inputValue()).toBe('');
    await many.getByText('Native submitted reply',{exact:true}).waitFor();
    expect(await page.evaluate(() => (window as any).qa.writes.some((w:any) => w.method==='POST' && w.body.body==='Native submitted reply'))).toBe(true);
    await many.locator('textarea').fill('Draft across resolve');
    await many.getByRole('button',{name:'Resolve comment',exact:true}).click();
    await page.locator('.filter-slot summary').click();
    await page.getByRole('menuitemradio',{name:'Resolved',exact:true}).click();
    await many.getByText('Resolved',{exact:true}).waitFor();
    if (process.env.KOMO_CONVERSATION_EVIDENCE) { await page.locator('.list').evaluate(e => e.scrollTop=0); await page.screenshot({path:join(process.env.KOMO_CONVERSATION_EVIDENCE,'resolved.png')}); }
    await many.getByRole('button',{name:'Reopen comment',exact:true}).click();
    await page.locator('.filter-slot summary').click();
    await page.getByRole('menuitemradio',{name:'Comments',exact:true}).click();
    await expect.poll(() => many.locator('textarea').inputValue()).toBe('Draft across resolve');
    expect(await page.locator('button button,button a,a button').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.skipIf(!chrome).each(['floating-light','floating-dark','frame-light','frame-dark','floating-narrow','frame-narrow'])("renders full initKomo conversation states: %s", async variant => {
  const narrow = variant.endsWith('narrow');
  const page = await browser.newPage({viewport:{width:narrow?1000:1280,height:1000},colorScheme:variant.endsWith('dark')?'dark':'light',reducedMotion:'reduce'});
  try {
    await page.goto(origin + '/?fallback=1&mode=' + (variant.startsWith('frame')?'frame':'floating'));
    if (narrow && variant.startsWith('floating')) {
      const box = (await page.locator('.edge-sidebar-resize-w').boundingBox())!;
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
      await page.mouse.down(); await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2); await page.mouse.up();
    }
    for (const id of ['zero','one','many']) await page.locator(`.thread-item[data-thread="${id}"] .card-reply-toggle`).click();
    await page.locator('.thread-item[data-thread="many"] textarea').fill('A long unsent draft with @Alex and 123.\n'.repeat(9));
    expect(await page.locator('.thread-item').evaluateAll(nodes => nodes.some(n => n.scrollWidth > n.clientWidth+1))).toBe(false);
    const out = process.env.KOMO_CONVERSATION_EVIDENCE;
    if (out) {
      await mkdir(out,{recursive:true});
      await page.mouse.move(100,100);
      await page.locator('.list').evaluate(e => e.scrollTop=0);
      await page.screenshot({path:join(out,variant+'.png')});
      await page.locator('.thread-item[data-thread="zero"]').scrollIntoViewIfNeeded();
      await page.screenshot({path:join(out,variant+'-zero.png')});
    }
  } finally { await page.close(); }
});

it.skipIf(!chrome)("late labels and navigation respect live focus and explicit Close", async () => {
  const page = await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  page.setDefaultTimeout(5000);
  try {
    await page.goto(origin+'/?deferred=1&slow=1#current-context');
    const one = page.locator('.thread-item[data-thread="one"]');
    await one.locator('.card-reply-toggle').click();
    await one.locator('textarea').fill('Draft through delayed navigation');
    await one.locator('textarea').evaluate((e: HTMLTextAreaElement) => { (window as any).qa.input=e;e.setSelectionRange(3,8,'backward'); });
    await page.evaluate(() => (window as any).qa.resolveLabel('<img src=x onerror=alert(1)>'));
    await expect.poll(() => one.locator('.page').textContent()).toBe('<img src=x onerror=alert(1)>');
    expect(await one.locator('.page > *').count()).toBe(0);
    expect(await one.locator('textarea').evaluate(e => e===(window as any).qa.input && (e.getRootNode() as ShadowRoot).activeElement===e)).toBe(true);
    await one.locator('.thread-card').click();
    await page.getByRole('button',{name:'Close sidebar',exact:true}).click();
    await page.evaluate(() => (window as any).qa.finishRoute());
    await expect.poll(() => page.url()).toBe(origin+'/reports/123/summary');
    expect(await page.locator('.dialog').isVisible()).toBe(false);
    await page.keyboard.press('l');
    await expect.poll(() => one.locator('textarea').inputValue()).toBe('Draft through delayed navigation');
  } finally { await page.close(); }
});
