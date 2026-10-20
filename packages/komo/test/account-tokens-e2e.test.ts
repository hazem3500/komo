import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page, type Route } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The Account panel's API tokens view in real Chrome, with the token API mocked through
// page.route: list, create with a one-time reveal and copy, inline revoke with rollback,
// guests, and servers without tokens, on light and dark host pages.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;
const SECRET = "komo_pat_newtoken0001_" + "S".repeat(39) + "abcd";
const day = 864e5;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-account-tokens-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      const fixture = JSON.parse(new URLSearchParams(location.search).get("user") || "null");
      const endpoint = location.origin + "/api/";
      const key = "branch-comments:" + endpoint + ":tokens";
      if (fixture) {
        localStorage.setItem(key, "synthetic-session");
        localStorage.setItem(key + ":user", JSON.stringify({ token: "synthetic-session", user: fixture }));
      }
      window.komo = initKomo({ endpoint, project: "tokens", repo: "example/review", branch: "fixture", restoreOpen: false, autoHideDrawer: false, pollInterval: 60000 });
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<meta name="color-scheme" content="light dark"><style>body{margin:0;font:16px system-ui;background:light-dark(#f4f2ee,#141414);color:light-dark(#222,#eee)}main{min-height:100vh;padding:70px;box-sizing:border-box}</style><main><h1>Example page</h1></main><script type="module" src="/entry.js"></script>`);
      return;
    }
    try {
      const file = resolve(directory, `.${path}`);
      if (!file.startsWith(directory + "/")) throw new Error("outside fixture");
      response.setHeader("content-type", "text/javascript");
      response.end(await readFile(file));
    } catch { response.statusCode = 404; response.end(); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

const google = { id: "google:synthetic-reviewer", name: "Example reviewer", verified: true };
const guest = { id: "guest:synthetic-reviewer", name: "Example guest", verified: false };
type Mock = {
  tokens: Record<string, unknown>[];
  posts: Record<string, unknown>[];
  deletes: string[];
  supported: boolean;
  listStatus?: number;
  failDelete?: string;
};
const token = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, prefix: `komo_pat_${id}`, last4: "wxyz", scopes: ["comments:read"], projects: null,
  createdAt: Date.now() - 3 * day, expiresAt: Date.now() + 27 * day, lastUsedAt: Date.now() - 2 * 36e5, expired: false, ...extra,
});

async function open(scheme: "light" | "dark", user: object | null, mock: Mock): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: scheme, reducedMotion: "reduce", locale: "en-US" });
  page.setDefaultTimeout(6000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  (page as any).errors = errors;
  await page.addInitScript(() => {
    (window as any).copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void (window as any).copied.push(text) } });
  });
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\//, "");
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "me") return json({ user });
    if (path === "config") return json({ repo: "example/review", google: true, github: false, guests: true, guestResolve: true, private: false, ...(mock.supported ? { tokens: true } : {}) });
    if (path === "threads") return json({ threads: [] });
    if (path === "usage") return json({ hosted: true, comments: { used: 4, limit: 250 }, projects: { used: 1, limit: 3 } });
    if (path === "account/tokens" && method === "GET") {
      if (mock.listStatus) return json({ error: "Not found." }, mock.listStatus);
      return json({ tokens: mock.tokens, projects: ["other", "tokens"], scopes: ["comments:read", "comments:write"] });
    }
    if (path === "account/tokens" && method === "POST") {
      const body = request.postDataJSON();
      mock.posts.push(body);
      const item = token("newtoken0001", body.name, { scopes: body.scopes, projects: body.projects.length ? body.projects : null, createdAt: Date.now(), expiresAt: body.expiresInDays ? Date.now() + body.expiresInDays * day : null, lastUsedAt: null, last4: "abcd" });
      mock.tokens.unshift(item);
      return json({ token: SECRET, item }, 201);
    }
    const revoke = path.match(/^account\/tokens\/([a-z0-9]+)$/);
    if (revoke && method === "DELETE") {
      mock.deletes.push(revoke[1]);
      if (mock.failDelete === revoke[1]) return json({ error: "Comments are temporarily unavailable. Try again." }, 500);
      mock.tokens = mock.tokens.filter((item) => item.id !== revoke[1]);
      return json({ ok: true });
    }
    return json({ error: "Not found." }, 404);
  });
  await page.goto(`${origin}/?user=${encodeURIComponent(JSON.stringify(user))}`);
  await page.waitForFunction(() => !!(window as any).komo);
  await page.locator('.morphing-menu__bar [data-menu-item="account"]').click();
  await page.locator(".account-dialog").waitFor();
  return page;
}
const mockApi = (extra: Partial<Mock> = {}): Mock => ({ tokens: [], posts: [], deletes: [], supported: true, ...extra });
const shot = (page: Page, name: string) => page.screenshot({ path: join(tmpdir(), `komo-account-tokens-${name}.png`) });
const live = (page: Page) => page.locator(".account-tokens [role=status][aria-live=polite]");

