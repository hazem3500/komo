import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Drives the real examples/react-props demo in Chrome, built once against React 19 and once
// against React 18: pick an unregistered component in Design mode and read what it shows.
// KOMO_SCREENSHOTS=<dir> also writes the documentation screenshots.
const root = process.cwd();
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(
  (path): path is string => !!path && existsSync(path),
);
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".map": "application/json" };
let server: Server;
let browser: Browser;
let origin = "";

beforeAll(async () => {
  if (!chrome) return;
  execFileSync(process.execPath, [resolve(root, "examples/react-props/build.mjs")], { cwd: root, stdio: "pipe" });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    try {
      const file = resolve(root, `.${path.endsWith("/") ? `${path}index.html` : path}`);
      if (!file.startsWith(root)) throw new Error("outside root");
      response.setHeader("content-type", types[extname(file)] ?? "text/plain");
      response.end(await readFile(file));
    } catch {
      response.statusCode = 404;
      response.end();
    }
  }).listen(0);
  origin = `http://localhost:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
}, 120_000);
afterAll(async () => {
  await browser?.close();
  server?.close();
});

async function open(react: 18 | 19, viewport: { width: number; height: number }, query = "") {
  const page = await browser.newPage({ viewport });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // The fixture's comments endpoint is not reachable here; answer with an empty project.
  await page.route(/ts\.net/, (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
  await page.goto(`${origin}/examples/react-props/index.html?components=react&react=${react}${query}`);
  await page.waitForSelector(".team-badge");
  return { page, errors };
}

/** Enter Design mode and pick `selector`; resolves to the panel's discovered-props group text. */
async function pick(page: Page, selector: string, position?: { x: number; y: number }) {
  await page.keyboard.press("d");
  await page.waitForFunction(() => !!document.querySelector(".design-active"));
  await page.click(selector, position ? { position } : undefined);
  await page.waitForFunction(() => [...document.querySelectorAll("*")].some((node) => node.shadowRoot?.querySelector(".design-react-group")));
}
const panelFields = (page: Page) =>
  page.evaluate(() => {
    const host = [...document.querySelectorAll("*")].find((node) => node.shadowRoot?.querySelector(".design-react-group"))!;
    const group = host.shadowRoot!.querySelector(".design-react-group")!;
    return {
      className: group.className,
      heading: group.querySelector("summary")?.textContent,
      note: group.querySelector(".design-react-source")?.textContent,
      fields: Object.fromEntries([...group.querySelectorAll("label")].map((label) => [label.querySelector("span")!.textContent, label.querySelector("input, select") as HTMLInputElement])
        .map(([name, input]) => [name, { value: (input as HTMLInputElement).title || (input as HTMLInputElement).value, disabled: (input as HTMLInputElement).disabled }])),
      editable: group.querySelectorAll("input:not(:disabled), select").length,
    };
  });

describe.skipIf(!chrome).each([18, 19] as const)("react-fiber adapter in the demo with React %i", (react) => {
  it("shows discovered, read-only props and the source for an unregistered component", async () => {
    const { page, errors } = await open(react, { width: 1280, height: 800 });
    expect(await page.evaluate(() => (window as any).React?.version ?? document.querySelector("script[data-bundle]")?.getAttribute("data-bundle"))).toContain(react === 18 ? "-18" : "react-props.js");
    await pick(page, ".team-badge", { x: 4, y: 4 });
    const panel = await panelFields(page);
    expect(panel.className).toContain("design-react-discovered");
    expect(panel.heading).toBe("Discovered props");
    expect(panel.note).toContain("TeamBadge · discovered from React, read-only");
    expect(panel.note).toContain("rendered at examples/react-props/src/main.tsx:");
    expect(panel.fields.team).toEqual({ value: '"Design systems"', disabled: true });
    expect(panel.fields.seats.value).toBe("12");
    expect(panel.fields.active.value).toBe("true");
    expect(panel.fields.owner.value).toBe('{ name: "Rin", role: "lead" }');
    expect(panel.fields.onOpen.value).toBe("ƒ onOpen()");
    expect(panel.fields.authToken.value).toBe("[redacted]");
    expect(panel.fields.tags.value).toMatch(/^\["tokens", .*… \+1\]$/);
    expect(panel.editable).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("keeps the registered PromoCard editable instead of discovering it", async () => {
    const { page, errors } = await open(react, { width: 1280, height: 800 });
    await pick(page, ".promo-card", { x: 6, y: 6 });
    const panel = await panelFields(page);
    expect(panel.className).not.toContain("design-react-discovered");
    expect(panel.heading).toBe("Properties");
    expect(panel.editable).toBeGreaterThan(0);
    expect(panel.note).toContain("PromoCard");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("discovers nothing unless the adapter is installed", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route(/ts\.net/, (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
    await page.goto(`${origin}/examples/react-props/index.html?components=badge&react=${react}`);
    await page.waitForSelector(".team-badge");
    await page.keyboard.press("d");
    await page.waitForFunction(() => !!document.querySelector(".design-active"));
    await page.click(".team-badge", { position: { x: 4, y: 4 } });
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => [...document.querySelectorAll("*")].some((node) => node.shadowRoot?.querySelector(".design-react-group")))).toBe(false);
    await page.close();
  });

  const shots = process.env.KOMO_SCREENSHOTS;
  it.skipIf(!shots)("writes documentation screenshots", async () => {
    await mkdir(shots!, { recursive: true });
    for (const [name, viewport] of [["desktop", { width: 1280, height: 800 }], ["mobile", { width: 390, height: 844 }]] as const) {
      if (name === "mobile" && react === 18) continue;
      const { page } = await open(react, viewport);
      await pick(page, ".team-badge", { x: 4, y: 4 });
      await page.evaluate(() => {
        const host = [...document.querySelectorAll("*")].find((node) => node.shadowRoot?.querySelector(".design-react-discovered"))!;
        host.shadowRoot!.querySelector(".design-react-discovered")!.scrollIntoView({ block: "start" });
      });
      // The fixture's comments endpoint isn't served here; dismiss its "could not read comments" toast.
      for (const dismiss of await page.locator('[aria-label="Dismiss notice"]').all()) await dismiss.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(shots!, `${name}-react${react}.png`) });
      await page.close();
    }
  });
});
