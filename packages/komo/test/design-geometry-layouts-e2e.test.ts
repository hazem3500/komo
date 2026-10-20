import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = join(tmpdir(), "komo-geometry-layouts");
let directory: string;
let server: Server;
let browser: Browser;
let origin: string;

const photo = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='40' height='30'><rect width='40' height='30' fill='#9ab'/></svg>")}`;
const fixture = `<style>
body{margin:0;font:14px/1.3 system-ui}
main{padding:96px 32px 40px;box-sizing:border-box;min-height:100vh}
.demo{display:grid;grid-template-columns:260px 340px 240px;gap:28px;align-items:start}
.stack{display:flex;flex-direction:column;gap:8px;height:200px;padding:8px;border:1px solid #ccd}
#card{position:relative;flex:1;padding:12px;background:#eef3ff;border:1px solid #89a}
.stack span{flex:none}
.row{display:flex;gap:8px;margin-top:12px}
#cta{flex:1;padding:8px;font:inherit}
.cells{display:grid;grid-template-columns:repeat(3,100px);grid-auto-rows:56px;gap:10px}
.cells>div{background:#f3efe6;border:1px solid #a98}
.anchor{position:relative;height:30px;margin-top:12px;border-bottom:1px dashed #aaa}
#popover{position:absolute;top:36px;left:0;width:200px;height:70px;padding:8px;box-sizing:border-box;background:#fff;border:1px solid #888}
#photo{display:block;width:160px;aspect-ratio:4/3}
#badge{position:relative;display:inline-block;margin-top:12px;padding:4px 8px;background:#ffe9a8;translate:0px 0px !important}
</style><main><div class="demo">
<div><div class="stack"><div id="card">Card in a flex column</div><span>Footer line</span></div>
<div class="row"><button id="cta" type="button">Full-width action</button></div></div>
<div><div class="cells"><div id="cell">Cell</div><div>B</div><div>C</div><div>D</div><div>E</div><div>F</div></div>
<div class="anchor">Anchor<div id="popover">Popover</div></div></div>
<div id="side"><img id="photo" alt="" src="${photo}"><div id="badge">Badge</div>
<p id="prose">Copy with <span id="inline">an inline span</span> inside it.</p>
<div id="contents" style="display:contents"><div id="inner">Inside a contents wrapper</div></div></div>
</div></main><script type="module" src="/entry.js"></script>`;

