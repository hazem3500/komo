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
const shots = join(tmpdir(), "komo-geometry-polish");
const phase = process.env.KOMO_SHOT_PHASE ?? "after";
let directory: string;
let server: Server;
let browser: Browser;
let origin: string;

const fixture = `<style>
body{margin:0;font:14px/1.4 system-ui;background:#f7f6f3;color:#1d1c1a}
main{padding:72px 0 40px;min-height:100vh;box-sizing:border-box}
.light,.dark{display:flex;align-items:flex-start;gap:28px;padding:28px 40px}
.dark{background:#141414;color:#ecebe8}
.icon{display:grid;place-items:center;width:16px;height:16px;padding:0;border:0;border-radius:4px;background:#2e2b26;color:#fff}
.dark .icon{background:#ecebe8;color:#141414}
.icon svg{width:10px;height:10px;pointer-events:none}
.medium{padding:6px 14px;border:1px solid #cdc7bd;border-radius:8px;background:#fff;color:inherit;font:inherit}
.dark .medium{background:#262626;border-color:#3d3d3d}
.card{width:320px;height:180px;padding:16px;box-sizing:border-box;border:1px solid #cdc7bd;border-radius:12px;background:#fff}
.dark .card{background:#232323;border-color:#3d3d3d}
#blue{width:140px;height:60px;padding:8px;box-sizing:border-box;background:#0c93f5;color:#fff}
#edge{width:140px;height:44px;padding:8px;box-sizing:border-box;background:#dfe8f4}
</style><main>
<div class="light"><button class="icon" id="icon" type="button" aria-label="Add"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.6"/></svg></button><button class="medium" id="medium" type="button">Save changes</button><div class="card" id="card">Large card</div><div id="blue">Blue box</div></div>
<div class="dark"><button class="icon" id="icon2" type="button" aria-label="Add"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.6"/></svg></button><button class="medium" id="medium2" type="button">Save changes</button><div class="card" id="card2">Large card</div></div>
<div id="edge">Edge</div>
</main><script type="module" src="/entry.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  await mkdir(shots, { recursive: true });
  directory = await mkdtemp(join(tmpdir(), "komo-geometry-polish-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':polish';
      localStorage.setItem(key,'synthetic-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
      window.fetch=async input=>{const path=new URL(input instanceof Request?input.url:String(input),location.origin).pathname;return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads:[]}:{});};
      const params=new URLSearchParams(location.search);
      const frame=params.has('frame');
      if(!frame)document.body.append(document.createElement('aside'));
      window.komo=initKomo({endpoint:location.origin,project:'polish',repo:'example/review',branch:'fixture',pageRoot:frame?document.querySelector('main'):undefined,sidebar:frame?'background':'edge',frame:{scale:params.has('scaled')},design:{experimentalGeometry:true,selectionColor:params.get('color')||undefined},restoreOpen:false,pollInterval:60000,shortcuts:params.get('visibility')?{visibility:params.get('visibility')}:undefined});
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

async function open(query = "", viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.goto(`${origin}/?${query}`);
  await page.waitForFunction(() => !!(window as any).komo);
  await page.keyboard.press("d");
  return { page, errors };
}
async function pick(page: Page, id: string) {
  await page.locator(`#${id}`).click();
  await expect.poll(() => page.locator(".design-inspector__target").textContent()).toMatch(new RegExp(`#${id}$`));
}
/** Fit the reflow Frame to a logical size that shows the page at `scale`; the controls' box is (width - 428) × (height - 72). */
async function fit(page: Page, scale: number) {
  await page.locator(".frame-size-trigger").click();
  const custom = page.locator(".frame-custom");
  await custom.getByLabel("Width", { exact: true }).fill(String(Math.round(852 / scale)));
  await custom.getByLabel("Height", { exact: true }).fill(String(Math.round(828 / scale)));
  await custom.getByRole("button", { name: "Set" }).click();
  await page.waitForTimeout(150);
  return page.locator(".frame-scale").textContent();
}
const clip = async (page: Page, id: string) => {
  const box = (await page.locator(`#${id}`).boundingBox())!;
  return { x: Math.max(0, box.x - 48), y: Math.max(0, box.y - 48), width: Math.max(box.width + 96, 200), height: box.height + 110 };
};

