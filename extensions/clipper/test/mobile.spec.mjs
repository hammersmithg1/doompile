import {test,expect} from '@playwright/test';
const select=page=>page.evaluate(()=>{const node=document.querySelector('#quote');node.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true}));const range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);node.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,composed:true}));document.dispatchEvent(new Event('selectionchange'));});
const action=(page,label)=>page.evaluate(label=>Array.from(testRoot.querySelectorAll(`[aria-label="${label}"]`)).find(node=>node.getClientRects().length).click(),label);
const autoOpen=async page=>{await select(page);await expect(page.locator('[data-doompile-clipper]')).toHaveCount(1);};
const tapComment=async page=>{const box=await page.evaluate(()=>{const r=testRoot.querySelector('.dp-comment').getBoundingClientRect();return {x:r.x+20,y:r.y+20};});await page.touchscreen.tap(box.x,box.y);};
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const root=attach.call(this,options);if(this.hasAttribute('data-doompile-receipt'))window.receiptShadow=root;return root;};});
 await page.goto('/mobile');
});
test('selection immediately shows an annotation without stealing focus or dismissing the native selection',async({page})=>{
 expect(await page.evaluate(()=>typeof window.DoompileComposer)).toBe('undefined');await autoOpen(page);
 await expect(page.locator('[data-doompile-selection-action]')).toHaveCount(0);
 expect(await page.evaluate(()=>testRoot.getRootNode().activeElement)).toBe(null);
 expect(await page.evaluate(()=>getSelection().toString())).toBe(await page.locator('#quote').textContent());
 const placement=await page.evaluate(()=>{const r=testRoot.getBoundingClientRect(),q=document.querySelector('#quote').getBoundingClientRect();return {side:testRoot.dataset.menuSide,top:r.top,quoteBottom:q.bottom};});
 expect(placement.side).toBe('both');expect(placement.top).toBeGreaterThan(placement.quoteBottom);
 await page.screenshot({path:'docs/review/clipper-0.11-mobile-selection.png'});
 await tapComment(page);await page.keyboard.insertText('Мысль с iPhone');await action(page,'Сохранить в Doompile');
 await expect.poll(()=>page.evaluate(()=>testUploads.length)).toBe(1);expect(await page.evaluate(()=>testUploads[0].source.quote)).toBe(await page.locator('#quote').textContent());
 await expect(page.locator('[data-doompile-receipt]')).toHaveCount(1);await expect.poll(()=>page.evaluate(()=>receiptShadow.querySelector('a').hidden)).toBe(false);
 await expect(page.locator('[data-doompile-receipt]')).toHaveCount(0,{timeout:4000});
});
test('full screen editor follows the keyboard viewport while only its document scrolls',async({page})=>{
 await autoOpen(page);await tapComment(page);await page.keyboard.insertText(Array.from({length:45},(_,i)=>'Строка '+i).join('\n'));
 await action(page,'Развернуть редактор');await expect.poll(()=>page.evaluate(()=>!!testRoot.querySelector('.tiptap'))).toBe(true);
 await page.evaluate(()=>{const events=new EventTarget();window.testViewport=Object.assign(events,{width:393,height:340,offsetTop:120,offsetLeft:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:window.testViewport});window.dispatchEvent(new Event('resize'));});
 const bounds=()=>page.evaluate(()=>{const r=testRoot.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width};});
 await expect.poll(async()=>Math.round((await bounds()).top)).toBe(120);expect(Math.round((await bounds()).bottom)).toBe(460);expect((await bounds()).width).toBe(393);
 expect(await page.evaluate(()=>document.body.inert)).toBe(true);
 await page.evaluate(()=>{testRoot.querySelector('.dp-scroll').scrollTop=600;window.dispatchEvent(new Event('scroll'));});
 expect(Math.round((await bounds()).top)).toBe(120);expect(Math.round((await bounds()).bottom)).toBe(460);
 await page.screenshot({path:'docs/review/clipper-0.11-mobile-keyboard.png'});
 await action(page,'Свернуть редактор');expect(await page.evaluate(()=>document.body.inert)).toBe(false);
});
test('the source preview, formatting and live editor survive collapse, edits and repeated expansion',async({page})=>{
 await autoOpen(page);await tapComment(page);await page.keyboard.insertText('Мысль');await action(page,'Развернуть редактор');
 await expect.poll(()=>page.evaluate(()=>!!window.testRich)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>!!testRoot.getRootNode().activeElement?.closest('.tiptap'))).toBe(true);
 expect(await page.evaluate(()=>testRoot.querySelectorAll('.source-snippet').length)).toBe(1);
 expect(await page.evaluate(()=>testRoot.querySelector('.source-snippet .source-quote').textContent)).toBe(await page.locator('#quote').textContent());
 await page.evaluate(()=>{window.originalRich=testRich;window.originalEditor=testRoot.querySelector('.tiptap');});
 await page.evaluate(()=>{const editor=testRoot.querySelector('.tiptap').editor;editor.commands.selectAll();editor.commands.toggleBold();editor.commands.setTextSelection(editor.state.doc.content.size-1);window.beforeCursor=editor.state.selection.from;});
 const hasBold=()=>page.evaluate(()=>JSON.stringify(testRich.getJSON()).includes('"type":"bold"'));
 await expect.poll(hasBold).toBe(true);await action(page,'Свернуть редактор');
 expect(await page.evaluate(()=>originalRich===testRich&&originalEditor===testRoot.querySelector('.tiptap'))).toBe(true);
 expect(await page.evaluate(()=>testRoot.querySelector('.tiptap').editor.state.selection.from)).toBe(await page.evaluate(()=>beforeCursor));
 expect(await page.evaluate(()=>getComputedStyle(testRoot.querySelector('.source-snippet')).display)).toBe('none');
 await expect.poll(()=>page.evaluate(()=>!!testRoot.getRootNode().activeElement?.closest('.tiptap'))).toBe(true);
 await page.keyboard.insertText(' и ещё');await action(page,'Развернуть редактор');await expect.poll(hasBold).toBe(true);
 expect(await page.evaluate(()=>testRoot.querySelector('.tiptap').textContent)).toContain('Мысль');
 expect(await page.evaluate(()=>testRoot.querySelector('.tiptap').textContent)).toContain('Мысль и ещё');
 const before=await page.evaluate(()=>testRich.getJSON());await page.keyboard.press('Meta+z');await page.keyboard.press('Meta+Shift+z');expect(await page.evaluate(()=>testRich.getJSON())).toEqual(before);await page.evaluate(()=>{const e=testRoot.querySelector('.tiptap').editor;e.commands.setTextSelection(e.state.doc.content.size-1);e.view.focus();return new Promise(requestAnimationFrame);});await page.screenshot({path:'docs/review/clipper-0.11-mobile-editor.png'});
 await action(page,'Сохранить в Doompile');await expect.poll(()=>page.evaluate(()=>testUploads.length)).toBe(1);
 expect(await page.evaluate(()=>testUploads[0].body)).toEqual(before);expect(await page.evaluate(()=>(function count(n){return(n.type==='sourceSnippet'?1:0)+(n.content||[]).reduce((sum,child)=>sum+count(child),0);})(testUploads[0].body))).toBe(1);
});
test('clickout resets the draft and source selections can reopen the automatic composer',async({page})=>{
 await autoOpen(page);await tapComment(page);await page.keyboard.insertText('Черновик');await page.locator('h1').tap();await expect(page.locator('[data-doompile-clipper]')).toHaveCount(0);
 await autoOpen(page);expect(await page.evaluate(()=>testRoot.querySelector('.dp-comment').value)).toBe('');
});