beforeAll(async () => {
  if (!chrome) return;
  await mkdir(shots, { recursive: true });
  directory = await mkdtemp(join(tmpdir(), "komo-geometry-layouts-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':layouts';
      localStorage.setItem(key,'synthetic-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
      window.fetch=async input=>{const path=new URL(input instanceof Request?input.url:String(input),location.origin).pathname;return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads:[]}:{});};
      const frame=location.search.includes('frame');
      if(!frame)document.body.append(document.createElement('aside'));
      window.komo=initKomo({endpoint:location.origin,project:'layouts',repo:'example/review',branch:'fixture',pageRoot:frame?document.querySelector('main'):undefined,sidebar:frame?'background':'edge',frame:{scale:location.search.includes('scaled')},design:{experimentalGeometry:true},restoreOpen:false,pollInterval:60000});
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

async function open(mode: string) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.goto(`${origin}/?${mode}`);
  await page.waitForFunction(() => !!(window as any).komo);
  await page.keyboard.press("d");
  return { page, errors };
}

const handle = (page: Page, name: string) => page.locator(".design-geometry").getByRole("button", { name, exact: true });
async function drag(page: Page, name: string, dx: number, dy: number) {
  const box = await handle(page, name).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2 + dy, { steps: 6 });
  await page.mouse.up();
}
const inspector = (page: Page, name: string) => page.locator(".design-inspector").getByRole("button", { name, exact: true });

// Each eligible box: move, two-axis resize, Undo, Before/After and Reset, with the exact attribute back.
const eligible: Array<{ id: string; ratio?: number }> = [
  { id: "card" }, { id: "cta" }, { id: "cell" }, { id: "popover" }, { id: "photo", ratio: 4 / 3 }, { id: "badge" },
];

describe.skipIf(!chrome)("geometry across layouts", () => {
  it.each(["floating", "frame", "frame-scaled"])("moves and resizes flex, grid, positioned and aspect boxes: %s", async mode => {
    const { page, errors } = await open(mode);
    try {
      for (const { id, ratio } of eligible) {
        const target = page.locator(`#${id}`);
        await target.click();
        await handle(page, "Move").waitFor({ state: "visible" });
        const baseline = await target.getAttribute("style");
        const start = (await target.boundingBox())!;
        const siblings = await page.locator(".demo > div").evaluateAll(nodes => nodes.map(node => node.children.length));
        await drag(page, "Move", 30, 20);
        const moved = (await target.boundingBox())!;
        expect(moved.x - start.x, `${id} x in ${mode}`).toBeCloseTo(30, 0);
        expect(moved.y - start.y, `${id} y in ${mode}`).toBeCloseTo(20, 0);
        expect(moved.width).toBeCloseTo(start.width, 0);
        const movedStyle = await target.getAttribute("style");
        await drag(page, "Resize width and height", 24, 16);
        const sized = (await target.boundingBox())!;
        expect(sized.width - moved.width, `${id} width in ${mode}`).toBeCloseTo(24, 0);
        if (ratio) expect(sized.width / sized.height).toBeCloseTo(ratio, 2);
        else expect(sized.height - moved.height, `${id} height in ${mode}`).toBeCloseTo(16, 0);
        // Never reparented or reordered.
        expect(await page.locator(".demo > div").evaluateAll(nodes => nodes.map(node => node.children.length))).toEqual(siblings);
        expect(await target.evaluate(node => node.style.transition)).toBe("");
        if (id === "cta") await page.screenshot({ path: join(shots, `layouts-${mode}.png`) });
        await inspector(page, "Undo").click();
        expect(await target.getAttribute("style")).toBe(movedStyle);
        await inspector(page, "Before").click();
        expect(await target.getAttribute("style")).toBe(baseline);
        await inspector(page, "After").click();
        expect(await target.getAttribute("style")).toBe(movedStyle);
        await inspector(page, "Reset").click();
        expect(await target.getAttribute("style"), `${id} reset in ${mode}`).toBe(baseline);
      }
      await page.evaluate(() => (window as any).komo.destroy());
      for (const { id } of eligible) expect(await page.locator(`#${id}`).getAttribute("style")).toBe(id === "contents" ? "display:contents" : null);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it.each(["floating", "frame-scaled"])("restores existing style attributes exactly, with priorities and an empty attribute: %s", async mode => {
    const { page, errors } = await open(mode);
    try {
      const attributes: Record<string, string> = {
        cta: "flex: 1; color: rgb(17, 34, 51) !important; transition: opacity 2s linear !important",
        card: "",
        photo: "translate: 4px 2px !important; aspect-ratio: 4 / 3",
        cell: "width: 90px; justify-self: start",
      };
      for (const [id, attribute] of Object.entries(attributes)) {
        const target = page.locator(`#${id}`);
        await target.evaluate((node, value) => node.setAttribute("style", value), attribute);
        await target.click();
        await drag(page, "Move", -14, 9);
        await drag(page, "Resize width and height", 18, 12);
        await inspector(page, "Undo").click();
        await inspector(page, "Undo").click();
        expect(await target.getAttribute("style"), `${id} undo in ${mode}`).toBe(attribute);
        await target.hover();
        await drag(page, "Resize width", 22, 0);
        await drag(page, "Move", 8, 8);
        await inspector(page, "Reset").click();
        expect(await target.getAttribute("style"), `${id} reset in ${mode}`).toBe(attribute);
        await target.hover();
        await drag(page, "Resize height", 0, 14);
      }
      await page.keyboard.press("d");
      for (const [id, attribute] of Object.entries(attributes)) expect(await page.locator(`#${id}`).getAttribute("style"), `${id} suspended`).toBe(attribute);
      await page.keyboard.press("d");
      expect(await page.locator("#cell").getAttribute("style")).not.toBe(attributes.cell);
      await page.evaluate(() => (window as any).komo.destroy());
      for (const [id, attribute] of Object.entries(attributes)) expect(await page.locator(`#${id}`).getAttribute("style"), `${id} destroy`).toBe(attribute);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("explains inline and display: contents targets and selects the nearest movable parent", async () => {
    const { page, errors } = await open("floating");
    try {
      await page.locator("#inline").click();
      const reason = page.locator(".design-geometry p");
      await expect.poll(() => reason.textContent()).toBe("Inline text box can't be resized");
      expect(await handle(page, "Move").isVisible()).toBe(false);
      await page.screenshot({ path: join(shots, "layouts-inline-reason.png") });
      await page.locator(".design-geometry").getByRole("button", { name: "Select movable parent p" }).click();
      await expect.poll(() => page.locator(".design-inspector__target").textContent()).toBe("p#prose");
      await handle(page, "Move").waitFor({ state: "visible" });

      await page.locator("#inner").click();
      await page.locator(".design-inspector__parent").click();
      await expect.poll(() => page.locator(".design-inspector__target").textContent()).toBe("div#contents");
      await expect.poll(() => reason.textContent()).toBe("display: contents has no box");
      expect(await handle(page, "Move").isVisible()).toBe(false);
      await page.locator(".design-geometry").getByRole("button", { name: "Select movable parent div" }).click();
      await expect.poll(() => page.locator(".design-inspector__target").textContent()).toBe("div#side");
      await handle(page, "Move").waitFor({ state: "visible" });
      expect(await page.locator("#contents").getAttribute("style")).toBe("display:contents");
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("discloses flex side effects in the UI and proposal, and snaps grid spans numerically", async () => {
    const { page, errors } = await open("floating");
    try {
      await page.locator("#cta").click();
      await drag(page, "Move", 12, -6);
      await drag(page, "Resize width", -40, 0);
      const style = await page.locator("#cta").evaluate(node => [node.style.flexBasis, node.style.flexGrow, node.style.width]);
      expect(style[0]).toBe(style[2]);
      expect(style[1]).toBe("0");
      const note = page.locator(".design-geometry p");
      await expect.poll(() => note.textContent()).toContain("width overrides flex: 1 1 0%");
      expect(await note.textContent()).toContain(`sets flex-basis: ${style[0]}`);

      await page.locator("#card").click();
      await drag(page, "Resize height", 0, -30);
      expect(await page.locator("#card").evaluate(node => [node.style.flexBasis, node.style.flexGrow])).toEqual([expect.stringMatching(/px$/), "0"]);

      await page.locator("#cell").click();
      const snap = page.locator(".design-geometry").getByRole("button", { name: "Snap to grid tracks" });
      await snap.click();
      expect(await snap.getAttribute("aria-pressed")).toBe("true");
      await drag(page, "Resize width and height", 112, 64);
      expect(await page.locator("#cell").evaluate(node => [node.style.gridColumnEnd, node.style.gridRowEnd, node.style.width])).toEqual(["span 2", "span 2", ""]);
      await handle(page, "Resize width").focus();
      await page.keyboard.press("Enter"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter");
      expect(await page.locator("#cell").evaluate(node => node.style.gridColumnEnd)).toBe("span 3");
      await page.screenshot({ path: join(shots, "layouts-grid-snap.png") });

      await page.locator("#cta").click();
      await inspector(page, "Comment").click();
      await page.waitForSelector(".draft-proposal");
      const proposal = (await page.locator(".draft-proposal").textContent())!;
      expect(proposal).toContain("Move (translate)");
      expect(proposal).toContain("Resize (flex-basis) width");
      expect(proposal).toContain("sets flex-grow: 0");
      await page.keyboard.press("Escape");
      expect(await page.locator("#cta").getAttribute("style")).toBeNull();
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("records mode, delta and side effects in copied proposals", async () => {
    const { page } = await open("floating");
    try {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      for (const [id, name, dx, dy] of [["badge", "Move", 10, 5], ["photo", "Resize width", 32, 0], ["cell", "Resize width", 20, 0]] as const) {
        await page.locator(`#${id}`).click();
        await drag(page, name, dx, dy);
      }
      await page.locator(".design-inspector__close").click();
      await page.keyboard.press("d");
      await page.locator(".design-inspector__pending").getByRole("button", { name: "Copy pending proposals" }).click();
      const text = await page.evaluate(() => navigator.clipboard.readText());
      expect(text).toMatch(/Proposed geometry changes \(preview only\)\nTarget: #badge\nLayout: position: relative\n- Move \(offset\): Δx 10px, Δy 5px · host styles override translate; moves with left\/top offsets/);
      expect(text).toMatch(/- Resize \(size\) width: 160px → 192px · keeps aspect ratio 4 \/ 3/);
      expect(text).toMatch(/- Resize \(size\) height: 120px → 144px/);
      expect(text).toMatch(/Layout: grid item\n- Resize \(size\) width: \d+(\.\d+)?px → \d+(\.\d+)?px · width overrides justify-self: stretch/);
    } finally { await page.close(); }
  });
});
