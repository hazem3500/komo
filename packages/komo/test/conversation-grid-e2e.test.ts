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
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-grid-"));
  await build({
    stdin: { contents: `
import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
const q=new URLSearchParams(location.search);
const user={id:'fixture',name:'Alex Morgan',verified:true};
const anchor=selector=>({selector,text:'',x:.5,y:.5,width:0,height:0,pageX:0,pageY:0,viewportWidth:1280});
const comment=(id,body,name,mine,ago)=>({id,body,author:{...user,id:mine?'fixture':'u-'+id,name},createdAt:Date.now()-ago,editedAt:null,reactions:{}});
const thread=(id,page,selector,comments,tags=[])=>({id,page,anchor:anchor(selector),resolved:false,resolvedBy:null,createdAt:Date.now(),updatedAt:Date.now(),tags,comments});
const threads=[
  thread('hello','/','#target',[comment('c1','Hello','Alex Morgan',true,180000),comment('c2','Could the heading spell out which month this covers?','Sam Lee',false,120000),comment('c3','Good idea, I will add the date range.','Alex Morgan',true,60000)],['content']),
  thread('missing','/','#missing',[comment('m1','This button moved after the last change; can we restore it?','Taylor Reed',false,900000)],['layout']),
  thread('other','/reports/summary','#target',[comment('o1','The summary needs a little more context.','Sam Lee',false,3600000)]),
];
window.qa={writes:[],threads};
const key='branch-comments:'+location.origin+':grid';
localStorage.setItem(key,'synthetic-session');
localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
window.fetch=async(input,init)=>{const method=init?.method||'GET',path=new URL(String(input),location.origin).pathname;
if(method!=='GET'){const body=JSON.parse(init.body||'{}');window.qa.writes.push({method,path,body});const t=threads.find(t=>path.includes('/threads/'+t.id));if(t&&method==='PATCH'&&!path.includes('/comments/'))Object.assign(t,body);return Response.json({id:'saved',tags:t?.tags??[]});}
return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads}:{});};
window.komo=initKomo({endpoint:location.origin,project:'grid',repo:'example/fixture',branch:'local',restoreOpen:false,sidebar:q.get('mode')||'background',pageRoot:document.querySelector('main')});
if(!q.has('closed')) window.komo.open();
`, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.endsWith(".js")) {
      response.setHeader("content-type", "text/html");
      response.end('<style>body{margin:0;font:16px system-ui}main{min-height:100vh;box-sizing:border-box;padding:64px}#target{margin-top:40px;padding:24px;max-width:360px;border:1px solid #ccc}</style><main><h1>Reports</h1><div id="target">Summary for October</div></main><script type="module" src="/entry.js"></script>');
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

type Box = { left: number; right: number; top: number; bottom: number; center: number; text: number };
/** Boxes of the first visible match per selector; `text` is where a field's text starts. */
async function boxes(page: Page, selectors: Record<string, string>) {
  return page.evaluate((selectors) => {
    const shadow = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
    const out: Record<string, Box> = {};
    for (const [name, selector] of Object.entries(selectors)) {
      const node = [...shadow.querySelectorAll<HTMLElement>(selector)].find((n) => n.getClientRects().length && !n.closest("[hidden]"));
      if (!node) continue;
      const r = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      out[name] = { left: r.left, right: r.right, top: r.top, bottom: r.bottom, center: (r.left + r.right) / 2, text: r.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) };
    }
    return out;
  }, selectors);
}
const near = (a: number | undefined, b: number | undefined) => expect(Math.abs(a! - b!), `${a} vs ${b}`).toBeLessThanOrEqual(1);
const intersects = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

async function open(width: number, query = "") {
  const page = await browser.newPage({ viewport: { width, height: 860 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  await page.goto(origin + "/?x=1" + query);
  await page.locator(query.includes("closed") ? ".pin" : '.thread-item[data-thread="hello"]').first().waitFor();
  return page;
}

const thread = {
  back: ".thread-back", title: ".thread-title", close: ".dialog-head > .row > button:last-child",
  avatar: ".dialog .message .avatar", author: ".dialog .message .author", body: ".dialog .message-text", tags: ".dialog .thread-tags",
  reaction: ".dialog .message-reaction", menu: ".dialog .message > .row > .comment-menu > summary", divider: ".dialog .message + .message",
  replyAvatar: ".dialog > .reply-composer > .avatar", reply: ".dialog > .reply-composer textarea", send: ".dialog > .reply-composer .send",
};
function expectConversationGrid(b: Record<string, Box>, panel: boolean) {
  if (panel) {
    near(b.back.center, b.avatar.center);
    near(b.title.left, b.author.left);
  }
  for (const key of ["body", "tags", "reply"] as const) near(key === "reply" ? b.reply.text : b[key].left, b.author.left);
  near(b.replyAvatar.left, b.avatar.left);
  for (const key of ["reaction", "menu", "send"] as const) near(b[key].center, b.close.center);
  near(b.divider.left, b.avatar.left);
  near(b.divider.right, b.close.right);
}

describe.skipIf(!chrome)("shared conversation grid", () => {
  for (const width of [1280, 900]) for (const mode of ["background", "edge"]) {
    it(`lines up list cards, replies and card actions in the ${mode} sidebar at ${width}px`, async () => {
      const page = await open(width, `&mode=${mode}`);
      try {
        await page.locator('.thread-item[data-thread="hello"] .card-reply-toggle').click();
        const list = {
          close: ".sidebar-title button:last-child", avatar: '[data-thread="missing"] .thread-card .avatar', author: '[data-thread="missing"] .thread-card .author',
          status: '[data-thread="missing"] .card-status', time: '[data-thread="missing"] .thread-card .row small', body: '[data-thread="missing"] .preview',
          tags: '[data-thread="missing"] .card-tags', toggle: '[data-thread="missing"] .card-reply-toggle', card: '[data-thread="missing"]',
          next: '[data-thread="other"] .thread-card .row', helloAvatar: '[data-thread="hello"] .thread-card .avatar', helloBody: '[data-thread="hello"] .preview',
          replyAvatar: '[data-thread="hello"] .sidebar-reply .avatar', replyAuthor: '[data-thread="hello"] .sidebar-reply .author', replyTime: '[data-thread="hello"] .sidebar-reply small',
          replyBody: '[data-thread="hello"] .sidebar-reply p', replyField: '[data-thread="hello"] .reply-composer textarea', replySend: '[data-thread="hello"] .reply-composer .send',
        };
        await page.locator('[data-thread="missing"] .thread-card').evaluate((node) => node.scrollIntoView({ block: "center" }));
        const rest = await boxes(page, list);
        near(rest.avatar.left, rest.helloAvatar.left);
        for (const key of ["body", "tags", "toggle"] as const) near(rest[key].left, rest.author.left);
        near(rest.helloBody.left, rest.author.left);
        expect(rest.status.left).toBeGreaterThan(rest.author.right);
        expect(rest.status.bottom).toBeLessThanOrEqual(rest.body.top);
        near(rest.time.right, rest.close.right);
        near(rest.replyAvatar.left, rest.author.left);
        near(rest.replyBody.left, rest.replyAuthor.left);
        near(rest.replyField.text, rest.replyBody.left);
        near(rest.replyTime.right, rest.close.right);
        near(rest.replySend.center, rest.close.center);
        expect(await page.locator('[data-thread="hello"] .sidebar-replies').evaluate((node) => getComputedStyle(node).borderLeftWidth)).toBe("0px");
        expect(await page.locator('[data-thread="hello"] .card-reply-toggle').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
        expect(await page.locator('.thread-card[title], .card-resolve[title], .card-reply-toggle[title]').count()).toBe(0);

        await page.locator('[data-thread="missing"] .thread-card').hover();
        await page.locator('[data-thread="missing"] .card-resolve').hover();
        await page.waitForSelector(".sidebar-tooltip[data-open]");
        const hover = await boxes(page, { ...list, resolve: '[data-thread="missing"] .card-resolve', tip: ".sidebar-tooltip[data-open]" });
        for (const edge of ["left", "right", "top", "bottom"] as const) near(hover.card[edge], rest.card[edge]);
        near(hover.resolve.center, rest.close.center);
        near(hover.resolve.right, rest.time.right);
        expect(Math.abs((hover.resolve.top + hover.resolve.bottom) / 2 - (rest.avatar.top + rest.avatar.bottom) / 2)).toBeLessThanOrEqual(1);
        expect(intersects(hover.tip, hover.next)).toBe(false);
        expect(await page.locator('[data-thread="missing"] .thread-card .row small').evaluate((node) => getComputedStyle(node).opacity)).toBe("0");

        await page.mouse.move(5, 5);
        await page.locator('[data-thread="missing"] .thread-card').focus();
        await page.keyboard.press("Tab");
        expect(await page.locator('[data-thread="missing"] .card-resolve').evaluate((node) => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
        expect(await page.locator('[data-thread="missing"] .card-resolve').evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
        await page.keyboard.press("Enter");
        await expect.poll(() => page.evaluate(() => (window as any).qa.writes.some((w: any) => w.method === "PATCH" && w.path.endsWith("/threads/missing") && w.body.resolved === true))).toBe(true);
      } finally { await page.close(); }
    });

    it(`lines up the thread view, edit mode and reply field in the ${mode} sidebar at ${width}px`, async () => {
      const page = await open(width, `&mode=${mode}`);
      try {
        await page.locator('.thread-item[data-thread="hello"] .thread-card').click();
        await page.locator(".dialog .message").first().waitFor();
        expectConversationGrid(await boxes(page, thread), true);
        // Dividers span the content box: the message rule fills its row, the composer rule is inset like it.
        expect(await page.locator(".dialog .message + .message").first().evaluate((node) => {
          const rule = getComputedStyle(node, "::before");
          return [rule.left, rule.right];
        })).toEqual(["0px", "0px"]);
        const composerRule = await page.locator(".dialog > .reply-composer").evaluate((node) => {
          const rule = getComputedStyle(node, "::before"), box = node.getBoundingClientRect();
          return [box.left + parseFloat(rule.left), box.right - parseFloat(rule.right)];
        });
        const grid = await boxes(page, { ...thread, pane: ".thread-pane .dialog", composer: ".dialog > .reply-composer" });
        near(grid.composer.bottom, grid.pane.bottom);
        near(composerRule[0], grid.avatar.left);
        near(composerRule[1], grid.close.right);

        await page.locator('.dialog .message[data-comment="c3"] summary').click();
        await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
        const editor = page.locator(".dialog textarea[aria-label='Edit comment']");
        await editor.waitFor();
        const edit = await boxes(page, { ...thread, editor: ".message-editor", save: ".edit-actions .primary", cancel: ".edit-actions .secondary", other: '.message[data-comment="c2"] .message-text' });
        near(edit.editor.left, edit.other.left);
        near(edit.editor.right, edit.other.right);
        expect(edit.editor.bottom - edit.editor.top).toBeLessThan(40);
        expect(await editor.evaluate((node) => getComputedStyle(node).resize)).toBe("none");
        near(edit.save.right, edit.editor.right);
        expect(edit.save.left - edit.cancel.right).toBeGreaterThanOrEqual(6);
        expect(edit.save.bottom - edit.save.top).toBeLessThanOrEqual(30);
        expect(await page.locator(".edit-actions kbd").allTextContents()).toEqual(expect.arrayContaining(["Esc", "↵"]));

        await editor.fill("Good idea, I will add the date range.\nAnd the time zone.");
        const grown = await editor.boundingBox();
        expect(grown!.height).toBeGreaterThan(edit.editor.bottom - edit.editor.top);
        await page.evaluate(() => (window as any).komo.refresh());
        await expect.poll(() => editor.inputValue()).toBe("Good idea, I will add the date range.\nAnd the time zone.");
        await editor.press("Escape");
        await expect.poll(() => editor.count()).toBe(0);
        expect(await page.locator(".dialog").isVisible()).toBe(true);

        await page.locator('summary[aria-label="Comment actions"]').click();
        await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
        await editor.waitFor();
        const first = await boxes(page, { editor: ".message-editor", tags: ".message-edit .thread-tags", actions: ".edit-actions", author: ".dialog .message .author" });
        near(first.editor.left, first.author.left);
        near(first.tags.left, first.author.left);
        expect(first.tags.top).toBeGreaterThanOrEqual(first.actions.bottom);
        await editor.fill("Hello there");
        await editor.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        await expect.poll(() => page.evaluate(() => (window as any).qa.writes.find((w: any) => w.path.endsWith("/comments/c1"))?.body.body)).toBe("Hello there");

        await page.locator(".dialog > .reply-composer textarea").click();
        await page.keyboard.type("Typing a reply");
        expectConversationGrid(await boxes(page, thread), true);
      } finally { await page.close(); }
    });

  }
  for (const width of [1280, 900]) {
    it(`lines up the floating card at ${width}px`, async () => {
      const page = await open(width, "&closed=1");
      try {
        await page.locator(".pin").first().click();
        await page.locator(".dialog .message").first().waitFor().catch(async (error) => {
          await page.screenshot({ path: join(tmpdir(), "komo-grid-floating-failure.png") });
          throw error;
        });
        expectConversationGrid(await boxes(page, thread), false);
      } finally { await page.close(); }
    });

    it(`lines up the new comment composer at ${width}px`, async () => {
      const page = await open(width, "&closed=1");
      try {
        await expect.poll(async () => {
          if (await page.locator(".catch").isHidden()) await page.keyboard.press("c");
          return page.locator(".catch").isVisible();
        }).toBe(true);
        const target = (await page.locator("#target").boundingBox())!;
        await page.mouse.click(target.x + 20, target.y + 10);
        await page.locator(".new-comment-composer textarea").waitFor();
        const b = await boxes(page, { dialog: ".dialog", avatar: ".new-comment-composer .avatar", input: ".new-comment-composer textarea", send: ".new-comment-composer .send", close: ".draft-close" });
        near(b.input.text, b.avatar.right + 8);
        near(b.send.center, b.close.center);
        near(b.avatar.left - b.dialog.left, b.dialog.right - b.close.right);
      } finally { await page.close(); }
    });
  }

  it.each(["background", "edge"])("keeps the %s sidebar toolbar opaque while focus is in the reply field", async (mode) => {
    const page = await open(1000, `&mode=${mode}`);
    try {
      await page.locator('.thread-item[data-thread="hello"] .thread-card').click();
      await page.locator(".dialog > .reply-composer textarea").click();
      await page.keyboard.type("Typing a reply");
      const probe = await page.evaluate(() => {
        const shadow = [...document.body.children].find((node) => node.shadowRoot)!.shadowRoot!;
        const button = shadow.querySelector<HTMLElement>('.toolbar [data-menu-item="comments"]')!;
        const shell = shadow.querySelector<HTMLElement>(".toolbar .morphing-menu__shell")!;
        const r = button.getBoundingClientRect();
        // Light content passing behind the dock must not show through it.
        const stripe = document.createElement("div");
        stripe.style.cssText = `position:fixed;left:${r.left}px;top:0;bottom:0;width:12px;background:#fff;z-index:1`;
        document.documentElement.append(stripe);
        const outside = [button, ...button.querySelectorAll("*")].flatMap((node) => ["::before", "::after"].map((pseudo) => getComputedStyle(node, pseudo)))
          .filter((style) => style.content !== "none" && style.content !== "normal" && (style.boxShadow !== "none" || style.backgroundImage !== "none" || style.filter !== "none"));
        const s = shell.getBoundingClientRect();
        return { button: [r.left, r.top, r.width, r.height], shell: [s.left, s.top, s.width, s.height], backdrop: getComputedStyle(shell).backdropFilter, background: getComputedStyle(shell).backgroundColor, glowing: outside.length, active: shadow.activeElement?.tagName };
      });
      expect(probe.active).toBe("TEXTAREA");
      expect(probe.backdrop).toBe("none");
      expect(probe.background).toMatch(/^rgb\(/);
      expect(probe.glowing).toBe(0);
      const [x, y, w, h] = probe.shell;
      const png = await page.screenshot({ clip: { x, y, width: w, height: h } });
      const samples = await page.evaluate(async ({ data, stripeX, top, bottom }) => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        const lum = (px: number, py: number) => { const [r, g, b] = context.getImageData(px, py, 1, 1).data; return (r + g + b) / 3; };
        // Columns through the shell beside the active button: above it, below it, and a reference far away.
        return { above: lum(stripeX + 3, Math.max(1, top - 3)), below: lum(stripeX + 3, Math.min(bitmap.height - 2, bottom + 2)), reference: lum(Math.round(bitmap.width * .9), Math.max(1, top - 3)) };
      }, { data: png.toString("base64"), stripeX: Math.round(probe.button[0] - x), top: Math.round(probe.button[1] - y), bottom: Math.round(probe.button[1] - y + probe.button[3]) });
      expect(Math.abs(samples.above - samples.reference)).toBeLessThan(6);
      expect(Math.abs(samples.below - samples.reference)).toBeLessThan(6);
      expect(samples.above).toBeLessThan(80);
    } finally { await page.close(); }
  });
});
