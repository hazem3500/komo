import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
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

const handle = (page: Page, name: string) => page.locator(`.design-geometry__handle[data-handle=${name}]`);
/** Wake the canvas (panel clicks leave it undecorated), then drag a handle by a screen delta. */
async function drag(page: Page, name: string, dx: number, dy: number, cancel = false) {
  await page.locator('#target').hover();
  await handle(page, name).waitFor({ state: 'visible' });
  const box = (await handle(page, name).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}
/** Ctrl + arrow presses on the focused selection, each a committed resize step. */
async function keys(page: Page, ...presses: string[]) {
  await page.locator('#target').hover();
  await page.locator('.design-geometry__frame').focus();
  for (const press of presses) await page.keyboard.press(press);
}

describe.skipIf(!chrome)('experimental geometry', () => {
  it.each(['normal', 'frame', 'frame-scaled', 'narrow'])('handle resize, cancel, undo, keyboard, comparison, Browse and reset: %s', async mode => {
    const page = await browser.newPage({ viewport: { width: mode === 'narrow' ? 500 : 1280, height: 900 }, reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(5000);
    try {
      await page.goto(`${origin}/?${mode}`);
      await page.waitForFunction(() => !!(window as any).komo);
      await page.keyboard.press('d');
      await page.locator('#target').click();
      await handle(page, 'se').waitFor({ state: 'visible' });
      const target = page.locator('#target');
      const baseline = await target.getAttribute('style');
      const before = await target.boundingBox();
      await drag(page, 'se', 33, 23, true);
      expect(await target.getAttribute('style')).toBe(baseline);
      await drag(page, 'se', 44, 35);
      const sized = (await target.boundingBox())!;
      expect(sized.x).toBeCloseTo(before!.x, 0);
      expect(sized.width - before!.width).toBeCloseTo(44, 0);
      expect(sized.height - before!.height).toBeCloseTo(35, 0);
      const sizedStyle = await target.getAttribute('style');
      await drag(page, 'e', 20, 0);
      expect((await target.boundingBox())!.width - sized.width).toBeCloseTo(20, 0);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      expect(await target.getAttribute('style')).toBe(sizedStyle);
      await keys(page, 'Control+ArrowRight');
      expect((await target.boundingBox())!.width).toBeGreaterThan(sized.width);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      expect(await target.getAttribute('style')).toBe(sizedStyle);
      await page.getByRole('button', { name: 'Before', exact: true }).click();
      expect(await target.getAttribute('style')).toBe(baseline);
      await page.getByRole('button', { name: 'After', exact: true }).click();
      expect(await target.getAttribute('style')).toBe(sizedStyle);
      await page.keyboard.press('d');
      expect(await target.getAttribute('style')).toBe(baseline);
      await page.keyboard.press('d');
      expect(await target.getAttribute('style')).toBe(sizedStyle);
      await target.hover();
      await handle(page, 'se').waitFor({ state: 'visible' });
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
      await keys(page, 'Control+ArrowRight');
      const prior = await target.getAttribute('style');
      const rect = (await target.boundingBox())!;
      const box = (await handle(page, 'se').boundingBox())!;
      await page.mouse.move(box.x + 8, box.y + 8); await page.mouse.down();
      await page.mouse.move(box.x + 41, box.y + 31);
      const sized = (await target.boundingBox())!;
      expect(sized.width - rect.width).toBeCloseTo(33, 0);
      expect(sized.height - rect.height).toBeCloseTo(23, 0);
      // Scrolling under a held handle keeps the dragged edge under the pointer.
      await page.mouse.wheel(0, 40); await page.waitForTimeout(100);
      const scrolled = (await target.boundingBox())!;
      // The host's centred scale drifts the box a little as it grows; it no longer scrolls away.
      expect(Math.abs(scrolled.y + scrolled.height - (sized.y + sized.height))).toBeLessThan(3);
      expect(scrolled.height - sized.height).toBeGreaterThan(30);
      await page.keyboard.press('Escape'); await page.mouse.up();
      expect(await target.getAttribute('style')).toBe(prior);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      expect(await target.getAttribute('style')).toBe(baseline);
      await keys(page, 'Control+ArrowDown');
      await target.evaluate(node => { (window as any).oldGeometryTarget = node; const replacement = node.cloneNode(true) as HTMLElement; replacement.removeAttribute('style'); node.replaceWith(replacement); });
      await page.waitForTimeout(60);
      expect(await page.locator('.design-inspector__target').textContent()).toBe('Select an element');
      expect(await target.getAttribute('style')).toBeNull();
      await page.evaluate(() => (window as any).komo.destroy());
      expect(await page.evaluate(() => (window as any).oldGeometryTarget.getAttribute('style'))).toBe(baseline);
      expect(await target.getAttribute('style')).toBeNull();
    } finally { await page.close(); }
  });
  it.each(['rotate(5deg)', 'skewX(5deg)', 'rotateY(10deg)', 'scale(-1,1)'])('explains unsupported transform %s in the panel without changing host', async transform => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    try {
      await page.goto(origin); await page.waitForFunction(() => !!(window as any).komo);
      await page.locator('#target').evaluate((node, value) => (node as HTMLElement).style.transform = value, transform);
      const baseline = await page.locator('#target').getAttribute('style');
      await page.keyboard.press('d'); await page.locator('#target').click();
      const reason = page.locator('.design-inspector .design-geometry-note p');
      await reason.waitFor();
      expect(await reason.textContent()).toBe("Rotated, skewed, 3D or mirrored boxes can't be previewed.");
      expect(await page.locator('.design-geometry__handle:visible').count()).toBe(0);
      expect(await page.locator('.design-geometry__frame').isVisible()).toBe(false);
      expect(await page.locator('#target').getAttribute('style')).toBe(baseline);
    } finally { await page.close(); }
  });
});

describe.skipIf(!chrome)('geometry proposal handoff', () => {
  it('transfers both dimensions into a comment and cancels the draft exactly', async () => {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    try {
      await page.goto(origin); await page.waitForFunction(() => !!(window as any).komo);
      await page.keyboard.press('d'); await page.locator('#target').click();
      await keys(page, 'Control+ArrowRight', 'Control+ArrowDown');
      await page.locator('.design-inspector__actions').getByRole('button', { name: 'Comment', exact: true }).click();
      await page.waitForSelector('.draft-proposal .design-toggle');
      const proposal = await page.locator('.draft-proposal').textContent();
      expect(proposal).toContain('width'); expect(proposal).toContain('height');
      expect(proposal).not.toContain('translate');
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
      const corner = handle(page, 'se');
      await corner.waitFor();
      const box = (await corner.boundingBox())!;
      await page.mouse.move(box.x + 8, box.y + 8); await page.mouse.down();
      await page.mouse.move(box.x + 40, box.y + 40);
      await corner.dispatchEvent('pointercancel', { pointerId: 1 });
      await page.mouse.up();
      expect(await page.locator('#target').getAttribute('style')).toBeNull();
      expect(await page.locator('.design-inspector [aria-label=Undo]').isEnabled()).toBe(false);
      await keys(page, ...Array.from({ length: 25 }, () => ['Control+Shift+ArrowLeft', 'Control+Shift+ArrowUp']).flat());
      const dimensions = await page.locator('#target').evaluate(node => [(node as HTMLElement).style.width, (node as HTMLElement).style.height]);
      expect(dimensions).toEqual(['24px', '24px']);
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      expect(await page.locator('#target').getAttribute('style')).toBeNull();
    } finally { await page.close(); }
  });
});
