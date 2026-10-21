import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(resolve('packages/komo/package.json'));
const {chromium}=require('playwright-core');
const out='/private/tmp/komo-conversation-corrective-visuals';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-blink-features=EyeDropperAPI']});
const results=[];
try {
for(const mode of ['floating','frame']) for(const colorScheme of ['light','dark']) {
 const page=await browser.newPage({viewport:{width:1280,height:800},colorScheme,reducedMotion:'reduce'});page.setDefaultTimeout(5000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4392/?mode='+mode);
 const toggle=page.getByRole('button',{name:'Show 1 reply',exact:true});await toggle.click();
 const input=page.locator('[data-thread="one"] textarea');
 const draft='A long retained draft with @Alex and record 123.\n'.repeat(9);
 await input.fill(draft);await input.evaluate(e=>e.setSelectionRange(7,31,'backward'));await page.waitForTimeout(50);
 await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await toggle.evaluate(e=>e.getRootNode().activeElement===e),true);
 await page.keyboard.press('Enter');assert.equal(await input.inputValue(),draft);assert.equal(await input.evaluate(e=>e.selectionStart),7);assert.equal(await input.evaluate(e=>e.selectionEnd),31);assert.equal(await input.evaluate(e=>e.style.height),'128px');
 await page.keyboard.press('Space');assert.equal(await toggle.getAttribute('aria-expanded'),'false');await page.keyboard.press('Space');
 await page.getByRole('button',{name:'Copy page URL',exact:true}).click();assert.equal(await page.evaluate(()=>qa.copied),'http://127.0.0.1:4392/reports/123/summary');assert.deepEqual(await page.evaluate(()=>qa.navigation),[]);
 const link=page.getByRole('link',{name:/Open page:/});await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('[data-thread="one"] .card-page-url').isVisible(),true);await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Copy page URL',exact:true}).evaluate(e=>e.getRootNode().activeElement===e),true);
 await page.mouse.move(500,100);await input.fill('');await page.screenshot({path:out+'/after-'+mode+'-'+colorScheme+'.png'});
 await input.fill(draft);await page.locator('[data-thread="one"] .thread-card').click();const dialogInput=page.locator('.dialog textarea');assert.equal(await dialogInput.inputValue(),draft);
 await dialogInput.fill(draft+'Edited in thread');await dialogInput.evaluate(e=>e.setSelectionRange(4,17));await page.waitForTimeout(50);
 const back=page.locator('.thread-back');await back.click();
 const same=page.locator('[data-thread="one"] textarea');await page.waitForFunction(()=>[...document.body.children].find(n=>n.shadowRoot)?.shadowRoot.querySelector('[data-thread="one"] textarea')?.value.endsWith('Edited in thread'));assert.equal(await same.inputValue(),draft+'Edited in thread');
 assert.equal(await page.locator('button button,button a,a button').count(),0);assert.deepEqual(await page.evaluate(()=>qa.writes),[]);assert.deepEqual(errors,[]);
 results.push({mode,colorScheme,passed:true});await page.close();
}
{
 const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});await page.goto('http://127.0.0.1:4392/?deferred=1');
 await page.getByRole('button',{name:'Show 1 reply',exact:true}).click();const input=page.locator('[data-thread="one"] textarea');await input.fill('Unsent async label draft');await input.evaluate(e=>{window.qa.input=e;e.setSelectionRange(3,10)});
 await page.evaluate(()=>qa.resolveLabel('Reports › Summary'));
 await page.getByText('Reports › Summary',{exact:true}).waitFor();assert.equal(await input.inputValue(),'Unsent async label draft');assert.equal(await input.evaluate(e=>e===window.qa.input&&e===e.getRootNode().activeElement),true);assert.equal(await input.evaluate(e=>e.selectionStart),3);
 await page.getByRole('button',{name:'Close sidebar',exact:true}).click();await page.keyboard.press('l');await input.waitFor();assert.equal(await input.inputValue(),'Unsent async label draft');
 results.push({asyncLabel:true,closeReopenDraft:true,passed:true});await page.close();
}
for (const mode of ['floating','frame']) {
 const narrow=await browser.newPage({viewport:{width:1000,height:800},reducedMotion:'reduce'});
 await narrow.goto('http://127.0.0.1:4392/?mode='+mode);
 if(mode==='floating') {const box=await narrow.locator('.edge-sidebar-resize-w').boundingBox();await narrow.mouse.move(box.x+box.width/2,box.y+box.height/2);await narrow.mouse.down();await narrow.mouse.move(box.x+box.width/2+80,box.y+box.height/2);await narrow.mouse.up();}
 await narrow.getByRole('button',{name:'Show 2 replies',exact:true}).click();
 const overflow=await narrow.locator('.thread-item').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth+1));assert.equal(overflow,false);
 await narrow.mouse.move(100,100);await narrow.screenshot({path:out+'/after-narrow-'+mode+'.png'});results.push({mode,narrow:true,passed:true});await narrow.close();
}
const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});await page.goto('http://127.0.0.1:4391');await page.getByRole('button',{name:'Show 1 reply',exact:true}).click();await page.mouse.move(500,100);await page.screenshot({path:out+'/before.png'});await page.close();
} finally {await browser.close();await writeFile(out+'/results.json',JSON.stringify(results,null,2));}
console.log(JSON.stringify(results));
