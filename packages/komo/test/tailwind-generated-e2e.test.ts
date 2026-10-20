import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real Chrome CSSOM: selectorText is re-serialized (escapes, nesting, @layer), cross-origin
// sheets throw on cssRules, and <link> sheets are null until they load.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string, crossOrigin: string;
let server: Server, cross: Server, browser: Browser;

// Shaped like Tailwind v4 output: layered utilities, escaped names, variants under @media, nesting.
const appCss = String.raw`@layer theme, utilities;
@layer utilities {
  .p-4 { padding: 16px }
  .p-1\.5 { padding: 6px }
  .w-1\/2 { width: 50% }
  .-mt-4 { margin-top: -16px }
  .p-\[13px\] { padding: 13px }
  .\!p-8 { padding: 32px !important }
  .\32 xl-box { padding: 1px }
  .hover\:p-10 { &:hover { @media (hover: hover) { padding: 40px } } }
  @media (width >= 48rem) { .md\:p-6 { padding: 24px } }
  @supports (display: grid) { @container (min-width: 1px) { .m-2 { margin: 8px } } }
  .card { & .p-5 { padding: 20px } }
}`;
const classes = ["p-4", "p-9", "p-1.5", "w-1/2", "-mt-4", "p-[13px]", "p-[14px]", "!p-8", "p-8", "2xl-box", "hover:p-10", "p-10", "md:p-6", "p-6", "m-2", "p-5", "p-16"];
const generated = ["p-4", "p-1.5", "w-1/2", "-mt-4", "p-[13px]", "!p-8", "2xl-box", "hover:p-10", "md:p-6", "m-2", "p-5"];

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-tailwind-generated-"));
  await build({
    stdin: { contents: `
      import { tailwindTokens } from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
      const adapter = tailwindTokens({ tokens: ${JSON.stringify(classes)}.map(name => ({ path: name, type: "dimension", class: name, properties: ["padding"], value: "1px" })) }, { onlyGenerated: true });
      window.listed = () => adapter.list({}).map(token => token.path);
    `, resolveDir: process.cwd(), loader: "ts" },
    outfile: join(directory, "entry.js"), bundle: true, format: "esm", platform: "browser", target: "es2022",
  });
  cross = createServer((request, response) => {
    response.setHeader("content-type", "text/css");
    if (request.url === "/cors.css") response.setHeader("access-control-allow-origin", "*");
    response.end(".p-9{padding:36px}");
  }).listen(0);
  crossOrigin = `http://127.0.0.1:${(cross.address() as { port: number }).port}`;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      const extra = { cross: `<link rel="stylesheet" href="${crossOrigin}/plain.css">`, cors: `<link rel="stylesheet" crossorigin href="${crossOrigin}/cors.css">`, import: `<style>@import url("${crossOrigin}/plain.css");</style>` }[url.searchParams.get("case") ?? ""] ?? "";
      response.setHeader("content-type", "text/html");
      response.end(`<!doctype html><link rel="stylesheet" href="/app.css">${extra}<main>Fixture</main><script type="module" src="/entry.js"></script>`);
    } else if (url.pathname.endsWith(".css")) {
      if (url.pathname === "/slow.css") await new Promise((done) => setTimeout(done, 400));
      response.setHeader("content-type", "text/css");
      response.end(url.pathname === "/slow.css" ? ".p-16{padding:64px}" : appCss);
    } else if (url.pathname === "/entry.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(await readFile(join(directory, "entry.js")));
    } else {
      response.statusCode = 404;
      response.end();
    }
  }).listen(0);
  origin = `http://localhost:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  cross?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function open(query = ""): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${origin}/${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof (window as unknown as { listed?: unknown }).listed === "function");
  return page;
}
const listed = (page: Page) => page.evaluate(() => (window as unknown as { listed: () => string[] }).listed());

describe.skipIf(!chrome)("tailwindTokens onlyGenerated in Chrome", () => {
  it("matches Chrome's serialized selectors, including escapes, variants, layers and nesting", async () => {
    const page = await open();
    expect(await listed(page)).toEqual(generated);
    await page.close();
  });

  it("re-scans for a late <style>, changed text, inserted rules, adopted sheets and a loading <link>", async () => {
    const page = await open();
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.id = "late";
      style.textContent = ".p-9{padding:36px}";
      document.head.append(style);
    });
    expect(await listed(page)).toEqual([...generated.slice(0, 1), "p-9", ...generated.slice(1)]);
    await page.evaluate(() => { document.getElementById("late")!.textContent = ".p-14{padding:56px}"; });
    expect(await listed(page)).toEqual(generated);
    await page.evaluate(() => { (document.styleSheets[0] as CSSStyleSheet).insertRule(".p-6{padding:24px}", 0); });
    expect(await listed(page)).toContain("p-6");
    await page.evaluate(() => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(".p-10{padding:40px}");
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    });
    expect(await listed(page)).toContain("p-10");
    await page.evaluate(() => document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/slow.css" })));
    expect(await listed(page)).toEqual(classes); // still loading: unknown, nothing hidden
    await page.waitForFunction(() => [...document.styleSheets].some((sheet) => sheet.href?.endsWith("/slow.css")));
    expect(await listed(page)).toContain("p-16");
    expect(await listed(page)).not.toContain("p-9");
    await page.close();
  });

  it("keeps every token while a cross-origin sheet is unreadable, and reads it with CORS", async () => {
    for (const query of ["?case=cross", "?case=import"]) {
      const page = await open(query);
      expect(await listed(page)).toEqual(classes);
      await page.close();
    }
    const page = await open("?case=cors");
    expect(await listed(page)).toEqual([...generated.slice(0, 1), "p-9", ...generated.slice(1)]);
    await page.close();
  });
});
