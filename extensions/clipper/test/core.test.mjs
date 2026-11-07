import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=(await readFile(new URL('../src/contracts.js',import.meta.url),'utf8'))+'\n'+(await readFile(new URL('../src/core.js',import.meta.url),'utf8'));
const sandbox={URL};vm.runInNewContext(source,sandbox);const core=sandbox.DoompileCore;
const now='2026-10-29T18:00:00.000Z';
test('inline images and file cards retain attachment metadata when captured from the shared editor',()=>{
 const id='613e83a9-92e2-4cd7-8477-9b9395b503c0';
 const note=core.makeNote({noteOnly:true,comment:'Photo',document:{type:'doc',content:[{type:'paragraph',content:[{type:'image',attrs:{id,src:'/api/attachments/'+id,alt:'photo.png',mimeType:'image/png',size:123}}]}]}},now,'613e83a9-92e2-4cd7-8477-9b9395b503c1');
 assert.equal(note.attachments.length,1);assert.equal(note.attachments[0].id,id);assert.equal(note.attachments[0].name,'photo.png');assert.equal(note.attachments[0].size,123);
});
test('YouTube time formats preserve the exact moment, including zero',()=>{
  for(const [input,seconds] of [['0:00',0],['2:34',154],['1:02:03',3723],['1h2m3s',3723],['154',154],['154s',154],['1m',60]])assert.equal(core.timecode(input),seconds);
  for(const input of ['2:99','hello','1:-1','-2',':','','999999999999','999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999'])assert.equal(core.timecode(input),null);
  assert.equal(core.timestampFromURL('https://youtu.be/abc?t=1m2s'),62);
  assert.equal(core.timestampFromURL('https://youtube.com/watch?v=x&start=0'),0);
  assert.equal(core.formatTime(3723),'1:02:03');
});
test('credentials can only be sent to explicit HTTPS endpoints or loopback',()=>{
  assert.equal(core.endpoint('https://notes.example.com/'),'https://notes.example.com');
  assert.equal(core.endpoint('http://localhost:3000'),'http://localhost:3000');
  for(const url of ['http://example.com','https://user:secret@example.com','javascript:alert(1)','file:///tmp/notes','https://example.com/?token=secret','https://example.com/#fragment'])assert.throws(()=>core.endpoint(url));
});
test('capture separates annotation from exact quote and adds original source',()=>{
  const note=core.makeNote({url:'https://example.com/article',title:'An article',quote:'  exact text\n',comment:'My annotation',tags:'#ideas,read later,ideas',articleText:'Article snapshot',selector:{prefix:'before',suffix:'after'}},now,'uuid');
  assert.equal(note.source.quote,'  exact text\n');
  assert.equal(note.body.content[0].type,'sourceSnippet');
  assert.equal(note.body.content[1].content[0].text,'My annotation');
  assert.equal(note.source.articleText,undefined);
  assert.equal(note.source.selector.prefix,'before');
  assert.equal(note.tags.join(','),'ideas,read later');
  assert.equal(note.revision,0);
});
test('video zero timestamp is retained in note and deep link',()=>{
  const note=core.makeNote({url:'https://youtube.com/watch?v=abc',title:'Video',timestampSeconds:0,video:true},now,'uuid');
  assert.equal(note.source.timestampSeconds,0);assert.equal(new URL(note.source.url).searchParams.get('t'),'0');assert.equal(note.kind,'video');
});
test('unsafe source URLs are rejected and stored text stays literal',()=>{
  assert.throws(()=>core.makeNote({url:'javascript:alert(1)'},now,'uuid'));
  const note=core.makeNote({url:'https://example.com',quote:'<script>alert(1)</script>'},now,'uuid');
  assert.equal(note.body.content[0].attrs.quote,'<script>alert(1)</script>');
});
test('idempotent response matching does not discard a different server note',()=>{
  const note=core.makeNote({url:'https://example.com',comment:'A'},now,'uuid');
  assert.equal(core.sameCapture(note,{...note,revision:1}),true);
  assert.equal(core.sameCapture(note,{...note,plainText:'Changed on another device'}),false);
  assert.equal(core.retryDelay(100),3600000);
});

