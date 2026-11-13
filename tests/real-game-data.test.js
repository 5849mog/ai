import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateTournament,summarizePair} from '../real-game-model.js';

test('published real-game sample consists of completed, legal color-swapped matches',async()=>{
 const report=validateTournament(JSON.parse(await readFile(new URL('../reports/real-games-latest.json',import.meta.url))));
 const expected=['1000-5000','1000-10000','5000-10000'];
 assert.deepEqual(report.batches.flatMap(b=>b.identity.matchups.map(m=>m.join('-'))).sort(),expected.sort());
 for(const batch of report.batches){
  assert.equal(batch.complete,true);assert.ok(batch.identity.openings.length>=2);
  for(const [a,b] of batch.identity.matchups){const summary=summarizePair(report.games,a,b);assert.equal(summary.total,batch.identity.openings.length*2);
   for(const opening of batch.identity.openings)for(const color of [1,2])assert.equal(summary.games.filter(g=>g.openingId===opening.id&&g.longColor===color).length,1);
  }
 }
});