/** Drawn squares (from each hit area and its --x/--y offsets), the outline box and the overlay's state. */
function overlay(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-branch-comments]")!.shadowRoot!;
    const surface = root.querySelector<HTMLElement>(".design-geometry")!, outline = root.querySelector<HTMLElement>(".design-geometry__frame")!;
    const frame = outline.getBoundingClientRect();
    const squares = [...root.querySelectorAll<HTMLElement>(".design-geometry__handle")].filter(handle => !handle.hidden).map(handle => {
      const box = handle.getBoundingClientRect(), square = getComputedStyle(handle, "::before");
      return { name: handle.dataset.handle!, drawn: square.display !== "none", opacity: getComputedStyle(handle).opacity, border: square.borderTopColor,
        left: box.left + parseFloat(square.left), top: box.top + parseFloat(square.top), size: parseFloat(square.width), radius: parseFloat(square.borderTopLeftRadius) };
    });
    return { frame: { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom, width: frame.width, height: frame.height },
      color: getComputedStyle(outline).borderTopColor, opacity: getComputedStyle(outline).opacity, hidden: getComputedStyle(surface).visibility === "hidden" || surface.hidden,
      squares, attributes: surface.getAttributeNames() };
  });
}
const handles = async (page: Page) => (await overlay(page)).squares.filter(square => square.drawn).map(square => square.opacity);
const blue = "rgb(12, 147, 245)";

