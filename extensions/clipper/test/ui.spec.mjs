import {test,expect} from '@playwright/test';
const click=(page,label)=>page.evaluate(label=>Array.from(window.testRoot.querySelectorAll(`[aria-label="${label}"]`)).find(node=>node.getClientRects().length).click(),label);
const value=(page,selector)=>page.evaluate(selector=>window.testRoot.querySelector(selector)?.value,selector);
test.beforeEach(async({page})=>{await page.goto('/');await page.evaluate(()=>openClipper());});
test('compact save completes even if Safari never returns the message callback',async({page})=>{
 await page.evaluate(()=>{window.testMode='closed-port';});
 await page.keyboard.insertText('Мысль о доверии');
 await click(page,'Сохранить в Doompile');
 await expect.poll(()=>page.evaluate(()=>testUploads.length)).toBe(1);
 await expect(page.locator('[data-doompile-clipper]')).toHaveCount(0);
 const note=await page.evaluate(()=>testUploads[0]);
 expect(note.body.attrs.editorVersion).toBe(1);expect(note.body.content.map(node=>node.type)).toEqual(['sourceSnippet','paragraph']);expect(note.body.content[1].content[0].text).toBe('Мысль о доверии');
});
test('expanded editor reuses desktop blocks, tags and compact draft through a lost callback',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.keyboard.insertText('Мысль о доверии');await click(page,'Развернуть редактор');
 await expect.poll(()=>page.evaluate(()=>!!testRoot.querySelector('.dp-rich .tiptap'))).toBe(true);
 await expect.poll(()=>page.evaluate(()=>testRoot.querySelector('.dp-composer').getAttribute('aria-busy'))).toBe('false');
 expect(await page.evaluate(()=>testRoot.querySelector('.dp-format-toolbar'))).toBe(null);
 expect(await page.evaluate(()=>testRoot.querySelector('.dp-title'))).toBe(null);
 await click(page,'Добавить тег');await page.keyboard.insertText('Раб');
 await expect.poll(()=>page.evaluate(()=>testRoot.querySelector('[role="option"]')?.textContent)).toBe('Работа');
 await page.keyboard.press('Enter');await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>testRoot.querySelector('.dp-tag').textContent)).toContain('Работа');
 await click(page,'Свернуть редактор');expect(await value(page,'.dp-comment')).toBe('Мысль о доверии');
 await click(page,'Развернуть редактор');
 await click(page,'Важное');
 await expect.poll(()=>page.evaluate(()=>getComputedStyle(testRoot.querySelector('.dp-expanded')).opacity)).toBe('1');
 await page.screenshot({path:'docs/review/clipper-0.7-expanded.png',animations:'disabled'});
 await click(page,'Сохранить в Doompile');
 await expect.poll(()=>page.evaluate(()=>testUploads.length)).toBe(1);
 expect(await page.evaluate(()=>testUploads[0].tags)).toEqual(['Работа']);expect(await page.evaluate(()=>testUploads[0].urgent)).toBe(true);expect(errors).toEqual([]);
});
test('dead background reports an error, keeps the draft and permits retry without duplicates',async({page})=>{
 await page.evaluate(()=>{window.testMode='dead';});await page.keyboard.insertText('Не потерять');
 await click(page,'Сохранить в Doompile');
 await expect.poll(()=>page.evaluate(()=>testRoot.querySelector('.dp-error')?.textContent),{timeout:18000}).toContain('Расширение не ответило');
 expect(await value(page,'.dp-comment')).toBe('Не потерять');
 expect(await page.evaluate(()=>testRoot.querySelector('.dp-send').disabled)).toBe(false);
 await page.evaluate(()=>{window.testMode='lost-reply';});await click(page,'Сохранить в Doompile');
 await expect.poll(()=>page.evaluate(()=>testUploads.length)).toBe(1);
 const ids=await page.evaluate(()=>testMessages.filter(m=>m.type==='doompile:capture').map(m=>m.captureId));expect(ids[0]).toBe(ids[1]);
});
test('clickout resets draft and editor expansion; source selection stays on page',async({page})=>{
 await page.keyboard.insertText('Черновик');await click(page,'Развернуть редактор');
 await expect.poll(()=>page.evaluate(()=>!!testRoot.querySelector('.tiptap'))).toBe(true);
 await page.locator('h1').click();await expect(page.locator('[data-doompile-clipper]')).toHaveCount(0);
 await page.evaluate(()=>openClipper());expect(await value(page,'.dp-comment')).toBe('');
 expect(await page.evaluate(()=>testRoot.querySelector('.dp-expanded').hidden)).toBe(true);
});
test('saved clip renders one quotation, one small source link and no generated article heading',async({page})=>{
 await page.keyboard.insertText('Мысль о доверии');await click(page,'Сохранить в Doompile');
 await expect.poll(()=>page.evaluate(()=>testUploads.length)).toBe(1);
 await page.addScriptTag({url:'/'+await page.evaluate(()=>DoompileEditorBuild.file)});
 await page.evaluate(()=>{
  const note=testUploads[0],style=document.createElement('link');style.rel='stylesheet';style.href='/composer.css';document.head.append(style);
  const wrapper=document.createElement('main');wrapper.className='dp-composer';wrapper.style.cssText='width:720px;margin:48px auto;background:#fff;border:1px solid #dedbd7;border-radius:16px';
  const root=document.createElement('div');root.className='dp-rich';wrapper.append(root);document.body.replaceChildren(wrapper);DoompileRichEditor.mount(root,note.body,()=>{});
 });
 await expect(page.locator('.source-snippet')).toHaveCount(1);await expect(page.locator('.source-snippet .source-quote')).toHaveCount(1);await expect(page.locator('.source-snippet a')).toHaveCount(1);await expect(page.locator('.tiptap h1')).toHaveCount(0);
 await expect(page.locator('.tiptap')).toContainText('Мысль о доверии');await expect(page.locator('.tiptap')).not.toContainText('Сайт есть, доверия нет');
 expect(await page.locator('.source-snippet a').evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeLessThanOrEqual(12);
 await page.screenshot({path:'docs/review/clipper-0.7-saved-note.png'});
});
test('source link returns to the correct repeated quote and highlights it natively without the extension',async({page,context})=>{
 await page.addScriptTag({url:'/'+await page.evaluate(()=>DoompileEditorBuild.file)});
 await page.evaluate(()=>{
  const root=document.createElement('div');document.body.replaceChildren(root);
  DoompileRichEditor.mount(root,{type:'doc',content:[{type:'sourceSnippet',attrs:{url:location.origin+'/anchor-article#old-section',title:'Статья',quote:'Нужная мысль встречается в статье.',quotePrefix:'Второй раздел.',quoteSuffix:'Второй вывод.'}},{type:'paragraph'}]},()=>{});
 });
 const link=page.locator('.source-snippet a');await expect(link).toHaveAttribute('href',/:~:text=/);
 const waiting=context.waitForEvent('page');await link.click();const article=await waiting;await article.waitForLoadState();
 await expect.poll(()=>article.locator('#target').evaluate(node=>node.getBoundingClientRect().top)).toBeLessThan(900);
 expect(await article.evaluate(()=>scrollY)).toBeGreaterThan(1000);
 expect(await article.evaluate(()=>!!globalThis.DoompileComposer)).toBe(false);
 await article.screenshot({path:'docs/review/clipper-0.8-return-to-quote.png'});
});
test('capture stores the actual selected occurrence, not the first equal text in its parent',async({page})=>{
 const result=await page.evaluate(()=>{
  const paragraph=document.createElement('p');paragraph.textContent='Первый контекст. Нужная мысль. Ещё текст. Второй контекст. Нужная мысль. Финальный контекст.';document.body.append(paragraph);
  const node=paragraph.firstChild,offset=node.textContent.lastIndexOf('Нужная мысль.');const range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+'Нужная мысль.'.length);
  const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  return __doompileClipper.dispatch({type:'doompile:inspect'});
 });
 expect(result.selector.prefix).toContain('Второй контекст.');expect(result.selector.prefix.trim().endsWith('Второй контекст.')).toBe(true);expect(result.selector.suffix.trim()).toBe('Финальный контекст.');
});
test('a multi-paragraph quote survives layout changes and edits between its endpoints',async({page,context})=>{
 await page.addScriptTag({url:'/'+await page.evaluate(()=>DoompileEditorBuild.file)});
 await page.evaluate(()=>{
  const root=document.createElement('div');document.body.replaceChildren(root);
  DoompileRichEditor.mount(root,{type:'doc',content:[{type:'sourceSnippet',attrs:{url:location.origin+'/anchor-multiblock',quote:'Начало выбранного фрагмента.\nПрежний текст середины.\nКонец выбранного фрагмента.',quotePrefix:'Перед цитатой.',quoteSuffix:'После цитаты.'}},{type:'paragraph'}]},()=>{});
 });
 const waiting=context.waitForEvent('page');await page.locator('.source-snippet a').click();const article=await waiting;await article.waitForLoadState();
 await expect.poll(()=>article.evaluate(()=>scrollY)).toBeGreaterThan(1000);
 expect(await article.locator('#target').evaluate(node=>node.getBoundingClientRect().top)).toBeLessThan(900);
});

