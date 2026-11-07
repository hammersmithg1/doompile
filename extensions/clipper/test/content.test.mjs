import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=await readFile(new URL('../src/content.js',import.meta.url),'utf8');
function inspect(quote,hostname='example.com',width=80){
 let handler;
 const browser={runtime:{id:'x',onMessage:{addListener:fn=>handler=fn}}};
 const document={title:'Article',querySelector:()=>({currentTime:22,duration:100,getBoundingClientRect:()=>({width,height:200,top:10})})};
 const sandbox={browser,document,window:{getSelection:()=>({toString:()=>quote,rangeCount:0})},location:{href:'https://'+hostname,hostname},innerHeight:800,DoompileCore:{timestampFromURL:()=>null}};
 vm.runInNewContext(source,sandbox);let result;handler({type:'doompile:inspect'},{id:'x'},value=>result=value);return result;
}
test('text selection stays an article even when the page contains video',()=>{
 const result=inspect('Exact selected words','youtube.com',600);
 assert.equal(result.quote,'Exact selected words');assert.equal(result.video,false);assert.equal(result.timestampSeconds,null);
});
test('small incidental video does not turn an article into a video capture',()=>{assert.equal(inspect('').video,false);});
test('primary video retains a real zero-independent playback timestamp',()=>{const result=inspect('','youtube.com',600);assert.equal(result.video,true);assert.equal(result.timestampSeconds,22);});

test('content listener is rebound after reload even if the old boolean flag survives',()=>{
 const listeners=new Set();const sandbox={setTimeout,clearTimeout,__doompileContentLoaded:true,browser:{runtime:{id:'x',onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}}}};
 vm.runInNewContext(source,sandbox);assert.equal(listeners.size,1);vm.runInNewContext(source,sandbox);assert.equal(listeners.size,1);
});

test('clickout destroys the composer and listeners, and reopening starts a fresh instance',()=>{
 const docListeners=new Map(),windowListeners=new Map(),instances=[];
 class Element{
  constructor(){this.children=[];this.style={};this.classList={toggle(){}};this.offsetWidth=520;}
  setAttribute(){}addEventListener(){}append(...nodes){this.children.push(...nodes);}attachShadow(){return new Element();}remove(){this.removed=true;}focus(){}
 }
 const document={title:'Article',documentElement:new Element(),activeElement:new Element(),querySelector:()=>null,createElement:()=>new Element(),addEventListener:(name,fn)=>docListeners.set(name,fn),removeEventListener:name=>docListeners.delete(name)};
 const browser={runtime:{id:'x',onMessage:{addListener(){},removeListener(){}}}};
 const sandbox={browser,document,HTMLElement:Element,URL,innerWidth:1000,innerHeight:800,location:{href:'https://example.com',hostname:'example.com'},window:{scrollY:0,scrollX:0,getSelection:()=>({toString:()=>'',rangeCount:0}),addEventListener:(name,fn)=>windowListeners.set(name,fn),removeEventListener:name=>windowListeners.delete(name)},requestAnimationFrame:fn=>fn(),DoompileComposer:{mount(){const controller={focus(){},destroy(){controller.destroyed=true;},expanded:false};instances.push(controller);return controller;}}};
 vm.runInNewContext(source,sandbox);sandbox.__doompileClipper.dispatch({type:'doompile:open'});
 const host=document.documentElement.children.at(-1);docListeners.get('pointerdown')({composedPath:()=>[host]});assert.equal(instances[0].destroyed,undefined);
 docListeners.get('pointerdown')({composedPath:()=>[document.documentElement]});assert.equal(instances[0].destroyed,true);assert.equal(host.removed,true);assert.equal(docListeners.size,0);assert.equal(windowListeners.size,0);
 sandbox.__doompileClipper.dispatch({type:'doompile:open'});assert.equal(instances.length,2);assert.equal(instances[1].destroyed,undefined);windowListeners.get('blur')();assert.equal(instances[1].destroyed,true);assert.equal(docListeners.size,0);
});
