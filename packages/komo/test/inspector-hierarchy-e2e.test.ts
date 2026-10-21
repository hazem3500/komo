import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// KOMO_SCREENSHOTS=<label> writes inspector screenshots to <os tmpdir>/komo-inspector-hierarchy/<label>.
const chrome = [process.env.KOMO_E2E_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((path): path is string => !!path && existsSync(path));
const shots = process.env.KOMO_SCREENSHOTS ? join(tmpdir(), "komo-inspector-hierarchy", process.env.KOMO_SCREENSHOTS) : undefined;
let directory: string, origin: string;
let server: Server, browser: Browser;

const stacks: Record<string, string> = {
  stack: 'Inter, ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  quoted: '"Acme, Display", "Fallback Sans", serif',
  variable: "var(--font-sans)",
  unresolved: "var(--font-missing)",
  generic: "system-ui, sans-serif",
};

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-inspector-hierarchy-"));
  await build({
    stdin: { contents: `
      import ${JSON.stringify(resolve("src/adapters/react-preview.ts"))};
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      import {useKomoInspectable} from ${JSON.stringify(resolve("src/react.ts"))};
      import {discoverReactComponents} from ${JSON.stringify(resolve("src/adapters/react-fiber.ts"))};
      import {classTheme} from ${JSON.stringify(resolve("src/adapters/class-theme.ts"))};
      const query=new URLSearchParams(location.search),mode=query.get('mode'),view=query.get('case')||'registered';
      const definition={id:'button',name:'Button',source:'src/components/button.tsx',line:12,props:[
        {name:'label',kind:'string',required:true,typeLabel:'string'},
        {name:'variant',kind:'enum',required:true,values:['primary','secondary','ghost'],typeLabel:'"primary" | "secondary" | "ghost"'},
        {name:'size',kind:'enum',required:false,values:['sm','md','lg'],typeLabel:'"sm" | "md" | "lg"'},
        {name:'disabled',kind:'boolean',required:true,typeLabel:'boolean'},
        {name:'loading',kind:'boolean',required:false,typeLabel:'boolean'},
        {name:'accessibleDescriptionOverride',kind:'string',required:false,typeLabel:'string'},
        {name:'count',kind:'number',required:false,typeLabel:'number'},
        {name:'onPress',kind:'unsupported',required:false,typeLabel:'() => void'},
      ]};
      window.qa={opened:[],changes:[],copied:[]};
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.qa.copied.push(text)}}});
      window.open=(url)=>{window.qa.opened.push(String(url));return null};
      function Button(props){
        const [state,setState]=React.useState(props);
        const inspectable=useKomoInspectable({component:definition,props:state,onChange(next){window.qa.changes.push(next);setState(next)},enabled:true});
        return React.createElement('button',{...inspectable,type:'button',className:'button button-'+state.variant+(state.size?' button-'+state.size:''),disabled:state.disabled,'data-loading':state.loading===undefined?'unset':String(state.loading)},state.label+(state.count===undefined?'':' ('+state.count+')'));
      }
      function Card(props){return React.createElement('article',{className:'card'},React.createElement('h2',null,props.title),React.createElement('p',null,props.tone+(props.elevated?' · elevated':'')));}
      function Divider(props){return React.createElement('hr',{onClick:props.onClick,className:'divider'});}
      const schema=identity=>identity.name==='Card'?[{name:'title',kind:'string',required:true,typeLabel:'string'},{name:'tone',kind:'enum',required:true,values:['calm','bold','muted'],typeLabel:'"calm" | "bold" | "muted"'},{name:'elevated',kind:'boolean',required:true,typeLabel:'boolean'}]:undefined;
      const components=discoverReactComponents({edit:view==='discovered',schema});
      function App(){
        if(view==='registered')return React.createElement(Button,{label:'Save changes',variant:'primary',disabled:false,accessibleDescriptionOverride:''});
        if(view==='empty')return React.createElement(Divider,{onClick(){}});
        return React.createElement(Card,{title:'Weekly summary',tone:'calm',elevated:false});
      }
      createRoot(document.querySelector('#app')).render(React.createElement(App));
      window.fetch=async()=>Response.json({threads:[],guests:true});
      if(mode==='floating')document.body.append(document.createElement('aside'));
      const axis=classTheme({id:'mode',label:'Mode',options:[{id:'light',attribute:{'data-mode':'light'}},{id:'dark',attribute:{'data-mode':'dark'}}],colorScheme:true});
      window.komo=initKomo({endpoint:location.origin,project:'inspector',repo:'example/review',branch:'fixture',sourceUrl:(source,branch)=>'vscode://file/workspace/'+source+'?branch='+branch,pageRoot:mode==='floating'?undefined:document.querySelector('main'),sidebar:mode==='floating'?'edge':'background',frame:{scale:mode==='scaled'},restoreOpen:false,design:{components,themes:[axis]}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  await build({
    stdin: { contents: `
      import {initKomo} from ${JSON.stringify(resolve("src/index.ts"))};
      const query=new URLSearchParams(location.search),mode=query.get('mode'),long=query.has('long'),named=query.has('component');
      const qa=window.cardQA={opened:[],copied:[]};
      window.open=(url)=>{qa.opened.push(String(url));return null};
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{qa.copied.push(text)}}});
      const source=long?'src/features/planning/components/weekly-overview/sections/headings/a-really-long-directory-name-without-breaks/plan-section-heading-with-an-extremely-long-file-name.tsx:142':'src/components/plan-heading.tsx:12';
      const heading=document.querySelector('#target');
      const components={identify:element=>named&&element===heading?{name:long?'PlanSectionHeadingWithAnExtremelyLongComponentNameThatKeepsGoing':'PlanHeading',source,element}:null};
      const text=long?'Plan'+'!'.repeat(160)+'https://example.com/a/very/long/url/that/does/not/break/anywhere/at/all/'+'x'.repeat(80):'Plan!!!!';
      const selector=long?'main > h6.'+'utility-class-with-a-very-long-name-'.repeat(4)+'end.another-long-utility:nth-of-type(1)':'main > h6.px-2.py-1:nth-of-type(1)';
      const body='Please check this label\\n\\nProposed inline text change (preview only)\\nTarget: '+selector+'\\n'+(named?'Component: '+(long?'PlanSectionHeadingWithAnExtremelyLongComponentNameThatKeepsGoing':'PlanHeading')+' ('+source+')\\n':'')+'- Text: \\"Plan\\" → '+JSON.stringify(text)+'\\n- Source markup is unchanged; refresh resets this preview.'+(long?'\\n\\nProposed style changes (preview only)\\nTarget: '+selector+'\\n- background-image: none → url(https://cdn.example.com/assets/images/'+'segment/'.repeat(12)+'background.png)':'');
      const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
      const anchor={selector:'#target',text:'Plan',x:.5,y:.5,width:0,height:0,pageX:0,pageY:0,viewportWidth:1280};
      const thread={id:'card-thread',page:location.pathname,anchor,resolved:false,resolvedBy:null,createdAt:Date.now(),updatedAt:Date.now(),comments:[{id:'card-comment',body,author:user,createdAt:Date.now(),editedAt:null,reactions:{}}]};
      const key='branch-comments:'+location.origin+':cards';
      localStorage.setItem(key,'synthetic-session');
      localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));
      qa.body=body;qa.text=text;
      qa.posts=[];
      window.fetch=async(input,init)=>{const path=new URL(input instanceof Request?input.url:String(input)).pathname;if(init?.method==='POST'&&path.endsWith('/threads')){qa.posts.push(JSON.parse(init.body));return Response.json({thread})}return Response.json(path.endsWith('/me')?{user}:path.endsWith('/config')?{guests:true}:path.endsWith('/threads')?{threads:query.has('thread')?[thread]:[]}:{})};
      if(mode==='floating')document.body.append(document.createElement('aside'));
      window.komo=initKomo({endpoint:location.origin,project:'cards',repo:'example/review',branch:'fixture',sourceUrl:(path,branch)=>'vscode://file/workspace/'+path,pageRoot:mode==='floating'?undefined:document.querySelector('main'),sidebar:mode==='floating'?'edge':'background',frame:{scale:mode==='scaled'},restoreOpen:false,design:{components}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: join(directory, "card"), entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/card") {
      const theme = url.searchParams.get("theme") === "dark" ? "dark" : "light";
      const classes = url.searchParams.has("long") ? `${"utility-class-with-a-very-long-name-".repeat(4)}end another-long-utility` : "px-2 py-1";
      response.setHeader("content-type", "text/html");
      response.end(`<html data-mode="${theme}"><style>body{margin:0;font-family:system-ui,sans-serif}[data-mode=light]{background:#f7f6f3;color:#1f1f1f}[data-mode=dark]{background:#161616;color:#f1efeb}main{min-height:100vh;box-sizing:border-box;padding:80px 40px}h6{margin:0;font-size:14px;width:max-content}</style><main><h6 id="target" class="${classes}">Plan</h6></main><script type="module" src="/card/entry.js"></script></html>`);
      return;
    }
    if (url.pathname === "/") {
      const theme = url.searchParams.get("theme") === "dark" ? "dark" : "light";
      const family = stacks[url.searchParams.get("font") ?? "stack"] ?? stacks.stack;
      response.setHeader("content-type", "text/html");
      response.end(`<html data-mode="${theme}"><style>:root{--font-sans:"Acme, Display", Georgia, serif}body{margin:0;font-family:Georgia,serif}[data-mode=light]{background:#f7f6f3;color:#1f1f1f}[data-mode=dark]{background:#161616;color:#f1efeb}main{min-height:100vh;box-sizing:border-box;padding:80px 40px}.button{padding:12px 18px;border:0;border-radius:10px;font-size:15px;font-family:${family}}.button-primary{background:#6941c6;color:#fff}.button-secondary{background:#e9e6e1;color:#1f1f1f}.button-ghost{background:none;color:inherit}.button-lg{font-size:18px}.card{width:260px;padding:16px;border-radius:12px;background:#ffffff14;border:1px solid #8884}.divider{width:200px;height:12px;border:0;background:#8886}</style><main><div id="app"></div></main><script type="module" src="/entry.js"></script></html>`);
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

async function open(mode: string, query: string, viewport = { width: 1280, height: 800 }): Promise<Page> {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  await page.goto(`${origin}/?mode=${mode}&${query}`);
  await page.waitForFunction(() => !!(window as any).komo);
  const target = page.locator("#app > *").first();
  await target.waitFor();
  await page.keyboard.press("d");
  await target.click();
  await page.locator(".design-inspector .design-group").first().waitFor();
  return page;
}

async function composer(mode: string, query: string, viewport = { width: 1280, height: 800 }): Promise<Page> {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  await page.goto(`${origin}/card?mode=${mode}&${query}`);
  await page.waitForFunction(() => !!(window as any).komo);
  await page.keyboard.press("d");
  await page.locator('.design-inspector[aria-hidden="false"]').waitFor();
  await page.locator("#target").click({ position: { x: 5, y: 5 } });
  await page.getByRole("button", { name: "Edit selected text inline", exact: true }).click();
  await page.locator('#target[contenteditable="true"]').waitFor();
  await page.keyboard.press("End");
  await page.keyboard.type(await page.evaluate(() => (window as any).cardQA.text.slice(4)));
  await page.keyboard.press("Enter");
  await page.locator(".design-inspector__actions button:last-child").click();
  await page.locator(".draft-proposal .design-card").waitFor();
  return page;
}

async function posted(mode: string, query: string, viewport = { width: 1280, height: 800 }): Promise<Page> {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  await page.goto(`${origin}/card?mode=${mode}&thread&${query}`);
  await page.waitForFunction(() => !!(window as any).komo);
  await page.evaluate(() => (window as any).komo.open());
  await page.locator(".thread-card").first().click();
  await page.locator(".message-text .design-card").first().waitFor();
  return page;
}

/** Card content stays inside the card: nothing wider than its box, no descendant past its edges. */
function overflow(page: Page, selector: string) {
  return page.locator(selector).first().evaluate(root => {
    const box = root.getBoundingClientRect(), bad: string[] = [];
    if (root.scrollWidth > root.clientWidth) bad.push(`root ${root.scrollWidth}>${root.clientWidth}`);
    for (const node of root.querySelectorAll<HTMLElement>("*")) {
      if (node.closest("[hidden],style,.komo-source > span")) continue;
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      if (style.overflowX === "visible" && node.clientWidth && node.scrollWidth > node.clientWidth) bad.push(`${node.className || node.localName} scroll ${node.scrollWidth}>${node.clientWidth}`);
      if (rect.width && (rect.right > box.right + 1 || rect.left < box.left - 1)) bad.push(`${node.className || node.localName} rect ${rect.left}-${rect.right} outside ${box.left}-${box.right}`);
    }
    return bad;
  });
}

const modes = ["floating", "reflow", "scaled"];

describe.skipIf(!chrome).each(modes)("inspector hierarchy in %s", mode => {
  it("heads Properties with the component, keeps the source in an info popover and sizes typed controls", async () => {
    const page = await open(mode, "case=registered");
    const group = page.locator(".design-react-group").first();
    expect(await group.locator("summary").textContent()).toBe("Button");
    expect(await group.getByText("Runtime preview").count()).toBe(0);
    expect(await group.locator(".design-react-source").count()).toBe(0);
    const info = page.getByRole("button", { name: "Button source", exact: true });
    await info.click();
    const popup = page.getByRole("dialog", { name: "Button source", exact: true });
    await expect.poll(() => popup.isVisible()).toBe(true);
    expect(await popup.evaluate(node => node.firstChild?.textContent)).toBe("src/components/button.tsx:12");
    await popup.getByRole("button", { name: "Copy source path", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).qa.copied)).toEqual(["src/components/button.tsx:12"]);
    await popup.getByRole("button", { name: "Open source", exact: true }).click();
    expect(await page.evaluate(() => (window as any).qa.opened)).toEqual([expect.stringMatching(/^vscode:\/\/file\/workspace\/src\/components\/button\.tsx\?branch=\w+$/)]);
    expect(await popup.isVisible()).toBe(false);
    await info.click();
    await page.keyboard.press("Escape");
    expect(await popup.isVisible()).toBe(false);
    expect(await page.locator('.design-inspector[aria-hidden="false"]').count()).toBe(1);
    const button = page.locator("#app button");
    const variant = page.locator('[aria-label="Button variant"]');
    expect(await variant.evaluate(node => node.localName)).toBe("select");
    // A compact label column; controls fill the rest and end at one edge, before Reset's reserved slot.
    const columns = await group.locator(".design-react-row").evaluateAll(rows => rows.map(row => {
      const field = row.querySelector(".design-react-field")!, control = field.querySelector(":scope > :is(input:not([type=checkbox]), select)");
      return { label: field.querySelector(":scope > span")!.getBoundingClientRect().width, right: control && Math.round(control.getBoundingClientRect().right), row: Math.round(row.getBoundingClientRect().right) };
    }));
    expect(Math.max(...columns.map(column => column.label))).toBeLessThanOrEqual(80);
    const edges = new Set(columns.flatMap(column => column.right === null ? [] : [column.right]));
    expect(edges.size).toBe(1);
    expect(columns[0].row - [...edges][0]).toBeGreaterThanOrEqual(28);
    expect((await variant.boundingBox())!.width).toBeGreaterThan(140);
    await variant.selectOption("ghost");
    await expect.poll(() => button.getAttribute("class")).toContain("button-ghost");
    const disabled = page.getByRole("switch", { name: "Button disabled", exact: true });
    expect(await disabled.isChecked()).toBe(false);
    await disabled.click();
    await expect.poll(() => button.isDisabled()).toBe(true);
    expect(await disabled.isChecked()).toBe(true);
    expect(await page.getByRole("switch", { name: "Button loading", exact: true }).getAttribute("data-unset")).toBe("");
    expect(await page.locator('[aria-label="Button count"]').getAttribute("placeholder")).toBe("unset");
    expect(await page.locator('[aria-label="Button accessibleDescriptionOverride"]').getAttribute("placeholder")).toBe('""');
    const caption = group.locator(".design-react-field > span").filter({ hasText: "accessibleDescriptionOverride" });
    expect(await caption.getAttribute("title")).toBe("accessibleDescriptionOverride");
    expect(await caption.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    expect(await group.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => button.isDisabled()).toBe(false);
    await page.getByRole("button", { name: "Before", exact: true }).click();
    await expect.poll(() => button.getAttribute("class")).toContain("button-primary");
    await page.getByRole("button", { name: "After", exact: true }).click();
    await expect.poll(() => button.getAttribute("class")).toContain("button-ghost");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect.poll(() => button.getAttribute("class")).toContain("button-primary");
    await page.close();
  });

  it("edits schema enums and switches on discovered components, labels read-only props and drops empty bodies", async () => {
    const page = await open(mode, "case=discovered");
    const card = page.locator("#app article");
    expect(await page.locator(".design-react-group summary").first().textContent()).toBe("Card");
    await page.locator('[aria-label="Card tone"]').selectOption("bold");
    await page.getByRole("switch", { name: "Card elevated", exact: true }).click();
    await expect.poll(() => card.locator("p").textContent()).toBe("bold · elevated");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect.poll(() => card.locator("p").textContent()).toBe("calm");
    await page.close();
    const readonly = await open(mode, "case=readonly");
    const discovered = readonly.locator(".design-react-discovered");
    expect(await discovered.locator("summary").textContent()).toBe("CardRead-only");
    expect(await discovered.locator("input[readonly]").count()).toBe(3);
    expect(await discovered.locator('[aria-label="title (discovered, read-only)"]').inputValue()).toBe('"Weekly summary"');
    await readonly.getByRole("button", { name: "Card source", exact: true }).click();
    const popup = readonly.getByRole("dialog", { name: "Card source", exact: true });
    expect(await popup.getByRole("button", { name: "Copy source path", exact: true }).count()).toBe(1);
    expect(await popup.getByRole("button", { name: "Open source", exact: true }).count()).toBe(0);
    await readonly.close();
    const empty = await open(mode, "case=empty");
    const group = empty.locator(".design-react-discovered");
    expect(await group.getAttribute("data-empty")).toBe("");
    expect(await group.locator("summary").textContent()).toBe("Divider");
    expect(await group.locator(".design-react-field, .design-react-status").count()).toBe(0);
    await empty.close();
  });

  it.each([
    ["quoted", "Acme, Display", "", '"Acme, Display", "Fallback Sans", serif'],
    ["stack", "Inter", "", "Inter, ui-sans-serif"],
    ["generic", "system-ui", "generic", "system-ui, sans-serif"],
    ["variable", "Acme, Display", "", "var(--font-sans) → "],
    ["unresolved", "--font-missing unresolved", "", "does not resolve"],
  ])("shows the %s font family by its primary name and keeps the exact stack", async (font, label, note, title) => {
    const page = await open(mode, `case=registered&font=${font}`);
    const field = page.locator('[data-field-property="font-family"]');
    await field.scrollIntoViewIfNeeded();
    expect(await field.locator(".komo-font-name span").textContent()).toBe(label);
    expect(await field.locator(".komo-font-name small").textContent()).toBe(note);
    expect(await field.locator("input[data-property]").getAttribute("title")).toContain(title);
    await page.close();
  });

  it("keeps an exact quoted stack through preview, cancel, Undo, Before/After and Reset", async () => {
    const page = await open(mode, "case=registered&font=quoted");
    const button = page.locator("#app button");
    const field = page.locator('[data-field-property="font-family"]');
    const input = field.locator("input[data-property]");
    const label = () => field.locator(".komo-font-name span").textContent();
    const inline = () => button.evaluate(node => node.style.fontFamily);
    const exact = '"Other, Face", "Fallback Sans", monospace';
    await field.scrollIntoViewIfNeeded();
    await input.fill(exact);
    expect(await inline()).toBe(exact);
    await input.press("Escape");
    expect(await inline()).toBe("");
    await expect.poll(label).toBe("Acme, Display");
    await input.fill(exact);
    await input.press("Enter");
    expect(await inline()).toBe(exact);
    expect(await label()).toBe("Other, Face");
    expect(await input.inputValue()).toBe(exact);
    await page.getByRole("button", { name: "Before", exact: true }).click();
    expect(await inline()).toBe("");
    await page.getByRole("button", { name: "After", exact: true }).click();
    expect(await inline()).toBe(exact);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await inline()).toBe("");
    await expect.poll(label).toBe("Acme, Display");
    await page.locator('[data-field-property="font-family"] input[data-property]').fill(exact);
    await page.locator('[data-field-property="font-family"] input[data-property]').press("Enter");
    expect(await inline()).toBe(exact);
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    expect(await inline()).toBe("");
    await page.close();
  });

  it("names change cards for reviewers, hides the source behind the shared info button and never overflows", async () => {
    const draft = await composer(mode, "component&long");
    const card = draft.locator(".draft-proposal .design-card").first();
    const name = "PlanSectionHeadingWithAnExtremelyLongComponentNameThatKeepsGoing";
    expect(await card.locator(".design-card-target").textContent()).toBe(name);
    expect(await card.locator(".design-card-target").getAttribute("title")).toBe(name);
    expect(await card.evaluate(node => node.innerText)).not.toContain("src/features");
    expect(await overflow(draft, ".draft-proposal")).toEqual([]);
    await card.getByRole("button", { name: `${name} source`, exact: true }).click();
    const popup = card.getByRole("dialog", { name: `${name} source`, exact: true });
    expect(await popup.evaluate(node => node.firstChild?.textContent)).toContain("plan-section-heading-with-an-extremely-long-file-name.tsx:142");
    await popup.getByRole("button", { name: "Copy source path", exact: true }).click();
    await expect.poll(() => draft.evaluate(() => (window as any).cardQA.copied.length)).toBe(1);
    await popup.getByRole("button", { name: "Open source", exact: true }).click();
    expect(await draft.evaluate(() => (window as any).cardQA.opened)).toEqual([
      "vscode://file/workspace/src/features/planning/components/weekly-overview/sections/headings/a-really-long-directory-name-without-breaks/plan-section-heading-with-an-extremely-long-file-name.tsx",
    ]);
    await draft.close();
    const plain = await composer(mode, "");
    const target = plain.locator(".draft-proposal .design-card-target").first();
    expect(await target.textContent()).toBe("Heading “Plan”");
    expect(await plain.locator(".draft-proposal").evaluate(node => (node as HTMLElement).innerText)).not.toMatch(/px-2|#target|h6/);
    expect(await plain.locator(".draft-proposal .design-diff").evaluate(node => node.innerHTML)).toBe("Plan<ins>!!!!</ins>");
    const note = plain.getByRole("textbox", { name: "Comment", exact: true });
    await note.fill("Please check this label");
    await note.press("Meta+Enter");
    await plain.waitForFunction(() => (window as any).cardQA.posts?.length);
    const body = (await plain.evaluate(() => (window as any).cardQA.posts[0])).body as string;
    expect(body).toContain("Target: ");
    expect(body).toContain('- Text: "Plan" → "Plan!!!!"');
    await plain.close();
    const thread = await posted(mode, "component&long");
    expect(await thread.locator(".message-text .design-card-target").first().textContent()).toBe(name);
    expect(await overflow(thread, ".message-text .design-comment")).toEqual([]);
    expect(await thread.locator(".message-text .design-comment").evaluate(node => (node as HTMLElement).innerText)).not.toMatch(/src\/features|utility-class/);
    await thread.close();
  });
});

describe.skipIf(!chrome || !shots)("inspector screenshots", () => {
  it("writes registered, discovered, empty, source and font screenshots in light, dark and at 390px", async () => {
    await mkdir(shots!, { recursive: true });
    const cases = [["registered", "case=registered"], ["discovered", "case=discovered"], ["readonly", "case=readonly"], ["empty", "case=empty"], ["source", "case=registered"],
      ...Object.keys(stacks).map(font => [`font-${font}`, `case=registered&font=${font}`])];
    for (const theme of ["light", "dark"]) {
      for (const [name, query, mode = "floating"] of [["composer", "component"], ["composer-plain", ""], ["composer-long", "component&long"], ["composer-source", "component&long", "reflow"]]) {
        const page = await composer(mode, `${query}&theme=${theme}`);
        if (name.endsWith("source")) await page.locator(".draft-proposal .komo-source__button").click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(shots!, `${name}-${theme}.png`) });
        await page.close();
      }
      for (const [name, query] of [["posted", "component"], ["posted-plain", ""], ["posted-long", "component&long"], ["posted-source", "component&long"]]) {
        const page = await posted("floating", `${query}&theme=${theme}`);
        if (name.endsWith("source")) await page.locator(".message-text .komo-source__button").first().click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(shots!, `${name}-${theme}.png`) });
        await page.close();
      }
      for (const [name, query] of cases) {
        const page = await open("floating", `${query}&theme=${theme}`);
        if (name.startsWith("font")) await page.locator('[data-field-property="font-family"]').scrollIntoViewIfNeeded();
        if (name === "source") await page.locator(".komo-source__button").click().catch(() => {});
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(shots!, `${name}-${theme}.png`) });
        await page.close();
      }
      for (const name of ["registered", "source", "font-quoted"]) {
        const narrow = await open("reflow", `case=registered&font=quoted&theme=${theme}`, { width: 390, height: 844 });
        if (name === "source") await narrow.locator(".komo-source__button").click().catch(() => {});
        if (name.startsWith("font")) await narrow.locator('[data-field-property="font-family"]').scrollIntoViewIfNeeded();
        await narrow.waitForTimeout(300);
        await narrow.screenshot({ path: join(shots!, `${name}-${theme}-390.png`) });
        await narrow.close();
      }
    }
  }, 240_000);
});
