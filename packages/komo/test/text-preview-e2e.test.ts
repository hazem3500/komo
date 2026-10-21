import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDesign } from "./design-e2e.js";

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
        import {useKomoInspectable} from ${JSON.stringify(resolve("src/react.ts"))};
        import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
        import {renderDraftProposal,resetDesignPreviews} from ${JSON.stringify(resolve("src/design-comment.ts"))};
        import {startInlineTextEditor} from ${JSON.stringify(resolve("src/inline-text-editor.ts"))};
        const qa=window.textQA={actions:0};
        qa.startText=async()=>{const editor=await startInlineTextEditor(document.querySelector('#target'),{loadReactBridge:async()=>null,onFinish(){}});qa.finishText=cancel=>editor.finish(cancel)};
        const definition={id:'heading',name:'Heading',textProp:'title',props:[{name:'title',kind:'string',required:true,typeLabel:'string'}]};
        function Bridge(){
          const[props,setProps]=React.useState({title:'Original title'});
          const inspect=useKomoInspectable({enabled:true,component:definition,props,onChange:setProps});
          qa.props=props;
          return React.createElement('p',{...inspect,id:'bridge',style:{whiteSpace:'pre-wrap'}},props.title);
        }
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
        createRoot(document.querySelector('main')).render(React.createElement(new URLSearchParams(location.search).has('bridge')?Bridge:App));
        const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
        const key='branch-comments:'+location.origin+':text-preview';
        localStorage.setItem(key,'synthetic-session');
        localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
        window.fetch=async (input,init)=>{const path=new URL(input instanceof Request?input.url:String(input)).pathname;if(init?.method==="POST"&&path.endsWith("/threads"))qa.post=JSON.parse(init.body);return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads:[]}:{});};
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
  it("inspects focused native buttons, links and summaries with Enter/Space without host activation", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await page.goto(`${origin}/?react=${version}&mode=floating`);
    await page.locator('#target').waitFor();
    await page.evaluate(() => {
      const area = document.createElement('section');
      area.innerHTML = '<button id="native-button">Action</button><a id="native-link" href="#destination">Navigate</a><details><summary id="native-summary">Details</summary>Body</details>';
      document.querySelector('main')!.append(area);
      area.addEventListener('click', () => (window as any).textQA.actions++);
    });
    await openDesign(page);
    for (const id of ['native-button', 'native-link', 'native-summary']) for (const key of ['Enter', 'Space']) {
      await page.locator(`#${id}`).focus();
      await page.keyboard.press(key);
      expect(await page.locator('.design-inspector__target').textContent()).toContain(`#${id}`);
      expect(await page.evaluate(() => (window as any).textQA.actions)).toBe(0);
      expect(new URL(page.url()).hash).toBe('');
      expect(await page.locator('main details').getAttribute('open')).toBeNull();
    }
    await page.locator('#native-button').focus();
    await page.keyboard.press('ArrowRight');
    expect(await page.locator('.design-inspector__target').textContent()).toContain('#native-summary');
    await page.locator('#native-button').click();
    await page.keyboard.press('Tab');
    expect(await page.locator('.design-inspector__target').textContent()).toContain('#native-link');
    await page.evaluate(() => (window as any).komo.destroy());
    await page.close();
  });

  it("opens the inspector only once its selection keys have loaded", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    let release!: () => void;
    const loaded = new Promise<void>(resolve => { release = resolve; });
    let requested = false;
    await page.route(/\/design-export[^/]*\.js$/, async route => { requested = true; await loaded; await route.continue(); });
    await page.goto(`${origin}/?react=${version}&mode=floating`);
    await page.locator('#target').waitFor();
    await page.evaluate(() => { document.querySelector('main')!.appendChild(document.createElement('button')).id = 'early-button'; });
    await page.keyboard.press('d');
    await expect.poll(() => requested).toBe(true);
    // Design mode has loaded and requested its selection keys; until they arrive, the inspector stays closed.
    expect(await page.locator('.design-inspector[aria-hidden="false"]').count()).toBe(0);
    release();
    await page.locator('.design-inspector[aria-hidden="false"]').waitFor();
    await page.locator('#early-button').focus();
    await page.keyboard.press('Enter');
    expect(await page.locator('.design-inspector__target').textContent()).toContain('#early-button');
    await page.evaluate(() => (window as any).komo.destroy());
    await page.close();
  });

  it("opens the inspector within 2s even while its selection keys are still loading", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    let release!: () => void;
    const loaded = new Promise<void>(resolve => { release = resolve; });
    let requested = 0;
    await page.route(/\/design-export[^/]*\.js$/, async route => { requested ||= Date.now(); await loaded; await route.continue(); });
    try {
      await page.goto(`${origin}/?react=${version}&mode=floating`);
      await page.locator('#target').waitFor();
      await page.keyboard.press('d');
      await expect.poll(() => requested).not.toBe(0);
      await page.locator('.design-inspector[aria-hidden="false"]').waitFor({ timeout: 4000 });
      expect(Date.now() - requested).toBeGreaterThanOrEqual(1500);
      // The held chunk then arrives and Enter inspects the focused link as usual.
      release();
      await expect.poll(() => page.locator('.design-inspector__actions [aria-label="Undo"] svg').count()).toBe(1);
      await page.locator('#target').focus();
      await page.keyboard.press('Enter');
      expect(await page.locator('.design-inspector__target').textContent()).toContain('#target');
      await page.evaluate(() => (window as any).komo.destroy());
    } finally {
      release();
      await page.close();
    }
  });

  it("keeps source-formatting newlines at baseline geometry in Before and Undo", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await page.goto(`${origin}/?react=${version}&mode=floating`);
    await page.locator('#target').waitFor();
    const baseline = await page.locator('#target').evaluate(node => {
      node.querySelector('strong')!.firstChild!.textContent = 'Original\n title';
      (node as HTMLElement).style.setProperty('white-space', 'normal', 'important');
      const qa = (window as any).textQA;
      qa.owner = node; qa.icon = node.querySelector('svg'); qa.text = node.querySelector('strong')!.firstChild;
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, whitespace: getComputedStyle(node).whiteSpace, style: node.getAttribute('style') };
    });
    const geometry = () => page.locator('#target').evaluate(node => { const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height, whitespace: getComputedStyle(node).whiteSpace, style: node.getAttribute('style') }; });
    const start = async () => {
      await page.getByRole('button', { name: 'Edit selected text inline', exact: true }).click();
      await page.locator('#target[contenteditable="true"]').waitFor();
    };
    const compare = page.locator('.design-inspector__compare');
    await openDesign(page);
    await page.locator('#target').click({ position: { x: 5, y: 5 } });
    await start();
    await page.keyboard.type(' edited');
    await page.keyboard.press('Enter');
    expect((await geometry()).whitespace).toBe('normal');
    await compare.getByRole('button', { name: 'Before', exact: true }).click();
    expect(await geometry()).toEqual(baseline);
    await compare.getByRole('button', { name: 'After', exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await geometry()).toEqual(baseline);
    await start();
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('line');
    await page.keyboard.press('Enter');
    expect((await geometry()).whitespace).toBe('pre-wrap');
    await compare.getByRole('button', { name: 'Before', exact: true }).click();
    expect(await geometry()).toEqual(baseline);
    await compare.getByRole('button', { name: 'After', exact: true }).click();
    await page.locator('.design-inspector__actions button:last-child').click();
    const proposal = page.locator('.draft-proposal');
    await proposal.locator('.design-toggle').waitFor();
    expect(await proposal.textContent()).toContain('white-space');
    expect((await geometry()).whitespace).toBe('pre-wrap');
    await proposal.getByRole('button', { name: 'Before', exact: true }).click();
    expect(await geometry()).toEqual(baseline);
    await proposal.getByRole('button', { name: 'After', exact: true }).click();
    expect((await geometry()).whitespace).toBe('pre-wrap');
    expect(await page.locator('#target').evaluate(node => node === (window as any).textQA.owner && node.querySelector('svg') === (window as any).textQA.icon && node.querySelector('strong')!.firstChild === (window as any).textQA.text)).toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#target')!).whiteSpace === 'normal');
    expect(await geometry()).toEqual(baseline);
    await page.evaluate(() => (window as any).komo.destroy());
    await page.close();
  });

  it("commits physical multiline typing through the registered React text bridge and Undo", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await page.goto(`${origin}/?react=${version}&mode=floating&bridge=1`);
    const target = page.locator('#bridge[data-komo-text-prop]');
    await target.waitFor();
    await openDesign(page);
    await target.click();
    const tab = page.getByRole('tab', { name: 'Design', exact: true });
    if (await tab.count()) await tab.click();
    await page.getByRole('button', { name: 'Edit selected text inline', exact: true }).click();
    await page.locator('#bridge[contenteditable="true"]').waitFor();
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('bridge');
    await page.keyboard.press('Enter');
    expect(await target.textContent()).toBe('Original title\nbridge');
    expect(await page.evaluate(() => (window as any).textQA.props.title)).toBe('Original title\nbridge');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForFunction(() => (window as any).textQA.props.title === 'Original title');
    expect(await target.textContent()).toBe('Original title');
    await page.evaluate(() => (window as any).komo.destroy());
    await page.close();
  });

  it("moves canvas siblings without comparing or activating the host, and reveals the selected outline", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await page.goto(`${origin}/?react=${version}&mode=floating`);
    await page.locator("#target").waitFor();
    await page.evaluate(() => {
      const sibling = document.createElement('p');
      sibling.id = 'sibling'; sibling.textContent = 'Next element'; sibling.style.marginTop = '1200px';
      document.querySelector('#target')!.after(sibling);
    });
    await openDesign(page);
    await page.locator('#target').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Tab');
    expect(await page.locator('.design-inspector__target').textContent()).toBe('p#sibling');
    const rect = await page.locator('#sibling').boundingBox();
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.y).toBeLessThan(800);
    expect(await page.locator('.design-outline:not(.design-outline--prospective)').isVisible()).toBe(true);
    await page.keyboard.press('Tab');
    expect(await page.locator('.design-inspector__target').textContent()).toBe('p#sibling');
    await page.keyboard.press('Shift+Tab');
    expect(await page.locator('.design-inspector__target').textContent()).toBe('a#target');
    expect(await page.evaluate(() => (window as any).textQA.actions)).toBe(0);
    expect(new URL(page.url()).hash).toBe('');
    await page.evaluate(() => (window as any).komo.destroy());
    await page.close();
  });

  it.each(['Meta+Enter', 'Control+Enter'])("submits the real proposal composer with %s", async shortcut => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await page.goto(`${origin}/?react=${version}&mode=floating`);
    await page.locator('#target').waitFor();
    await openDesign(page);
    await page.locator('#target').click({ position: { x: 5, y: 5 } });
    const designTab = page.getByRole('tab', { name: 'Design', exact: true });
    if (await designTab.count()) await designTab.click();
    await page.getByRole('button', { name: 'Edit selected text inline', exact: true }).click();
    await page.locator('#target[contenteditable="true"]').waitFor();
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('proposal');
    await page.keyboard.press('Enter');
    await page.locator('.design-inspector__actions button:last-child').click();
    const composer = page.getByRole('textbox', { name: 'Comment', exact: true });
    await composer.fill('Please update');
    await composer.press(shortcut);
    await page.waitForFunction(() => !!(window as any).textQA.post);
    const posted = await page.evaluate(() => (window as any).textQA.post);
    expect(JSON.stringify(posted)).toContain('Please update');
    expect(posted.body).toContain(JSON.stringify('Original title\nproposal'));
    expect(await page.evaluate(() => (window as any).textQA.actions)).toBe(0);
    await page.evaluate(() => (window as any).komo.destroy());
    await page.close();
  });

  it("restores absent, empty and prioritized focus styles without a DOM observer flushing attributes", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${origin}/?react=${version}&mode=floating`);
    await page.locator("#target").waitFor();
    for (const original of [null, "", "outline: 3px dotted blue !important; outline-offset: -3px; box-shadow: inset 0 0 1px red; white-space: nowrap; color: green !important;"]) {
      await page.evaluate(value => {
        const element = document.querySelector("#target")!;
        if (value === null) element.removeAttribute("style");
        else element.setAttribute("style", value);
      }, original);
      for (const cancel of [false, true]) {
        await page.evaluate(() => (window as any).textQA.startText());
        await page.keyboard.press("Space");
        await page.keyboard.press("q");
        await page.keyboard.press("a");
        await page.evaluate(value => (window as any).textQA.finishText(value), cancel);
        expect(await page.locator("#target").getAttribute("style")).toBe(original);
      }
    }
    await page.evaluate(async () => {
      const element = document.querySelector<HTMLElement>("#target")!;
      element.removeAttribute("style");
      await (window as any).textQA.startText();
      element.style.setProperty("color", "rgb(1, 2, 3)", "important");
      (window as any).textQA.finishText(true);
    });
    expect(await page.locator("#target").getAttribute("style")).toBe("color: rgb(1, 2, 3) !important;");
    await page.evaluate(() => (window as any).komo.destroy());
    await page.close();
  });

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
      const tab = page.getByRole("tab", { name: "Design", exact: true });
      if (await tab.count()) await tab.click();
      await page.getByRole("button", { name: "Edit selected text inline", exact: true }).click();
      await page.locator('#target[contenteditable="true"]').waitFor();
    };
    await openDesign(page);
    await target.click({ position: { x: 5, y: 5 } });
    await start();
    expect(await target.evaluate(node => getComputedStyle(node).outlineColor)).toBe("rgb(189, 166, 239)");
    expect(await target.evaluate(node => getComputedStyle(node).boxShadow)).toBe("none");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.press("q");
    await page.keyboard.press("a");
    await page.keyboard.press("Enter");
    expect(await text()).toBe("Original title\nqa");
    await page.waitForTimeout(400);
    expect(await target.evaluate(node => getComputedStyle(node).whiteSpace)).toBe("pre-wrap");
    await page.locator(".design-inspector__compare button").first().waitFor({ state: "visible" });
    await page.locator(".design-inspector__compare button").first().focus();
    await page.keyboard.press("ArrowLeft");
    expect(await text()).toBe("Original title");
    await page.keyboard.press("ArrowRight");
    expect(await text()).toBe("Original title\nqa");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await text()).toBe("Original title");
    await start();
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("reset");
    await page.keyboard.press("Meta+Enter");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    expect(await text()).toBe("Original title");
    expect(await target.getAttribute("style")).toBeNull();
    await start();
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("cancel");
    await page.keyboard.press("Escape");
    expect(await text()).toBe("Original title");
    expect(await target.getAttribute("style")).toBeNull();
    await start();
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("proposal");
    await page.keyboard.press("Enter");
    await page.evaluate(() => (window as any).textQA.rewrite());
    await page.waitForTimeout(250);
    expect(await text()).toBe("Original title\nproposal");
    await page.locator("#target").evaluate(node => (node as HTMLElement).blur());
    await page.keyboard.press("v");
    expect(await text()).toBe("Original title");
    await page.evaluate(() => (window as any).textQA.rewrite());
    await page.waitForTimeout(150);
    expect(await text()).toBe("Host update");
    await page.keyboard.press("d");
    expect(await text()).toBe("Original title\nproposal");
    await page.locator(".design-inspector__actions button:last-child").click();
    const proposal = page.locator(".draft-proposal");
    await proposal.locator(".design-toggle").waitFor();
    expect(await proposal.getByRole("button", { name: "After", exact: true }).getAttribute("aria-pressed")).toBe("true");
    expect(await text()).toBe("Original title\nproposal");
    await page.evaluate(() => (window as any).textQA.rewrite());
    await page.waitForTimeout(150);
    expect(await text()).toBe("Original title\nproposal");
    await proposal.getByRole("button", { name: "Before", exact: true }).click();
    expect(await text()).toBe("Original title");
    await proposal.getByRole("button", { name: "After", exact: true }).click();
    expect(await text()).toBe("Original title\nproposal");
    await page.keyboard.press("ArrowLeft");
    expect(await text()).toBe("Original title");
    await page.keyboard.press("ArrowRight");
    expect(await text()).toBe("Original title\nproposal");
    expect(await same()).toBe(true);
    if (mode === "floating") await page.evaluate(() => {
      history.pushState({}, '', '/next');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    else await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector('#target strong')?.textContent === 'Original title');
    expect(await text()).toBe("Original title");
    await page.waitForTimeout(400);
    expect(await target.evaluate(node => ({ html: node.innerHTML, attributes: [...node.attributes].map(attr => [attr.name, attr.value]) }))).toEqual(original);
    expect(await same()).toBe(true);
    await page.evaluate(() => (window as any).komo.destroy());
    expect(await text()).toBe("Original title");
    expect(errors).toEqual([]);
    await page.close();
  });
});
