import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('match report renders measured results, replays moves and keeps position on refresh',async()=>{
 const html=await readFile(new URL('../report.html',import.meta.url),'utf8');
 const batch=JSON.parse(await readFile(new URL('../reports/real-games-1v5.json',import.meta.url),'utf8'));
 const sample={schema:2,createdAt:'2026-11-13T10:00:00Z',batches:[batch]},dom=new JSDOM(html,{url:'https://example.com/ai/report.html',pretendToBeVisual:true});
 const saved={};for(const name of ['document','window','navigator','fetch','setInterval','clearInterval'])saved[name]=Object.getOwnPropertyDescriptor(globalThis,name);
 Object.defineProperty(globalThis,'document',{configurable:true,value:dom.window.document});Object.defineProperty(globalThis,'window',{configurable:true,value:dom.window});Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
 globalThis.fetch=async()=>({ok:true,json:async()=>sample});globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
 try {
  await import(`../report.js?test=${Date.now()}`);await new Promise(resolve=>setImmediate(resolve));
  const $=s=>document.querySelector(s);assert.equal($('#reportContent').hidden,false);assert.equal($('#heroGames').textContent,'4');assert.equal(document.querySelectorAll('.real-match-card').length,1);assert.match($('.real-match-card').textContent,/50\.0%/);
  const range=$('#replayRange'),end=Number(range.value);$('#replayPrev').click();assert.equal(Number(range.value),end-1);assert.equal($('#replayBoard').querySelectorAll('[data-stone]').length,end-1);
  $('#refreshReport').click();await new Promise(resolve=>setImmediate(resolve));assert.equal(Number(range.value),end-1);
  document.querySelectorAll('.replay-button')[1].click();assert.equal($('#replayBoard').querySelectorAll('[data-stone]').length,Number(range.value));
 } finally {dom.window.close();for(const [name,descriptor] of Object.entries(saved))descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];}
});
