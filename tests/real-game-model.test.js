import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTournament,summarizePair,coordinate} from '../real-game-model.js';

function fixture(){const indices=[0,15,1,16,2,17,3,18,4],opening=indices.slice(0,3);return {schema:2,batches:[{identity:{openings:[{id:'a',moves:opening}],matchups:[[1000,5000]]},games:[{id:'g1',openingId:'a',shortMs:1000,longMs:5000,longColor:1,winner:1,moves:indices.slice(3).map((index,i)=>({index,color:i%2?1:2,budgetMs:i%2?5000:1000}))}]}]};}
test('replays a measured game and computes opponent-specific win and score rates',()=>{
 const data=validateTournament(fixture());const s=summarizePair(data.games,1000,5000);assert.equal(s.total,1);assert.equal(s.wins,1);assert.equal(s.winRate,1);assert.equal(s.scoreRate,1);assert.equal(data.games[0].plies,9);assert.equal(coordinate(0),'A15');assert.equal(coordinate(224),'O1');
});
test('rejects an incorrect outcome, illegal move, wrong side or wrong budget',()=>{
 for(const change of [g=>g.winner=2,g=>g.moves[0].index=0,g=>g.moves[0].color=1,g=>g.moves[0].budgetMs=5000]){const report=fixture();change(report.batches[0].games[0]);assert.throws(()=>validateTournament(report));}
});
test('unfinished games never enter the win-rate denominator and duplicate records are rejected',()=>{
 const report=fixture();report.batches[0].games[0].moves.pop();report.batches[0].games[0].winner=0;const data=validateTournament(report),s=summarizePair(data.games,1000,5000);assert.equal(s.total,0);assert.equal(s.winRate,null);report.batches[0].games.push(structuredClone(report.batches[0].games[0]));assert.throws(()=>validateTournament(report),/重复/);
});
test('wins and score are kept separate when a match is drawn',()=>{
 const games=[{shortMs:1000,longMs:5000,longColor:1,winner:1},{shortMs:1000,longMs:5000,longColor:2,winner:3},{shortMs:1000,longMs:5000,longColor:2,winner:1},{shortMs:1000,longMs:10000,longColor:1,winner:1}];
 const s=summarizePair(games,1000,5000);assert.equal(s.total,3);assert.equal(s.wins,1);assert.equal(s.draws,1);assert.equal(s.losses,1);assert.equal(s.winRate,1/3);assert.equal(s.scoreRate,.5);assert.deepEqual(s.colors.map(c=>[c.color,c.wins,c.draws,c.losses]),[[1,1,0,0],[2,0,1,1]]);
});
