import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = join(tmpdir(), "komo-geometry-handles");
const phase = process.env.KOMO_SHOT_PHASE ?? "after";
let directory: string;
let server: Server;
let browser: Browser;
let origin: string;

const photo = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='40' height='30'><rect width='40' height='30' fill='#9ab'/></svg>")}`;
const fixture = `<style>
body{margin:0;font:14px/1.4 system-ui;background:#f7f6f3;color:#1d1c1a}
body.dark{color-scheme:dark;background:#161616;color:#ecebe8}
main{padding:120px 48px 60px;min-height:100vh;box-sizing:border-box}
.row{display:flex;align-items:flex-start;gap:16px;width:720px;padding:16px;border:1px dashed #b9b4ab;box-sizing:border-box}
#card{flex:none;width:240px;padding:16px;box-sizing:border-box;border:1px solid #cdc7bd;border-radius:12px;background:#fff}
.dark #card{background:#232323;border-color:#3d3d3d}
#card h3{margin:0 0 4px;font-size:15px}
#card p{margin:0;color:#6f6a62}
#peer{width:200px;height:132px;box-sizing:border-box;border-radius:12px;background:#e7e2d8}
.dark #peer{background:#2c2c2c}
.tools{display:flex;align-items:center;gap:12px;margin-top:28px}
#icon{display:grid;place-items:center;width:16px;height:16px;padding:0;border:0;border-radius:4px;background:#2e2b26;color:#fff}
.dark #icon{background:#ecebe8;color:#161616}
#icon svg{width:10px;height:10px;pointer-events:none}
#photo{display:block;width:120px;aspect-ratio:4/3;margin-top:28px}
#fixed{width:180px;min-height:40px;max-height:40px;margin-top:28px;padding:8px;box-sizing:border-box;background:#dfe8f4}
.dark #fixed{background:#24303c}
</style><main>
<div class="row" id="row"><div id="card"><h3 id="title">Flex card</h3><p>A flex item with padding and a border.</p></div><div id="peer"></div></div>
<div class="tools"><button id="icon" type="button" aria-label="Add"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.6"/></svg></button><span>Icon button</span></div>
<img id="photo" alt="" src="${photo}">
<div id="fixed">Fixed height</div>
</main><script type="module" src="/entry.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  await mkdir(shots, { recursive: true });
  directory = await mkdtemp(join(tmpdir(), "komo-geometry-handles-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':handles';
      localStorage.setItem(key,'synthetic-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
      window.fetch=async input=>{const path=new URL(input instanceof Request?input.url:String(input),location.origin).pathname;return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads:[]}:{});};
      if(location.search.includes('dark'))document.body.classList.add('dark');
      const frame=location.search.includes('frame');
      if(!frame)document.body.append(document.createElement('aside'));
      window.komo=initKomo({endpoint:location.origin,project:'handles',repo:'example/review',branch:'fixture',pageRoot:frame?document.querySelector('main'):undefined,sidebar:frame?'background':'edge',frame:{scale:location.search.includes('scaled')},design:{experimentalGeometry:true},restoreOpen:false,pollInterval:60000});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(fixture);
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

async function open(mode = "", viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.goto(`${origin}/?${mode}`);
  await page.waitForFunction(() => !!(window as any).komo);
  await page.keyboard.press("d");
  return { page, errors };
}

const frameOf = (page: Page) => page.locator(".design-geometry__frame");
const handleOf = (page: Page, name: string) => page.locator(`.design-geometry__handle[data-handle=${name}]`);
const readout = (page: Page) => page.locator(".design-geometry__readout:not(.design-geometry__chip)");
const inspector = (page: Page, name: string) => page.locator(".design-inspector").getByRole("button", { name, exact: true });

let picked = "";
const spot = (id: string) => id === "card" ? { position: { x: 12, y: 12 } } : {};
/** Select a box; the card is reached from its title through the inspector's parent button, at any scale. */
async function pick(page: Page, id: string) {
  picked = id;
  await page.locator(`#${id === "card" ? "title" : id}`).click();
  if (id === "card") await page.locator(".design-inspector__parent").click();
  await expect.poll(() => page.locator(".design-inspector__target").textContent()).toMatch(new RegExp(`#${id}$`));
  await frameOf(page).waitFor({ state: "visible" });
}

