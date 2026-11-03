// Before/After for a structural move in Frame's Viewport mode (single-copy shell and the plain
// same-origin iframe) and In place: the composer's card and the posted card show the move in the
// page's own document, by click and by B, ← and → from the composer's note, and keep its stand-in
// through the framed app's React commits. Synthetic loopback fixture only.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = join(tmpdir(), "komo-shots", "viewport-move-compare");
let directory: string, origin: string;
let server: Server, browser: Browser;

const html = `<!doctype html><html><head><style>body{margin:0;font:14px system-ui;color:#0f172a}
main{min-height:100vh;padding:40px;box-sizing:border-box}.toolbar{display:flex;gap:8px;padding:8px;background:#ede9fe;border-radius:8px}
.toolbar button{padding:8px 14px;font:inherit;border:0;border-radius:6px;background:#7c3aed;color:#fff}</style></head>
<body><main id="root"></main><script type="module" src="/entry.js"></script></body></html>`;

type Mode = "shell" | "viewport" | "inplace";

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-viewport-move-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      import {isShell} from ${JSON.stringify(resolve("src/shell.ts"))};
      const h=React.createElement;
      const params=new URLSearchParams(location.search);
      const project='viewport-move';
      const shell=params.has('shell')&&isShell(project,{timeout:1500});
      window.qa={};
      // Headless-UI style wrappers: the components the adapter names are anonymous primitives.
      function App(){
        const[count,setCount]=React.useState(0);
        const[generation,setGeneration]=React.useState(0);
        React.useEffect(()=>{Object.assign(window.qa,{bump:()=>setCount(v=>v+1),remount:()=>setGeneration(v=>v+1)});},[]);
        return h(React.Fragment,null,
          h('div',{key:generation,id:'toolbar',className:'toolbar',role:'toolbar','aria-label':'Actions','data-c':'Primitive.div'},
            // A commit that rewrites the moved button's display brings the original back unless komo re-hides it.
            h('button',{id:'new',type:'button','data-c':'Slot',style:{display:count%2?'inline-block':'inline-flex'}},'New goal'),
            h('button',{id:'edit',type:'button','data-c':'Slot'},'Edit'),
            h('button',{id:'share',type:'button','data-c':'Slot'},'Share')),
          h('p',{id:'count'},'Renders '+count));
      }
      if(!shell)createRoot(document.getElementById('root')).render(h(App));
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':'+project;
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      const stored=()=>JSON.parse(sessionStorage.getItem('qa-threads')||'[]');
      window.fetch=async(input,init)=>{
        const method=init?.method||'GET',path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url,location.origin).pathname;
        if(method==='POST'&&path.endsWith('/threads')){
          const body=JSON.parse(init.body),threads=stored(),id='thread-'+(threads.length+1);
          threads.push({id,page:body.page,anchor:body.anchor,resolved:false,resolvedBy:null,createdAt:Date.now(),updatedAt:Date.now(),tags:[],comments:[{id:id+'-comment',author:user,body:body.body,createdAt:Date.now(),editedAt:null,reactions:{}}]});
          sessionStorage.setItem('qa-threads',JSON.stringify(threads));
          return Response.json({id,commentId:id+'-comment'});
        }
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads:stored()}:{});
      };
      const components={identify(element){const host=element.closest('[data-c]');return host?{name:host.dataset.c,element:host}:null;}};
      window.komo=initKomo({endpoint:location.origin,project,repo:'example/review',branch:'fixture',pageRoot:document.getElementById('root'),sidebar:'background',restoreOpen:false,pollInterval:60000,
        design:{experimentalGeometry:true,components},
        frame:{mode:'iframe',shell:params.has('shell'),...(params.has('inplace')?{defaultMode:'transform'}:{})}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.endsWith(".js")) {
      response.setHeader("content-type", "text/html");
      return response.end(html);
    }
    try {
      const file = resolve(directory, `.${url.pathname}`);
      if (!file.startsWith(directory + "/")) throw new Error("outside fixture");
      response.setHeader("content-type", "text/javascript");
      response.end(await readFile(file));
    } catch { response.statusCode = 404; response.end(); }
  }).listen(0);
  origin = `http://localhost:${(server.address() as { port: number }).port}`;
  // Never let Chrome start the system colour sampler.
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-blink-features=EyeDropperAPI"] });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