const tapAction=async(page,label)=>{
 const p=await page.evaluate(label=>{const el=[...testRoot.querySelectorAll(`[aria-label="${label}"]`)].find(node=>node.getClientRects().length);const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},label);
 await page.touchscreen.tap(p.x,p.y);
};
test('a stale editor module is replaced before expansion and real touch collapse preserves the draft',async({page})=>{
 await autoOpen(page);
 await page.evaluate(()=>{window.DoompileRichEditor={mount(){throw Error('Stale module used');}};});
 await tapAction(page,'Развернуть редактор');
 await expect.poll(()=>page.evaluate(()=>!!testRoot.querySelector('.tiptap'))).toBe(true);
 expect(await page.evaluate(()=>DoompileRichEditor.version)).toBe(2);
 expect(await page.evaluate(()=>DoompileRichEditor.build===DoompileEditorBuild.hash)).toBe(true);
 await page.keyboard.insertText('Сохранить формат');
 const before=await page.evaluate(()=>testRich.getJSON());
 await tapAction(page,'Свернуть редактор');
 expect(await page.evaluate(()=>testRoot.querySelector('.dp-expanded').hidden)).toBe(true);
 expect(await page.evaluate(()=>testRich.getJSON())).toEqual(before);
 await tapAction(page,'Развернуть редактор');
 expect(await page.evaluate(()=>testRich.getJSON())).toEqual(before);
 expect(await page.evaluate(()=>testRoot.querySelector('.dp-status').textContent)).toBe('');
});
test('empty canvas focuses the editor and the opaque backdrop covers the keyboard gap',async({page})=>{
 await autoOpen(page);await tapAction(page,'Развернуть редактор');
 await expect.poll(()=>page.evaluate(()=>!!testRoot.querySelector('.tiptap'))).toBe(true);
 await page.evaluate(()=>{testRoot.getRootNode().activeElement?.blur();});
 const canvas=await page.evaluate(()=>{const el=testRoot.querySelector('.tiptap'),r=el.getBoundingClientRect();return{x:r.x+20,y:r.bottom-25,height:r.height};});
 expect(canvas.height).toBeGreaterThan(450);await page.touchscreen.tap(canvas.x,canvas.y);
 expect(await page.evaluate(()=>!!testRoot.getRootNode().activeElement?.closest('.tiptap'))).toBe(true);
 await page.keyboard.insertText('В пустом месте');
 expect(await page.evaluate(()=>testRich.getText())).toContain('В пустом месте');
 await page.evaluate(()=>{const v=Object.assign(new EventTarget(),{width:393,height:330,offsetTop:95,offsetLeft:0});Object.defineProperty(window,'visualViewport',{value:v,configurable:true});window.dispatchEvent(new Event('resize'));});
 const cover=await page.evaluate(()=>{const n=testRoot.getRootNode().querySelector('.mobile-backdrop'),r=n.getBoundingClientRect();return{hidden:n.hidden,bottom:r.bottom,background:getComputedStyle(n).backgroundColor};});
 expect(cover.hidden).toBe(false);expect(cover.bottom).toBeGreaterThanOrEqual(852);expect(cover.background).not.toBe('rgba(0, 0, 0, 0)');
 await tapAction(page,'Свернуть редактор');expect(await page.evaluate(()=>testRoot.getRootNode().querySelector('.mobile-backdrop').hidden)).toBe(true);
});
test('image long press opens an image annotation without intercepting native image actions',async({page})=>{
 await page.evaluate(()=>{const img=document.createElement('img');img.id='capture-image';img.src=location.origin+'/photo.png';img.style.cssText='width:220px;height:120px';document.querySelector('article').prepend(img);});
 // A short tap and a scrolling gesture must not open the composer.
 await page.locator('#capture-image').tap();await page.waitForTimeout(750);await expect(page.locator('[data-doompile-clipper]')).toHaveCount(0);
 await page.evaluate(()=>{const img=document.querySelector('#capture-image');img.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:30,clientY:30}));img.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:30,clientY:100}));img.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}));});
 await page.waitForTimeout(750);await expect(page.locator('[data-doompile-clipper]')).toHaveCount(0);
 const nativeAllowed=await page.evaluate(()=>{const img=document.querySelector('#capture-image');img.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:30,clientY:30}));img.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}));return img.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));});
 expect(nativeAllowed).toBe(true);await expect(page.locator('[data-doompile-clipper]')).toHaveCount(1);
 await tapComment(page);await page.keyboard.insertText('Картинка');await tapAction(page,'Сохранить в Doompile');
 await expect.poll(()=>page.evaluate(()=>testUploads.length)).toBe(1);
 const note=await page.evaluate(()=>testUploads[0]);expect(note.kind).toBe('image');expect(JSON.stringify(note.body)).toContain('/photo.png');expect(note.source.quote).toBeUndefined();
});
test('an image hold survives lifting the finger while its editor is preparing',async({page})=>{
 await page.evaluate(()=>{const img=document.createElement('img');img.src=location.origin+'/held.png';img.style.cssText='width:150px;height:100px';document.querySelector('article').prepend(img);img.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:30,clientY:30}));});
 await page.waitForTimeout(660);
 await page.evaluate(()=>document.querySelector('article img').dispatchEvent(new PointerEvent('pointerup',{bubbles:true})));
 await expect(page.locator('[data-doompile-clipper]')).toHaveCount(1);
});
test('Safari toolbar popup fits its sheet and hands the whole draft to the fullscreen page editor',async({page})=>{
 await page.goto('/popup-fixture');await expect(page.locator('.dp-comment')).toBeEnabled();
 await expect.poll(()=>page.locator('[aria-label="Развернуть редактор"]').isEnabled()).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
 await page.locator('.dp-comment').tap();await page.keyboard.insertText('Черновик из шторы');
 await page.locator('[aria-label="Важное"]:visible').tap();
 await page.locator('[aria-label="Развернуть редактор"]').tap();
 await expect(page.locator('[data-doompile-clipper]')).toHaveCount(1);
 await expect.poll(()=>page.evaluate(()=>!!testRoot.querySelector('.tiptap'))).toBe(true);
 const r=await page.evaluate(()=>{const r=testRoot.getBoundingClientRect();return{width:r.width,height:r.height};});
 expect(r.width).toBe(393);expect(r.height).toBe(852);
 expect(await page.evaluate(()=>testRich.getText())).toContain('Черновик из шторы');
 expect(await page.evaluate(()=>testRoot.querySelector('.dp-expanded [aria-label="Важное"]').getAttribute('aria-pressed'))).toBe('true');
 await page.screenshot({path:'docs/review/clipper-0.11-mobile-toolbar-expanded.png'});
});