describe.skipIf(!chrome)("geometry polish", () => {
  it("draws 7px squares centred on a pixel-aligned 1px outline, the same size at Fit 53, 67, 86 and 100%", async () => {
    const { page, errors } = await open("frame");
    try {
      for (const scale of [0.53, 0.67, 0.86, 1]) {
        if (scale === 1) { await page.getByRole("button", { name: "100%", exact: true }).click(); await page.waitForTimeout(150); }
        else expect(Math.abs(parseInt((await fit(page, scale))!) - scale * 100)).toBeLessThanOrEqual(1);
        for (const id of ["card", "medium"]) {
          await pick(page, id);
          const box = (await page.locator(`#${id}`).boundingBox())!;
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          const { frame, squares, color } = await overlay(page);
          expect(color).toBe(blue);
          for (const edge of [frame.left, frame.top, frame.right, frame.bottom]) expect(Number.isInteger(edge), `${id} ${scale} outline ${edge}`).toBe(true);
          const drawn = squares.filter(square => square.drawn);
          // Under 24px no squares; under 40px a side drops its midpoint squares.
          const tiny = frame.width < 24 || frame.height < 24;
          expect(drawn.length, `${id} at ${scale}`).toBe(tiny ? 0 : 8 - (frame.width < 40 ? 2 : 0) - (frame.height < 40 ? 2 : 0));
          for (const square of drawn) {
            expect(square.size).toBe(7);
            expect(square.radius).toBeLessThanOrEqual(1);
            expect(square.border).toBe(blue);
            expect(Number.isInteger(square.left) && Number.isInteger(square.top), `${id} ${square.name} aligned`).toBe(true);
            const x = square.left + 3.5, y = square.top + 3.5;
            const lineX = square.name.includes("w") ? frame.left + 0.5 : square.name.includes("e") ? frame.right - 0.5 : null;
            const lineY = square.name.includes("n") ? frame.top + 0.5 : square.name.includes("s") ? frame.bottom - 0.5 : null;
            if (lineX !== null) expect(x).toBeCloseTo(lineX, 5);
            if (lineY !== null) expect(y).toBeCloseTo(lineY, 5);
            if (lineX === null) expect(Math.abs(x - (frame.left + frame.right) / 2)).toBeLessThanOrEqual(1);
            if (lineY === null) expect(Math.abs(y - (frame.top + frame.bottom) / 2)).toBeLessThanOrEqual(1);
          }
        }
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("uses the canvas selection color for outlines, handles and the hover outline, configurable and kept visible on blue", async () => {
    const { page, errors } = await open();
    try {
      await pick(page, "card");
      await page.locator("#medium").hover();
      expect(await page.locator(".design-outline--prospective").evaluate(node => getComputedStyle(node).outlineColor)).toBe(blue);
      // The panel keeps its own accent.
      expect(await page.locator(".design-inspector").evaluate(node => getComputedStyle(node).getPropertyValue("--accent"))).not.toContain("0c93f5");
      await pick(page, "blue");
      expect((await overlay(page)).color).toBe("rgb(229, 53, 155)");
      await page.goto(`${origin}/?color=rgb(255,100,0)`);
      await page.waitForFunction(() => !!(window as any).komo);
      await page.keyboard.press("d");
      await pick(page, "card");
      await page.locator("#card").hover();
      const { color, squares } = await overlay(page);
      expect(color).toBe("rgb(255, 100, 0)");
      expect(squares[0].border).toBe("rgb(255, 100, 0)");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("shows handles near the pointer, steps back over the panel and fields, drops the outline during hover previews, and shows them with focus", async () => {
    const { page, errors } = await open();
    try {
      await pick(page, "card");
      const card = (await page.locator("#card").boundingBox())!;
      await page.mouse.move(card.x + 20, card.y + 20);
      await expect.poll(() => handles(page)).toEqual(Array(8).fill("1"));
      await page.mouse.move(card.x - 7, card.y + 40);
      await expect.poll(() => handles(page)).toEqual(Array(8).fill("1"));
      await page.mouse.move(card.x - 30, card.y + card.height + 40);
      await expect.poll(() => handles(page)).toEqual(Array(8).fill("0"));
      expect((await overlay(page)).opacity).toBe("1");
      // Over the panel, only a faint outline stays.
      await page.locator(".design-inspector__target").hover();
      await expect.poll(async () => (await overlay(page)).opacity).toBe("0.4");
      expect(await handles(page)).toEqual(Array(8).fill("0"));
      // Typing in a field keeps them back even with the pointer on the box.
      await page.locator('.design-inspector [data-property="width"]').first().focus();
      await page.mouse.move(card.x + 20, card.y + 20);
      await expect.poll(async () => (await overlay(page)).attributes).toContain("data-quiet");
      await page.locator('.design-inspector [data-property="width"]').first().blur();
      // A select's hover preview drops the outline.
      await page.locator('.design-inspector [data-property="display"]').first().click();
      const option = page.locator(".komo-select [role=option]").nth(1);
      await option.waitFor();
      await option.hover();
      await expect.poll(async () => (await overlay(page)).opacity).toBe("0");
      await page.keyboard.press("Escape");
      await page.mouse.move(card.x - 30, card.y + card.height + 40);
      // Keyboard focus on the selection shows the handles anywhere.
      await page.locator("#card").click({ position: { x: 20, y: 20 } });
      await page.mouse.move(card.x - 30, card.y + card.height + 40);
      await page.keyboard.press("m");
      await expect.poll(() => handles(page)).toEqual(Array(8).fill("1"));
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("draws no squares on boxes under 24px yet resizes them from outside, and keeps clicks and double-clicks inside", async () => {
    const { page, errors } = await open();
    try {
      await pick(page, "icon");
      const icon = (await page.locator("#icon").boundingBox())!;
      await page.mouse.move(icon.x + 8, icon.y + 8);
      expect((await overlay(page)).squares.filter(square => square.drawn)).toEqual([]);
      // The bottom-right corner drags from 5px outside the box.
      await page.mouse.move(icon.x + icon.width + 5, icon.y + icon.height + 5);
      await page.mouse.down();
      await page.mouse.move(icon.x + icon.width + 25, icon.y + icon.height + 15, { steps: 5 });
      await page.mouse.up();
      expect((await page.locator("#icon").boundingBox())!.width).toBeCloseTo(36, 0);
      await page.locator(".design-inspector").getByRole("button", { name: "Undo", exact: true }).click();
      await pick(page, "medium");
      await page.locator("#medium").dblclick();
      await page.locator('#medium[contenteditable="true"]').waitFor();
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("hides every overlay with the visibility key (tap toggles, hold peeks) or the eye toggle, and on Before", async () => {
    const { page, errors } = await open();
    try {
      await pick(page, "card");
      await page.locator("#medium").hover();
      const host = page.locator("[data-branch-comments]");
      const hiddenNow = () => host.evaluate(node => node.hasAttribute("data-komo-overlays-hidden") && getComputedStyle(node.shadowRoot!.querySelector(".design-geometry")!).visibility === "hidden"
        && getComputedStyle(node.shadowRoot!.querySelector(".design-outline--prospective")!).visibility === "hidden");
      await page.keyboard.press("h");
      expect(await hiddenNow()).toBe(true);
      await page.keyboard.press("h");
      expect(await hiddenNow()).toBe(false);
      await page.keyboard.down("h");
      await page.waitForTimeout(450);
      expect(await hiddenNow()).toBe(true);
      await page.keyboard.up("h");
      expect(await hiddenNow()).toBe(false);
      const eye = page.locator(".design-inspector__eye");
      expect(await eye.getAttribute("aria-label")).toBe("Hide selection (H)");
      await eye.click();
      expect([await hiddenNow(), await eye.getAttribute("aria-label"), await eye.getAttribute("aria-pressed")]).toEqual([true, "Show selection (H)", "true"]);
      await eye.click();
      expect(await hiddenNow()).toBe(false);
      // Shortcut help lists the key with the Design keys.
      await page.locator("#card").click({ position: { x: 20, y: 20 } });
      await page.keyboard.press("?");
      await expect.poll(() => page.locator(".komo-shortcuts").textContent()).toContain("Hide or show selection · hold to peek");
      await page.keyboard.press("Escape");
      // Before shows the page without the selection overlays.
      await page.locator("#card").hover();
      await page.locator(".design-geometry__frame").focus();
      await page.keyboard.press("Control+ArrowRight");
      await page.locator("#card").click({ position: { x: 20, y: 20 } });
      await page.keyboard.press("b");
      await expect.poll(async () => (await overlay(page)).hidden).toBe(true);
      await page.keyboard.press("b");
      // Outside Design mode, the key is the comments toggle again.
      await page.keyboard.press("d");
      await page.keyboard.press("h");
      expect(await host.evaluate(node => node.hasAttribute("data-komo-overlays-hidden"))).toBe(false);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("peeks with a configured Shift+H: tap toggles, hold peeks, releasing Shift or losing focus ends it, and the eye names the key", async () => {
    const { page, errors } = await open("visibility=Shift%2BH");
    try {
      await pick(page, "card");
      const host = page.locator("[data-branch-comments]");
      const hidden = () => host.evaluate(node => node.hasAttribute("data-komo-overlays-hidden"));
      await page.keyboard.press("h");
      expect(await hidden()).toBe(false);
      await page.keyboard.press("Shift+H");
      expect(await hidden()).toBe(true);
      await page.keyboard.press("Shift+H");
      expect(await hidden()).toBe(false);
      // Hold, then let go of Shift before the letter.
      await page.keyboard.down("Shift");
      await page.keyboard.down("H");
      await page.waitForTimeout(450);
      expect(await hidden()).toBe(true);
      await page.keyboard.up("Shift");
      expect(await hidden()).toBe(false);
      await page.keyboard.up("H");
      expect(await hidden()).toBe(false);
      // Focus leaving mid-hold ends the peek.
      await page.keyboard.down("Shift");
      await page.keyboard.down("H");
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      expect(await hidden()).toBe(false);
      await page.keyboard.up("H");
      await page.keyboard.up("Shift");
      const mac = await page.evaluate(() => /mac|iphone|ipad/i.test(navigator.platform));
      expect(await page.locator(".design-inspector__eye").getAttribute("aria-label")).toBe(`Hide selection (${mac ? "⇧H" : "Shift+H"})`);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("shows the move cursor and a first-use hint until the first move, and keeps the size chip clear of the squares", async () => {
    const { page, errors } = await open();
    try {
      await page.evaluate(() => localStorage.removeItem("komo:geometry-moved"));
      await pick(page, "medium");
      expect(await page.locator("#medium").evaluate(node => getComputedStyle(node).cursor)).toBe("move");
      const note = page.locator(".design-inspector .design-geometry-note p");
      await expect.poll(() => note.textContent()).toBe("Drag to reorder · M, then ⌥↑/⌥↓");
      await page.keyboard.press("m");
      await page.keyboard.press("Alt+ArrowDown");
      await pick(page, "card");
      await expect.poll(() => note.isVisible()).toBe(false);
      // The W × H chip sits below the box, clear of its bottom squares.
      const se = page.locator(".design-geometry__handle[data-handle=se]");
      await page.locator("#card").hover();
      const corner = (await se.boundingBox())!;
      await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
      await page.mouse.down();
      await page.mouse.move(corner.x + 20, corner.y + 10, { steps: 4 });
      const chip = (await page.locator(".design-geometry__readout:not(.design-geometry__chip)").boundingBox())!;
      const bottom = Math.max(...(await overlay(page)).squares.filter(square => square.drawn).map(square => square.top + square.size));
      expect(chip.y).toBeGreaterThan(bottom);
      expect(await page.locator(".design-geometry__readout:not(.design-geometry__chip)").evaluate(node => getComputedStyle(node).backgroundColor)).toBe(blue);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      // A box at the viewport's left edge keeps its outline and left handles on screen.
      await pick(page, "edge");
      await page.locator("#edge").hover();
      const { frame, squares } = await overlay(page);
      expect(frame.left).toBe(0);
      expect(squares.find(square => square.name === "w")?.drawn).toBe(true);
      await page.screenshot({ path: join(shots, `${phase}-edge-selected.png`), clip: { x: 0, y: frame.top - 40, width: 260, height: 130 } });
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
});

describe.skipIf(!chrome)("geometry polish screenshots", () => {
  it("captures small, medium and large selections in light and dark host areas, and at Fit scales", async () => {
    const { page } = await open();
    try {
      for (const id of ["icon", "medium", "card", "icon2", "medium2", "card2", "edge"]) {
        await pick(page, id);
        const box = (await page.locator(`#${id}`).boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(shots, `${phase}-${id}.png`), clip: await clip(page, id) });
      }
    } finally { await page.close(); }
    const framed = await open("frame");
    try {
      for (const scale of [0.53, 0.67, 0.86, 1]) {
        if (scale === 1) {
          await framed.page.getByRole("button", { name: "100%", exact: true }).click();
          // 100% keeps the last point in view; pan the stage back to the page's top-left.
          await framed.page.mouse.move(8, 400);
          await framed.page.mouse.wheel(-5000, -5000);
          await framed.page.waitForTimeout(150);
        }
        else await fit(framed.page, scale);
        for (const id of ["icon", "card"]) {
          await pick(framed.page, id);
          const box = (await framed.page.locator(`#${id}`).boundingBox())!;
          await framed.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await framed.page.waitForTimeout(200);
          await framed.page.screenshot({ path: join(shots, `${phase}-fit${Math.round(scale * 100)}-${id}.png`), clip: await clip(framed.page, id) });
        }
      }
    } finally { await framed.page.close(); }
  });

  it("lays the before and after captures side by side on one contact sheet", async () => {
    const names = [...new Set((await readdir(shots)).filter(file => /^(before|after)-.*\.png$/.test(file)).map(file => file.replace(/^(before|after)-/, "")))].sort();
    const cell = async (file: string) => existsSync(join(shots, file))
      ? `<figure><img src="data:image/png;base64,${(await readFile(join(shots, file))).toString("base64")}"><figcaption>${file.replace(".png", "")}</figcaption></figure>` : "<figure></figure>";
    const rows = await Promise.all(names.map(async name => `${await cell(`before-${name}`)}${await cell(`after-${name}`)}`));
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    try {
      await page.setContent(`<style>body{margin:16px;font:12px system-ui;background:#fff;display:grid;grid-template-columns:1fr 1fr;gap:10px}figure{margin:0}img{max-width:100%;border:1px solid #ddd}</style>${rows.join("")}`);
      await page.screenshot({ path: join(shots, "contact-sheet.png"), fullPage: true });
    } finally { await page.close(); }
  });
});
