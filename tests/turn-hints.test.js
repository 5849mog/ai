import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnHints } from '../turn-hints.js';
const setup=(color=1)=>{const board=new Uint8Array(225);board[112]=1;board[97]=2;const h=new TurnHints();h.setPosition({board,color});h.begin(1);return h;};
const event=(color=1,indices=[110,111,113],requestId=1,depth=12)=>({requestId,sideToMove:color,stats:{recommendations:indices.map(index=>({index,depth}))}});
test('empty ordinary boards show three immediate opening references while formal restrictions still win',()=>{
 const h=new TurnHints(),board=new Uint8Array(225);h.setPosition({board,color:1});assert.deepEqual(h.points.map(p=>p.index),[112,111,97]);
 h.begin(1);h.accept(event(1,[112],1,0));assert.equal(h.points.length,3);
 h.setPosition({board,color:1,rule:'rif',stage:'b1',allowedMoves:[112]});assert.deepEqual(h.points.map(p=>p.index),[112]);
});
for(const color of [1,2])test(`turn hints belong to actual color ${color} and expire as soon as the board advances`,()=>{
 const h=setup(color);assert.ok(h.accept(event(color)));assert.equal(h.points.length,3);assert.ok(h.points.every(p=>p.color===color));
 const board=h.position.board.slice();board[120]=color;h.setPosition({board,color:3-color});assert.equal(h.points.length,0);
 assert.equal(h.accept(event(color)),false);h.begin(2);h.accept(event(3-color,[121,122,123],2));assert.ok(h.points.every(p=>p.color===3-color));
});
test('wrong job, wrong color, occupied, duplicate, mixed-depth or forbidden points cannot create hints',()=>{
 const h=setup();for(const e of [event(2),event(1,[110,111,113],0),event(1,[112,111,113]),event(1,[110,110,113]),{...event(),stats:{recommendations:[{index:110,depth:12},{index:111,depth:13}]}}])assert.equal(h.accept(e),false);
 const board=new Uint8Array(225);for(const i of [109,110,111,113,114])board[i]=1;
 h.setPosition({board,color:1,rule:'renju'});h.begin(2);assert.equal(h.accept(event(1,[112],2)),false);
});
test('deeper single-PV search promotes its current best while keeping same-board shortlist alternatives',()=>{
 const h=setup();h.accept(event());assert.ok(h.accept({requestId:1,sideToMove:1,stats:{assessment:{bestIndex:127,depth:20}}}));
 assert.deepEqual(h.points.map(p=>p.index),[127,110,111]);assert.equal(h.accept(event(1,[113,114,115],1,10)),false);
 h.cancel();assert.equal(h.points.length,0);assert.equal(h.accept(event()),false);
});
test('decision, proposal, terminal and new-color stages hide old hints immediately',()=>{
 const h=setup();h.accept(event());h.setPosition({board:h.position.board,color:1,stage:'swap3',enabled:false});assert.equal(h.points.length,0);
 h.begin(2);assert.equal(h.accept(event(1,[110,111,113],2)),false);
});