test('image captures retain the exact image, page context and annotation',()=>{
 const note=core.makeNote({url:'https://example.com/article',imageUrl:'https://cdn.example.com/photo.png',title:'An image',comment:'My annotation'},now,'image-id');
 assert.equal(note.kind,'image');assert.equal(note.source.url,'https://example.com/article');assert.equal(note.body.content[1].type,'image');assert.equal(note.body.content[1].attrs.src,'https://cdn.example.com/photo.png');assert.match(note.plainText,/My annotation/);
 assert.throws(()=>core.makeNote({url:'https://example.com',imageUrl:'javascript:alert(1)'},now,'x'));
 assert.throws(()=>core.makeNote({url:'https://example.com',imageUrl:'blob:https://example.com/x'},now,'x'));
 const changed=structuredClone(note);changed.body.content[1].attrs.src='https://cdn.example.com/other.png';assert.equal(core.sameCapture(note,changed),false);
});

test('permission patterns omit ports but real API endpoints retain them',()=>{
 for(const [input,expected] of [['http://localhost:3000','http://localhost/*'],['http://127.0.0.1:8080','http://127.0.0.1/*'],['https://notes.example.com:8443/api','https://notes.example.com/*']]){
   assert.equal(core.permissionPattern(input),expected);assert.equal(core.endpoint(input),input);
 }
 assert.equal(core.isLocalEndpoint('https://localhost.evil.example'),false);
 assert.equal(core.isLocalEndpoint('http://127.0.0.1:3000'),true);
});

test('plain popup notes do not invent a page source',()=>{
 const note=core.makeNote({noteOnly:true,comment:'A quick thought'},now,'note');assert.equal(note.kind,'note');assert.equal(note.source,undefined);assert.equal(note.plainText,'A quick thought');
 assert.throws(()=>core.makeNote({noteOnly:true,comment:''},now,'note'));
});

test('rich annotations retain formatting, separate source title, and editor flags',()=>{
 const body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'My annotation',marks:[{type:'bold'}]}]},{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'Follow up'}]}]}]}]};
 const note=core.makeNote({url:'https://example.com',title:'Source title',noteTitle:'My note',quote:'Exact original',comment:'My annotation\nFollow up',annotationBody:body,pinned:true,urgent:true},now,'rich');
 assert.equal(note.title,'My note');assert.equal(note.source.title,'Source title');assert.equal(note.source.quote,'Exact original');assert.equal(note.body.content[2].content[0].marks[0].type,'bold');assert.equal(note.body.content[3].type,'taskList');assert.equal(note.pinned,true);assert.equal(note.urgent,true);
 assert.throws(()=>core.makeNote({url:'https://example.com',annotationBody:{type:'not-a-document'}},now,'bad'));
});

test('a clipped quote has one source block and never a generated page heading',()=>{
 const note=core.makeNote({url:'https://example.com',title:'Page title',quote:'Exact quotation',comment:'My thought'},now,'one');
 assert.equal(note.body.attrs.editorVersion,1);
 assert.equal(note.body.content.filter(n=>n.type==='sourceSnippet').length,1);
 assert.equal(note.body.content.some(n=>n.type==='heading'||n.type==='blockquote'),false);
 assert.equal(note.body.content.map(n=>n.content?.[0]?.text||'').filter(Boolean).join(''),'My thought');
});
test('a full preview document is saved as-is without reconstructing or duplicating its source',()=>{
 const capture={url:'https://example.com',title:'Source',quote:'Exact quote',comment:'Annotation'};
 const doc=core.captureDocument(capture);doc.content[1].content[0].marks=[{type:'bold'}];
 const note=core.makeNote({...capture,document:doc},now,'preview');assert.equal(JSON.stringify(note.body),JSON.stringify(doc));assert.equal(note.body.content.filter(node=>node.type==='sourceSnippet').length,1);
 const withoutSource={...doc,content:doc.content.slice(1)};assert.equal(JSON.stringify(core.makeNote({...capture,document:withoutSource},now,'edited').body),JSON.stringify(withoutSource));
});
