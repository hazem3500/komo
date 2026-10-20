// Dot and compact pin rendering, the unread breathing halo, and the Design
// mode empty state, in real Chrome against a synthetic loopback fixture.
import { build } from "esbuild";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = join(tmpdir(), "komo-shots", "dot-pins-empty-state");
const tag = process.env.KOMO_SHOT_TAG ?? "after";
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-dot-pins-"));
  await mkdir(shots, { recursive: true });
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { captureAnchor } from ${JSON.stringify(resolve("src/anchors.ts"))};
      import { discoverCssTokens } from ${JSON.stringify(resolve("src/adapters/css-variables.ts"))};
      const query=new URLSearchParams(location.search),layout=query.get('layout')??'floating';
      const user={id:'reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':dots';
      localStorage.setItem(key,'fixture-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'fixture-session',user}));
      localStorage.setItem('branch-comments:read:dots:example/review',JSON.stringify({'thread-1':99}));
      const authors=[{id:'author-a',name:'Avery Example',verified:true,accentColor:'#7f56d9'},{id:'author-b',name:'Blake Sample',verified:true,accentColor:'#f79009'},{id:'author-c',name:'Casey Demo',verified:true,accentColor:'#12b76a'}];
      const thread=(id,node,dx,dy,author,at)=>{const box=node.getBoundingClientRect(),point={x:box.left+dx,y:box.top+dy};
        return {id,page:'/',anchor:captureAnchor(node,point,point),resolved:false,resolvedBy:null,createdAt:at,updatedAt:at,tags:[],
          comments:[{id:'comment-'+id,author,body:'Synthetic note '+id,createdAt:at,editedAt:null,reactions:{}}]};};
      const threads=[...document.querySelectorAll('.stage > section')].map((node,index)=>thread('thread-'+index,node,40,48,authors[index],index+1));
      window.addThread=()=>{threads.push(thread('thread-new',document.querySelector('#copy'),60,10,authors[2],50));window.dispatchEvent(new Event('online'));};
      window.fetch=async input=>{
        const path=new URL(input instanceof URL?input.href:typeof input==='string'?input:input.url).pathname;
        return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads}:{});
      };
      if(layout==='floating')document.body.append(document.createElement('aside'));
      const size=query.get('size');
      window.komo=initKomo({endpoint:location.origin,project:'dots',repo:'example/review',branch:'fixture',
        pageRoot:layout==='floating'?undefined:document.querySelector('main'),sidebar:layout==='floating'?'edge':'background',
        ...(layout==='scaled'?{frame:{scale:true}}:{}),restoreOpen:false,pollInterval:60000,shortcuts:{design:'Shift+D'},
        ...(size?{pins:{size}}:{}),...(query.get('tokens')?{design:{tokens:discoverCssTokens()}}:{})});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      const dark = url.searchParams.get("theme") === "dark";
      response.setHeader("content-type", "text/html");
      response.end(`<style>:root{--color-brand:#3355ff;--radius-card:12px}html,body{color-scheme:${dark ? "dark" : "light"}}body{margin:0;font:15px system-ui;background:${dark ? "#121212" : "#fff"};color:${dark ? "#e5e5e5" : "#1d2939"}}main{min-height:100vh;box-sizing:border-box;padding:120px 96px}.stage{display:flex;gap:24px}.stage>section{box-sizing:border-box;width:150px;height:96px;padding:14px;border-radius:var(--radius-card);font-size:13px}#card{background:${dark ? "#1f1f1f" : "#f2f4f7"};border:1px solid ${dark ? "#333" : "#d0d5dd"}}#hero{background:linear-gradient(135deg,var(--color-brand),#ff4f8b);color:#fff}p{max-width:480px}</style><main><div class="stage"><section id="plain">Page</section><section id="card">Card</section><section id="hero">Hero</section></div><p id="copy">Double-click this paragraph to edit its text.</p></main><script type="module" src="/entry.js"></script>`);
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