/** Press on a handle's centre and drag by a screen delta, optionally holding a modifier. */
async function drag(page: Page, name: string, dx: number, dy: number, modifier?: string, during?: () => Promise<void>) {
  // Panel clicks leave the canvas undecorated until the pointer returns to the page.
  await page.locator(`#${picked}`).hover();
  await handleOf(page, name).waitFor({ state: "visible" });
  const box = (await handleOf(page, name).boundingBox())!;
  expect(box, name).not.toBeNull();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await during?.();
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

/** Visible handles with their hit boxes, drawn squares and cursors, plus the element's content box. */
async function layout(page: Page, id: string) {
  return page.evaluate((id) => {
    const element = document.getElementById(id)!;
    const css = getComputedStyle(element), rect = element.getBoundingClientRect();
    const scale = rect.width / element.offsetWidth;
    const inset = (side: string) => (parseFloat(css.getPropertyValue(`padding-${side}`)) + parseFloat(css.getPropertyValue(`border-${side}-width`))) * scale;
    const content = { left: rect.left + inset("left"), top: rect.top + inset("top"), right: rect.right - inset("right"), bottom: rect.bottom - inset("bottom") };
    const root = document.querySelector("[data-branch-comments]")!.shadowRoot!;
    const outline = root.querySelector<HTMLElement>(".design-geometry__frame")!;
    const frame = outline.getBoundingClientRect();
    const handles = [...root.querySelectorAll<HTMLElement>(".design-geometry__handle")].filter(handle => !handle.hidden).map(handle => {
      const box = handle.getBoundingClientRect(), square = getComputedStyle(handle, "::before");
      const size = parseFloat(square.width);
      const x = box.left + parseFloat(square.left) + size / 2, y = box.top + parseFloat(square.top) + size / 2;
      return { name: handle.dataset.handle!, cursor: getComputedStyle(handle).cursor, drawn: square.display !== "none",
        hit: [box.width, box.height], square: { left: x - size / 2, top: y - size / 2, right: x + size / 2, bottom: y + size / 2, size } };
    });
    return { rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }, content,
      frame: { left: frame.left, top: frame.top, width: frame.width, height: frame.height, border: getComputedStyle(outline).borderTopWidth },
      handles };
  }, id);
}

const cursors: Record<string, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };
const all = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];
const corners = ["nw", "ne", "sw", "se"];
const bottomOf = async (page: Page, id: string) => { const box = (await page.locator(`#${id}`).boundingBox())!; return box.y + box.height; };