/** Opens Frame in `mode` at Fit and returns where the app runs: the viewport iframe, or this page. */
async function open(mode: Mode) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && /removeChild|insertBefore|not a child/i.test(message.text())) errors.push(message.text()); });
  page.on("dialog", (dialog) => void dialog.accept());
  page.setDefaultTimeout(8000);
  await page.goto(`${origin}/?${mode}`);
  await page.waitForFunction(() => !!(window as any).komo);
  await page.keyboard.press("l");
  if (mode === "shell") {
    await page.waitForURL(/komo-shell=[0-9a-f]{32}/);
    await page.waitForFunction(() => !!(window as any).komo);
  }
  await page.locator(".frame-bar").waitFor();
  let app: Frame = page.mainFrame();
  if (mode !== "inplace") {
    await page.waitForFunction(() => {
      const root = [...document.body.children].find((node) => node.shadowRoot)?.shadowRoot;
      const frame = root?.querySelector<HTMLIFrameElement>("iframe[data-komo-viewport]");
      return !!frame?.contentDocument?.getElementById("new") && !root!.querySelector(".frame-stage[data-loading]");
    });
    app = page.frames().find((item) => item.name() === "komo-viewport")!;
  } else await page.locator("#new").waitFor();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.waitForTimeout(200);
  return { page, app, errors };
}

/** The toolbar as the page shows it: visible children by text, the stand-in marked with *. */
const order = (app: Frame) => app.evaluate(() => [...document.getElementById("toolbar")!.children]
  .filter((node) => getComputedStyle(node).display !== "none")
  .map((node) => `${node.textContent}${node.hasAttribute("data-komo-move-clone") ? "*" : ""}`));