type Options = { reducedMotion?: "reduce" | "no-preference"; scale?: number };
async function open(query: string, options: Options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: options.scale ?? 1, reducedMotion: options.reducedMotion ?? "no-preference" });
  page.setDefaultTimeout(8000);
  await page.goto(`${origin}/?${query}`);
  await page.locator(".pin").first().waitFor();
  return page;
}
const settle = (page: Page, ms = 400) => page.waitForTimeout(ms);
const face = (page: Page, index: number) => page.locator(".pin .avatar").nth(index).evaluate(node => {
  const style = getComputedStyle(node), box = node.getBoundingClientRect();
  return { fill: style.backgroundColor, shadow: style.boxShadow, opacity: Number(style.opacity), width: box.width, height: box.height };
});
const box = (page: Page, index = 0) => page.locator(".pin").nth(index).evaluate(node => {
  const rect = node.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
});
const layers = (shadow: string) => shadow.split(/,(?![^(]*\))/).map(layer => layer.trim());
const halos = (page: Page) => page.evaluate(() => document.querySelector("[data-branch-comments]")!.shadowRoot!.getAnimations()
  .filter(animation => (animation as CSSAnimation).animationName === "komo-pin-breathe")
  .map(animation => {
    const effect = animation.effect as KeyframeEffect;
    return { thread: (effect.target as HTMLElement).dataset.thread, pseudo: effect.pseudoElement, duration: Number(effect.getTiming().duration), from: Number(effect.getKeyframes()[0]!.opacity) };
  })
  .sort((a, b) => a.thread!.localeCompare(b.thread!)));

describe.skipIf(!chrome).each(["light", "dark"])("dot pins on a %s page", theme => {
  it("draws solid accent dots with a surface ring and soft shadow, quieter when read, in a 24px target", async () => {
    const page = await open(`size=dot&theme=${theme}`);
    const ring = theme === "dark" ? "rgb(13, 13, 13)" : "rgb(248, 247, 244)";
    const unread = await face(page, 0), read = await face(page, 1);
    expect(unread).toMatchObject({ fill: "rgb(127, 86, 217)", opacity: 1, width: 12, height: 12 });
    // Read dots stay filled with the author's accent, at a lower opacity.
    expect(read.fill).toBe("rgb(247, 144, 9)");
    expect(read.opacity).toBeGreaterThanOrEqual(0.4);
    expect(read.opacity).toBeLessThanOrEqual(0.6);
    for (const look of [unread, read]) {
      const [first, ...rest] = layers(look.shadow);
      expect(first).toBe(`${ring} 0px 0px 0px 2px`);
      // A soft drop shadow below the ring.
      expect(rest.some(layer => /0px [1-9][\d.]*px [1-9][\d.]*px/.test(layer))).toBe(true);
    }
    const target = await box(page);
    expect(target).toMatchObject({ width: 24, height: 24 });
    for (const [dx, dy] of [[1, 1], [23, 1], [1, 23], [23, 23], [12, 12]])
      expect(await page.evaluate(([x, y]) => document.querySelector("[data-branch-comments]")!.shadowRoot!
        .elementFromPoint(x, y)?.closest(".pin")?.getAttribute("data-thread"), [target.x + dx, target.y + dy])).toBe("thread-0");
    expect(await page.locator(".pin").first().getAttribute("aria-label")).toBe("Comment 1 by Avery Example: Synthetic note thread-0");
    // Compact pins share the ring and shadow language.
    const compact = await open(`size=compact&theme=${theme}`);
    const chip = await face(compact, 0);
    expect(chip.width).toBe(20);
    expect(layers(chip.shadow)[0]).toBe(`${ring} 0px 0px 0px 2px`);
    expect(layers(chip.shadow).slice(1)).toEqual(layers(unread.shadow).slice(1));
    await compact.close();
    await page.close();
  }, 60000);
});

