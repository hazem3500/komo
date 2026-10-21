import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

// Boolean props render as switches in real Chrome: the white thumb sits 2px in from the
// track's start when off and from its end when on, never mid-track, and an unset prop is an
// empty dashed track with an "unset" label and no thumb. Positions are read from the computed
// pseudo-element and from the rendered pixels.
// KOMO_SCREENSHOTS=<label> writes switch screenshots to <os tmpdir>/komo-prop-switch/<label>.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = process.env.KOMO_SCREENSHOTS ? join(tmpdir(), "komo-prop-switch", process.env.KOMO_SCREENSHOTS) : undefined;
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-prop-switch-"));
  await build({
    stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      import {useKomoInspectable} from ${JSON.stringify(resolve("src/react.ts"))};
      const h=React.createElement;
      const definition={id:'option',name:'Option',source:'fixture/option.tsx',line:1,props:[
        {name:'selected',kind:'boolean',required:true,typeLabel:'boolean'},
        {name:'loading',kind:'boolean',required:false,typeLabel:'boolean'},
        {name:'muted',kind:'boolean',required:true,typeLabel:'boolean'}]};
      function Option(initial){
        const[props,setProps]=React.useState(initial);
        const inspect=useKomoInspectable({component:definition,props,onChange:next=>setProps(current=>({...current,...next})),enabled:true});
        return h('button',{ref:inspect.ref,'data-komo-inspectable':inspect['data-komo-inspectable'],type:'button',className:'fixture-option',
          'data-selected':String(props.selected),'data-loading':String(props.loading)},'Example option');
      }
      createRoot(document.querySelector('main')).render(h(Option,{selected:true,muted:false}));
      window.fetch=async()=>Response.json({threads:[],guests:true});
      document.body.append(document.createElement('aside'));
      window.komo=initKomo({endpoint:location.origin,project:'prop-switch',repo:'example/review',branch:'fixture',sidebar:'edge',restoreOpen:false});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<style>:root{color-scheme:light dark}body{margin:0;font:16px sans-serif;background:light-dark(#fff,#111);color:light-dark(#111,#eee)}main{min-height:100vh;box-sizing:border-box;padding:80px}.fixture-option{padding:12px 18px;border:1px solid #888;border-radius:10px;font:inherit}</style><main></main><script type="module" src="/entry.js"></script>`);
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
  // The vitest setup stubs the EyeDropper; this suite never opens the color editor either.
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-blink-features=EyeDropperAPI"] });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function open(colorScheme: "light" | "dark", reducedMotion: "reduce" | "no-preference" = "reduce") {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme, reducedMotion });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.locator(".fixture-option").waitFor();
  await openDesign(page);
  await page.click(".fixture-option");
  const control = (name: string) => page.getByRole("switch", { name: `Option ${name}`, exact: true });
  await control("selected").waitFor();
  return { page, errors, control };
}

/** The thumb's box from the computed ::before, relative to the track's border box. */
const geometry = (control: Locator) => control.evaluate((node) => {
  const track = node.getBoundingClientRect();
  const thumb = getComputedStyle(node, "::before");
  const base = { width: track.width, height: track.height, opacity: Number(getComputedStyle(node).opacity), duration: thumb.transitionDuration };
  if (thumb.display === "none" || thumb.content === "none") return { ...base, thumb: null };
  const size = parseFloat(thumb.width);
  const shift = thumb.translate === "none" ? 0 : parseFloat(thumb.translate);
  const left = node.clientLeft + parseFloat(thumb.left) + shift;
  const top = node.clientTop + parseFloat(thumb.top);
  return { ...base, thumb: { size, left, right: track.width - left - size, top, bottom: track.height - top - size, color: thumb.backgroundColor } };
});

/** The near-white run across the switch's middle row, in track pixels (28 wide). */
async function rendered(page: Page, control: Locator) {
  const png = (await control.screenshot({ animations: "disabled" })).toString("base64");
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
    const scale = width / 28, row = Math.floor(height / 2), white: number[] = [];
    for (let x = 0; x < width; x++) {
      const i = (row * width + x) * 4;
      if (data[i]! > 235 && data[i + 1]! > 235 && data[i + 2]! > 235) white.push(x);
    }
    return { count: white.length, centre: white.length ? (white[0]! + white.at(-1)! + 1) / 2 / scale : null };
  }, png);
}

/** The screenshot's clip rounds to device pixels, so allow 1px; a centred thumb is 6px away. */
function expectCentre(run: { centre: number | null }, at: number) {
  expect(run.centre).not.toBeNull();
  expect(Math.abs(run.centre! - at)).toBeLessThanOrEqual(1);
}

async function shoot(page: Page, name: string) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  await page.locator(".design-react-group").first().screenshot({ path: join(shots, `${name}.png`), animations: "disabled" });
}