describe.skipIf(!chrome).each(["light", "dark"] as const)("API tokens on a %s page", (scheme) => {
  it("lists tokens with relative times and exact times on hover, then returns to the account", async () => {
    const mock = mockApi({ tokens: [token("deploybot001", "Deploy bot", { scopes: ["comments:read", "comments:write"], projects: ["tokens"] }), token("oldscript001", "Old script", { expired: true, expiresAt: Date.now() - day, lastUsedAt: null })] });
    const page = await open(scheme, google, mock);
    try {
      const entry = page.getByRole("button", { name: "API tokens" });
      // Below usage, above Sign out.
      expect(await page.locator(".account").evaluate((form) => [...form.children].map((node) => node.className).slice(-2))).toEqual(["account-sites", "account-session"]);
      await entry.click();
      const view = page.getByRole("region", { name: "API tokens" });
      await view.waitFor();
      await expect.poll(() => page.evaluate(() => document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement?.textContent)).toBe("API tokens");
      const list = view.getByRole("list", { name: "Your API tokens" });
      await list.waitFor();
      const items = list.getByRole("listitem");
      expect(await items.count()).toBe(2);
      const deploy = list.getByRole("listitem", { name: "Deploy bot" });
      expect(await deploy.locator(".api-token-chip").allTextContents()).toEqual(["Read", "Write", "This project"]);
      expect(await deploy.locator("time").first().textContent()).toBe("3 days ago");
      expect(await deploy.locator("dd").nth(1).textContent()).toContain("2 hr. ago");
      expect(await deploy.locator("code").textContent()).toBe("komo_pat_deploybot001…wxyz");
      const old = list.getByRole("listitem", { name: "Old script" });
      expect(await old.locator(".api-token-chip").first().textContent()).toBe("Expired");
      expect(await old.locator("dd").nth(1).textContent()).toBe("Never");
      await deploy.locator("time").first().hover();
      const tip = page.locator(".sidebar-tooltip[data-open]");
      await tip.waitFor();
      expect(await tip.textContent()).toMatch(/\d{4}/);
      await shot(page, `list-${scheme}`);
      await page.keyboard.press("Escape");
      await entry.waitFor();
      await expect.poll(() => page.evaluate(() => document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement?.textContent)).toBe("API tokens");
      expect(await page.locator(".sidebar-tooltip[data-open]").count()).toBe(0);
      expect((page as any).errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("creates a token only on submit, reveals it once, copies it and forgets it", async () => {
    const mock = mockApi();
    const page = await open(scheme, google, mock);
    try {
      await page.getByRole("button", { name: "API tokens" }).click();
      const view = page.getByRole("region", { name: "API tokens" });
      await view.getByText("No tokens yet").waitFor();
      await shot(page, `empty-${scheme}`);
      await view.getByRole("button", { name: "New token" }).click();
      const form = view.getByRole("form", { name: "New token" });
      await form.waitFor();
      expect(mock.posts).toEqual([]);
      // Validation stays local.
      await form.getByRole("button", { name: "Create token" }).click();
      expect(await form.getByRole("alert").textContent()).toBe("Name your token.");
      await expect.poll(() => page.evaluate(() => (document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement as HTMLInputElement)?.placeholder)).toBe("e.g. Deploy bot");
      expect(mock.posts).toEqual([]);
      await page.keyboard.type("CI bot");
      // Any komo render rebuilds the account dialog; the view keeps its node, input and focus.
      await page.locator(".account-dialog").evaluate((node) => ((node as HTMLElement).dataset.before = ""));
      await page.locator(".account-tokens").evaluate((node) => ((node as HTMLElement).dataset.before = ""));
      await page.evaluate(() => (window as any).komo.open());
      await expect.poll(() => page.locator(".account-dialog[data-before]").count()).toBe(0);
      const name = form.getByRole("textbox", { name: "Name" });
      expect(await name.inputValue()).toBe("CI bot");
      expect(await page.locator(".account-tokens[data-before]").count()).toBe(1);
      expect(await name.evaluate((node) => node.getRootNode() instanceof ShadowRoot && (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
      await form.getByRole("checkbox", { name: "Write comments" }).check();
      expect(await form.getByRole("radio", { name: "This project" }).isChecked()).toBe(true);
      await form.getByRole("radio", { name: "7 days" }).check();
      await shot(page, `create-${scheme}`);
      await page.keyboard.press("Enter");
      const reveal = view.getByRole("region", { name: "Copy “CI bot”" });
      await reveal.waitFor();
      expect(mock.posts).toEqual([{ name: "CI bot", scopes: ["comments:read", "comments:write"], expiresInDays: 7, projects: ["tokens"] }]);
      expect(await reveal.locator("code").textContent()).toBe(SECRET);
      expect(await reveal.textContent()).toContain("You won’t see this token again.");
      await expect.poll(() => page.evaluate(() => document.querySelector("[data-branch-comments]")!.shadowRoot!.activeElement?.textContent)).toBe("Copy");
      await page.keyboard.press("Enter");
      await expect.poll(() => page.evaluate(() => (window as any).copied)).toEqual([SECRET]);
      await expect.poll(() => live(page).textContent()).toBe("Token copied to the clipboard.");
      expect(await reveal.getByRole("button", { name: "Copy token" }).textContent()).toBe("Copied");
      expect(await view.getByRole("listitem", { name: "CI bot" }).count()).toBe(1);
      await shot(page, `reveal-${scheme}`);
      // Escape keeps the secret on screen and moves to Done.
      await page.keyboard.press("Escape");
      expect(await reveal.isVisible()).toBe(true);
      await view.getByRole("button", { name: "Done" }).click();
      await reveal.waitFor({ state: "detached" });
      const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.documentElement.outerHTML + document.querySelector("[data-branch-comments]")!.shadowRoot!.innerHTML);
      expect(stored).not.toContain(SECRET.slice(-20));
      expect((page as any).errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("revokes after an inline confirm, optimistically, and rolls back on failure", async () => {
    const mock = mockApi({ tokens: [token("first0000001", "First bot"), token("second000001", "Second bot")], failDelete: "second000001" });
    const page = await open(scheme, google, mock);
    try {
      await page.getByRole("button", { name: "API tokens" }).click();
      const view = page.getByRole("region", { name: "API tokens" });
      const first = view.getByRole("listitem", { name: "First bot" });
      await first.getByRole("button", { name: "Revoke First bot" }).click();
      const confirm = first.getByRole("group", { name: "Revoke First bot" });
      await confirm.waitFor();
      await shot(page, `confirm-${scheme}`);
      // Escape and Keep both cancel without a request.
      await page.keyboard.press("Escape");
      await confirm.waitFor({ state: "detached" });
      await first.getByRole("button", { name: "Revoke First bot" }).click();
      await confirm.getByRole("button", { name: "Keep token" }).click();
      await confirm.waitFor({ state: "detached" });
      expect(mock.deletes).toEqual([]);
      await first.getByRole("button", { name: "Revoke First bot" }).click();
      await confirm.getByRole("button", { name: "Revoke token" }).click();
      await first.waitFor({ state: "detached" });
      await expect.poll(() => live(page).textContent()).toBe("Revoked First bot.");
      expect(mock.deletes).toEqual(["first0000001"]);
      const second = view.getByRole("listitem", { name: "Second bot" });
      await second.getByRole("button", { name: "Revoke Second bot" }).click();
      await second.getByRole("button", { name: "Revoke token" }).click();
      await expect.poll(() => live(page).textContent()).toBe("Couldn’t revoke Second bot.");
      expect(await second.getByRole("alert").textContent()).toContain("temporarily unavailable");
      expect(await view.getByRole("listitem").count()).toBe(1);
      await shot(page, `rollback-${scheme}`);
      expect((page as any).errors).toEqual([]);
    } finally { await page.close(); }
  });

  it("hides tokens for guests and for servers without tokens, and explains a missing route", async () => {
    for (const [user, mock] of [[guest, mockApi()], [google, mockApi({ supported: false })]] as const) {
      const page = await open(scheme, user, mock);
      try {
        await page.locator(".account-session").waitFor();
        expect(await page.getByRole("button", { name: "API tokens" }).count()).toBe(0);
        if (user === guest) await shot(page, `guest-${scheme}`);
      } finally { await page.close(); }
    }
    const page = await open(scheme, google, mockApi({ listStatus: 404 }));
    try {
      await page.getByRole("button", { name: "API tokens" }).click();
      const alert = page.getByRole("region", { name: "API tokens" }).getByRole("alert");
      await alert.waitFor();
      expect(await alert.textContent()).toBe("This komo server doesn’t support API tokens.");
      expect(await page.getByRole("button", { name: "Try again" }).count()).toBe(0);
      await shot(page, `unsupported-${scheme}`);
    } finally { await page.close(); }
  });
});
