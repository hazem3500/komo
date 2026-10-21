import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e";

// The Design footer at every panel width: with a change count, Before/After, Undo, Redo, Reset,
// Copy CSS and Comment all showing, every control stays inside the panel and Comment keeps its
// full label. Narrowest is the 240px floating panel; Frame docks a 380px column; small screens
// get the bottom sheet. Light and dark pages.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = process.env.KOMO_SHOT_DIR ?? join(tmpdir(), "komo-footer-fit");
const tag = process.env.KOMO_SHOT_TAG ?? "after";
let directory: string, origin: string;
let server: Server, browser: Browser;

const html = `<html><style>
:root{--color-text:#131213;--color-page:#fafafa;--color-surface:#f0f0f0}
[data-mode=dark]{--color-text:#ededed;--color-page:#141414;--color-surface:#2a2a2a}
body{margin:0;background:var(--color-page);color:var(--color-text);font:16px system-ui,sans-serif}
main{min-height:calc(100vh - 80px);box-sizing:border-box;padding:40px}
#card{width:200px;height:80px;padding:16px;border-radius:10px;background:var(--color-surface)}
</style><main><article id="card">Example card</article></main><script type="module" src="/entry.js"></script></html>`;

beforeAll(async () => {
  if (!chrome) return;
  await mkdir(shots, { recursive: true });
  directory = await mkdtemp(join(tmpdir(), "komo-footer-fit-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      const query=new URLSearchParams(location.search);
      document.documentElement.setAttribute('data-mode',query.get('theme')??'light');
      const width=Number(query.get('width'));
      if(width)localStorage.setItem('branch-comments:sidebar:footer-fit:example/review',JSON.stringify({width}));
      window.fetch=async()=>Response.json({threads:[],guests:true});
      const frame=query.get('layout')==='frame';
      // A second page root keeps the floating panel floating; Frame needs one root to scale.
      if(!frame)document.body.append(document.createElement('aside'));
      window.komo=initKomo({endpoint:location.origin,project:'footer-fit',repo:'example/review',branch:'fixture',pageRoot:frame?document.querySelector('main'):undefined,sidebar:frame?'background':'edge',frame:{scale:frame},restoreOpen:false,pollInterval:60000,design:{}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(html);
      return;
    }
    try {
      const file = resolve(directory, `.${path}`);
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

const layouts = [
  { name: "narrowest", query: "width=240", viewport: { width: 1280, height: 800 } },
  { name: "default", query: "", viewport: { width: 1280, height: 800 } },
  { name: "frame", query: "layout=frame", viewport: { width: 1280, height: 800 } },
  { name: "sheet", query: "", viewport: { width: 320, height: 640 } },
] as const;

describe.skipIf(!chrome).each(["light", "dark"])("Design footer on a %s page", theme => {
  it.each(layouts)("keeps every control, and Comment's full label, inside the $name panel", async ({ name, query, viewport }) => {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?theme=${theme}&${query}`);
    await page.waitForFunction(() => !!(window as any).komo);
    await openDesign(page);
    await page.locator(".design-inspector__empty").waitFor();
    await page.locator("#card").click();
    const field = page.locator('.design-inspector [data-property="width"]');
    await field.fill("240");
    await field.press("Enter");
    const bar = page.locator(".design-inspector__bar:not(.design-token-bar)");
    await bar.locator(".design-inspector__compare").waitFor();
    // Redo shows, disabled, beside Undo; disabled tools take the same room.
    const heading = (await page.locator(".design-inspector__target").boundingBox())!;
    await page.mouse.move(heading.x + 4, heading.y + heading.height / 2);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(shots, `${tag}-${name}-${theme}.png`) });
    const layout = await page.locator(".design-inspector").evaluate(panel => {
      const box = panel.getBoundingClientRect();
      const footer = panel.querySelector(".design-inspector__bar:not(.design-token-bar)")!;
      const controls = [...footer.querySelectorAll<HTMLElement>(".design-inspector__count, .design-inspector__compare button, .design-inspector__actions button")]
        .filter(node => node.getClientRects().length);
      const comment = footer.querySelector<HTMLElement>(".design-inspector__actions button:last-child")!;
      const rect = comment.getBoundingClientRect();
      return {
        names: controls.map(node => node.getAttribute("aria-label") ?? node.textContent),
        outside: controls.filter(node => {
          const r = node.getBoundingClientRect();
          return r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5;
        }).map(node => node.getAttribute("aria-label") ?? node.textContent),
        comment: { text: comment.textContent, full: comment.scrollWidth <= comment.clientWidth, oneLine: rect.height <= 40, width: rect.width },
      };
    });
    expect(layout.names).toEqual(["1 change", "Before", "After", "Undo", "Redo", "Reset", "Copy CSS", "Comment"]);
    expect(layout.outside).toEqual([]);
    expect(layout.comment).toMatchObject({ text: "Comment", full: true, oneLine: true });
    expect(layout.comment.width).toBeGreaterThanOrEqual(70);
    expect(errors).toEqual([]);
    await page.close();
  });
});
