import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The Tokens view in real Chrome: page-wide edits through discoverCssTokens'
// injected stylesheet, per theme option, Before/After, Undo, Reset, a page
// comment and exact teardown, in floating, reflow and scaled modes.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-token-page-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { discoverCssTokens } from ${JSON.stringify(resolve("src/adapters/css-variables.ts"))};
      import { classTheme } from ${JSON.stringify(resolve("src/adapters/class-theme.ts"))};
      const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':tokens';
      localStorage.setItem(key,'synthetic-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
      const qa=window.tokenQA={posts:[]};
      window.fetch=async(input,init)=>{const path=new URL(String(input instanceof Request?input.url:input)).pathname,method=init?.method??'GET';
        if(method==='POST'&&path.endsWith('/threads')){qa.posts.push(JSON.parse(init.body));return Response.json({id:'posted-thread',commentId:'posted-comment'})}
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads:qa.posts.map(post=>({id:'posted-thread',page:post.page,anchor:post.anchor,tags:[],resolved:false,resolvedBy:null,createdAt:1,updatedAt:1,comments:[{id:'posted-comment',body:post.body,author:user,createdAt:1,editedAt:null,reactions:{}}]}))}:{})};
      const mode=new URLSearchParams(location.search).get('mode');
      if(mode==='floating')document.body.append(document.createElement('aside'));
      const theme=classTheme({id:'mode',options:[{id:'light'},{id:'dark',class:'dark'}]});
      window.komo=initKomo({endpoint:location.origin,project:'tokens',repo:'example/review',branch:'fixture',pageRoot:mode==='floating'?undefined:document.querySelector('main'),sidebar:mode==='floating'?'edge':'background',frame:{scale:mode==='scaled'},restoreOpen:false,pollInterval:60000,design:{tokens:discoverCssTokens({scopes:{dark:'.dark'}}),themes:[theme]}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<html style="--radius-card: 6px"><style>:root{--color-gray-900:#131213;--color-gray-700:#444444;--color-text:var(--color-gray-900);--color-surface:240 240 240;--radius-card:6px}.dark{--color-text:#e6e6e6;--color-surface:19 18 19}body{margin:0}main{min-height:100vh;box-sizing:border-box;padding:70px}#card{width:240px;height:96px;padding:16px;border-radius:var(--radius-card);background:rgb(var(--color-surface));color:var(--color-text);font:16px sans-serif}</style><main><article id="card">Example card</article></main><script type="module" src="/entry.js"></script></html>`);
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

const light = { background: "rgb(240, 240, 240)", color: "rgb(19, 18, 19)" };

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("Tokens view in %s", mode => {
  it("edits tokens page-wide per theme, flips Before/After, undoes, resets and comments on the page", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?mode=${mode}`);
    await page.waitForFunction(() => !!(window as any).komo);
    const original = await page.evaluate(() => [document.documentElement.getAttribute("style"), document.documentElement.className, document.head.innerHTML]);
    const look = () => page.locator("#card").evaluate(node => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color }));
    const variable = (name: string) => page.evaluate(name => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), name);
    const row = (name: string) => page.locator(".design-token-row").filter({ has: page.locator("b").getByText(name, { exact: true }) });
    const bar = page.locator(".design-token-bar");
    const count = bar.locator(".design-inspector__count");
    // Every Custom editor applies live: Enter keeps the value and the popup takes it when it closes.
    const custom = async (name: string, value: string) => {
      await row(name).locator("button").first().click();
      const length = /^([\d.]+)px$/.exec(value);
      const input = length ? page.locator(".komo-custom .komo-typed__field input").first() : page.locator('.komo-color input[aria-label="Hex"]');
      await input.fill(length ? length[1] : value.replace("#", ""));
      await input.press("Enter");
      await row(name).locator("button").first().click();
      await page.locator(".komo-tokens").waitFor({ state: "detached" });
    };
    // The Tokens header shows one light/dark switch: one click flips it.
    const theme = async (label: string) => {
      const toggle = page.locator(".design-inspector__heading .design-theme-toggle");
      await toggle.click();
      await expect.poll(() => toggle.getAttribute("aria-label")).toBe(`Theme: ${label}`);
    };

    await page.keyboard.press("d");
    const open = page.getByRole("button", { name: "Edit tokens", exact: true });
    await open.waitFor();
    await page.screenshot({ path: join(tmpdir(), `komo-token-page-${mode}-empty.png`) });
    await open.click();
    await row("surface").waitFor();
    expect(await page.locator(".design-inspector__target").textContent()).toBe("Tokens");
    expect(await page.locator(".design-token-page__list small").allTextContents()).toEqual(["Color", "Radius"]);
    expect(await row("surface").locator("i").textContent()).toBe("#f0f0f0");
    expect(await row("text").locator("i").textContent()).toBe("gray-900");
    expect(await look()).toEqual(light);

    // A raw-channel color edits as hex; the variable receives channels.
    await custom("surface", "#ff8000");
    expect(await look()).toEqual({ ...light, background: "rgb(255, 128, 0)" });
    expect(await variable("--color-surface")).toBe("255 128 0");
    expect(await row("surface").getAttribute("data-changed")).toBe("");
    expect(await count.textContent()).toBe("1 change");

    // An alias is repointed from the token list, with Custom… under it; there are no tabs.
    await row("text").locator("button").first().click();
    expect(await page.locator(".komo-tokens__tabs").count()).toBe(0);
    expect(await page.locator(".komo-tokens__more").isVisible()).toBe(true);
    await page.locator('.komo-tokens [role="option"]').filter({ hasText: "gray-700" }).click();
    expect((await look()).color).toBe("rgb(68, 68, 68)");
    expect(await row("text").locator("i").textContent()).toBe("gray-700");

    // Dark is its own option: light edits stay out of it, and its edit stays out of light.
    await theme("Dark");
    await expect.poll(look).toEqual({ background: "rgb(19, 18, 19)", color: "rgb(230, 230, 230)" });
    await expect.poll(() => row("text").locator("i").textContent()).toBe("#e6e6e6");
    expect(await row("surface").getAttribute("data-changed")).toBeNull();
    await custom("text", "#f5f5f5");
    expect((await look()).color).toBe("rgb(245, 245, 245)");
    await page.screenshot({ path: join(tmpdir(), `komo-token-page-${mode}-dark.png`) });
    await theme("Light");
    await expect.poll(look).toEqual({ background: "rgb(255, 128, 0)", color: "rgb(68, 68, 68)" });
    expect(await count.textContent()).toBe("3 changes");

    // Before/After and B flip the whole preview.
    await bar.getByRole("button", { name: "Before", exact: true }).click();
    expect(await look()).toEqual(light);
    expect(await page.locator("style[data-komo-token-preview]").count()).toBe(0);
    await bar.getByRole("button", { name: "After", exact: true }).click();
    expect((await look()).background).toBe("rgb(255, 128, 0)");
    await page.locator(".design-inspector__target").click();
    await page.keyboard.press("b");
    expect(await look()).toEqual(light);
    await page.keyboard.press("b");
    expect((await look()).background).toBe("rgb(255, 128, 0)");
    await page.screenshot({ path: join(tmpdir(), `komo-token-page-${mode}.png`) });

    // Undo is chronological; a row's reset leaves no undo step.
    await bar.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await count.textContent()).toBe("2 changes");
    await theme("Dark");
    await expect.poll(look).toEqual({ background: "rgb(19, 18, 19)", color: "rgb(230, 230, 230)" });
    await theme("Light");
    await row("surface").getByRole("button", { name: "Reset color.surface", exact: true }).click();
    expect(await look()).toEqual({ ...light, color: "rgb(68, 68, 68)" });
    expect(await count.textContent()).toBe("1 change");
    await bar.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await look()).toEqual(light);
    expect(await count.textContent()).toBe("");
    await custom("surface", "#ff8000");
    await custom("card", "12px");
    expect(await page.locator("#card").evaluate(node => getComputedStyle(node).borderTopLeftRadius)).toBe("12px");
    await bar.getByRole("button", { name: "Reset all", exact: true }).click();
    expect(await look()).toEqual(light);
    expect(await page.locator("style[data-komo-token-preview]").count()).toBe(0);

    // The comment is about the page: no element target, pinned in view.
    await custom("surface", "#ff8000");
    await custom("card", "12px");
    await bar.getByRole("button", { name: "Comment", exact: true }).click();
    const draft = page.locator(".draft-proposal");
    await draft.waitFor();
    expect(await draft.locator(".design-card-title").textContent()).toBe("Token changes");
    // Like an element's card, it starts on After and flips the token preview stylesheet.
    const label = draft.locator(".design-prop").first();
    expect(await label.textContent()).toBe("surface");
    expect(await label.getAttribute("aria-label")).toBe("color.surface (light)");
    const toggle = draft.locator(".design-toggle");
    expect(await toggle.getByRole("button", { name: "After", exact: true }).getAttribute("aria-pressed")).toBe("true");
    expect((await look()).background).toBe("rgb(255, 128, 0)");
    await toggle.getByRole("button", { name: "Before", exact: true }).click();
    expect(await look()).toEqual(light);
    expect(await page.locator("style[data-komo-token-preview]").count()).toBe(0);
    await toggle.getByRole("button", { name: "After", exact: true }).click();
    await expect.poll(async () => (await look()).background).toBe("rgb(255, 128, 0)");
    expect(await page.locator("#card").evaluate(node => getComputedStyle(node).borderTopLeftRadius)).toBe("12px");
    // komo's tooltip names the full path.
    await label.hover();
    await expect.poll(() => page.locator(".sidebar-tooltip[data-open]").textContent()).toBe("color.surface (light)");
    await page.screenshot({ path: join(tmpdir(), `komo-token-page-${mode}-card.png`) });
    await page.getByRole("button", { name: "Post comment", exact: true }).click();
    await expect.poll(look).toEqual(light);
    expect(await page.locator("style[data-komo-token-preview]").count()).toBe(0);
    await page.waitForFunction(() => (window as any).tokenQA.posts.length === 1);
    const posted = await page.evaluate(() => (window as any).tokenQA.posts[0]);
    expect(posted.anchor.selector).toBe("body");
    expect(posted.body).toBe("Proposed token changes (preview only)\nToken: color.surface (light) #f0f0f0 → #ff8000\nToken: radius.card (light) 6px → 12px\nToken adapter: css-variables");
    const pin = page.locator('.pin[aria-label^="Comment 1"][aria-label$=": Token changes · 2 edits"]');
    // Pins redraw as the posted thread settles; wait for a laid-out one.
    await expect.poll(async () => {
      const box = await pin.boundingBox();
      return !!box && box.y >= 0 && box.y + box.height <= 800 && box.x >= 0 && box.x + box.width <= 1280;
    }).toBe(true);

    // Destroy leaves the page exactly as it was.
    await page.keyboard.press("Escape");
    await page.keyboard.press("d");
    await page.getByRole("button", { name: "Edit tokens", exact: true }).click();
    await custom("surface", "#00ff00");
    expect((await look()).background).toBe("rgb(0, 255, 0)");
    await page.evaluate(() => (window as any).komo.destroy());
    await expect.poll(look).toEqual(light);
    expect(await page.evaluate(() => [document.documentElement.getAttribute("style"), document.documentElement.className, document.head.innerHTML])).toEqual(original);
    expect(errors).toEqual([]);
    await page.close();
  });

  it.each([{ width: 1280, height: 800 }, { width: 1280, height: 520 }, { width: 420, height: 760 }])("opens a row's popup above later rows, inside the viewport, at $width×$height", async viewport => {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?mode=${mode}`);
    await page.waitForFunction(() => !!(window as any).komo);
    await page.keyboard.press("d");
    await page.getByRole("button", { name: "Edit tokens", exact: true }).click();
    const rows = page.locator(".design-token-row");
    await rows.nth(2).waitFor();
    // The first row has every other row after it, under where its popup opens.
    const row = rows.first();
    await row.locator("button").first().click();
    const popup = page.locator(".komo-tokens");
    await popup.waitFor();
    await popup.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
    const result = await popup.evaluate((node, anchor) => {
      const root = node.getRootNode() as ShadowRoot, rect = node.getBoundingClientRect();
      const points: number[][] = [];
      for (const y of [.1, .3, .5, .7, .9]) for (const x of [.1, .5, .9]) points.push([rect.left + rect.width * x, rect.top + rect.height * y]);
      return {
        open: node.matches(":popover-open"),
        misses: points.filter(([x, y]) => !node.contains(root.elementFromPoint(x, y))),
        visible: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
        clear: rect.top >= anchor.bottom || rect.bottom <= anchor.top,
      };
    }, (await row.boundingBox().then(box => ({ top: box!.y, bottom: box!.y + box!.height }))));
    await page.screenshot({ path: join(tmpdir(), `komo-token-page-popup-${mode}-${viewport.width}x${viewport.height}.png`) });
    expect(result).toEqual({ open: true, misses: [], visible: true, clear: true });
    await page.keyboard.press("Escape");
    await expect.poll(() => popup.count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });
});