describe.skipIf(!chrome)("Figma-style geometry handles", () => {
  it.each(["floating", "frame", "frame-scaled"])("outline and handle set per box, outside the content, with resize cursors: %s", async mode => {
    const { page, errors } = await open(mode);
    try {
      const expected: Record<string, { drawn: string[]; present: string[] }> = {
        card: { drawn: all, present: all },
        // Under 24px a box draws no squares; its edges and corners still drag from outside.
        icon: { drawn: [], present: all },
        photo: { drawn: corners, present: corners },
        fixed: { drawn: ["e", "w"], present: ["e", "w"] },
      };
      for (const [id, { drawn, present }] of Object.entries(expected)) {
        await pick(page, id);
        const state = await layout(page, id);
        expect(Math.abs(state.frame.left - state.rect.left), `${id} frame left`).toBeLessThan(1);
        expect(Math.abs(state.frame.width - state.rect.width), `${id} frame width`).toBeLessThan(1);
        expect(Math.abs(state.frame.height - state.rect.height), `${id} frame height`).toBeLessThan(1);
        expect(state.frame.border).toBe("1px");
        expect(state.handles.map(handle => handle.name).sort(), `${id} handles`).toEqual([...present].sort());
        expect(state.handles.filter(handle => handle.drawn).map(handle => handle.name).sort(), `${id} squares`).toEqual([...drawn].sort());
        for (const handle of state.handles) {
          expect(handle.cursor, `${id} ${handle.name}`).toBe(cursors[handle.name]);
          expect(handle.square.size).toBe(7);
          expect(Math.min(...handle.hit), `${id} ${handle.name} hit`).toBeGreaterThanOrEqual(12);
          if (!handle.drawn) continue;
          // A drawn square centres on the outline, so at most half of it reaches inside the box.
          const overlapX = Math.min(handle.square.right, state.content.right) - Math.max(handle.square.left, state.content.left);
          const overlapY = Math.min(handle.square.bottom, state.content.bottom) - Math.max(handle.square.top, state.content.top);
          expect(overlapX <= 4.6 || overlapY <= 4.6, `${id} ${handle.name} covers content`).toBe(true);
        }
        // Nothing in the page overlay carries text but the readout; announcements use komo's live region.
        expect(await page.locator(".design-geometry").evaluate(node => [...node.querySelectorAll("*")]
          .filter(child => !child.matches(".design-geometry__readout") && child.textContent).length)).toBe(0);
      }
      // The old Move and resize buttons are gone.
      expect(await page.locator(".design-geometry button").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("selection clicks, double-click editing and the icon button still work around the handles", async () => {
    const { page, errors } = await open();
    try {
      await pick(page, "card");
      await pick(page, "icon");
      expect(await page.locator(".design-inspector__target").textContent()).toBe("button#icon");
      await pick(page, "card");
      await page.locator("#title").click();
      await expect.poll(() => page.locator(".design-inspector__target").textContent()).toBe("h3#title");
      await page.locator("#title").dblclick();
      await page.locator('#title[contenteditable="true"]').waitFor();
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it.each(["floating", "frame-scaled"])("resizes from edges and corners with a readout, Shift proportions, snapping guides and Alt: %s", async mode => {
    const { page, errors } = await open(mode);
    try {
      await pick(page, "card");
      const card = page.locator("#card");
      const baseline = await card.getAttribute("style");
      const start = (await card.boundingBox())!;
      const scale = start.width / 240;
      // Right edge, with the live W × H chip just below the selection.
      await drag(page, "e", 30, 0, undefined, async () => {
        expect(await readout(page).isVisible()).toBe(true);
        const chip = (await readout(page).boundingBox())!, box = (await card.boundingBox())!;
        expect(chip.y).toBeGreaterThan(box.y + box.height);
        expect(await readout(page).textContent()).toBe(`${Math.round(box.width / scale)} × ${Math.round(box.height / scale)}`);
        expect(await readout(page).evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
      });
      expect(await readout(page).isVisible()).toBe(false);
      expect((await card.boundingBox())!.width - start.width).toBeCloseTo(30, 0);
      await inspector(page, "Undo").click();
      expect(await card.getAttribute("style")).toBe(baseline);
      // The left edge grows the box too; the flow keeps its left edge.
      await drag(page, "w", -20, 0);
      expect((await card.boundingBox())!.width - start.width).toBeCloseTo(20, 0);
      await inspector(page, "Undo").click();
      // Shift on a corner keeps the box's proportions.
      await drag(page, "se", 48, 0, "Shift");
      const shifted = (await card.boundingBox())!;
      expect(shifted.width / shifted.height).toBeCloseTo(start.width / start.height, 1);
      expect(shifted.width).toBeGreaterThan(start.width + 40);
      await inspector(page, "Undo").click();
      expect(await card.getAttribute("style")).toBe(baseline);
      // The bottom edge snaps to the sibling's bottom within 4px and draws a guide; Alt turns snapping off.
      const target = await bottomOf(page, "peer");
      const delta = target - (start.y + start.height) - 3;
      let guides = 0;
      await drag(page, "s", 0, delta, undefined, async () => {
        guides = await page.locator(".design-geometry__guide:visible").count();
        const line = (await page.locator(".design-geometry__guide:visible").first().boundingBox())!;
        expect(Math.abs(line.y - target)).toBeLessThan(1);
        expect(line.height).toBeLessThanOrEqual(1.01);
      });
      expect(guides).toBe(1);
      expect(Math.abs(await bottomOf(page, "card") - target)).toBeLessThan(0.6);
      await inspector(page, "Undo").click();
      await drag(page, "s", 0, delta, "Alt", async () => {
        expect(await page.locator(".design-geometry__guide:visible").count()).toBe(0);
      });
      expect(target - await bottomOf(page, "card")).toBeCloseTo(3, 0);
      await inspector(page, "Reset").click();
      expect(await card.getAttribute("style")).toBe(baseline);
      await page.evaluate(() => (window as any).komo.destroy());
      expect(await card.getAttribute("style")).toBe(baseline);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("resizes from the keyboard on the focused selection and announces it", async () => {
    const { page, errors } = await open();
    try {
      await pick(page, "card");
      const card = page.locator("#card");
      const live = page.locator('.sr-only[aria-live="polite"]');
      expect(await live.count()).toBe(1);
      await frameOf(page).focus();
      // The label names the shipped keys in the platform's glyphs only.
      const mac = await page.evaluate(() => /mac|iphone|ipad/i.test(navigator.platform));
      expect(await frameOf(page).getAttribute("aria-label")).toBe(mac
        ? "Move or resize div#card: ⌥↑/↓ move, ⌥⇧↑/↓ move out or into, ⌘ arrows resize, ⇧⌘ arrows by 10px"
        : "Move or resize div#card: Alt+↑/↓ move, Alt+Shift+↑/↓ move out or into, Ctrl+arrows resize, Ctrl+Shift+arrows by 10px");
      await page.keyboard.press("Control+ArrowRight");
      expect(await card.evaluate(node => node.style.width)).toBe("241px");
      await expect.poll(() => live.textContent()).toBe("Resized: width 241px");
      await page.keyboard.press("Control+Shift+ArrowLeft");
      expect(await card.evaluate(node => node.style.width)).toBe("231px");
      await page.keyboard.press("Meta+ArrowLeft");
      expect(await card.evaluate(node => node.style.width)).toBe("230px");
      const height = (await card.boundingBox())!.height;
      await page.keyboard.press("Control+Shift+ArrowDown");
      expect((await card.boundingBox())!.height - height).toBeCloseTo(10, 0);
      await expect.poll(() => live.textContent()).toMatch(/^Resized: height [\d.]+px$/);
      // Plain arrows are not resize keys (Alt + arrows move; see the structural move suite).
      const before = await card.getAttribute("style");
      await page.keyboard.press("ArrowRight");
      expect(await card.getAttribute("style")).toBe(before);
      for (let index = 0; index < 4; index++) await inspector(page, "Undo").click();
      expect(await card.getAttribute("style")).toBeNull();
      // A pinned height has no height keys either.
      await pick(page, "fixed");
      await frameOf(page).focus();
      await page.keyboard.press("Control+ArrowDown");
      expect(await page.locator("#fixed").getAttribute("style")).toBeNull();
      await page.keyboard.press("Control+ArrowRight");
      expect(await page.locator("#fixed").evaluate(node => node.style.width)).toBe("181px");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("keeps handles, outline and readout a constant size at Fit and 100% in a scaled Frame", async () => {
    const { page, errors } = await open("frame");
    try {
      await page.locator(".frame-size-trigger").click();
      await page.getByLabel("Width", { exact: true }).fill("2400");
      await page.getByLabel("Height", { exact: true }).fill("1800");
      await page.getByRole("button", { name: "Set" }).click();
      await page.waitForTimeout(150);
      for (const zoom of ["Fit", "100%"]) {
        if (zoom === "100%") { await page.getByRole("button", { name: "100%", exact: true }).click(); await page.waitForTimeout(150); }
        await pick(page, "card");
        const state = await layout(page, "card");
        const scale = state.rect.width / 240;
        if (zoom === "Fit") expect(scale).toBeLessThan(0.6);
        else expect(scale).toBeCloseTo(1, 2);
        expect(state.frame.border).toBe("1px");
        expect(state.handles.length).toBe(8);
        for (const handle of state.handles) expect(Math.min(...handle.hit), `${zoom} ${handle.name}`).toBeGreaterThanOrEqual(12);
        const card = page.locator("#card");
        const baseline = await card.getAttribute("style");
        await drag(page, "e", 30, 0, "Alt", async () => {
          const chip = (await readout(page).boundingBox())!;
          expect(chip.height).toBeGreaterThan(14);
          expect(chip.height).toBeLessThan(26);
        });
        // Pointer deltas are screen pixels, divided by the Frame scale.
        expect(parseFloat(await card.evaluate(node => node.style.width))).toBeCloseTo(240 + 30 / scale, 0);
        await page.screenshot({ path: join(shots, `${phase}-frame-${zoom === "Fit" ? "fit" : "100"}.png`) });
        await inspector(page, "Undo").click();
        expect(await card.getAttribute("style")).toBe(baseline);
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("puts side effects in the panel's Layout section, not over the page", async () => {
    const { page, errors } = await open();
    try {
      await page.addStyleTag({ content: "#card{flex:1 1 0%}" });
      await pick(page, "card");
      await drag(page, "e", -40, 0);
      const note = page.locator(".design-inspector .design-geometry-note");
      await expect.poll(() => note.textContent()).toContain("width overrides flex: 1 1 0%");
      expect(await note.textContent()).toContain("sets flex-grow: 0");
      expect(await note.evaluate(node => node.closest(".design-section")?.querySelector("summary")?.textContent)).toBe("Layout");
      expect(await page.locator(".design-geometry .design-geometry-note").count()).toBe(0);
      expect(await page.locator('.sr-only[aria-live="polite"]').textContent()).toMatch(/^Resized: width [\d.]+px$/);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
});

describe.skipIf(!chrome)("geometry screenshots", () => {
  it.each(["light", "dark"])("captures the flex card and the icon button: %s", async scheme => {
    const { page } = await open(scheme === "dark" ? "dark" : "");
    try {
      for (const id of ["card", "icon"]) {
        const target = page.locator(`#${id}`);
        await target.click(phase === "after" ? spot(id) : { position: { x: 2, y: 2 } });
        await page.waitForTimeout(400);
        const box = (await target.boundingBox())!;
        await page.mouse.move(box.x + 12, box.y + 12);
        const clip = { x: Math.max(0, box.x - 60), y: Math.max(0, box.y - 70), width: Math.max(box.width + 120, 260), height: box.height + 140 };
        await page.screenshot({ path: join(shots, `${phase}-${id}-${scheme}.png`), clip });
        if (phase !== "after") continue;
        const handle = (await handleOf(page, "se").boundingBox())!;
        await page.mouse.move(handle.x + 8, handle.y + 8);
        await page.mouse.down();
        await page.mouse.move(handle.x + 32, handle.y + 20, { steps: 4 });
        await page.screenshot({ path: join(shots, `${phase}-${id}-${scheme}-dragging.png`), clip: { ...clip, width: clip.width + 30, height: clip.height + 30 } });
        await page.keyboard.press("Escape");
        await page.mouse.up();
        expect(await target.getAttribute("style")).toBeNull();
      }
    } finally { await page.close(); }
  });

  it("lays the before and after captures out on one contact sheet", async () => {
    const files = (await readdir(shots)).filter(file => /^(before|after)-(card|icon)-(light|dark)(-dragging)?\.png$/.test(file)).sort();
    if (!files.some(file => file.startsWith("before-"))) return;
    const cells = await Promise.all(files.map(async file => `<figure><img src="data:image/png;base64,${(await readFile(join(shots, file))).toString("base64")}"><figcaption>${file.replace(".png", "")}</figcaption></figure>`));
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.setContent(`<style>body{margin:16px;font:12px system-ui;background:#fff;display:grid;grid-template-columns:repeat(4,1fr);gap:12px}figure{margin:0}img{max-width:100%;border:1px solid #ddd}</style>${cells.join("")}`);
      await page.screenshot({ path: join(shots, "contact-sheet.png"), fullPage: true });
    } finally { await page.close(); }
  });
});