describe.skipIf(!chrome)("unread dot halo", () => {
  it("breathes on unread dots for about three cycles, pauses, and resumes once for new unread threads", async () => {
    const page = await open("size=dot");
    const started = Date.now();
    let running = await halos(page);
    expect(running.map(halo => halo.thread)).toEqual(["thread-0", "thread-2"]);
    for (const halo of running) {
      expect(halo.pseudo).toBe("::before");
      expect(halo.duration).toBeGreaterThanOrEqual(1500);
      expect(halo.duration).toBeLessThanOrEqual(2000);
      expect(halo.from).toBeGreaterThanOrEqual(0.2);
      expect(halo.from).toBeLessThanOrEqual(0.3);
    }
    await expect.poll(() => halos(page), { timeout: 9000, intervals: [250] }).toEqual([]);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThan(3500);
    expect(elapsed).toBeLessThan(8000);
    expect(await page.locator(".pins").getAttribute("data-breathe")).toBeNull();
    // Re-renders alone do not restart it.
    await page.mouse.wheel(0, 40);
    await settle(page, 600);
    expect(await halos(page)).toEqual([]);
    await page.evaluate(() => (window as unknown as { addThread(): void }).addThread());
    await expect.poll(async () => (await halos(page)).map(halo => halo.thread)).toContain("thread-new");
    running = await halos(page);
    expect(running.map(halo => halo.thread)).not.toContain("thread-1");
    await page.close();
  }, 60000);

  it("never animates under reduced motion, at rest or when expanding", async () => {
    const page = await open("size=dot", { reducedMotion: "reduce" });
    await settle(page);
    const animations = () => page.evaluate(() => document.querySelector("[data-branch-comments]")!.shadowRoot!.getAnimations()
      .filter(animation => (animation.effect as KeyframeEffect).target?.closest?.(".pins")).length);
    expect(await animations()).toBe(0);
    expect(await page.locator(".pins").getAttribute("data-breathe")).toBeNull();
    const target = await box(page);
    await page.mouse.move(target.x + 12, target.y + 12);
    expect(await animations()).toBe(0);
    expect((await box(page)).width).toBe(34);
    await page.close();
  }, 30000);
});

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("pin expansion in %s", layout => {
  it("grows dots and compact pins into the full pin in one motion from a fixed anchor corner", async () => {
    for (const size of ["dot", "compact"] as const) {
      const page = await open(`size=${size}&layout=${layout}`);
      const rest = await box(page);
      const right = (await page.locator(".pin").first().getAttribute("data-pointer")) === "right";
      const sampling = page.evaluate(async () => {
        const pin = document.querySelector("[data-branch-comments]")!.shadowRoot!.querySelector<HTMLElement>(".pin")!;
        const avatar = pin.querySelector(".avatar")!;
        const frames: Array<{ left: number; right: number; bottom: number; face: number; background: string }> = [];
        const start = performance.now();
        while (performance.now() - start < 600) {
          const outer = pin.getBoundingClientRect(), inner = avatar.getBoundingClientRect();
          frames.push({ left: outer.left, right: outer.right, bottom: outer.bottom, face: inner.width, background: getComputedStyle(pin).backgroundColor });
          await new Promise(done => requestAnimationFrame(done));
        }
        return frames;
      });
      await page.waitForTimeout(80);
      await page.mouse.move(rest.x + 12, rest.y + 12);
      const frames = await sampling;
      const anchor = right ? rest.x + rest.width : rest.x;
      for (const frame of frames) {
        expect(right ? frame.right : frame.left).toBeCloseTo(anchor, 0);
        expect(frame.bottom).toBeCloseTo(rest.y + rest.height, 0);
        // The hit box never paints its own fill mid-motion.
        expect(frame.background).toBe("rgba(0, 0, 0, 0)");
      }
      const faces = frames.map(frame => frame.face);
      expect(faces[0]).toBe(size === "dot" ? 12 : 20);
      expect(faces.at(-1)).toBe(34);
      for (let index = 1; index < faces.length; index++) expect(faces[index]!).toBeGreaterThanOrEqual(faces[index - 1]! - 0.01);
      // Several in-between frames: a morph, not a jump.
      expect(new Set(faces.filter(width => width > faces[0]! && width < 34)).size).toBeGreaterThanOrEqual(3);
      // Focus keeps its ring.
      await page.mouse.move(rest.x - 300, rest.y + 300);
      await page.keyboard.press("Shift");
      await page.locator(".pin").first().focus();
      await settle(page);
      expect(await page.locator(".pin").first().evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
      expect((await box(page)).width).toBe(34);
      await page.close();
    }
  }, 60000);
});

describe.skipIf(!chrome)("Design mode empty state", () => {
  async function design(query: string, options: Options = {}) {
    const page = await open(query, options);
    await page.keyboard.press("Shift+D");
    await page.locator(".design-inspector__empty").waitFor();
    await settle(page, 300);
    return page;
  }

  it("shows one hint line, a quiet shortcuts link, and no token action without a token adapter", async () => {
    const page = await design("");
    const empty = page.locator(".design-inspector__empty");
    expect(await empty.locator("strong").textContent()).toBe("Select an element");
    expect(await empty.locator("li").count()).toBe(0);
    expect(await empty.locator("p").allTextContents()).toEqual(["Click to inspect · Double-click text to edit"]);
    expect(await empty.getByRole("button", { name: /Edit tokens/ }).count()).toBe(0);
    const link = empty.getByRole("button", { name: "Keyboard shortcuts", exact: true });
    expect(await link.getAttribute("aria-keyshortcuts")).toBe("?");
    // The only keycap is the quiet filled chip.
    expect(await empty.locator("kbd").allTextContents()).toEqual(["?"]);
    expect(await empty.locator(".komo-kbd").getAttribute("data-variant")).toBe("surface");
    const cap = await empty.locator("kbd").evaluate(node => ({ shadow: getComputedStyle(node).boxShadow, border: getComputedStyle(node).borderTopStyle, fill: getComputedStyle(node).backgroundColor }));
    expect(cap).toMatchObject({ shadow: "none", border: "none" });
    expect(cap.fill).not.toBe("rgba(0, 0, 0, 0)");

    await link.click();
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await help.waitFor();
    const keys = (label: string) => help.evaluate((dialog, label) => [...dialog.querySelectorAll(":scope > div")]
      .find(line => line.firstChild?.textContent === label)?.querySelector(".komo-kbd")?.getAttribute("aria-label"), label);
    const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));
    // Every hint that left the empty state, with the configured bindings.
    expect(await keys("Inspect element")).toBe("Click");
    expect(await keys("Select an inner target")).toBe(mac ? "Command + Click" : "Control + Click");
    expect(await keys("Edit text")).toBe("Double-click");
    expect(await keys("Previous sibling")).toBe("ArrowLeft");
    expect(await keys("Next sibling")).toBe("ArrowRight");
    expect(await keys("Parent element")).toBe(mac ? "Option + ArrowUp" : "Alt + ArrowUp");
    expect(await keys("Child element")).toBe(mac ? "Option + ArrowDown" : "Alt + ArrowDown");
    expect(await keys("Exit design mode")).toBe("Escape");
    expect(await keys("Design mode")).toBe("Shift + D");
    expect(await keys("Keyboard shortcuts")).toBe("?");
    await page.keyboard.press("Escape");
    await help.waitFor({ state: "detached" });
    // Closing help stays in Design mode and returns focus to the link.
    expect(await page.locator(".design-inspector__empty").count()).toBe(1);
    expect(await link.evaluate(node => node === (node.getRootNode() as ShadowRoot).activeElement)).toBe(true);
    // ? opens the same help from the canvas.
    await page.evaluate(() => (document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("?");
    await help.waitFor();
    await page.keyboard.press("Escape");
    await help.waitFor({ state: "detached" });
    await page.close();
  }, 30000);

  it("makes Edit tokens the primary action when a token adapter is configured", async () => {
    const page = await design("tokens=1");
    const empty = page.locator(".design-inspector__empty");
    const tokens = empty.getByRole("button", { name: "Edit tokens", exact: true });
    await tokens.waitFor();
    const names = await empty.locator("button").evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).offsetParent).map(node => node.getAttribute("aria-label") ?? node.textContent));
    expect(names).toEqual(["Edit tokens", "Keyboard shortcuts"]);
    const [primary, link] = await empty.locator("button").evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).offsetParent).map(node => getComputedStyle(node).backgroundColor));
    expect(primary).not.toBe("rgba(0, 0, 0, 0)");
    expect(link).toBe("rgba(0, 0, 0, 0)");
    await tokens.click();
    await page.locator(".design-token-row").first().waitFor();
    expect(await page.locator(".design-inspector__target").textContent()).toBe("Tokens");
    await page.close();
  }, 30000);
});

