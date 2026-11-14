import test from 'node:test';
import assert from 'node:assert/strict';
import {OpeningSession,replaySession} from '../opening-session.js';
import {forcedOpeningMove} from '../forced-opening.js';
for(const rule of ['rif','taraguchi10'])for(const workflow of ['follow','duel','copilot'])for(const seat of [0,1])test(`${rule} ${workflow} seat ${seat}: only center is forced and owner is preserved`,()=>{
 const s=new OpeningSession({rule,workflow,initialBlackSeat:null});assert.equal(forcedOpeningMove(s),null);s.apply({type:'start',initialBlackSeat:seat});assert.deepEqual(s.allowedMoves(),[112]);const actor=s.actor;s.apply(forcedOpeningMove(s),{automatic:true});assert.equal(s.board[112],1);assert.equal(s.actors.at(-1),actor);assert.equal(s.stage,rule==='rif'?'w2':'swap1');assert.deepEqual(replaySession(s.record()).record(),s.record());assert.equal(forcedOpeningMove(s),null);
});
test('free openings and seeded positions are not auto-filled',()=>{for(const rule of ['freestyle','renju'])assert.equal(forcedOpeningMove(new OpeningSession({rule,initialBlackSeat:0})),null);const board=new Uint8Array(225);assert.equal(forcedOpeningMove(new OpeningSession({rule:'rif',initialBlackSeat:0,seed:{board,sideToMove:1}})),null);});
