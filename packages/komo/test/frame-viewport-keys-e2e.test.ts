// Review and Design keys in Frame's Viewport mode with keyboard focus inside the framed
// document: a click on the page focuses the iframe, so keys fire in the frame's own
// document. Each key must do what it does In place, the frame's own text fields keep
// their keys, held keys never stick across the two documents, and all of it survives a
// reload of the frame. Synthetic loopback fixture only. Never touches the eyedropper.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

const app = `<!doctype html><html><head><style>body{margin:0;font:14px system-ui}main{display:flex;flex-direction:column;gap:12px;width:520px;padding:40px;min-height:1400px}
.card{display:block;width:240px;padding:16px;border-radius:12px;background:#e2e8f0}</style></head>
<body><main id="root"><h1 id="heading">Board</h1><div class="card" id="card"><span id="title">Weekly summary</span> <span id="meta">3 items</span></div>
<div class="card" id="second">Second card</div><div class="card" id="third">Third card</div><input id="field" aria-label="Field"></main>
<script type="module" src="/entry.js"></script></body></html>`;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-frame-keys-"));
  await build({
    stdin: { contents: `
      import {initPalette} from ${JSON.stringify(resolve("src/index.ts"))};
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='palette:'+location.origin+':frame-keys';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      const params=new URLSearchParams(location.search);
      // A Custom 1600 x 1200 frame at 100%: larger than its stage, so it pans.
      if(params.has('pan')&&window===top)localStorage.setItem('palette:frame-size:frame-keys:example/review',JSON.stringify({v:2,size:[1600,1200],actual:true}));
      // The app's own key handler: the keys Palette handles never reach it.
      window.qa={keys:[],loaded:performance.timeOrigin};
      addEventListener('keydown',event=>qa.keys.push(event.key));
      window.fetch=async input=>{
        const path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url,location.origin).pathname;
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads:[]}:{});
      };
      window.palette=initPalette({endpoint:location.origin,project:'frame-keys',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,pollInterval:60000,
        design:{experimentalGeometry:true},frame:{mode:'iframe',...(params.has('inplace')?{defaultMode:'transform'}:{})}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.endsWith(".js")) {
      response.setHeader("content-type", "text/html");
      return response.end(app);
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

const mac = process.platform === "darwin";
const UNDO = "ControlOrMeta+z", REDO = mac ? "Meta+Shift+z" : "Control+Shift+z";

type Review = Page & { errors: string[]; frame: Frame | null; inPlace: boolean };
/** The viewport iframe once it shows a document loaded after `after` (its time origin). */
async function viewportFrame(page: Page, after = 0): Promise<Frame> {
  await page.waitForFunction((after) => {
    const root = [...document.body.children].find((node) => node.shadowRoot)?.shadowRoot;
    const frame = root?.querySelector<HTMLIFrameElement>("iframe[data-palette-viewport]");
    const view = frame?.contentWindow as (Window & { qa?: { loaded: number } }) | null | undefined;
    return !!frame?.contentDocument?.getElementById("card") && (view?.qa?.loaded ?? 0) > after && !root!.querySelector(".frame-stage[data-loading]");
  }, after);
  return page.frames().find((item) => item.name() === "komo-viewport")!;
}
/** Where an element of the reviewed page sits on screen, through the frame's offset and scale. */
const box = (page: Review, id: string) => page.evaluate(([id, framed]) => {
  const frame = framed ? [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!.querySelector<HTMLIFrameElement>("iframe[data-palette-viewport]")! : null;
  const outer = frame ? frame.getBoundingClientRect() : new DOMRect(), scale = frame ? outer.width / frame.offsetWidth : 1;
  const inner = (frame ? frame.contentDocument! : document).getElementById(id)!.getBoundingClientRect();
  return { x: outer.left + inner.left * scale, y: outer.top + inner.top * scale, width: inner.width * scale, height: inner.height * scale };
}, [id, !page.inPlace] as const);
const host = (page: Page) => page.locator("[data-branch-comments]");
const before = (page: Page) => page.locator(".design-inspector__compare button", { hasText: "Before" }).getAttribute("aria-pressed");
const target = (page: Page) => page.locator(".design-inspector__target").textContent();
const active = (page: Page) => host(page).evaluate((node) => node.classList.contains("design-active"));
/** The page under review: the framed document in Viewport, else this one. */
const reviewed = (page: Review) => page.frame ?? page.mainFrame();
const width = (page: Review) => reviewed(page).locator("#card").evaluate((node) => (node as HTMLElement).style.width);
const appKeys = (page: Review) => reviewed(page).evaluate(() => (window as any).qa.keys as string[]);
/** True when keyboard focus is inside the framed document (In place: on the page, outside Palette). */
const inFrame = (page: Review) => page.inPlace
  ? page.evaluate(() => !document.activeElement?.closest("[data-branch-comments]"))
  : page.frame!.evaluate(() => document.hasFocus());
async function clickInto(page: Review, id = "heading", dx = 4) {
  // The frame may still be settling after a mode change; measure again until the click lands in it.
  for (let tries = 0; tries < 3 && !(tries && await inFrame(page)); tries++) {
    const at = await box(page, id);
    await page.mouse.click(at.x + dx, at.y + 4);
  }
  expect(await inFrame(page)).toBe(true);
}
async function press(page: Review, key: string) {
  expect(await inFrame(page), `focus inside the page for ${key}`).toBe(true);
  await page.keyboard.press(key);
}

async function open(query = ""): Promise<Review> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(6000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/${query}`);
  await page.waitForFunction(() => !!(window as any).palette);
  await page.keyboard.press("l");
  await page.locator(".frame-bar").waitFor();
  const inPlace = query.includes("inplace");
  const frame = inPlace ? null : await viewportFrame(page);
  return Object.assign(page, { errors, frame, inPlace });
}
/** A click on empty canvas: the framed document's body, right of the app. Design mode deselects. */
async function clickCanvas(page: Review) {
  const at = await box(page, "root");
  await page.mouse.click(at.x + at.width + 60, at.y + 200);
  expect(await inFrame(page)).toBe(true);
}
/**
 * Keyboard focus back on the page, as the app's own focus handling or a click there leaves it
 * (a Design mode pick blurs the frame, so the selection's own click can't).
 */
async function focusPage(page: Review) {
  await (page.inPlace ? page.mainFrame() : page.frame!).evaluate(() => {
    let node = document.activeElement as HTMLElement | null;
    while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement as HTMLElement;
    node?.blur();
    window.focus();
  });
  expect(await inFrame(page)).toBe(true);
}
/** Design mode with #card selected and widened, and keyboard focus inside the framed document. */
async function designInside(page: Review) {
  await clickInto(page);
  await openDesign(page);
  const card = await box(page, "card");
  await page.mouse.click(card.x + 6, card.y + 6);
  await expect.poll(() => target(page)).toContain("div#card");
  const input = page.locator('[data-field-property="width"] input');
  await input.fill("300");
  await input.press("Enter");
  expect(await width(page)).toBe("300px");
  await focusPage(page);
}

describe.skipIf(!chrome)("Viewport keys with focus inside the framed document", () => {
  for (const query of ["", "?inplace"]) {
    const mode = query ? "In place" : "Viewport";
    it(`${mode}: ← and → and B flip Before/After, ⌘Z and ⌘⇧Z undo and redo, and Escape leaves in one press`, async () => {
      const page = await open(query);
      await designInside(page);
      const seen = (await appKeys(page)).length;
      expect(await before(page)).toBe("false");
      await press(page, "ArrowLeft");
      expect(await before(page)).toBe("true");
      await press(page, "ArrowRight");
      expect(await before(page)).toBe("false");
      await press(page, "b");
      expect(await before(page)).toBe("true");
      await press(page, "b");
      expect(await before(page)).toBe("false");
      await press(page, UNDO);
      expect(await width(page)).toBe("");
      await press(page, REDO);
      expect(await width(page)).toBe("300px");
      // Palette's keys stop at Palette: the app's own handler never saw them.
      expect((await appKeys(page)).slice(seen).filter((key) => key !== "Meta" && key !== "Control" && key !== "Shift")).toEqual([]);
      await press(page, "Escape");
      expect(await active(page)).toBe(false);
      expect(page.errors).toEqual([]);
      await page.close();
    }, 40000);
  }

  it("walks the selection with Tab, Shift+Tab, Shift+Enter and Alt+↓, and M and ? work", async () => {
    const page = await open();
    await designInside(page);
    await press(page, "Tab");
    expect(await target(page)).toContain("div#second");
    await press(page, "Shift+Tab");
    expect(await target(page)).toContain("div#card");
    await press(page, "Shift+Enter");
    expect(await target(page)).toContain("main#root");
    await press(page, "Alt+ArrowDown");
    expect(await target(page)).toContain("h1#heading");
    // M focuses the selection; Escape gives focus back to the canvas.
    await press(page, "m");
    await page.waitForFunction(() => document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement?.classList.contains("design-geometry__frame"));
    await page.keyboard.press("Escape");
    expect(await active(page)).toBe(true);
    // A click on the frame's empty canvas deselects and leaves focus in the frame: ? opens shortcut
    // help, ⌘Z still undoes and Escape still leaves.
    await clickCanvas(page);
    await page.locator(".design-inspector__empty").waitFor();
    await press(page, "?");
    await page.locator("dialog.palette-shortcuts").waitFor();
    await page.keyboard.press("Escape");
    await page.locator("dialog.palette-shortcuts").waitFor({ state: "detached" });
    await clickCanvas(page);
    await press(page, UNDO);
    expect(await width(page)).toBe("");
    await press(page, "Escape");
    expect(await active(page)).toBe(false);
    expect(page.errors).toEqual([]);
    await page.close();
  }, 40000);

  it("taps and holds the visibility key, and the toolbar shortcuts work from the frame", async () => {
    const page = await open();
    await designInside(page);
    const hidden = () => host(page).evaluate((node) => node.hasAttribute("data-palette-overlays-hidden"));
    await press(page, "h");
    expect(await hidden()).toBe(true);
    await press(page, "h");
    expect(await hidden()).toBe(false);
    // A hold peeks until the key comes up, in the frame or, after focus moved, in this window.
    await page.keyboard.down("h");
    await page.waitForTimeout(450);
    expect(await hidden()).toBe(true);
    await page.keyboard.up("h");
    expect(await hidden()).toBe(false);
    await page.keyboard.down("h");
    await page.waitForTimeout(450);
    expect(await hidden()).toBe(true);
    await page.locator(".design-inspector__eye").evaluate((node: HTMLElement) => node.focus());
    await page.keyboard.up("h");
    expect(await hidden()).toBe(false);
    // Focus leaving the browser mid-hold, from inside the frame, ends the peek too.
    await clickCanvas(page);
    await page.keyboard.down("h");
    await page.waitForTimeout(450);
    expect(await hidden()).toBe(true);
    await page.evaluate(() => Object.defineProperty(document, "hasFocus", { value: () => false, configurable: true }));
    await page.frame!.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
    await expect.poll(hidden).toBe(false);
    await page.evaluate(() => delete (document as { hasFocus?: unknown }).hasFocus);
    await page.keyboard.up("h");
    // D leaves Design mode, C picks a comment target and L closes Frame, all from inside the frame.
    await press(page, "d");
    await expect.poll(() => active(page)).toBe(false);
    // The inspector finishes closing before the page takes the next click.
    await page.locator(".design-inspector").waitFor({ state: "hidden" });
    await clickInto(page);
    await press(page, "c");
    const card = await box(page, "card");
    await page.mouse.move(card.x + 20, card.y + 20);
    await page.mouse.move(card.x + 24, card.y + 24);
    await page.locator(".component-hover").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await clickInto(page);
    await press(page, "l");
    await page.locator(".frame-bar").waitFor({ state: "hidden" });
    expect(page.errors).toEqual([]);
    await page.close();
  }, 40000);

  it("keeps the keys of the frame's own text field", async () => {
    const page = await open();
    const field = page.frame!.locator("#field");
    // Outside Design mode: review shortcuts type into the field.
    const at = await box(page, "field");
    await page.mouse.click(at.x + 6, at.y + 6);
    await page.keyboard.type("dclh");
    expect(await field.inputValue()).toBe("dclh");
    expect(await active(page)).toBe(false);
    expect(await page.locator(".frame-bar").isVisible()).toBe(true);
    await field.fill("");
    // In Design mode, with something to compare: the field keeps B, arrows, ⌘Z and D.
    await designInside(page);
    await field.focus();
    await page.keyboard.type("ab");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("d");
    expect(await field.inputValue()).toBe("adb");
    expect(await before(page)).toBe("false");
    await page.keyboard.press(UNDO);
    expect(await width(page)).toBe("300px");
    expect(await active(page)).toBe(true);
    // A pick lets go of the framed field, as in place: back in the frame, B is Palette's again.
    const card = await box(page, "card");
    await page.mouse.click(card.x + 6, card.y + 6);
    await page.frame!.evaluate(() => window.focus());
    expect(await page.frame!.evaluate(() => document.activeElement?.localName)).toBe("body");
    await press(page, "b");
    expect(await before(page)).toBe("true");
    await press(page, "b");
    await field.focus();
    // Escape lets go of the field first, then leaves.
    await page.keyboard.press("Escape");
    expect(await active(page)).toBe(true);
    await page.keyboard.press("Escape");
    expect(await active(page)).toBe(false);
    expect(page.errors).toEqual([]);
    await page.close();
  }, 40000);

  it("pans a 100% frame with Space+drag from inside the frame, and Space never sticks", async () => {
    const page = await open("?pan");
    const port = page.locator(".frame-port");
    const scroll = () => port.evaluate((node) => [node.scrollLeft, node.scrollTop]);
    const hand = page.locator(".frame-hand");
    await clickInto(page);
    expect(await scroll()).toEqual([0, 0]);
    const at = await box(page, "second");
    await page.mouse.move(at.x + 10, at.y + 10);
    // A tap of Space scrolls neither the frame's page nor the port.
    await press(page, " ");
    expect(await page.frame!.evaluate(() => scrollY)).toBe(0);
    await page.keyboard.down(" ");
    expect(await hand.isVisible()).toBe(true);
    await page.mouse.down();
    await page.mouse.move(at.x - 110, at.y - 70, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up(" ");
    expect(await hand.isVisible()).toBe(false);
    expect(await scroll()).toEqual([120, 80]);
    expect(await page.frame!.evaluate(() => scrollY)).toBe(0);
    // Held in the frame and released in this window, or the reverse: no hand left behind.
    await clickInto(page, "third", 200);
    await page.keyboard.down(" ");
    expect(await hand.isVisible()).toBe(true);
    // (Palette's own button would take Space, so focus lands on this window's page.)
    await page.locator(".frame-size-trigger").evaluate((node: HTMLElement) => (node.focus(), node.blur()));
    expect(await page.frame!.evaluate(() => document.hasFocus())).toBe(false);
    await page.keyboard.up(" ");
    expect(await hand.isVisible()).toBe(false);
    await page.keyboard.down(" ");
    expect(await hand.isVisible()).toBe(true);
    await page.frame!.evaluate(() => window.focus());
    await page.keyboard.up(" ");
    expect(await hand.isVisible()).toBe(false);
    // Focus leaving the browser from inside the frame drops the hand too.
    await page.keyboard.down(" ");
    expect(await hand.isVisible()).toBe(true);
    await page.evaluate(() => Object.defineProperty(document, "hasFocus", { value: () => false, configurable: true }));
    await page.frame!.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
    await expect.poll(() => hand.isVisible()).toBe(false);
    await page.evaluate(() => delete (document as { hasFocus?: unknown }).hasFocus);
    await page.keyboard.up(" ");
    // The app's own field keeps its spaces.
    await page.frame!.locator("#field").focus();
    await page.keyboard.type("a b");
    expect(await page.frame!.locator("#field").inputValue()).toBe("a b");
    expect(await hand.isVisible()).toBe(false);
    expect(page.errors).toEqual([]);
    await page.close();
  }, 40000);

  it("keeps every key after the frame reloads", async () => {
    const page = await open();
    const loaded = await page.frame!.evaluate(() => (window as any).qa.loaded as number);
    await page.frame!.evaluate(() => location.reload());
    page.frame = await viewportFrame(page, loaded);
    await designInside(page);
    await press(page, "ArrowLeft");
    expect(await before(page)).toBe("true");
    await press(page, "ArrowRight");
    expect(await before(page)).toBe("false");
    await press(page, UNDO);
    expect(await width(page)).toBe("");
    await press(page, REDO);
    expect(await width(page)).toBe("300px");
    await press(page, "Tab");
    expect(await target(page)).toContain("div#second");
    await press(page, "Escape");
    expect(await active(page)).toBe(false);
    expect(page.errors).toEqual([]);
    await page.close();
  }, 40000);
});