it.skipIf(!chrome)("captures dot and compact pin close-ups and the empty state on light and dark pages", async () => {
  const clip = { x: 90, y: 114, width: 510, height: 108 };
  for (const theme of ["light", "dark"]) {
    for (const size of ["dot", "compact"]) {
      const page = await open(`size=${size}&theme=${theme}`, { reducedMotion: "reduce", scale: 3 });
      await settle(page);
      await page.screenshot({ path: join(shots, `${tag}-${size}-${theme}.png`), clip });
      const target = await box(page, 2);
      await page.mouse.move(target.x + 12, target.y + 12);
      await settle(page);
      await page.screenshot({ path: join(shots, `${tag}-${size}-${theme}-hover.png`), clip });
      await page.close();
    }
    const breathing = await open(`size=dot&theme=${theme}`, { scale: 3 });
    await settle(breathing, 260);
    await breathing.screenshot({ path: join(shots, `${tag}-dot-${theme}-halo.png`), clip });
    await breathing.close();
    for (const tokens of ["", "tokens=1"]) {
      const page = await open(`theme=${theme}&${tokens}`, { reducedMotion: "reduce", scale: 2 });
      await page.keyboard.press("Shift+D");
      await page.locator(".design-inspector__empty").waitFor();
      await settle(page);
      const inspector = (await page.locator(".design-inspector").boundingBox())!;
      const pad = 16;
      await page.screenshot({
        path: join(shots, `${tag}-empty-${theme}${tokens ? "-tokens" : ""}.png`),
        clip: { x: inspector.x - pad, y: inspector.y - pad, width: inspector.width + pad * 2, height: inspector.height + pad * 2 },
      });
      await page.close();
    }
  }
  const files = readdirSync(shots).filter(file => file.endsWith(".png"));
  const names = [...new Set(files.map(file => file.replace(/^(before|after)-/, "")))].sort();
  const cell = (file: string) => files.includes(file) ? `<img src="${file}" alt="${file}">` : "<span>not captured</span>";
  writeFileSync(join(shots, "index.html"), `<!doctype html><meta charset="utf-8"><title>komo dot pins and empty state</title>
<style>body{margin:24px;font:13px system-ui;background:#f5f5f4;color:#1c1917}table{border-collapse:collapse}td,th{padding:8px;vertical-align:top;text-align:left;border-bottom:1px solid #e7e5e4}img{max-width:560px;border:1px solid #d6d3d1;background:#fff}th{font-weight:600}</style>
<h1>komo · dot pins and Design empty state</h1><table><tr><th>View</th><th>Before</th><th>After</th></tr>
${names.map(name => `<tr><td>${name.replace(/\.png$/, "")}</td><td>${cell(`before-${name}`)}</td><td>${cell(`after-${name}`)}</td></tr>`).join("\n")}
</table>`);
  expect(existsSync(join(shots, `${tag}-dot-light.png`))).toBe(true);
}, 120000);
