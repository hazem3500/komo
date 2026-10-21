import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

// Pending edits in real Chrome. Escape keeps element previews pending (Before while
// closed, After on return), and page token edits do the same: after re-entering they
// count in the element footer behind a "Token changes" chip, share one Undo, flip with
// Before/After and join Comment and Reset all. Geometry resizes refresh the Layout fields.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-pending-edits-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { discoverCssTokens } from ${JSON.stringify(resolve("src/adapters/css-variables.ts"))};
      const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':pending';
      localStorage.setItem(key,'synthetic-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
      const qa=window.pendingQA={posts:[]};
      window.fetch=async(input,init)=>{const path=new URL(String(input instanceof Request?input.url:input)).pathname,method=init?.method??'GET';
        if(method==='POST'&&path.endsWith('/threads')){qa.posts.push(JSON.parse(init.body));return Response.json({id:'posted-thread',commentId:'posted-comment'})}
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads:qa.posts.map(post=>({id:'posted-thread',page:post.page,anchor:post.anchor,tags:[],resolved:false,resolvedBy:null,createdAt:1,updatedAt:1,comments:[{id:'posted-comment',body:post.body,author:user,createdAt:1,editedAt:null,reactions:{}}]}))}:{})};
      const mode=new URLSearchParams(location.search).get('mode');
      if(mode==='floating')document.body.append(document.createElement('aside'));
      window.komo=initKomo({endpoint:location.origin,project:'pending',repo:'example/review',branch:'fixture',pageRoot:mode==='floating'?undefined:document.querySelector('main'),sidebar:mode==='floating'?'edge':'background',frame:{scale:mode==='scaled'},restoreOpen:false,pollInterval:60000,design:{tokens:discoverCssTokens(),experimentalGeometry:true}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<html><style>:root{--color-text:#131213;--color-surface:240 240 240}body{margin:0}main{min-height:calc(100vh - 80px);box-sizing:border-box;padding:70px}#card{width:240px;height:96px;padding:16px;background:rgb(var(--color-surface));color:var(--color-text);font:16px sans-serif}</style><main><article id="card">Example card</article></main><script type="module" src="/entry.js"></script></html>`);
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

const light = "rgb(240, 240, 240)", orange = "rgb(255, 128, 0)";

/** A press on empty canvas (the page root's blank area, or outside the page) deselects; re-entry brings the selection back. */
async function deselect(page: import("playwright-core").Page) {
  const point = await page.evaluate(() => {
    for (let y = innerHeight - 4; y > 0; y -= 24) for (let x = 4; x < innerWidth; x += 24) {
      const node = document.elementFromPoint(x, y);
      if (node === document.body || node === document.documentElement || node === document.querySelector("main")) return [x, y];
    }
    return null;
  });
  if (!point) throw new Error("No empty canvas to click");
  await page.mouse.click(point[0], point[1]);
  await page.locator(".design-inspector__empty").waitFor();
}

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("pending token and geometry edits in %s", mode => {
  it("shows pending token edits after Escape, shares Undo, Before/After, Comment and Reset all, and keeps Layout fields current", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?mode=${mode}`);
    await page.waitForFunction(() => !!(window as any).komo);
    const original = await page.evaluate(() => [document.documentElement.getAttribute("style"), document.head.innerHTML]);
    const card = page.locator("#card");
    const background = () => card.evaluate(node => getComputedStyle(node).backgroundColor);
    const cssWidth = () => card.evaluate(node => getComputedStyle(node).width);
    const row = (name: string) => page.locator(".design-token-row").filter({ has: page.locator("b").getByText(name, { exact: true }) });
    const bar = page.locator(".design-inspector__bar:not(.design-token-bar)");
    const count = bar.locator(".design-inspector__count");
    const chip = page.locator(".design-inspector__token-chip");
    const field = (property: string) => page.locator(`.design-inspector [data-property="${property}"]`);
    const tool = (name: string) => bar.getByRole("button", { name, exact: true });
    const editSurface = async () => {
      if (!await page.locator(".design-inspector__empty").count()) await deselect(page);
      await page.getByRole("button", { name: /^Edit tokens/ }).click();
      // The colour editor keeps each value as it is typed; clicking the row again closes it.
      await row("surface").locator("button").first().click();
      const input = page.locator('.komo-color input[aria-label="Hex"]');
      await input.fill("ff8000");
      await input.press("Enter");
      await row("surface").locator("button").first().click();
      await page.locator(".komo-color").waitFor({ state: "detached" });
      expect(await background()).toBe(orange);
    };
    // Ctrl+Shift+Left on the focused selection steps ten local CSS pixels, so the resize is exact in
    // every mode; holding the arrow down keeps the four steps in one gesture.
    const narrow = async () => {
      // Editing in the panel hides the handles until the canvas is targeted again.
      await card.hover();
      const selection = page.locator(".design-geometry__frame");
      await selection.waitFor();
      await selection.focus();
      await page.keyboard.down("Control");
      await page.keyboard.down("Shift");
      for (let step = 0; step < 4; step++) await page.keyboard.down("ArrowLeft");
      await page.keyboard.up("ArrowLeft");
      await page.keyboard.up("Shift");
      await page.keyboard.up("Control");
    };

    await openDesign(page);
    await editSurface();

    // Escape shows Before while closed; re-entering puts the tokens back, and says so.
    await page.keyboard.press("Escape");
    await expect.poll(background).toBe(light);
    await openDesign(page);
    await expect.poll(background).toBe(orange);
    expect(await page.locator(".design-inspector__pending h3").textContent()).toBe("1 unsaved change");
    await card.click();
    await chip.waitFor();
    expect(await chip.getAttribute("aria-label")).toBe("Token changes · 1 change");
    expect(await count.textContent()).toBe("1 change");

    // The chip is a keyboard-reachable link back to the Tokens view.
    await chip.focus();
    await page.keyboard.press("Enter");
    await row("surface").waitFor();
    expect(await page.locator(".design-inspector__target").textContent()).toBe("Tokens");
    expect(await row("surface").getAttribute("data-changed")).toBe("");
    await card.click();
    await chip.waitFor();

    // A geometry resize refreshes Width at once; Height keeps its value.
    expect(await field("width").inputValue()).toBe("240");
    await narrow();
    expect(await cssWidth()).toBe("200px");
    expect(await field("width").inputValue()).toBe("200");
    expect(await field("height").inputValue()).toBe("96");
    expect(await count.textContent()).toBe("2 changes");
    await page.screenshot({ path: join(tmpdir(), `komo-pending-edits-${mode}.png`) });

    // Before/After flips the element and the tokens, and the field follows.
    await tool("Before").click();
    expect([await background(), await cssWidth(), await field("width").inputValue()]).toEqual([light, "240px", "240"]);
    await tool("After").click();
    expect([await background(), await cssWidth(), await field("width").inputValue()]).toEqual([orange, "200px", "200"]);

    // A field edit after the resize joins the same history; Undo walks back through all three.
    await field("width").fill("180");
    await field("width").press("Enter");
    expect(await cssWidth()).toBe("180px");
    expect(await count.textContent()).toBe("2 changes");
    await tool("Undo").click();
    expect([await cssWidth(), await field("width").inputValue()]).toEqual(["200px", "200"]);
    await tool("Undo").click();
    expect([await cssWidth(), await field("width").inputValue(), await count.textContent()]).toEqual(["240px", "240", "1 change"]);
    expect(await card.getAttribute("style")).toBeNull();
    await tool("Undo").click();
    expect(await background()).toBe(light);
    await chip.waitFor({ state: "hidden" });
    expect(await count.textContent()).toBe("");

    // Comment carries the net style change and the token section, then clears both.
    await narrow();
    await field("width").fill("180");
    await field("width").press("Enter");
    await page.keyboard.press("Escape");
    await openDesign(page);
    await editSurface();
    await card.click();
    expect(await count.textContent()).toBe("2 changes");
    expect(await field("width").inputValue()).toBe("180");
    await tool("Comment").click();
    const draft = page.locator(".draft-proposal");
    await draft.waitFor();
    await expect.poll(() => draft.locator(".design-prop").allTextContents()).toEqual(["width", "surface"]);
    // The draft card starts on After for the element and the tokens alike; Before clears both.
    await expect.poll(async () => [await background(), await cssWidth()]).toEqual([orange, "180px"]);
    await draft.getByRole("button", { name: "Before", exact: true }).click();
    expect([await background(), await cssWidth()]).toEqual([light, "240px"]);
    await draft.getByRole("button", { name: "After", exact: true }).click();
    await expect.poll(async () => [await background(), await cssWidth()]).toEqual([orange, "180px"]);
    await page.getByRole("button", { name: "Post comment", exact: true }).click();
    await expect.poll(background).toBe(light);
    await page.waitForFunction(() => (window as any).pendingQA.posts.length === 1);
    const posted = await page.evaluate(() => (window as any).pendingQA.posts[0]);
    expect(posted.body).toMatch(/^Proposed style changes \(preview only\)\nTarget: #card\n- width: 240px → 180px/);
    expect(posted.body).not.toContain("Proposed geometry changes");
    expect(posted.body).toContain("\n\nProposed token changes (preview only)\nToken: color.surface #f0f0f0 → #ff8000\nToken adapter: css-variables");
    expect(await card.getAttribute("style")).toBeNull();

    // Discard all clears element and token previews together.
    // Posting selects the new thread, and D would open it in Design mode; start again from a fresh page.
    await page.reload();
    await page.waitForFunction(() => !!(window as any).komo);
    await openDesign(page);
    await editSurface();
    await card.click();
    await narrow();
    // Escape on a resize handle cancels the gesture, so leave with the close button.
    await page.getByRole("button", { name: "Exit design mode", exact: true }).click();
    await openDesign(page);
    const pending = page.locator(".design-inspector__pending");
    expect(await pending.locator("h3").textContent()).toBe("2 unsaved changes");
    await page.screenshot({ path: join(tmpdir(), `komo-pending-edits-${mode}-pending.png`) });
    await pending.getByRole("button", { name: "Discard all", exact: true }).click();
    await expect.poll(async () => [await background(), await card.getAttribute("style")]).toEqual([light, null]);
    await pending.waitFor({ state: "hidden" });

    await page.evaluate(() => (window as any).komo.destroy());
    expect(await page.evaluate(() => [document.documentElement.getAttribute("style"), document.head.innerHTML])).toEqual(original);
    expect(errors).toEqual([]);
    await page.close();
  });
});
