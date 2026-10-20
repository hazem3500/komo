import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string;
let server: Server;
let browser: Browser;
let origin: string;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-geometry-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
      const key='branch-comments:'+location.origin+':lifecycle';
      localStorage.setItem(key,'synthetic-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
      window.fetch=async input=>{const path=new URL(input instanceof Request?input.url:String(input),location.origin).pathname;return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true,guestResolve:true}:path.endsWith('/threads')?{threads:[]}:{});};
      const frame=location.search.includes('frame');
      if(!frame)document.body.append(document.createElement('aside'));
      window.komo=initKomo({endpoint:location.origin,project:'lifecycle',repo:'example/review',branch:'fixture',pageRoot:frame?document.querySelector('main'):undefined,sidebar:frame?'background':'edge',frame:{scale:location.search.includes('scaled')},design:{experimentalGeometry:!location.search.includes('off')},restoreOpen:false,pollInterval:60000});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<style>body{margin:0;font:16px system-ui}main{min-height:160vh;padding:110px 35px;box-sizing:border-box}#target{width:180px;height:100px;background:#ddedff;border:2px solid #4679a5;padding:10px;box-sizing:border-box}#wrap{transform:scale(1.1,1.15);transform-origin:0 0}#next{margin-top:40px}</style><main><div id="wrap"><div id="target" tabindex="0">Geometry preview</div><p id="next">Normal flow stays in place</p></div></main><script type="module" src="/entry.js"></script>`);
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

