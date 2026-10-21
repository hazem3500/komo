// Native public-initKomo regressions; uses only a synthetic loopback fixture.
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
      const query=new URLSearchParams(location.search),radius=query.get('case')==='radius',theme=query.get('case')==='theme',semantic=query.get('case')==='semantic',baseline=query.get('baseline'),named=baseline?.startsWith('named');
      const listeners=new Set();
      const axis=semantic?{id:'mode',options:[{id:'light'},{id:'dark'}],current:()=>document.documentElement.getAttribute('data-review-mode'),apply(id){document.documentElement.setAttribute('data-review-mode',id);if(baseline==='concrete'||baseline==='named')document.querySelector('#target').style.setProperty('color',id==='light'?'#555555':named?'red':'#cccccc','important');listeners.forEach(listener=>listener())},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)}}:classTheme({id:'mode',options:[{id:'light',attribute:{'data-review-mode':'light'}},{id:'dark',attribute:{'data-review-mode':'dark'}}]});
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
      const adapter=semantic?{id:'semantic-baseline',list:state=>[{path:'tone.base',type:'color',properties:['color'],value:state?.mode==='light'?'#555555':named?'red':'#cccccc',label:'Base'},{path:'tone.accent',type:'color',properties:['color'],value:state?.mode==='light'?'#222222':'#eeeeee',label:'Accent'}],resolve:()=>({color:baseline?.endsWith('custom')?{offToken:named?'red':'#cccccc'}:{path:'tone.base'}})}:query.get('adapter')==='inline'?{id:'inline-values',list:state=>tokens.list(state),resolve:element=>tokens.resolve(element)}:tokens;
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
      window.komo=initKomo({endpoint:location.origin,project:'ownership',repo:'example/review',branch:'fixture',pageRoot:mode==='floating'?undefined:document.querySelector('main'),sidebar:mode==='floating'?'edge':'background',...(mode==='scaled'?{frame:{scale:true}}:{}),restoreOpen:false,...(query.has('restore')?{shortcuts:{restore:query.get('restore')}}:{}),design:{tokens:adapter,...(theme||semantic?{themes:[axis]}:{})}});
    `, resolveDir: process.cwd(), loader: "ts" },
    outdir: directory, entryNames: "entry", bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022",
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost"), path = url.pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      if (url.searchParams.get("case") === "semantic") {
        const baseline = url.searchParams.get("baseline");
        const color = baseline === "classes" ? "" : `color:${baseline === "variable" ? "var(--semantic-base)" : baseline === "currentcolor" ? "currentcolor" : baseline?.startsWith("named") ? "red" : "#cccccc"} !important;`;
        response.end(`<style>body{margin:0;color:var(--semantic-base)}main{min-height:100vh;padding:70px;box-sizing:border-box}[data-review-mode=dark]{--semantic-base:#cccccc}[data-review-mode=light]{--semantic-base:#555555}.semantic-base{color:var(--semantic-base)}</style><main><p id="target" class="${baseline === "classes" ? "semantic-base" : ""}" style="${color}padding:12px !important">Example text</p></main><script type="module" src="/entry.js"></script>`);
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
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});


