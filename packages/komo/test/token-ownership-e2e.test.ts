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
let directory: string, origin: string;
let server: Server, browser: Browser;

beforeAll(async () => {
  if (!chrome) return;
  directory = await mkdtemp(join(tmpdir(), "komo-token-ownership-"));
  await build({
    stdin: { contents: `
      import { initKomo } from ${JSON.stringify(resolve("src/index.ts"))};
      import { tailwindTokens } from ${JSON.stringify(resolve("src/adapters/tailwind.ts"))};
      import { classTheme } from ${JSON.stringify(resolve("src/adapters/class-theme.ts"))};
      const query=new URLSearchParams(location.search),radius=query.get('case')==='radius',theme=query.get('case')==='theme',semantic=query.get('case')==='semantic',baseline=query.get('baseline');
      const listeners=new Set();
      const axis=semantic?{id:'mode',options:[{id:'light'},{id:'dark'}],current:()=>document.documentElement.getAttribute('data-review-mode'),apply(id){document.documentElement.setAttribute('data-review-mode',id);if(baseline==='concrete')document.querySelector('#target').style.setProperty('color',id==='light'?'#555555':'#cccccc','important');listeners.forEach(listener=>listener())},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)}}:classTheme({id:'mode',options:[{id:'light',attribute:{'data-review-mode':'light'}},{id:'dark',attribute:{'data-review-mode':'dark'}}]});
      if(theme||semantic)document.documentElement.setAttribute('data-review-mode','dark');
      const tokens=tailwindTokens({tokens:[
        {path:'color.base',type:'color',class:'text-base',properties:['color'],value:'#575456',...(theme?{values:{light:'#575456',dark:'#bbbbbb'}}:{}),label:'Base'},
        {path:'color.primary',type:'color',class:'text-primary',properties:['color'],value:'#6941c6',...(theme?{values:{light:'#6941c6',dark:'#c1a8ff'}}:{}),label:'Primary'},
        {path:'background.base',type:'color',class:'bg-base',properties:['background-color'],value:'#575456',...(theme?{values:{light:'#575456',dark:'#bbbbbb'}}:{}),label:'Base'},
        {path:'background.primary',type:'color',class:'bg-primary',properties:['background-color'],value:'#6941c6',...(theme?{values:{light:'#6941c6',dark:'#c1a8ff'}}:{}),label:'Primary'},
        ...(radius?[
          {path:'radius.small',type:'dimension',class:'radius-small',properties:['border-radius'],value:'8px',label:'Small'},
          {path:'radius.full',type:'dimension',class:'radius-full',properties:['border-radius'],value:'calc(infinity * 1px)',label:'Full'},
          {path:'radius.ellipse',type:'dimension',class:'radius-ellipse',properties:['border-radius'],value:'25% 30% 4px 40px / 10px 50% 4px 12px',label:'Elliptical'}
        ]:[])
      ]},{themes:theme?[axis]:undefined});
      const adapter=semantic?{id:'semantic-baseline',list:state=>[{path:'tone.base',type:'color',properties:['color'],value:state?.mode==='light'?'#555555':'#cccccc',label:'Base'},{path:'tone.accent',type:'color',properties:['color'],value:state?.mode==='light'?'#222222':'#eeeeee',label:'Accent'}],resolve:()=>({color:baseline==='custom'?{offToken:'#cccccc'}:{path:'tone.base'}})}:query.get('adapter')==='inline'?{id:'inline-values',list:state=>tokens.list(state),resolve:element=>tokens.resolve(element)}:tokens;
      const qa=window.radiusQA={actions:0,writes:[]};
      if(semantic)qa.theme=id=>axis.apply(id);
      document.querySelector('#target').onclick=()=>qa.actions++;
      const anchor={selector:'#target',text:'',x:.5,y:.5,width:0,height:0,pageX:0,pageY:0,viewportWidth:1280};
      const thread={id:'radius-thread',page:location.pathname,anchor,resolved:false,resolvedBy:null,createdAt:Date.now(),updatedAt:Date.now(),comments:[{id:'radius-comment',body:'Synthetic radius conversation',author:{id:'synthetic-reviewer',name:'Example reviewer',verified:true},createdAt:Date.now(),editedAt:null,reactions:{}}]};
      const user={id:'synthetic-reviewer',name:'Example reviewer',verified:true};
      if(radius){const key='branch-comments:'+location.origin+':ownership';localStorage.setItem(key,'synthetic-session');localStorage.setItem(key+':user',JSON.stringify({token:'synthetic-session',user}));localStorage.setItem(key+':'+JSON.stringify(['example/review','local'])+':threads',JSON.stringify({token:'synthetic-session',threads:[thread]}))}
      window.fetch=async(input,init)=>{const method=init?.method??(input instanceof Request?input.method:'GET');if(method!=='GET'){qa.writes.push(method);throw Error('Unexpected fixture write')}return Response.json({...(radius?{user}:{}),threads:radius?[thread]:[],guests:true})};
      const mode=new URLSearchParams(location.search).get('mode');
      if(mode==='floating')document.body.append(document.createElement('aside'));
      window.komo=initKomo({endpoint:location.origin,project:'ownership',repo:'example/review',branch:'fixture',pageRoot:mode==='floating'?undefined:document.querySelector('main'),sidebar:mode==='floating'?'edge':'background',frame:{scale:mode==='scaled'},restoreOpen:false,design:{tokens:adapter,...(theme||semantic?{themes:[axis]}:{})}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost"), path = url.pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      if (url.searchParams.get("case") === "semantic") {
        const baseline = url.searchParams.get("baseline");
        const color = baseline === "classes" ? "" : `color:${baseline === "variable" ? "var(--semantic-base)" : "#cccccc"} !important;`;
        response.end(`<style>body{margin:0}main{min-height:100vh;padding:70px;box-sizing:border-box}[data-review-mode=dark]{--semantic-base:#cccccc}[data-review-mode=light]{--semantic-base:#555555}.semantic-base{color:var(--semantic-base)}</style><main><p id="target" class="${baseline === "classes" ? "semantic-base" : ""}" style="${color}padding:12px !important">Example text</p></main><script type="module" src="/entry.js"></script>`);
        return;
      }
      response.end('<style>body{margin:0}main{min-height:100vh;box-sizing:border-box;padding:70px}.text-base{color:#575456}.text-primary{color:#6941c6}.bg-base{background-color:#575456}.bg-primary{background-color:#6941c6}[data-review-mode=dark] .text-base{color:#bbbbbb}[data-review-mode=dark] .text-primary{color:#c1a8ff}[data-review-mode=dark] .bg-base{background-color:#bbbbbb}[data-review-mode=dark] .bg-primary{background-color:#c1a8ff}button.surface{display:block;width:240px;height:72px;box-sizing:border-box;margin-bottom:32px;border:2px solid #aaa;background:#fff}.radius-small{border-radius:8px}.radius-full{border-radius:calc(infinity * 1px)}.radius-ellipse{border-radius:25% 30% 4px 40px / 10px 50% 4px 12px}</style><main>'+(url.searchParams.get('case')==='radius'?'<button id="target" class="surface radius-small">Primary surface</button><button id="other" class="surface radius-small">Second surface</button>':'<p id="target" class="text-base bg-base" style="padding: 12px !important;">Example text</p>')+'</main><script type="module" src="/entry.js"></script>');
      return;
    }
    if (path === "/radius.css") {
      response.setHeader("content-type", "text/css");
      response.end("#target{border-radius:24px}");
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

describe.skipIf(!chrome).each(["floating", "reflow", "scaled"])("token ownership in %s", mode => {

  it.each(["concrete", "variable", "classes", "custom"])("restores the current %s baseline in actual Before, Undo and Reset", async baseline => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    await page.goto(`${origin}/?mode=${mode}&case=semantic&baseline=${baseline}`);
    await page.waitForFunction(() => !!(window as any).komo);
    const target = page.locator("#target"), original = await target.evaluate(node => node.style.cssText);
    const value = () => target.evaluate(node => getComputedStyle(node).color);
    const theme = (id: string) => page.evaluate(id => (window as any).radiusQA.theme(id), id);
    await page.keyboard.press("d");
    await target.click();
    const trigger = page.locator('[data-field-property="color"] select[data-picker]');
    const choose = async () => {
      await trigger.click();
      await page.locator('.komo-tokens [role="option"]').filter({ hasText: "Accent" }).click();
    };
    const expected = baseline === "custom" ? "rgb(204, 204, 204)" : "rgb(85, 85, 85)";
    await choose();
    expect(await value()).toBe("rgb(238, 238, 238)");
    await theme("light");
    await expect.poll(value).toBe("rgb(34, 34, 34)");
    await page.getByRole("button", { name: "Before", exact: true }).click();
    expect(await value()).toBe(expected);
    expect(await target.evaluate(node => [node.style.padding, node.style.getPropertyPriority("padding")])).toEqual(["12px", "important"]);
    await theme("dark");
    await expect.poll(() => trigger.getAttribute("title")).toContain("#eeeeee");
    expect(await value()).toBe("rgb(204, 204, 204)");
    await theme("light");
    await expect.poll(() => trigger.getAttribute("title")).toContain("#222222");
    expect(await value()).toBe(expected);
    await page.getByRole("button", { name: "After", exact: true }).click();
    expect(await value()).toBe("rgb(34, 34, 34)");
    const field = page.locator('[data-field-property="color"]');
    await field.getByRole("button", { name: "Edit color value", exact: true }).click();
    const raw = field.locator('input[data-property="color"]');
    await raw.fill("#ef3340");
    await raw.press("Enter");
    expect(await value()).toBe("rgb(239, 51, 64)");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await value()).toBe("rgb(34, 34, 34)");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await value()).toBe(expected);
    expect(await page.locator(".design-inspector__count").textContent()).toBe("");
    expect(await page.locator('.design-inspector__actions [aria-label="Undo"]').isDisabled()).toBe(true);
    await expect.poll(() => trigger.inputValue()).toBe(baseline === "custom" ? "" : "tone.base");
    if (baseline !== "concrete") expect(await target.evaluate(node => node.style.cssText)).toBe(original);
    else expect(await target.evaluate(node => [node.style.color, node.style.getPropertyPriority("color")])).toEqual(["rgb(85, 85, 85)", "important"]);
    await choose();
    await page.keyboard.press("Tab");
    await page.keyboard.press("v");
    expect(await value()).toBe(expected);
    await theme("dark");
    await expect.poll(() => trigger.getAttribute("title")).toContain("#eeeeee");
    expect(await value()).toBe("rgb(204, 204, 204)");
    await page.keyboard.press("d");
    await expect.poll(value).toBe("rgb(238, 238, 238)");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    expect(await value()).toBe("rgb(204, 204, 204)");
    if (baseline !== "concrete") expect(await target.evaluate(node => node.style.cssText)).toBe(original);
    else expect(await target.evaluate(node => [node.style.color, node.style.getPropertyPriority("color"), node.style.padding, node.style.getPropertyPriority("padding")])).toEqual(["rgb(204, 204, 204)", "important", "12px", "important"]);
    await choose();
    await page.locator('.design-inspector__bar').getByRole("button", { name: "Comment", exact: true }).click();
    const draft = page.locator(".draft-proposal");
    await draft.waitFor();
    await theme("light");
    await expect.poll(value).toBe("rgb(34, 34, 34)");
    await draft.getByRole("button", { name: "Before", exact: true }).click();
    expect(await value()).toBe(expected);
    await theme("dark");
    await expect.poll(() => draft.textContent()).toContain("#eeeeee");
    expect(await value()).toBe("rgb(204, 204, 204)");
    await draft.getByRole("button", { name: "After", exact: true }).click();
    expect(await value()).toBe("rgb(238, 238, 238)");
    await page.keyboard.press("Escape");
    expect(await value()).toBe("rgb(204, 204, 204)");
    expect(await page.evaluate(() => ({ actions: (window as any).radiusQA.actions, writes: (window as any).radiusQA.writes }))).toEqual({ actions: 0, writes: [] });
    await page.evaluate(() => (window as any).komo.destroy());
    await page.close();
  });

  it.each(["classes", "inline"])("keeps %s semantic DOM, picker and unsaved draft current across theme changes", async adapter => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?mode=${mode}&case=theme&adapter=${adapter}`);
    await page.waitForFunction(() => !!(window as any).komo);
    const target = page.locator("#target"), original = await target.getAttribute("style");
    const value = () => target.evaluate(node => getComputedStyle(node).color);
    const theme = (id: string) => page.evaluate(id => document.documentElement.setAttribute("data-review-mode", id), id);
    await page.keyboard.press("d");
    await target.click();
    const field = page.locator('[data-field-property="color"]');
    const trigger = field.locator("select[data-picker]");
    await trigger.waitFor();
    await trigger.click();
    await page.locator('.komo-tokens [role="option"]').filter({ hasText: "Primary" }).click();
    expect(await value()).toBe("rgb(193, 168, 255)");
    await trigger.click();
    const popup = await page.locator(".komo-tokens").elementHandle();
    const search = page.getByRole("combobox", { name: "Search tokens for color" });
    const searchNode = await search.elementHandle();
    await search.fill("base");
    expect(await value()).toBe("rgb(187, 187, 187)");
    await theme("light");
    await expect.poll(value).toBe("rgb(87, 84, 86)");
    expect(await popup!.evaluate(node => node.isConnected)).toBe(true);
    expect(await searchNode!.evaluate(node => node === node.getRootNode().querySelector('.komo-tokens input'))).toBe(true);
    expect(await search.inputValue()).toBe("base");
    expect(await search.evaluate(node => (node as HTMLInputElement).selectionStart)).toBe(4);
    await expect.poll(() => page.locator('.komo-tokens [data-active]').getAttribute("aria-label")).toContain("#575456");
    await page.keyboard.press("Escape");
    expect(await value()).toBe("rgb(105, 65, 198)");
    expect(await field.locator('input[type="color"]').inputValue()).toBe("#6941c6");
    expect(await trigger.getAttribute("title")).not.toContain("#c1a8ff");
    await field.getByRole("button", { name: "Edit color value", exact: true }).click();
    const raw = field.locator('input[data-property="color"]');
    await raw.fill("#ef3340");
    await raw.press("Enter");
    await theme("dark");
    await expect.poll(() => trigger.getAttribute("title")).toContain("rgb(239, 51, 64)");
    expect(await value()).toBe("rgb(239, 51, 64)");
    expect(await field.getAttribute("data-token-mode")).toBe("custom");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(value).toBe("rgb(193, 168, 255)");
    await page.getByRole("button", { name: "Before", exact: true }).click();
    await theme("light");
    await expect.poll(value).toBe("rgb(87, 84, 86)");
    await page.getByRole("button", { name: "After", exact: true }).click();
    expect(await value()).toBe("rgb(105, 65, 198)");
    await page.keyboard.press("v");
    await theme("dark");
    await expect.poll(value).toBe("rgb(187, 187, 187)");
    await page.keyboard.press("d");
    await expect.poll(value).toBe("rgb(193, 168, 255)");
    const fill = page.locator('[data-field-property="background-color"]');
    await fill.getByRole("button", { name: "Edit background-color value", exact: true }).click();
    await fill.locator('input[data-property="background-color"]').fill("#ef3340");
    await fill.locator('input[data-property="background-color"]').press("Enter");
    await page.locator('.design-inspector__bar').getByRole("button", { name: "Comment", exact: true }).click();
    const draft = page.locator(".draft-proposal");
    await draft.waitFor();
    await expect.poll(value).toBe("rgb(193, 168, 255)");
    await draft.getByRole("button", { name: "Before", exact: true }).click();
    expect(await value()).toBe("rgb(187, 187, 187)");
    await theme("light");
    await expect.poll(() => draft.textContent()).toContain("#6941c6");
    expect(await draft.textContent()).not.toContain("#c1a8ff");
    expect(await draft.textContent()).toContain("rgb(239, 51, 64)");
    expect(await draft.textContent()).not.toContain("#bbbbbb");
    expect(await value()).toBe("rgb(87, 84, 86)");
    expect(await draft.getByRole("button", { name: "Before", exact: true }).evaluate(node => node === (node.getRootNode() as ShadowRoot).activeElement)).toBe(true);
    await draft.getByRole("button", { name: "After", exact: true }).click();
    expect(await value()).toBe("rgb(105, 65, 198)");
    expect(await target.evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(239, 51, 64)");
    await theme("dark");
    await expect.poll(value).toBe("rgb(193, 168, 255)");
    await page.keyboard.press("Escape");
    await expect.poll(value).toBe("rgb(187, 187, 187)");
    expect(await target.getAttribute("style")).toBe(original);
    expect(await target.getAttribute("class")).toBe("text-base bg-base");
    expect(await page.evaluate(() => (window as any).radiusQA)).toEqual({ actions: 0, writes: [] });
    expect(errors).toEqual([]);
    await page.evaluate(() => (window as any).komo.destroy());
    expect(await page.locator("main").getAttribute("style")).toBeNull();
    await page.close();
  });

  it("follows live modern pill and elliptical radius previews without a bounding-box change", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    await page.goto(`${origin}/?mode=${mode}&case=radius`);
    await page.waitForFunction(() => !!(window as any).komo);
    await page.keyboard.press("d");
    const target = page.locator("#target");
    await page.locator('.design-inspector[aria-hidden="false"]').waitFor();
    const pick = await target.boundingBox();
    await page.mouse.click(pick!.x + pick!.width * 0.75, pick!.y + pick!.height / 2);
    const field = page.locator('[data-field-property="border-radius"]');
    await field.locator("select[data-picker]").waitFor();
    const original = await target.boundingBox();
    const shape = async (id = "target", marker = ".design-outline:not(.design-outline--prospective)") => page.evaluate(({ id, marker }) => {
      const element = document.getElementById(id)!;
      const root = [...document.body.children].find(node => node.shadowRoot)!.shadowRoot!;
      const outline = root.querySelector<HTMLElement>(marker)!;
      const radii = (node: Element) => {
        const css = getComputedStyle(node), rect = node.getBoundingClientRect();
        const width = parseFloat(css.width), height = parseFloat(css.height);
        const length = (value: string, size: number) => [...value.replace(/([+-])\s+/g, "$1").matchAll(/([+-]?[\d.]+(?:e[+-]?\d+)?)(px|%)/gi)]
          .reduce((sum, match) => sum + Number(match[1]) * (match[2] === "%" ? size / 100 : 1), 0);
        const corners = [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomRightRadius, css.borderBottomLeftRadius].map(value => {
          const [x, y = x] = value.match(/calc\([^)]*\)|\S+/g)!;
          return [length(x, width), length(y, height)];
        });
        const factor = Math.min(1, width / (corners[0][0] + corners[1][0]), width / (corners[2][0] + corners[3][0]), height / (corners[0][1] + corners[3][1]), height / (corners[1][1] + corners[2][1]));
        return corners.flatMap(([x, y]) => [x * factor * rect.width / width, y * factor * rect.height / height]);
      };
      return { target: radii(element), outline: radii(outline), hidden: outline.hidden || getComputedStyle(outline).opacity === "0" };
    }, { id, marker });
    const aligned = async (id?: string, marker?: string) => {
      await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'));
      await expect.poll(async () => {
        const result = await shape(id, marker);
        return result.hidden ? Infinity : Math.max(...result.target.map((radius, index) => Math.abs(radius - result.outline[index])));
      }).toBeLessThan(0.1);
    };
    const open = () => field.locator("select[data-picker]").click();
    const full = page.locator('.komo-tokens [role="option"]').filter({ hasText: "Full" });
    await aligned();
    await open();
    await full.hover();
    expect(await target.evaluate(node => parseFloat(getComputedStyle(node).borderTopLeftRadius))).toBeGreaterThan(1e4);
    await aligned();
    await page.keyboard.press("ArrowDown");
    await aligned();
    expect(await target.boundingBox()).toEqual(original);
    await page.keyboard.press("Escape");
    await aligned();
    expect(await target.getAttribute("class")).toBe("surface radius-small");
    await open();
    await full.click();
    await aligned();
    await page.getByRole("button", { name: "Before", exact: true }).click();
    await aligned();
    await page.getByRole("button", { name: "After", exact: true }).click();
    await aligned();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await aligned();
    await open();
    await page.locator('.komo-tokens [role="option"]').filter({ hasText: "Elliptical" }).click();
    await aligned();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await aligned();
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.id = "radius-override";
      style.textContent = "#target{border-radius:40px}";
      document.head.append(style);
    });
    expect(await target.evaluate(node => getComputedStyle(node).borderRadius)).toBe("40px");
    await aligned();
    await page.evaluate(() => { document.querySelector("#radius-override")!.textContent = "#target{border-radius:20px}"; });
    await aligned();
    await page.evaluate(() => { document.querySelector("#radius-override")!.remove(); });
    expect(await target.evaluate(node => getComputedStyle(node).borderRadius)).toBe("8px");
    await aligned();
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const link = document.createElement("link");
      link.id = "radius-link";
      link.rel = "stylesheet";
      link.href = "/radius.css";
      link.onload = () => resolve();
      link.onerror = () => reject(new Error("fixture stylesheet did not load"));
      document.head.append(link);
    }));
    expect(await target.evaluate(node => getComputedStyle(node).borderRadius)).toBe("24px");
    await aligned();
    await page.evaluate(() => { document.querySelector("#radius-link")!.remove(); });
    await aligned();
    const other = page.locator("#other");
    await other.hover();
    await other.evaluate(node => { node.className = "surface radius-full"; });
    await aligned("other", ".design-outline--prospective");
    await target.evaluate(node => { node.className = "surface radius-ellipse"; });
    await aligned();
    expect(await target.boundingBox()).toEqual(original);
    await target.evaluate(node => {
      const style = (node as HTMLElement).style;
      style.transition = "border-radius 300ms linear";
      style.borderRadius = "40px 12px 24px 0px / 20px 30px 4px 0px";
    });
    await page.waitForTimeout(150);
    const during = await shape();
    expect(Math.max(...during.target.map((radius, index) => Math.abs(radius - during.outline[index])))).toBeLessThan(3);
    await page.waitForTimeout(200);
    await aligned();
    await target.evaluate(node => { (node as HTMLElement).style.cssText = ""; });
    await page.keyboard.press("v");
    await page.keyboard.press("c");
    const box = await target.boundingBox();
    await page.mouse.move(box!.x + box!.width * 0.75, box!.y + box!.height / 2);
    await aligned("target", ".component-hover");
    await target.evaluate(node => { node.className = "surface radius-full"; });
    await aligned("target", ".component-hover");
    await page.keyboard.press("Escape");
    await page.evaluate(() => (window as any).komo.open());
    await page.locator(".thread-card").filter({ hasText: "Synthetic radius conversation" }).click();
    await page.locator(".thread-title").filter({ hasText: "Synthetic radius conversation" }).waitFor();
    await page.locator(".thread-title").hover();
    await target.evaluate(node => { node.className = "surface radius-ellipse"; });
    await aligned("target", ".component-hover");
    expect(await page.evaluate(() => (window as any).radiusQA)).toEqual({ actions: 0, writes: [] });
    await page.evaluate(() => (window as any).komo.destroy());
    await page.close();
  });

  it.each(["color", "background-color"])("applies %s custom/token previews with exact cancellation and chronological Undo", async property => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?mode=${mode}`);
    await page.waitForFunction(() => !!(window as any).komo);
    const original = await page.locator("#target").getAttribute("style");
    await page.keyboard.press("d");
    await page.locator("#target").click();
    const field = page.locator(`[data-field-property="${property}"]`);
    const input = field.locator(`input[data-property="${property}"]`);
    const value = () => page.locator("#target").evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);
    const raw = async (text: string) => {
      if (!await input.isVisible()) await field.getByRole("button", { name: `Edit ${property} value`, exact: true }).click();
      await input.fill(text);
      await input.press("Enter");
    };
    const open = async () => { await field.locator("select[data-picker]").click(); await page.locator(".komo-tokens").waitFor(); };
    const primary = page.locator('.komo-tokens [role="option"]').filter({ hasText: "Primary" });
    await field.locator("select[data-picker]").waitFor();
    await raw("#ef3340");
    expect(await value()).toBe("rgb(239, 51, 64)");
    expect(await field.getAttribute("data-token-mode")).toBe("custom");
    await open();
    await primary.hover();
    expect(await value()).toBe("rgb(105, 65, 198)");
    expect(await field.locator('input[type="color"]').inputValue()).toBe("#6941c6");
    await page.keyboard.press("Escape");
    expect(await value()).toBe("rgb(239, 51, 64)");
    expect(await field.getAttribute("data-token-mode")).toBe("custom");
    await open();
    await primary.click();
    expect(await value()).toBe("rgb(105, 65, 198)");
    expect(await field.getAttribute("data-token-mode")).toBe("token");
    expect(await page.locator("#target").evaluate((node, name) => (node as HTMLElement).style.getPropertyValue(name), property)).toBe("");
    await raw("#2468ff");
    expect(await value()).toBe("rgb(36, 104, 255)");
    expect(await field.getAttribute("data-token-mode")).toBe("custom");
    await page.getByRole("button", { name: "Before", exact: true }).click();
    expect(await value()).toBe("rgb(87, 84, 86)");
    await page.getByRole("button", { name: "After", exact: true }).click();
    expect(await value()).toBe("rgb(36, 104, 255)");
    await page.keyboard.press("v");
    expect(await value()).toBe("rgb(87, 84, 86)");
    await page.keyboard.press("d");
    expect(await value()).toBe("rgb(36, 104, 255)");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await value()).toBe("rgb(105, 65, 198)");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await value()).toBe("rgb(239, 51, 64)");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await value()).toBe("rgb(87, 84, 86)");
    expect(await page.locator("#target").getAttribute("style")).toBe(original);
    expect(await page.locator("#target").getAttribute("class")).toBe("text-base bg-base");
    await raw("#ef3340");
    await input.fill("#2468ff");
    await input.press("Escape");
    expect(await value()).toBe("rgb(239, 51, 64)");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    expect(await page.locator("#target").getAttribute("style")).toBe(original);
    const font = page.locator('input[data-property="font-family"]');
    for (const partial of ["", '"']) {
      await font.fill(partial);
      expect(await page.locator("#target").getAttribute("style")).toBe(original);
    }
    await font.press("Escape");
    expect(await page.locator('.design-inspector__actions [aria-label="Undo"]').isDisabled()).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });
});
