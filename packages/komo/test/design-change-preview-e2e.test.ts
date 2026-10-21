// Posted design proposals in real Chrome: Before/After previews a structural move, a resize
// and a style change on the live page, outlines them in the selection colour, explains when
// After is unavailable, and restores the page exactly. Synthetic loopback fixture only.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = join(tmpdir(), "komo-shots", "design-change-preview");
let directory: string, origin: string;
let server: Server, browser: Browser;

const html = `<!doctype html><style>:root{--color-brand:#6941c6;--shadow-card:0 4px 16px rgb(0 0 0 / 20%)}body{margin:0;font:14px system-ui;color:#0f172a}main{display:flex;gap:32px;min-height:100vh;padding:40px;box-sizing:border-box}
nav{display:flex;flex-direction:column;gap:6px;width:200px}nav a{display:block;padding:8px 12px;border-radius:8px;background:#f1f5f9}
#card{width:180px;padding:16px;border-radius:12px;background:#e2e8f0;color:rgb(15, 23, 42)}</style>
<main><nav id="list"><a id="members">Members</a><a id="reports">Reports</a><a id="approvals">Approvals</a><a id="time">Time off</a></nav>
<section><div id="card">Weekly summary</div></section></main><script type="module" src="/entry.js"></script>`;

const bodies = {
  move: ["Proposed geometry changes (preview only)", "Target: nav#list > a:nth-of-type(3)", "Layout: flex item, column",
    "- Move Link “Approvals”: from NavList (3rd) → NavList (2nd)", "From: nav#list · index 2", "To: nav#list · index 1 · before"].join("\\n"),
  resize: ["Proposed style changes (preview only)", "Target: #card", "- color: rgb(15, 23, 42) → #6941c6", "",
    "Proposed geometry changes (preview only)", "Target: #card", "Layout: normal flow", "- Resize (size) width: 180px → 260px"].join("\\n"),
  missing: ["Proposed style changes (preview only)", "Target: #gone", "- color: rgb(15, 23, 42) → #6941c6"].join("\\n"),
};

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-change-preview-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { discoverCssTokens } from ${JSON.stringify(resolve("src/adapters/css-variables.ts"))};
      const tokens=new URLSearchParams(location.search).has('tokens');
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const thread=(id,selector,body)=>({id,page:'/',anchor:{selector,text:'',x:.5,y:.5,width:0,height:0,pageX:0,pageY:0,viewportWidth:1280},resolved:false,resolvedBy:null,createdAt:1,updatedAt:1,tags:[],
        comments:[{id:id+'-comment',body,author:user,createdAt:1,editedAt:null,reactions:{}}]});
      const threads=[thread('move','#approvals','${bodies.move}'),thread('resize','#card','${bodies.resize}'),thread('missing','#gone','${bodies.missing}')];
      const key='branch-comments:'+location.origin+':preview';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      window.fetch=async input=>{
        const path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url).pathname;
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads}:{});
      };
      window.komo=initKomo({endpoint:location.origin,project:'preview',repo:'example/review',branch:'fixture',pageRoot:document.querySelector('main'),sidebar:'background',restoreOpen:false,pollInterval:60000,design:{selectionColor:'#e5484d',...(tokens?{tokens:discoverCssTokens()}:{})}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.endsWith(".js")) {
      response.setHeader("content-type", "text/html");
      response.end(html);
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

async function open(thread: string) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(6000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/?comment=${thread}`);
  await page.locator(".design-card").first().waitFor();
  return Object.assign(page, { errors });
}
const toggle = (page: Page, label: string) => page.locator(".design-toggle button", { hasText: label });
const links = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("#list > a")].filter(node => getComputedStyle(node).display !== "none").map(node => node.textContent));
const marks = (page: Page) => page.locator(".design-mark").evaluateAll(nodes => nodes.map(node => ({ outline: (node as HTMLElement).style.outline, box: node.getBoundingClientRect().toJSON() })));
const snapshot = (page: Page) => page.evaluate(() => document.querySelector("main")!.outerHTML);

describe.skipIf(!chrome)("Before/After on posted design proposals", () => {
  it("switches the composer's card between Before and After, with motion, and keeps long values readable", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
    page.setDefaultTimeout(6000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?tokens`);
    await page.waitForFunction(() => !!(window as any).komo);
    const card = page.locator("#card");
    const look = () => card.evaluate(node => { const css = getComputedStyle(node); return [css.color, css.height, css.paddingTop, css.borderTopLeftRadius, css.fontSize, css.width]; });
    const original = await look();
    await openDesign(page);
    await page.locator(".design-inspector__empty").waitFor();
    const box = (await card.boundingBox())!;
    await page.mouse.click(box.x + 6, box.y + 6);
    await page.locator(".design-inspector__target").waitFor();
    const field = (property: string) => page.locator(`.design-inspector [data-property="${property}"]`).first();
    for (const [property, value] of [["height", "61"], ["padding", "9px 0px 4px 12px"], ["border-radius", "20"], ["font-size", "18"], ["width", "260"]]) {
      await field(property).fill(value);
      await field(property).press("Enter");
    }
    // A token for colour, which the composer shows as its own Token changes card.
    await page.locator('.design-inspector [data-field-property="color"] select').first().evaluate((select: HTMLSelectElement) => {
      select.value = "color.brand";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect.poll(() => card.evaluate(node => getComputedStyle(node).color)).toBe("rgb(105, 65, 198)");
    const after = await look();
    expect(after).not.toEqual(original);
    await page.locator(".design-inspector__actions").getByRole("button", { name: "Comment", exact: true }).click();
    const draft = page.locator(".draft-proposal");
    await draft.locator(".design-toggle").waitFor();
    // Let Design mode's own hand-off transitions finish, as a reviewer would.
    await page.waitForTimeout(900);
    await expect.poll(look).toEqual(after);
    await draft.getByRole("button", { name: "Before", exact: true }).click();
    await expect.poll(look).toEqual(original);
    await draft.getByRole("button", { name: "After", exact: true }).click();
    await expect.poll(look).toEqual(after);
    await draft.getByRole("button", { name: "Before", exact: true }).click();
    await expect.poll(look).toEqual(original);
    // Long values wrap instead of cutting off, and keep the full value on hover.
    const values = await draft.locator(".design-value-text").evaluateAll(nodes => nodes.map(node => ({
      text: node.textContent, title: node.getAttribute("title"), clipped: node.scrollWidth > node.clientWidth + 1,
    })));
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toMatchObject({ title: value.text, clipped: false });
    // The cards scroll inside the composer: the last row can always be reached.
    const reach = await draft.evaluate(node => {
      node.scrollTop = node.scrollHeight;
      const rows = node.querySelectorAll(".design-row");
      return [rows[rows.length - 1].getBoundingClientRect().bottom, node.getBoundingClientRect().bottom, getComputedStyle(node).overflowY];
    });
    expect(reach[0]).toBeLessThanOrEqual((reach[1] as number) + 1);
    expect(reach[2]).toBe("auto");
    await page.screenshot({ path: join(shots, "composer-before.png") });
    expect(errors).toEqual([]);
    await page.close();
  }, 40000);

  it("previews a structural move with a stand-in, outlines both spots, flips with B and restores on close", async () => {
    const page = await open("move");
    const before = await snapshot(page);
    expect(await page.locator(".design-card-title").textContent()).toBe("Moved Link “Approvals”");
    expect(await page.locator(".design-card-target").textContent()).toBe("NavList · 3rd → 2nd");
    expect(await page.locator(".design-row").count()).toBe(0);
    expect(await toggle(page, "Before").getAttribute("aria-pressed")).toBe("true");
    await page.screenshot({ path: join(shots, "move-before.png") });
    await toggle(page, "After").click();
    expect(await links(page)).toEqual(["Members", "Approvals", "Reports", "Time off"]);
    const shown = await marks(page);
    expect(shown).toHaveLength(2);
    expect(shown[0].outline).toContain("dashed");
    expect(shown[1].outline).toContain("solid");
    expect(shown[1].outline).toContain("rgb(229, 72, 77)");
    // The new spot sits on the stand-in, second in the list.
    const clone = await page.locator("[data-komo-move-clone]").boundingBox();
    expect(Math.abs(shown[1].box.top - clone!.y)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: join(shots, "move-after.png") });
    // B flips the open thread while focus is anywhere but a text field.
    await page.evaluate(() => (document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("b");
    expect(await snapshot(page)).toBe(before);
    expect(await page.locator(".design-mark").count()).toBe(0);
    await page.keyboard.press("b");
    expect(await links(page)).toEqual(["Members", "Approvals", "Reports", "Time off"]);
    // Closing the thread always restores the page.
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".design-card").count()).toBe(0);
    expect(await snapshot(page)).toBe(before);
    expect(await page.locator(".design-mark, [data-komo-move-clone]").count()).toBe(0);
    expect(page.errors).toEqual([]);
    await page.close();
  }, 30000);

  it("previews a resize and a style change together, then hands the style attribute back", async () => {
    const page = await open("resize");
    const before = await snapshot(page);
    await toggle(page, "After").click();
    const card = await page.locator("#card").evaluate(node => [getComputedStyle(node).width, getComputedStyle(node).color]);
    expect(card).toEqual(["260px", "rgb(105, 65, 198)"]);
    expect(await page.locator(".design-mark").count()).toBe(2);
    await page.screenshot({ path: join(shots, "resize-after.png") });
    await toggle(page, "Before").click();
    expect(await snapshot(page)).toBe(before);
    await page.close();
  }, 30000);

  it("disables After with a reason when the element is not on the page, and keeps the diff", async () => {
    const page = await open("missing");
    expect(await toggle(page, "After").isDisabled()).toBe(true);
    expect(await page.locator('.design-comment [role="status"]').textContent()).toBe("Element not found on this page");
    expect(await page.locator(".design-row").count()).toBe(1);
    await page.screenshot({ path: join(shots, "missing.png") });
    await page.close();
  }, 30000);

  it("restores the page when another thread opens", async () => {
    const page = await open("move");
    const before = await snapshot(page);
    await toggle(page, "After").click();
    expect(await page.locator("[data-komo-move-clone]").count()).toBe(1);
    // A deep link to another thread, without reloading the page.
    await page.evaluate(() => { history.pushState({}, "", "/?comment=resize"); dispatchEvent(new PopStateEvent("popstate")); });
    await page.locator(".design-card-title", { hasText: "Style changes" }).waitFor();
    expect(await page.locator("[data-komo-move-clone]").count()).toBe(0);
    expect(await snapshot(page)).toBe(before);
    await page.close();
  }, 30000);
});
