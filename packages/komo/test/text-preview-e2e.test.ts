import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-text-preview-"));
  for (const version of [18, 19]) {
    const require = createRequire(resolve(version === 18 ? "../komo-react18-fixture/package.json" : "package.json"));
    await build({
      stdin: { contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
        import {renderDraftProposal,resetDesignPreviews} from ${JSON.stringify(resolve("src/design-comment.ts"))};
        const qa=window.textQA={actions:0};
        function App(){
          const[label,setLabel]=React.useState('Original title');
          const[tick,setTick]=React.useState(0);
          const[revision,setRevision]=React.useState(0);
          const[visible,setVisible]=React.useState(true);
          qa.rewrite=()=>setLabel(value=>value==='Host rerender'?'Host update':'Host rerender');
          React.useEffect(()=>{const id=setInterval(()=>setTick(v=>v+1),100);return()=>clearInterval(id)},[]);
          return React.createElement('section',{'data-commit':tick},React.createElement('nav',null,
            React.createElement('button',{onClick:()=>setRevision(v=>v+1)},'Replace owner'),
            React.createElement('button',{onClick:()=>setVisible(false)},'Remove owner'),
            React.createElement('button',{onClick:()=>setVisible(true)},'Restore owner')),
            visible&&React.createElement('a',{key:revision,id:'target',href:'#destination',onClick:()=>qa.actions++},React.createElement('svg',{viewBox:'0 0 16 16'},React.createElement('path',{d:'M2 2h12v12H2z'})),React.createElement('span',null,React.createElement('strong',null,label))));
        }
        const review=document.body.appendChild(document.createElement('section'));
        review.id='retention-review';review.style.cssText='position:fixed;left:80px;top:300px;width:360px;z-index:20;background:#222';
        const proposal='Proposed inline text change (preview only)\\nTarget: #target\\n- Text: "Original title" → "Edited title"';
        qa.review=()=>renderDraftProposal(review,proposal,()=>document.querySelector('#target'));
        qa.clear=()=>{resetDesignPreviews();review.replaceChildren()};
        createRoot(document.querySelector('main')).render(React.createElement(App));
        const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
        const key='branch-comments:'+location.origin+':text-preview';
        localStorage.setItem(key,'synthetic-session');
        localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
        window.fetch=async input=>{const path=new URL(input instanceof Request?input.url:String(input)).pathname;return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads:[]}:{});};
        const mode=new URLSearchParams(location.search).get('mode');
        if(mode==='floating')document.body.append(document.createElement('aside'));
        window.komo=initKomo({endpoint:location.origin,project:'text-preview',repo:'example/review',branch:'fixture',pageRoot:mode==='floating'?undefined:document.querySelector('main'),sidebar:mode==='floating'?'edge':'background',frame:{scale:mode==='scaled'},restoreOpen:false});
      `, resolveDir: process.cwd(), loader: "ts" },
      alias: { react: dirname(require.resolve("react/package.json")), "react-dom": dirname(require.resolve("react-dom/package.json")) },
      outdir: join(directory, String(version)), entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
    });
  }
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<style>body{margin:0}main{min-height:100vh;box-sizing:border-box;padding:80px}a{display:inline-flex;align-items:center;gap:12px;padding:16px;color:#575456;border-radius:8px}a:focus{outline:2px solid #dba33d;outline-offset:-6px;box-shadow:inset 0 0 0 2px #dba33d}svg{width:24px;height:24px}</style><main></main><script type="module" src="/${url.searchParams.get("react") === "18" ? 18 : 19}/entry.js"></script>`);
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

describe.skipIf(!chrome).each([18, 19])("text DOM previews in React %s", version => {
  it.each(["floating", "reflow", "scaled"])("invalidates keyed owner replacement and removal in %s", async mode => {
    for (const action of ["Replace owner", "Remove owner"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${origin}/?react=${version}&mode=${mode}`);
      await page.locator("#target").waitFor();
      await page.waitForFunction(() => !!(window as any).komo);
      if (mode !== "floating") {
        await page.keyboard.press("l");
        await page.waitForFunction(() => Math.abs(document.querySelector("main")!.getBoundingClientRect().width - 852) < 1);
      }
      await page.evaluate(() => {
        const qa = (window as any).textQA;
        qa.owner = document.querySelector("#target");
        qa.text = qa.owner.querySelector("strong").firstChild;
        qa.review();
      });
      const review = page.locator("#retention-review");
      expect(await page.locator("#target strong").textContent()).toBe("Edited title");
      await page.getByRole("button", { name: action, exact: true }).click();
      await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('#retention-review .design-toggle button:last-child')?.disabled);
      expect(await review.getByRole("button", { name: "Before", exact: true }).getAttribute("aria-pressed")).toBe("true");
      expect(await review.getByRole("status").isVisible()).toBe(true);
      if (action === "Remove owner") await page.getByRole("button", { name: "Restore owner", exact: true }).click();
      await page.locator("#target").waitFor();
      expect(await page.locator("#target strong").textContent()).toBe("Original title");
      expect(await page.locator("#target").evaluate(node => node === (window as any).textQA.owner)).toBe(false);
      await page.keyboard.press("ArrowRight");
      await page.evaluate(() => (window as any).textQA.review());
      expect(await review.getByRole("button", { name: "After", exact: true }).isDisabled()).toBe(true);
      expect(await page.locator("#target strong").textContent()).toBe("Original title");
      await page.evaluate(() => {
        const qa = (window as any).textQA;
        qa.clear();
        qa.text.data = "Detached host update";
        qa.review();
      });
      expect(await page.locator("#target strong").textContent()).toBe("Edited title");
      await page.evaluate(() => {
        const qa = (window as any).textQA;
        qa.clear();
        qa.rewrite();
      });
      await page.waitForFunction(() => document.querySelector("#target strong")?.textContent === "Host rerender");
      expect(await page.evaluate(() => ({ text: (window as any).textQA.text.data, actions: (window as any).textQA.actions }))).toEqual({ text: "Detached host update", actions: 0 });
      expect(new URL(page.url()).hash).toBe("");
      await page.evaluate(() => (window as any).komo.destroy());
      expect(errors).toEqual([]);
      await page.close();
    }
  });

  it.each(["floating", "reflow", "scaled"])("preserves real nested text, icons and exact restoration in %s", async mode => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?react=${version}&mode=${mode}`);
    const target = page.locator("#target");
    await target.waitFor();
    await page.waitForFunction(() => !!(window as any).komo);
    const original = await target.evaluate(node => {
      const qa = (window as any).textQA;
      qa.owner = node;
      qa.icon = node.querySelector("svg");
      qa.text = node.querySelector("strong")!.firstChild;
      return { html: node.innerHTML, attributes: [...node.attributes].map(attr => [attr.name, attr.value]) };
    });
    const text = () => target.locator("strong").textContent();
    const same = () => target.evaluate(node => {
      const qa = (window as any).textQA;
      return node === qa.owner && node.querySelector("svg") === qa.icon && node.querySelector("strong")!.firstChild === qa.text && qa.actions === 0;
    });
    const start = async () => {
      await page.getByRole("button", { name: "Edit selected text inline", exact: true }).click();
      await page.locator('#target[contenteditable="true"]').waitFor();
    };
    await page.keyboard.press("d");
    await page.locator('.design-inspector[aria-hidden="false"]').waitFor();
    await target.click({ position: { x: 5, y: 5 } });
    await start();
    expect(await target.evaluate(node => getComputedStyle(node).outlineColor)).toBe("rgb(189, 166, 239)");
    expect(await target.evaluate(node => getComputedStyle(node).boxShadow)).toBe("none");
    await page.keyboard.type(" preview");
    await page.keyboard.press("Enter");
    expect(await text()).toBe("Original title preview");
    expect(await target.getAttribute("style")).toBeNull();
    await page.keyboard.press("ArrowLeft");
    expect(await text()).toBe("Original title");
    await page.keyboard.press("ArrowRight");
    expect(await text()).toBe("Original title preview");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await text()).toBe("Original title");
    await start();
    await page.keyboard.type(" cancel");
    await page.keyboard.press("Escape");
    expect(await text()).toBe("Original title");
    expect(await target.getAttribute("style")).toBeNull();
    await start();
    await page.keyboard.type(" proposal");
    await page.keyboard.press("Enter");
    await page.evaluate(() => (window as any).textQA.rewrite());
    await page.waitForTimeout(250);
    expect(await text()).toBe("Original title proposal");
    await page.keyboard.press("v");
    expect(await text()).toBe("Original title");
    await page.evaluate(() => (window as any).textQA.rewrite());
    await page.waitForTimeout(150);
    expect(await text()).toBe("Host update");
    await page.keyboard.press("d");
    expect(await text()).toBe("Original title proposal");
    await page.locator(".design-inspector__actions button:last-child").click();
    const proposal = page.locator(".draft-proposal");
    await proposal.locator(".design-toggle").waitFor();
    expect(await proposal.getByRole("button", { name: "After", exact: true }).getAttribute("aria-pressed")).toBe("true");
    expect(await text()).toBe("Original title proposal");
    await page.evaluate(() => (window as any).textQA.rewrite());
    await page.waitForTimeout(150);
    expect(await text()).toBe("Original title proposal");
    await proposal.getByRole("button", { name: "Before", exact: true }).click();
    expect(await text()).toBe("Original title");
    await proposal.getByRole("button", { name: "After", exact: true }).click();
    expect(await text()).toBe("Original title proposal");
    await page.keyboard.press("ArrowLeft");
    expect(await text()).toBe("Original title");
    await page.keyboard.press("ArrowRight");
    expect(await text()).toBe("Original title proposal");
    expect(await same()).toBe(true);
    await page.keyboard.press("Escape");
    expect(await text()).toBe("Original title");
    expect(await target.evaluate(node => ({ html: node.innerHTML, attributes: [...node.attributes].map(attr => [attr.name, attr.value]) }))).toEqual(original);
    expect(await same()).toBe(true);
    await page.evaluate(() => (window as any).komo.destroy());
    expect(await text()).toBe("Original title");
    expect(errors).toEqual([]);
    await page.close();
  });
});