test('shared formatting and block actions work inside the extension shadow root',async({page})=>{
 await page.keyboard.insertText('Inline comment');await click(page,'Развернуть редактор');
 await expect.poll(()=>page.evaluate(()=>!!testRoot.querySelector('.dp-rich .tiptap'))).toBe(true);
 await expect.poll(()=>page.evaluate(()=>testRoot.querySelector('.dp-composer').getAttribute('aria-busy'))).toBe('false');
 await page.evaluate(()=>{const e=testRoot.querySelector('.tiptap').editor;let selected;e.state.doc.descendants((node,pos)=>{if(node.isTextblock&&node.textContent==='Inline comment')selected={from:pos+1,to:pos+1+node.content.size};});e.commands.setTextSelection(selected);e.view.focus();});
 await expect.poll(()=>page.evaluate(()=>!!testRoot.querySelector('.selection-toolbar:not([hidden])'))).toBe(true);
 async function mouseClick(label){
  const rect=await page.evaluate(label=>{const el=[...testRoot.querySelectorAll('button')].find(el=>(el.getAttribute('aria-label')||el.textContent)===label&&el.getClientRects().length);if(!el)throw Error('Missing control: '+label);const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},label);
  await page.mouse.click(rect.x,rect.y);
 }
 await mouseClick('Жирный');
 expect(JSON.stringify(await page.evaluate(()=>testRich.getJSON()))).toContain('"type":"bold"');
 await mouseClick('Цвет текста и выделения');await mouseClick('Цвет текста: Красный');
 await expect.poll(async()=>JSON.stringify(await page.evaluate(()=>testRich.getJSON()))).toContain('#c44f4f');
 const paragraph=await page.evaluate(()=>{const ps=testRoot.querySelectorAll('.tiptap > p');const r=ps[ps.length-1].getBoundingClientRect();return{x:r.x+25,y:r.y+r.height/2};});
 await page.mouse.click(paragraph.x,paragraph.y,{button:'right'});
 await expect.poll(()=>page.evaluate(()=>!!testRoot.querySelector('.block-context-menu:not([hidden])'))).toBe(true);
 await mouseClick('Дублировать блок');
 expect((await page.evaluate(()=>testRich.getText())).match(/Inline comment/g)).toHaveLength(2);
});