/** Card labels whose text is cut off: wider or taller than their box. */
const clipped = (card: ReturnType<Page["locator"]>) => card.locator(".design-card-title, .design-card-target").evaluateAll((nodes) =>
  nodes.filter((node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1).map((node) => node.textContent));
const BEFORE = ["New goal", "Edit", "Share"], AFTER = ["Edit", "New goal*", "Share"];

/** An element's box on screen, through the viewport iframe's offset and scale. */
const onScreen = (page: Page, id: string) => page.evaluate((id) => {
  const root = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
  const frame = root.querySelector<HTMLIFrameElement>("iframe[data-komo-viewport]");
  const outer = frame?.getBoundingClientRect(), scale = frame ? outer!.width / frame.offsetWidth : 1;
  const inner = (frame?.contentDocument ?? document).getElementById(id)!.getBoundingClientRect();
  return { x: (outer?.left ?? 0) + inner.left * scale, y: (outer?.top ?? 0) + inner.top * scale, width: inner.width * scale, height: inner.height * scale };
}, id);

/** Picks the first button in Design mode and moves it one place later with Alt+→. */
async function move(page: Page, app: Frame) {
  await openDesign(page);
  const box = await onScreen(page, "new");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => page.locator(".design-inspector__target").textContent()).toMatch(/#new$/);
  await page.locator(".design-geometry__frame").focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(() => order(app)).toEqual(AFTER);
}

async function flip(page: Page, app: Frame, card: ReturnType<Page["locator"]>, label: string) {
  const toggle = (name: string) => card.locator(".design-toggle button", { hasText: name });
  await toggle("Before").click();
  await expect.poll(() => order(app), `${label} click Before`).toEqual(BEFORE);
  expect(await toggle("Before").getAttribute("aria-pressed")).toBe("true");
  await toggle("After").click();
  await expect.poll(() => order(app), `${label} click After`).toEqual(AFTER);
  // The stand-in sits after Edit in the page itself, not only in the DOM order.
  const [edit, clone] = await app.evaluate(() => [document.getElementById("edit")!, document.querySelector("[data-komo-move-clone]")!].map((node) => node.getBoundingClientRect().left));
  expect(clone, `${label} stand-in position`).toBeGreaterThan(edit);
  expect(await app.evaluate(() => getComputedStyle(document.getElementById("new")!).display)).toBe("none");
}

describe.skipIf(!chrome)("Before/After for a move in Viewport and In place", () => {
  it.each(["shell", "viewport", "inplace"] as const)("composer and posted cards show the move in the page's document: %s", async (mode) => {
    const { page, app, errors } = await open(mode);
    try {
      await move(page, app);
      await page.locator(".design-inspector__actions").getByRole("button", { name: "Comment", exact: true }).click();
      const draft = page.locator(".draft-proposal");
      await draft.locator(".design-toggle").waitFor();
      // The composer starts on After.
      await expect.poll(() => order(app), "draft starts on After").toEqual(AFTER);
      expect(await draft.locator(".design-toggle button", { hasText: "After" }).getAttribute("aria-pressed")).toBe("true");
      // The card names the button and its toolbar, not the wrappers' primitive names.
      expect(await draft.locator(".design-card-title").textContent()).toBe("Moved Button “New goal”");
      expect(await draft.locator(".design-card-target").textContent()).toBe("Toolbar “Actions”");
      // Nothing is cut off at the composer card's default width.
      expect(await clipped(draft)).toEqual([]);
      await page.screenshot({ path: join(shots, `${mode}-composer-after.png`) });
      await flip(page, app, draft, `${mode} composer`);

      // ←/→ from the composer's (empty) note; B there types, so a note can start with "b".
      const note = page.locator(".new-comment-composer textarea");
      await note.focus();
      await page.keyboard.press("ArrowLeft");
      await expect.poll(() => order(app), `${mode} ←`).toEqual(BEFORE);
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => order(app), `${mode} →`).toEqual(AFTER);
      await page.keyboard.press("b");
      expect(await note.inputValue()).toBe("b");
      expect(await order(app), `${mode} b types`).toEqual(AFTER);
      // With text in the note, the arrows move the caret.
      await page.keyboard.press("ArrowLeft");
      expect(await order(app), `${mode} ← in text`).toEqual(AFTER);
      await page.keyboard.press("End");
      await page.keyboard.press("Backspace");
      expect(await note.inputValue()).toBe("");

      // The framed app re-renders while After shows: a commit that rewrites the button's display,
      // and a remount of the whole toolbar. The stand-in stays and the original stays hidden.
      await app.evaluate(() => (window as any).qa.bump());
      await expect.poll(() => app.locator("#count").textContent()).toBe("Renders 1");
      await expect.poll(() => order(app), `${mode} after a commit`).toEqual(AFTER);
      await app.evaluate(() => (window as any).qa.remount());
      await expect.poll(() => order(app), `${mode} after a remount`).toEqual(AFTER);
      // Before hands the remounted toolbar back exactly.
      await draft.locator(".design-toggle button", { hasText: "Before" }).click();
      await expect.poll(() => order(app), `${mode} Before after a remount`).toEqual(BEFORE);
      expect(await app.evaluate(() => [document.getElementById("new")!.getAttribute("style"), document.querySelectorAll("[data-komo-move-clone]").length])).toEqual(["display: inline-block;", 0]);

      // Once the note has text, B and the arrows belong to it.
      await note.focus();
      await page.keyboard.type("Move it, b");
      await page.keyboard.press("ArrowLeft");
      expect(await note.inputValue()).toBe("Move it, b");
      await expect.poll(() => order(app)).toEqual(BEFORE);

      // Posting restores the page; the posted card opens on Before and flips by click.
      await page.locator(".new-comment-composer").getByRole("button", { name: "Post comment" }).click();
      const posted = page.locator(".message-text .design-card").first();
      await posted.waitFor();
      await expect.poll(() => order(app), `${mode} posted`).toEqual(BEFORE);
      // The thread pins to the centre of the button itself, not to whatever lies under its in-frame coordinates.
      const anchor = await page.evaluate(() => JSON.parse(sessionStorage.getItem("qa-threads")!)[0].anchor);
      expect([anchor.selector, Math.round(anchor.x * 10), Math.round(anchor.y * 10)]).toEqual(["#new", 5, 5]);
      const card = page.locator(".message-text").filter({ has: page.locator(".design-toggle") }).first();
      expect(await card.locator(".design-card-title").textContent()).toBe("Moved Button “New goal”");
      expect(await card.locator(".design-card-target").textContent()).toBe("Toolbar “Actions”");
      expect(await clipped(card)).toEqual([]);
      await card.locator(".design-toggle button", { hasText: "After" }).click();
      await expect.poll(() => order(app), `${mode} posted After`).toEqual(AFTER);
      await page.screenshot({ path: join(shots, `${mode}-posted-after.png`) });
      await flip(page, app, card, `${mode} posted`);
      await app.evaluate(() => (window as any).qa.bump());
      await expect.poll(() => order(app), `${mode} posted after a commit`).toEqual(AFTER);
      await card.locator(".design-toggle button", { hasText: "Before" }).click();
      await expect.poll(() => order(app), `${mode} posted Before`).toEqual(BEFORE);
      expect(await app.locator("[data-komo-move-clone]").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 60000);

  it("wraps a long card title to two lines before truncating", async () => {
    const { page, app } = await open("shell");
    try {
      await move(page, app);
      await page.locator(".design-inspector__actions").getByRole("button", { name: "Comment", exact: true }).click();
      const title = page.locator(".draft-proposal .design-card-title");
      await title.waitFor();
      const lines = (text: string) => title.evaluate((node, text) => {
        node.textContent = text;
        const css = getComputedStyle(node), line = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.2;
        return { lines: Math.round(node.getBoundingClientRect().height / line), clipped: node.scrollHeight > node.clientHeight + 1, clamp: css.webkitLineClamp };
      }, text);
      // The real title fits in two lines beside the switch, in full.
      expect(await lines("Moved Button “New goal”")).toEqual({ lines: 2, clipped: false, clamp: "2" });
      expect(await lines("Moved Button")).toMatchObject({ lines: 1, clipped: false });
      // Longer than two lines, it ends in an ellipsis on the second.
      expect(await lines("Moved Button “Create a new quarterly goal for the whole product and design team”")).toMatchObject({ lines: 2, clipped: true });
      await page.screenshot({ path: join(shots, "title-wrap.png") });
    } finally { await page.close(); }
  }, 40000);
});