describe.skipIf(!chrome)("public UI corrective regressions", () => {
  it("help Escape closes only help in default reflow", async () => {
    const page = await browser.newPage({ reducedMotion: "reduce" });
      page.setDefaultTimeout(4000);
    page.setDefaultTimeout(4000);
    try {
      await page.goto(origin + '/?mode=reflow&restore=Shift%2BJ');
      await page.waitForFunction(() => !!(window as any).komo);
      await page.locator('[data-menu-item="more"]').evaluate((el:HTMLElement)=>{el.focus();el.click()});
      await page.locator('[data-menu-item="shortcuts"]').evaluate((el:HTMLElement)=>{el.focus();el.click()});
      await expect.poll(() => page.locator('dialog.komo-shortcuts[open]').count()).toBe(1);
      const restore = page.locator('dialog.komo-shortcuts .komo-shortcuts__row').filter({ hasText: 'Restore feedback' });
      expect(await restore.getByRole('img', { name: 'Shift + J', exact: true }).count()).toBe(1);
      expect(await restore.locator('kbd').last().textContent()).toBe('J');
      await page.keyboard.press('Escape');
      expect(await page.locator('dialog.komo-shortcuts[open]').count()).toBe(0);
      expect(await page.locator('[data-menu-item="more"]').evaluate(el=>el.getRootNode().activeElement===el)).toBe(true);
      const dismiss = page.locator('.morphing-menu__shortcut[data-menu-item="dismiss"]');
      expect(await dismiss.getAttribute('aria-keyshortcuts')).toBeNull();
      await dismiss.click();
      expect(await page.locator('.toolbar').evaluate(el => (el as HTMLElement).style.display)).toBe('none');
      await page.keyboard.press('Shift+J');
      expect(await page.locator('.toolbar').evaluate(el => (el as HTMLElement).style.display)).not.toBe('none');
      expect(await page.evaluate(() => ({ actions: (window as any).radiusQA.actions, writes: (window as any).radiusQA.writes }))).toEqual({ actions: 0, writes: [] });
    } finally { await page.close(); }
  });
  it("Custom refresh follows unedited semantic theme value", async () => {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    try {
      await page.goto(origin + '/?mode=reflow&case=semantic&baseline=classes');
      await page.waitForFunction(() => !!(window as any).komo);
      await page.keyboard.press('d'); await page.locator('#target').click();
      await page.locator('[data-field-property="color"] select[data-picker]').click();
      const value=page.getByRole('textbox',{name:'Hex',exact:true});
      await expect.poll(()=>value.inputValue()).toBe('CCCCCC');
      await page.evaluate(()=>(window as any).radiusQA.theme('light'));
      await expect.poll(()=>page.locator('#target').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(85, 85, 85)');
      await expect.poll(()=>value.inputValue()).toBe('555555');
    } finally { await page.close(); }
  });
  it("Custom stays untouched through rapid theme switches", async () => {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    try {
      await page.goto(origin + '/?mode=reflow&case=semantic&baseline=classes');
      await page.waitForFunction(() => !!(window as any).komo);
      const target = page.locator('#target');
      const original = await target.evaluate(el => [el.className, el.getAttribute('style')]);
      await page.keyboard.press('d'); await target.click();
      await page.locator('[data-field-property="color"] select[data-picker]').click();
      const value = page.getByRole('textbox', { name: 'Hex', exact: true });
      await expect.poll(() => value.inputValue(), { timeout: 4000 }).toBe('CCCCCC');
      // Each switch lands while the previous refresh may still be settling.
      await page.evaluate(async () => {
        for (let step = 0; step < 24; step++) {
          (window as any).radiusQA.theme(step % 2 ? 'light' : 'dark');
          await new Promise(resolve => step % 3 ? setTimeout(resolve, step % 4) : requestAnimationFrame(resolve));
        }
      });
      await expect.poll(() => value.inputValue(), { timeout: 4000 }).toBe('555555');
      expect(await target.evaluate(el => getComputedStyle(el).color)).toBe('rgb(85, 85, 85)');
      expect(await target.evaluate(el => [el.className, el.getAttribute('style')])).toEqual(original);
      await value.press('Escape');
      expect(await target.evaluate(el => [el.className, el.getAttribute('style')])).toEqual(original);
    } finally { await page.close(); }
  });
  it("public Custom alpha commit and Undo restore exact binding", async () => {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    try {
      await page.goto(origin + '/?mode=reflow');
      await page.waitForFunction(() => !!(window as any).komo);
      const target=page.locator('#target');
      const before=await target.evaluate(el=>[el.className,el.getAttribute('style')]);
      await page.keyboard.press('d'); await target.click();
      await page.locator('[data-field-property="color"] select[data-picker]').click();
      await page.getByRole('textbox',{name:'Hex',exact:true}).fill('336699');
      const opacity=page.getByRole('textbox',{name:'Opacity',exact:true});
      await opacity.fill('50'); await opacity.press('Enter');
      expect(await target.evaluate(el=>getComputedStyle(el).color)).toBe('rgba(51, 102, 153, 0.5)');
      // The first Undo press closes the popup, which keeps the visit as one entry, then undoes it.
      await page.getByRole('button',{name:'Undo',exact:true}).click();
      expect(await page.locator('.komo-tokens').count()).toBe(0);
      expect(await target.evaluate(el=>[el.className,el.getAttribute('style')])).toEqual(before);
      expect(await page.locator('button[aria-label="Undo"]').isDisabled()).toBe(true);
    } finally { await page.close(); }
  });
  it("public pending Custom survives theme and Escape cancels exactly", async () => {
    const page=await browser.newPage({reducedMotion:'reduce'});page.setDefaultTimeout(4000);
    try {
      await page.goto(origin+'/?mode=reflow&case=semantic&baseline=classes');
      await page.waitForFunction(()=>!!(window as any).komo);
      await page.keyboard.press('d');await page.locator('#target').click();
      const trigger=page.locator('[data-field-property="color"] select[data-picker]');
      await trigger.click();
      await page.getByRole('textbox',{name:'Hex',exact:true}).fill('336699');
      const input=page.getByRole('textbox',{name:'Opacity',exact:true});
      await input.fill('50');
      await page.evaluate(()=>(window as any).radiusQA.theme('light'));
      await expect.poll(()=>page.locator('#target').evaluate(el=>getComputedStyle(el).color)).toBe('rgba(51, 102, 153, 0.5)');
      expect(await input.inputValue()).toBe('50');
      await input.press('Escape');
      expect(await page.locator('.komo-tokens').count()).toBe(0);
      expect(await page.locator('#target').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(85, 85, 85)');
      expect(await trigger.evaluate(el=>el.getRootNode().activeElement===el)).toBe(true);
      expect(await page.locator('button[aria-label="Undo"]').isDisabled()).toBe(true);
    } finally {await page.close()}
  });
  it("public Custom to token to raw rolls back one gesture at a time", async () => {
    const page=await browser.newPage({reducedMotion:'reduce'});page.setDefaultTimeout(4000);
    try {
      await page.goto(origin+'/?mode=reflow');await page.waitForFunction(()=>!!(window as any).komo);
      const target=page.locator('#target');const state=()=>target.evaluate(el=>[el.className,el.getAttribute('style')]);const original=await state();
      await page.keyboard.press('d');await target.click();
      const trigger=page.locator('[data-field-property="color"] select[data-picker]');
      await trigger.click();
      await page.getByRole('textbox',{name:'Hex',exact:true}).fill('336699');
      const opacity=page.getByRole('textbox',{name:'Opacity',exact:true});
      await opacity.fill('50');await opacity.press('Enter');
      await trigger.click();await expect.poll(()=>page.locator('.komo-tokens').count()).toBe(0);const custom=await state();
      await trigger.click();
      await page.locator('.komo-tokens [role=option]').filter({hasText:'Primary'}).first().click();const token=await state();
      expect(await target.evaluate(el=>getComputedStyle(el).color)).toBe('rgb(105, 65, 198)');
      await page.getByRole('button',{name:'Edit color value',exact:true}).click();
      const raw=page.locator('input[data-property="color"]');await raw.fill('#112233');await raw.press('Enter');
      expect(await target.evaluate(el=>getComputedStyle(el).color)).toBe('rgb(17, 34, 51)');
      await page.locator('button[aria-label="Undo"]').click();expect(await state()).toEqual(token);
      await page.locator('button[aria-label="Undo"]').click();expect(await state()).toEqual(custom);
      await page.locator('button[aria-label="Undo"]').click();expect(await state()).toEqual(original);
      expect(await page.locator('button[aria-label="Undo"]').isDisabled()).toBe(true);
    } finally {await page.close()}
  });

  for (const mode of ["reflow", "scaled"]) {
    it(`help owns Escape above Design and a host dialog (${mode})`, async () => {
      const page = await browser.newPage({ reducedMotion: "reduce" });
      page.setDefaultTimeout(4000);
      try {
        await page.goto(origin + `/?mode=${mode}`);
        await page.waitForFunction(() => !!(window as any).komo);
        await page.keyboard.press('d'); await page.locator('#target').click();
        await page.evaluate(() => {
          const dialog = document.createElement('dialog'); dialog.id = 'host-dialog';
          dialog.textContent = 'Synthetic host dialog'; document.body.append(dialog); dialog.showModal();
        });
        await page.locator('[data-menu-item="more"]').evaluate((el: HTMLElement) => { el.focus(); el.click(); });
        await page.locator('[data-menu-item="shortcuts"]').evaluate((el: HTMLElement) => { el.focus(); el.click(); });
        await page.locator('dialog.komo-shortcuts[open]').waitFor();
        const before = await page.locator('main').getAttribute('style');
        await page.keyboard.press('Escape');
        await expect.poll(() => page.locator('dialog.komo-shortcuts[open]').count()).toBe(0);
        expect(await page.locator('#host-dialog').evaluate((el: HTMLDialogElement) => el.open)).toBe(true);
        expect(await page.locator('[data-field-property="color"]').count()).toBe(1);
        expect(await page.locator('main').getAttribute('style')).toBe(before);
        expect(await page.locator('#host-dialog').evaluate(el => document.activeElement === el || el.contains(document.activeElement))).toBe(true);
      } finally { await page.close(); }
    });

    it(`help Escape preserves an unsent composer (${mode})`, async () => {
      const page = await browser.newPage({ reducedMotion: "reduce" });
      page.setDefaultTimeout(4000);
      try {
        await page.goto(origin + `/?mode=${mode}&case=radius`);
        await page.waitForFunction(() => !!(window as any).komo);
        await page.keyboard.press('c');
        const bounds = await page.locator('#other').boundingBox();
        await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
        const draft = page.getByPlaceholder('Add a comment…');
        await draft.fill('Unsent synthetic draft');
        await page.locator('[data-menu-item="more"]').evaluate((el: HTMLElement) => { el.focus(); el.click(); });
        await page.locator('[data-menu-item="shortcuts"]').evaluate((el: HTMLElement) => { el.focus(); el.click(); });
        await page.locator('dialog.komo-shortcuts[open]').waitFor();
        await page.keyboard.press('Escape');
        await expect.poll(() => page.locator('dialog.komo-shortcuts[open]').count()).toBe(0);
        expect(await draft.inputValue()).toBe('Unsent synthetic draft');
        expect(await page.evaluate(() => (window as any).radiusQA.writes)).toEqual([]);
        expect(await page.locator('[data-menu-item="more"]').evaluate(el => (el.getRootNode() as ShadowRoot).activeElement === el)).toBe(true);
      } finally { await page.close(); }
    });

    for (const kind of ['untouched', 'format', 'invalid', 'dirty', 'offToken']) {
      it(`Custom ${kind} theme refresh preserves its transaction (${mode})`, async () => {
        const page = await browser.newPage({ reducedMotion: "reduce" });
        page.setDefaultTimeout(4000);
        try {
          await page.goto(origin + `/?mode=${mode}&case=semantic&baseline=${kind === 'offToken' ? 'custom' : 'classes'}`);
          await page.waitForFunction(() => !!(window as any).komo);
          const target = page.locator('#target');
          const original = await target.evaluate(el => [el.className, el.getAttribute('style')]);
          await page.keyboard.press('d'); await target.click();
          const trigger = page.locator('[data-field-property="color"] select[data-picker]');
          await trigger.click();
          if (kind === 'format') await page.getByRole('combobox', { name: 'Color format', exact: true }).selectOption('CSS');
          const input = page.getByRole('textbox', { name: kind === 'format' ? 'CSS color' : 'Hex', exact: true });
          await input.waitFor();
          if (kind === 'invalid') await input.fill('12zz');
          if (kind === 'dirty') await input.fill('112233');
          await input.focus();
          await input.evaluate((el: HTMLInputElement) => { el.setSelectionRange(1, 3); (window as any).savedInput = el; (window as any).savedPopup = el.closest('.komo-tokens'); });
          const pending = await input.inputValue();
          for (const theme of ['light', 'dark', 'light']) {
            await page.evaluate(theme => (window as any).radiusQA.theme(theme), theme);
            await expect.poll(() => page.locator('#target').evaluate(el => getComputedStyle(el).color), { timeout: 4000 }).toBe(kind === 'dirty' ? 'rgb(17, 34, 51)' : kind === 'offToken' || theme === 'dark' ? 'rgb(204, 204, 204)' : 'rgb(85, 85, 85)');
          }
          if (kind === 'untouched') await expect.poll(() => input.inputValue()).toBe('555555');
          expect(await input.evaluate((el: HTMLInputElement) => el === (window as any).savedInput && el.closest('.komo-tokens') === (window as any).savedPopup && (el.getRootNode() as ShadowRoot).activeElement === el && el.selectionStart === 1 && el.selectionEnd === 3)).toBe(true);
          if (kind === 'untouched') {
            if (process.env.KOMO_UI_EVIDENCE) await page.screenshot({ path: join(process.env.KOMO_UI_EVIDENCE, `custom-${mode}.png`) });
          }
          else if (kind === 'format') expect(await input.inputValue()).toBe('rgb(85 85 85)');
          else expect(await input.inputValue()).toBe(pending);
          if (kind === 'invalid') {
            expect(await input.getAttribute('aria-invalid')).toBe('true');
            await input.press('Escape');
          } else {
            await input.press('Enter');
            expect(await target.evaluate(el => getComputedStyle(el).color)).toBe(kind === 'dirty' ? 'rgb(17, 34, 51)' : kind === 'offToken' ? 'rgb(204, 204, 204)' : 'rgb(85, 85, 85)');
            const undo = page.locator('button[aria-label="Undo"]');
            if (!(await undo.isDisabled())) await undo.click();
            else await trigger.click();
            await expect.poll(() => page.locator('.komo-tokens').count()).toBe(0);
            expect(await undo.isDisabled()).toBe(true);
          }
          expect(await target.evaluate(el => [el.className, el.getAttribute('style')])).toEqual(original);
          await trigger.click();
          await input.waitFor(); await input.press('Escape');
          expect(await target.evaluate(el => [el.className, el.getAttribute('style')])).toEqual(original);
          expect(await trigger.evaluate(el => (el.getRootNode() as ShadowRoot).activeElement === el)).toBe(true);
        } finally { await page.close(); }
      });
    }
  }

  for (const width of [390, 1280]) {
    it(`inline color controls preview, keep and cancel in the public popup at ${width}px`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
      page.setDefaultTimeout(4000);
      try {
        await page.goto(origin + '/?case=semantic&baseline=classes');
        await page.waitForFunction(() => !!(window as any).komo);
        await page.keyboard.press('d'); await page.locator('#target').click();
        const target = page.locator('#target');
        const original = await target.evaluate(el => [el.className, el.getAttribute('style')]);
        const trigger = page.locator('[data-field-property="color"] select[data-picker]');
        await trigger.click();
        const popup = page.locator('.komo-tokens');
        const area = page.getByRole('slider', { name: 'Saturation and brightness', exact: true });
        const hue = page.getByRole('slider', { name: 'Hue', exact: true });
        await area.waitFor();
        expect(await popup.locator('input[type=color], .react-colorful, .komo-custom').count()).toBe(0);
        await area.click({ position: { x: 60, y: 30 } });
        await hue.focus(); await hue.press('ArrowRight');
        const input = page.getByRole('textbox', { name: 'Hex', exact: true });
        expect(await input.inputValue()).not.toBe('CCCCCC');
        await trigger.click();
        await expect.poll(() => popup.count()).toBe(0);
        const committed = await target.evaluate(el => [el.className, el.getAttribute('style')]);
        expect(committed).not.toEqual(original);
        await trigger.click();
        await hue.waitFor(); await hue.focus();
        const beforeKey = await input.inputValue();
        await hue.press('ArrowRight');
        expect(await input.inputValue()).not.toBe(beforeKey);
        const alpha = page.getByRole('slider', { name: 'Opacity', exact: true });
        await alpha.focus();
        for (let step = 0; step < 5; step++) await alpha.press('PageDown');
        expect(await alpha.getAttribute('aria-valuetext')).toBe('Opacity 50%');
        expect(await target.evaluate(el => getComputedStyle(el).color)).toContain('0.5');
        expect(await page.locator('button[aria-label="Undo"]').isDisabled()).toBe(false);
        if (process.env.KOMO_UI_EVIDENCE) await page.screenshot({ path: join(process.env.KOMO_UI_EVIDENCE, `inline-${width}.png`) });
        await alpha.press('Escape');
        expect(await target.evaluate(el => [el.className, el.getAttribute('style')])).toEqual(committed);
        await page.locator('button[aria-label="Undo"]').click();
        expect(await page.locator('button[aria-label="Undo"]').isDisabled()).toBe(true);
        expect(await target.evaluate(el => [el.className, el.getAttribute('style')])).toEqual(original);
        await trigger.focus();
        expect(await trigger.evaluate(el => (el.getRootNode() as ShadowRoot).activeElement === el)).toBe(true);
      } finally { await page.close(); }
    });
  }

  it.each([390, 1280].flatMap(width => ["reflow", "scaled"].map(mode => ({ width, mode }))))("keeps the compact value row, live formats and the field uncovered at $width px in $mode", async ({ width, mode }) => {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    try {
      await page.goto(origin + `/?mode=${mode}`);
      await page.waitForFunction(() => !!(window as any).komo);
      const target = page.locator("#target");
      const original = await target.evaluate(node => [node.className, node.getAttribute("style")]);
      await page.keyboard.press("d");
      await target.click();
      const trigger = page.locator('[data-field-property="color"] select[data-picker]');
      await trigger.click();
      const popup = page.locator(".komo-tokens");
      const format = page.getByRole("combobox", { name: "Color format", exact: true });
      await format.waitFor();
      const popupNode = await popup.elementHandle();
      const geometry = async () => {
        const bounds = (await popup.boundingBox())!, field = (await page.locator('[data-field-property="color"]').boundingBox())!;
        expect(bounds.y >= field.y + field.height || bounds.y + bounds.height <= field.y).toBe(true);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
        expect(bounds.width).toBeLessThanOrEqual(256);
        expect(await format.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return (node.getRootNode() as ShadowRoot).elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === node;
        })).toBe(true);
      };
      await geometry();
      await format.selectOption("CSS");
      const css = page.getByRole("textbox", { name: "CSS color", exact: true });
      await css.fill("#33669980");
      expect(await target.evaluate(node => getComputedStyle(node).color)).toBe("rgba(51, 102, 153, 0.5)");
      expect(await page.locator('button[aria-label="Undo"]').isDisabled()).toBe(true);
      await format.selectOption("HSL");
      expect(await popup.locator(".komo-color__channels input").evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value))).toEqual(["210", "50", "40", "50"]);
      expect(await popup.evaluate((node, expected) => node === expected, popupNode)).toBe(true);
      await format.selectOption("RGB");
      expect(await popup.locator(".komo-color__channels input").evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value))).toEqual(["51", "102", "153", "50"]);
      expect(await target.evaluate(node => getComputedStyle(node).color)).toBe("rgba(51, 102, 153, 0.5)");
      const red = page.getByRole("textbox", { name: "Red", exact: true });
      await red.fill("abc");
      expect(await red.getAttribute("aria-invalid")).toBe("true");
      await page.keyboard.press("Escape");
      await expect.poll(() => popup.count()).toBe(0);
      expect(await target.evaluate(node => [node.className, node.getAttribute("style")])).toEqual(original);
      expect(await trigger.evaluate(node => (node.getRootNode() as ShadowRoot).activeElement === node)).toBe(true);
      await trigger.click();
      await red.fill("51");
      await page.getByRole("textbox", { name: "Green", exact: true }).fill("102");
      await page.getByRole("textbox", { name: "Blue", exact: true }).fill("153");
      const opacity = page.getByRole("textbox", { name: "Opacity", exact: true });
      await opacity.fill("50");
      await geometry();
      if (process.env.KOMO_UI_EVIDENCE) await page.screenshot({ path: join(process.env.KOMO_UI_EVIDENCE, `formats-${width}-${mode}.png`) });
      await opacity.press("Enter");
      await trigger.click();
      await expect.poll(() => popup.count()).toBe(0);
      expect(await target.evaluate(node => getComputedStyle(node).color)).toBe("rgba(51, 102, 153, 0.5)");
      await page.locator('button[aria-label="Undo"]').click();
      expect(await page.locator('button[aria-label="Undo"]').isDisabled()).toBe(true);
      expect(await target.evaluate(node => [node.className, node.getAttribute("style")])).toEqual(original);
    } finally { await page.close(); }
  });

  it("labels the numeric radius field with its unit inside, without rejecting a full-radius token", async () => {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    try {
      await page.goto(origin + '/?case=radius');
      await page.waitForFunction(() => !!(window as any).komo);
      await page.keyboard.press('d'); await page.locator('#other').click();
      const field = page.locator('[data-field-property="border-radius"]');
      expect(await field.locator('.design-field__label').textContent()).toBe('Corner radius');
      await expect.poll(() => field.locator('.design-field__unit').textContent()).toBe('px');
      await field.locator('select[data-picker]').click();
      await page.locator('.komo-tokens [role=option]').filter({ hasText: 'Full' }).click();
      expect(await page.locator('#other').evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThan(96);
    } finally { await page.close(); }
  });

});
