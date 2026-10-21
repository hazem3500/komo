import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Single-copy Viewport (frame.shell): the top window becomes komo's shell and the app
// runs once, in the frame. The fixture app mounts only when isShell() is false, and
// every copy registers on the top window, so the tests can count them.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = join(tmpdir(), "komo-frame-shell");
let directory: string, origin: string;
let server: Server, browser: Browser;

const html = `<!doctype html><html><head><style>body{margin:0;font:14px system-ui}main{min-height:100vh}
.card{height:120px;margin:12px;padding:12px;border-radius:8px;background:#7c3aed;color:#fff}</style></head>
<body><main id="root"></main><script type="module" src="/entry.js"></script></body></html>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-frame-shell-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      import {isShell} from ${JSON.stringify(resolve("src/shell.ts"))};
      const params=new URLSearchParams(location.search);
      const project='frame-shell';
      if(window===top)window.qa={mounts:[]};
      const shell=isShell(params.get('project')||project,{timeout:Number(params.get('timeout')||1500)});
      if(window===top)qa.shell=shell;
      if(!shell){
        const main=document.querySelector('main');
        main.innerHTML='<h1 id="title"></h1><a id="next" href="/other">Other page</a><div class="card" id="card-1">One</div><div class="card" id="card-2">Two</div>';
        const render=()=>{document.getElementById('title').textContent=location.pathname==='/other'?'Other':'Home';};
        document.getElementById('next').addEventListener('click',event=>{event.preventDefault();history.pushState({},'',event.currentTarget.getAttribute('href'));render();});
        addEventListener('popstate',render);render();
        top.qa.mounts.push(window===top?'top':'frame');
        // An app's own unsaved-changes guard.
        if(params.has('guard'))addEventListener('beforeunload',event=>{event.preventDefault();event.returnValue='';});
      }
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':'+project;
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      window.fetch=async(input)=>{
        const path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url,location.origin).pathname;
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads:[]}:{});
      };
      if(!params.has('nokomo'))window.komo=initKomo({endpoint:location.origin,project,repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',
        restoreOpen:params.has('restore')?'session':false,pollInterval:60000,
        frame:{mode:'iframe',shell:true,...(params.get('url')?{iframeUrl:()=>params.get('url')}:{})}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.endsWith(".js")) {
      if (url.pathname === "/deny") response.setHeader("x-frame-options", "DENY");
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
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

const state = (page: Page) => page.evaluate(() => ({
  shell: (window as any).qa?.shell as boolean,
  mounts: [...(window as any).qa?.mounts ?? []] as string[],
  url: location.href,
  flag: sessionStorage.getItem("komo:shell"),
  off: sessionStorage.getItem("komo:shell-off"),
  appOnTop: !!document.getElementById("title"),
}));
async function load(page: Page, query = "") {
  page.setDefaultTimeout(8000);
  await page.goto(`${origin}/${query}`);
  await page.waitForFunction(() => !!(window as any).qa);
}
async function viewportFrame(page: Page): Promise<Frame> {
  await page.waitForFunction(() => {
    const root = [...document.body.children].find((node) => node.shadowRoot)?.shadowRoot;
    const frame = root?.querySelector<HTMLIFrameElement>("iframe[data-komo-viewport]");
    return !!frame?.contentDocument?.getElementById("title") && !root!.querySelector(".frame-stage[data-loading]");
  });
  return page.frames().find((item) => item.name() === "komo-viewport")!;
}
/** Opens Frame on the normal page and accepts the reload into the shell. */
async function enter(page: Page, query = "") {
  await load(page, query);
  await page.waitForFunction(() => !!(window as any).komo);
  const asked = new Promise<string>((done) => page.once("dialog", (dialog) => {
    done(dialog.message());
    void dialog.accept();
  }));
  await page.keyboard.press("l");
  const message = await asked;
  await page.waitForURL(/komo-shell=[0-9a-f]{32}/);
  await page.waitForFunction(() => !!(window as any).komo);
  return { message, frame: await viewportFrame(page) };
}

describe.skipIf(!chrome)("Frame single-copy shell", () => {
  it("is never a shell from a link alone, or from another project's or origin's flag", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await load(page, "?komo-shell=1&nokomo");
    expect(await state(page)).toMatchObject({ shell: false, mounts: ["top"], appOnTop: true });
    // A flag left by another project, by another origin, or with another nonce.
    for (const [stored, query] of [
      [{ v: 1, project: "other-project", nonce: "a".repeat(32), origin }, `?komo-shell=${"a".repeat(32)}&nokomo`],
      [{ v: 1, project: "frame-shell", nonce: "b".repeat(32), origin: "http://elsewhere.test" }, `?komo-shell=${"b".repeat(32)}&nokomo`],
      [{ v: 1, project: "frame-shell", nonce: "c".repeat(32), origin }, `?komo-shell=${"d".repeat(32)}&nokomo`],
    ] as const) {
      await page.evaluate((value) => sessionStorage.setItem("komo:shell", JSON.stringify(value)), stored);
      await load(page, query);
      expect(await state(page), JSON.stringify(stored)).toMatchObject({ shell: false, mounts: ["top"], appOnTop: true });
    }
    await page.close();
  });

  it("reloads into a shell on Viewport, after asking, and runs the app once, in the frame", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { message, frame } = await enter(page);
    expect(message).toContain("Reload so the app runs once, in the frame?");
    expect(message).toContain("Unsaved changes in the app are lost");
    const now = await state(page);
    expect(now).toMatchObject({ shell: true, mounts: ["frame"], appOnTop: false });
    const nonce = new URL(now.url).searchParams.get("komo-shell");
    expect(JSON.parse(now.flag!)).toEqual({ v: 1, project: "frame-shell", nonce, origin });
    // The frame's document has no nonce, and its komo stays inert.
    expect(await frame.evaluate(() => [location.search, [...document.body.children].filter((node) => node.shadowRoot).length])).toEqual(["", 0]);
    await page.screenshot({ path: join(shots, "shell.png") });
    expect(errors).toEqual([]);
    await page.close();
  });

  it("keeps the shell's URL on the frame's route, so a reload stays in the shell on the same page", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const { frame } = await enter(page);
    const nonce = new URL(page.url()).searchParams.get("komo-shell");
    await frame.click("#next");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/other");
    expect(new URL(page.url()).searchParams.get("komo-shell")).toBe(nonce);
    await page.reload();
    await page.waitForFunction(() => !!(window as any).komo);
    const again = await viewportFrame(page);
    expect(await again.textContent("#title")).toBe("Other");
    expect(await state(page)).toMatchObject({ shell: true, mounts: ["frame"] });
    await page.close();
  });

  it("leaves for the normal page on the frame's route when the reviewer picks In place", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const { frame } = await enter(page);
    await frame.click("#next");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/other");
    await page.getByRole("button", { name: "In place", exact: true }).click();
    await page.waitForURL((url) => !url.searchParams.has("komo-shell"));
    await page.waitForFunction(() => !!(window as any).qa?.mounts.length);
    const now = await state(page);
    expect(now).toMatchObject({ shell: false, mounts: ["top"], appOnTop: true, flag: null, off: null });
    expect(new URL(now.url).pathname).toBe("/other");
    await page.close();
  });

  it("leaves for the normal page when Frame closes", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await enter(page);
    await page.evaluate(() => (window as any).komo.close());
    await page.waitForURL((url) => !url.searchParams.has("komo-shell"));
    await page.waitForFunction(() => !!(window as any).qa?.mounts.length);
    expect(await state(page)).toMatchObject({ shell: false, mounts: ["top"], appOnTop: true, flag: null });
    await page.close();
  });

  it("keeps a second copy when the reviewer cancels, without reloading", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await load(page);
    await page.waitForFunction(() => !!(window as any).komo);
    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.keyboard.press("l");
    await viewportFrame(page);
    expect(await state(page)).toMatchObject({ shell: false, mounts: ["top", "frame"], flag: null });
    expect(page.url()).toBe(`${origin}/`);
    await page.close();
  });

  it("reopens a remembered Frame in the shell on load, without asking", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let asked = 0;
    page.on("dialog", (dialog) => (asked++, void dialog.dismiss()));
    await load(page, "?restore");
    await page.evaluate(() => sessionStorage.setItem("branch-comments:open:frame-shell:example/review", "1"));
    await page.reload();
    await page.waitForURL(/komo-shell=[0-9a-f]{32}/);
    await page.waitForFunction(() => !!(window as any).komo);
    await viewportFrame(page);
    expect(asked).toBe(0);
    expect(await state(page)).toMatchObject({ shell: true, mounts: ["frame"] });
    await page.close();
  });

  it("clears the flag and reloads the normal page when komo doesn't start in the shell, then keeps two copies", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await enter(page);
    const nonce = new URL(page.url()).searchParams.get("komo-shell");
    // The same shell, but komo never starts: the app mounts nowhere until the guard's timeout.
    await page.goto(`${origin}/?nokomo&timeout=1000&komo-shell=${nonce}`);
    await page.waitForFunction(() => !!(window as any).qa);
    expect(await state(page)).toMatchObject({ shell: true, mounts: [] });
    await page.waitForURL((url) => !url.searchParams.has("komo-shell"), { timeout: 5000 });
    await page.waitForFunction(() => !!(window as any).qa?.mounts.length);
    const after = await state(page);
    expect(after).toMatchObject({ shell: false, mounts: ["top"], appOnTop: true, flag: null });
    expect(after.off).toContain("didn't start");
    // No loop: Frame now opens with two copies, without asking or reloading.
    let asked = 0;
    page.on("dialog", (dialog) => (asked++, void dialog.dismiss()));
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => !!(window as any).komo);
    await page.keyboard.press("l");
    await viewportFrame(page);
    expect(asked).toBe(0);
    expect(await state(page)).toMatchObject({ shell: false, mounts: ["top", "frame"] });
    await page.close();
  });

  it("leaves for the normal page with the reason when the frame can't load", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await load(page, "?url=/deny");
    await page.waitForFunction(() => !!(window as any).komo);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.keyboard.press("l");
    await page.waitForURL(/komo-shell=/);
    await page.waitForURL((url) => !url.searchParams.has("komo-shell"));
    await page.waitForFunction(() => !!(window as any).qa?.mounts.length);
    const now = await state(page);
    expect(now).toMatchObject({ shell: false, mounts: ["top"], flag: null });
    expect(now.off).toContain("X-Frame-Options");
    await page.close();
  });

  it("keeps the page, with a second copy, when the app's unsaved-changes guard refuses the reload", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await load(page, "?guard");
    await page.waitForFunction(() => !!(window as any).komo);
    // Sticky activation, so the guard's prompt shows.
    await page.mouse.click(600, 700);
    const kinds: string[] = [];
    page.on("dialog", (dialog) => {
      kinds.push(dialog.type());
      void (dialog.type() === "beforeunload" ? dialog.dismiss() : dialog.accept());
    });
    await page.keyboard.press("l");
    await viewportFrame(page);
    expect(kinds).toEqual(["confirm", "beforeunload"]);
    expect(await state(page)).toMatchObject({ shell: false, mounts: ["top", "frame"] });
    expect(page.url()).toBe(`${origin}/?guard`);
    await page.close();
  });
});