describe.skipIf(!chrome)('experimental geometry', () => {
  it.each(['normal', 'frame', 'frame-scaled', 'narrow'])('native move, resize, cancel, grouped undo, comparison, Browse and reset: %s', async mode => {
    const page = await browser.newPage({ viewport: { width: mode === 'narrow' ? 500 : 1280, height: 900 }, reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(5000);
    try {
      await page.goto(`${origin}/?${mode}`);
      await page.waitForFunction(() => !!(window as any).komo);
      await page.keyboard.press('d');
      await page.locator('#target').click();
      const move = page.getByRole('button', { name: 'Move', exact: true });
      await move.waitFor({ state: 'visible' });
      const target = page.locator('#target');
      const baseline = await target.getAttribute('style');
      const before = await target.boundingBox();
      const sibling = await page.locator('#next').boundingBox();
      const drag = async (handle: ReturnType<typeof page.locator>, dx: number, dy: number, cancel = false) => {
        const box = await handle.boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.mouse.down();
        await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2 + dy, { steps: 5 });
        if (cancel) await page.keyboard.press('Escape');
        await page.mouse.up();
      };
      await drag(move, 33, 23, true);
      expect(await target.getAttribute('style')).toBe(baseline);
      await drag(move, 33, 23);
      let moved = await target.boundingBox();
      expect(moved!.x - before!.x).toBeCloseTo(33, 0);
      expect(moved!.y - before!.y).toBeCloseTo(23, 0);
      expect((await page.locator('#next').boundingBox())!.y).toBe(sibling!.y);
      const movedStyle = await target.getAttribute('style');
      await drag(page.getByRole('button', { name: 'Resize width and height', exact: true }), 44, 35);
      expect((await target.boundingBox())!.width - moved!.width).toBeCloseTo(44, 0);
      expect((await target.boundingBox())!.height - moved!.height).toBeCloseTo(35, 0);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      expect(await target.getAttribute('style')).toBe(movedStyle);
      await target.hover();
      await move.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      expect(await target.getAttribute('style')).toBe(movedStyle);
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      expect((await target.boundingBox())!.x).toBeGreaterThan(moved!.x);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      expect(await target.getAttribute('style')).toBe(movedStyle);
      await page.getByRole('button', { name: 'Before', exact: true }).click();
      expect(await target.getAttribute('style')).toBe(baseline);
      await page.getByRole('button', { name: 'After', exact: true }).click();
      expect(await target.getAttribute('style')).toBe(movedStyle);
      await page.keyboard.press('d');
      expect(await target.getAttribute('style')).toBe(baseline);
      await page.keyboard.press('d');
      expect(await target.getAttribute('style')).toBe(movedStyle);
      await target.hover();
      await move.waitFor({ state: 'visible' });
      await page.screenshot({ path: join(directory, `geometry-${mode}.png`) });
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      expect(await target.getAttribute('style')).toBe(baseline);
      await page.evaluate(() => (window as any).komo.destroy());
      expect(await target.getAttribute('style')).toBe(baseline);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
  it('flag off loads no geometry chunk and has no affordances', async () => {
    const page = await browser.newPage();
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    page.setDefaultTimeout(5000);
    try {
      await page.goto(`${origin}/?off`);
      await page.waitForFunction(() => !!(window as any).komo);
      await page.keyboard.press('d');
      await page.locator('#target').click();
      await page.locator('.design-inspector__target').waitFor();
      expect(await page.locator('.design-geometry').count()).toBe(0);
      expect(requests.some(url => url.includes('design-geometry'))).toBe(false);
      expect(await page.locator('#target').getAttribute('style')).toBeNull();
    } finally { await page.close(); }
  });
});

describe.skipIf(!chrome)('geometry ownership and guards', () => {
  it('preserves host transforms, priorities, pending previews and scroll-aware capture; detach does not adopt a replacement', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    try {
      await page.goto(origin);
      await page.waitForFunction(() => !!(window as any).komo);
      const target = page.locator('#target');
      await target.evaluate(node => node.setAttribute('style', 'transform:scale(1.2,1.1);translate:5% 8px !important;transition:opacity 2s linear !important'));
      const baseline = await target.getAttribute('style');
      await page.keyboard.press('d');
      await target.click();
      const move = page.getByRole('button', { name: 'Move', exact: true });
      await move.waitFor();
      await move.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
      const prior = await target.getAttribute('style');
      const rect = await target.boundingBox();
      const box = await move.boundingBox();
      await page.mouse.move(box!.x + 10, box!.y + 10); await page.mouse.down();
      await page.mouse.move(box!.x + 43, box!.y + 33);
      const moved = await target.boundingBox();
      expect(moved!.x - rect!.x).toBeCloseTo(33, 0);
      expect(moved!.y - rect!.y).toBeCloseTo(23, 0);
      await page.mouse.wheel(0, 40); await page.waitForTimeout(100);
      expect((await target.boundingBox())!.y).toBeCloseTo(moved!.y, 0);
      await page.keyboard.press('Escape'); await page.mouse.up();
      expect(await target.getAttribute('style')).toBe(prior);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      expect(await target.getAttribute('style')).toBe(baseline);
      await target.hover(); await move.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
      await target.evaluate(node => { (window as any).oldGeometryTarget = node; const replacement = node.cloneNode(true) as HTMLElement; replacement.removeAttribute('style'); node.replaceWith(replacement); });
      await page.waitForTimeout(60);
      expect(await page.locator('.design-inspector__target').textContent()).toBe('Select an element');
      expect(await target.getAttribute('style')).toBeNull();
      await page.evaluate(() => (window as any).komo.destroy());
      expect(await page.evaluate(() => (window as any).oldGeometryTarget.getAttribute('style'))).toBe(baseline);
      expect(await target.getAttribute('style')).toBeNull();
    } finally { await page.close(); }
  });
  it.each(['rotate(5deg)', 'skewX(5deg)', 'rotateY(10deg)', 'scale(-1,1)'])('explains unsupported transform %s without changing host', async transform => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    try {
      await page.goto(origin); await page.waitForFunction(() => !!(window as any).komo);
      await page.locator('#target').evaluate((node, value) => (node as HTMLElement).style.transform = value, transform);
      const baseline = await page.locator('#target').getAttribute('style');
      await page.keyboard.press('d'); await page.locator('#target').click();
      await page.locator('.design-geometry p').waitFor();
      expect(await page.locator('.design-geometry p').textContent()).toBe("Rotated, skewed, 3D or mirrored boxes can't be previewed.");
      expect(await page.getByRole('button', { name: 'Move', exact: true }).isVisible()).toBe(false);
      expect(await page.locator('#target').getAttribute('style')).toBe(baseline);
    } finally { await page.close(); }
  });
});

describe.skipIf(!chrome)('geometry proposal handoff', () => {
  it('transfers move and both dimensions into a comment and cancels the draft exactly', async () => {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    try {
      await page.goto(origin); await page.waitForFunction(() => !!(window as any).komo);
      await page.keyboard.press('d'); await page.locator('#target').click();
      for (const name of ['Move', 'Resize width and height']) {
        const handle = page.getByRole('button', { name, exact: true });
        await handle.waitFor(); await handle.focus();
        await page.keyboard.press('Enter'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
      }
      await page.locator('.design-inspector__actions').getByRole('button', { name: 'Comment', exact: true }).click();
      await page.waitForSelector('.draft-proposal .design-toggle');
      const proposal = await page.locator('.draft-proposal').textContent();
      expect(proposal).toContain('translate'); expect(proposal).toContain('width'); expect(proposal).toContain('height');
      await page.keyboard.press('Escape');
      expect(await page.locator('#target').getAttribute('style')).toBeNull();
      await page.evaluate(() => (window as any).komo.destroy());
      expect(await page.locator('#target').getAttribute('style')).toBeNull();
    } finally { await page.close(); }
  });
});

describe.skipIf(!chrome)('geometry transaction boundaries', () => {
  it('cancels pointercancel without adding history and clamps both dimensions to the minimum', async () => {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    try {
      await page.goto(origin); await page.waitForFunction(() => !!(window as any).komo);
      await page.keyboard.press('d'); await page.locator('#target').click();
      const handle = page.getByRole('button', { name: 'Resize width and height', exact: true });
      await handle.waitFor();
      const box = await handle.boundingBox();
      await page.mouse.move(box!.x + 10, box!.y + 10); await page.mouse.down();
      await page.mouse.move(box!.x + 40, box!.y + 40);
      await handle.dispatchEvent('pointercancel', { pointerId: 1 });
      await page.mouse.up();
      expect(await page.locator('#target').getAttribute('style')).toBeNull();
      expect(await page.locator('.design-inspector [aria-label=Undo]').isEnabled()).toBe(false);
      await handle.focus(); await page.keyboard.press('Enter');
      for (let i = 0; i < 25; i++) { await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Shift+ArrowUp'); }
      await page.keyboard.press('Enter');
      const dimensions = await page.locator('#target').evaluate(node => [(node as HTMLElement).style.width, (node as HTMLElement).style.height]);
      expect(dimensions).toEqual(['24px', '24px']);
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      expect(await page.locator('#target').getAttribute('style')).toBeNull();
    } finally { await page.close(); }
  });
});