describe.skipIf(!chrome)("boolean prop switches", () => {
  it.each(["light", "dark"] as const)("keeps the thumb at the track's edges and unset distinct in %s", async (scheme) => {
    const { page, errors, control } = await open(scheme);
    const off = control("muted"), on = control("selected"), unset = control("loading");

    // On: thumb 2px from the end, white, on the accent track. Off: 2px from the start.
    const onBox = await geometry(on);
    expect(onBox).toMatchObject({ width: 28, height: 16, thumb: { size: 12, right: 2, top: 2, bottom: 2, color: "rgb(255, 255, 255)" } });
    const offBox = await geometry(off);
    expect(offBox).toMatchObject({ width: 28, height: 16, thumb: { size: 12, left: 2, top: 2, bottom: 2, color: "rgb(255, 255, 255)" } });
    expect(await on.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(await off.evaluate(node => getComputedStyle(node).backgroundColor));
    // Rendered pixels agree: the white thumb's centre is 8px from the start off and 20px on.
    expectCentre(await rendered(page, off), 8);
    expectCentre(await rendered(page, on), 20);
    // Unset: no thumb anywhere on the track, and a visible label.
    expect((await geometry(unset)).thumb).toBeNull();
    expect((await rendered(page, unset)).count).toBe(0);
    expect(await unset.evaluate(node => getComputedStyle(node, "::after").content)).toBe('"unset"');
    await shoot(page, `${scheme}-states`);

    // Clicking the unset switch moves the thumb to the end at once, while it keeps focus.
    await unset.click();
    await expect.poll(() => page.locator(".fixture-option").getAttribute("data-loading")).toBe("true");
    expect(await unset.evaluate(node => node === (node.getRootNode() as ShadowRoot).activeElement)).toBe(true);
    expect(await geometry(unset)).toMatchObject({ thumb: { right: 2 } });
    expectCentre(await rendered(page, unset), 20);
    await unset.click();
    await expect.poll(() => page.locator(".fixture-option").getAttribute("data-loading")).toBe("false");
    expect(await geometry(unset)).toMatchObject({ thumb: { left: 2 } });
    expectCentre(await rendered(page, unset), 8);
    await page.mouse.move(1, 1);
    await page.keyboard.press("Space");
    await expect.poll(() => page.locator(".fixture-option").getAttribute("data-loading")).toBe("true");

    // Keyboard focus shows a clear ring outside the track.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await unset.evaluate(node => node.matches(":focus-visible"))).toBe(true);
    expect(await unset.evaluate(node => { const style = getComputedStyle(node); return [style.outlineStyle, parseFloat(style.outlineWidth), parseFloat(style.outlineOffset)]; })).toEqual(["solid", 2, 2]);
    await shoot(page, `${scheme}-focus-visible`);

    // Disabled reads at reduced opacity and keeps its thumb at the edge.
    await unset.evaluate(node => (node as HTMLElement).blur());
    await off.evaluate(node => { (node as HTMLInputElement).disabled = true; });
    const disabled = await geometry(off);
    expect(disabled.opacity).toBeLessThan(1);
    expect(disabled).toMatchObject({ thumb: { left: 2 } });
    await shoot(page, `${scheme}-disabled`);

    expect(errors).toEqual([]);
    await page.close();
  });

  it("slides the thumb in 120ms and not at all under reduced motion", async () => {
    const moving = await open("dark", "no-preference");
    expect((await geometry(moving.control("selected"))).duration).toBe("0.12s");
    await moving.page.close();
    const still = await open("dark", "reduce");
    expect((await geometry(still.control("selected"))).duration).toBe("0s");
    await still.page.close();
  });
});
