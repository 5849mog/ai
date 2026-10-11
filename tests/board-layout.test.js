import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import { fitBoardToSlot } from "../board-layout.js";

function fixture(kind="board-wrap") {
  const dom=new JSDOM(`<div class="${kind}"><div class="board-frame"><svg><circle data-stone="112"></circle></svg></div></div>`);
  const svg=dom.window.document.querySelector("svg"),frame=svg.parentElement,slot=frame.parentElement;
  let callback,observed,writes=0,width="";
  Object.defineProperty(frame.style,"width",{get:()=>width,set:value=>{writes++;width=value;}});
  class Observer { constructor(run){callback=run;} observe(target){observed=target;} }
  const observer=fitBoardToSlot(svg,{Observer});
  return {dom,svg,frame,slot,observer,get observed(){return observed;},get writes(){return writes;},
    resize:(w,h)=>callback([{target:slot,contentRect:{width:w,height:h}}])};
}
test("portrait → landscape → portrait adapts both dimensions without changing stones or the observed slot",()=>{
  const f=fixture(),stone=f.svg.firstChild;
  try {
    assert.equal(f.observed,f.slot);
    for(const [w,h,side]of [[390,680,"390px"],[530,300,"300px"],[390,680,"390px"],[820,1000,"820px"],[1100,610,"610px"],[820,1000,"820px"]]){
      f.resize(w,h);assert.equal(f.frame.style.width,side);assert.equal(f.svg.firstChild,stone);
      assert.equal(f.slot.getAttribute("style"),null);
    }
  }finally{f.dom.window.close();}
});
test("duplicate resize notifications and subpixel noise at an integer boundary converge without rewrites",()=>{
  const f=fixture();
  try{
    f.resize(400.01,700);
    for(let n=0;n<1000;n++)f.resize(n%2?400.01:399.99,700);
    assert.equal(f.writes,1);assert.equal(f.frame.style.width,"400px");
    f.resize(399,700);assert.equal(f.frame.style.width,"399px");
    f.resize(399.8,700);assert.equal(f.writes,2);
    f.resize(402,700);assert.equal(f.frame.style.width,"402px");
  }finally{f.dom.window.close();}
});
test("hidden workspaces and dialogs retain their usable size then adapt when shown",()=>{
  const f=fixture("setup-board-wrap");
  try{
    f.resize(500,420);assert.equal(f.frame.style.width,"420px");
    for(const [w,h]of [[0,0],[500,0],[NaN,500],[Infinity,Infinity]])f.resize(w,h);
    assert.equal(f.writes,1);
    f.resize(380,600);assert.equal(f.frame.style.width,"380px");
  }finally{f.dom.window.close();}
});
test("record and import previews retain their own independent sizing",()=>{
  const f=fixture("record-preview-frame");
  try{assert.equal(f.observer,null);assert.equal(f.observed,undefined);assert.equal(f.writes,0);}finally{f.dom.window.close();}
});
test("a changing long dimension does not rewrite an unchanged square",()=>{
  const f=fixture();
  try{f.resize(300,900);f.resize(1000,300);f.resize(301,300);assert.equal(f.writes,1);}finally{f.dom.window.close();}
});
test("the shipping CSS keeps the sized frame outside the slot's intrinsic layout and removes height feedback",async()=>{
  const sources=await Promise.all(["styles.css","game-modes.css","opening.css","enhancements.css"].map(p=>readFile(new URL("../"+p,import.meta.url),"utf8")));
  const dom=new JSDOM(`<style>${sources.join("\n")}</style><div class="board-wrap"><div class="board-frame"></div></div><div class="setup-board-wrap"><div class="board-frame"></div></div>`);
  try{
    for(const frame of dom.window.document.querySelectorAll(".board-frame")){
      assert.equal(dom.window.getComputedStyle(frame).position,"absolute");
      assert.equal(dom.window.getComputedStyle(frame.parentElement).position,"relative");
    }
    assert.doesNotMatch(sources.join("\n"),/100cq[wh]|--(?:simple-board|opening-flow|quick-tools)-space/);
    for(const p of ["opening-app.js","game-enhancements.js"])
      assert.doesNotMatch(await readFile(new URL("../"+p,import.meta.url),"utf8"),/new ResizeObserver|getBoundingClientRect\(\)\.height/);
  }finally{dom.window.close();}
});
