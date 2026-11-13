// Assemble the measured batches, verify all hashes and replay every move.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateTournament,summarizePair} from '../real-game-model.js';
const inputs=process.argv.slice(2);assert.ok(inputs.length,'Pass the measured batch JSON files');
const batches=[];
for(const path of inputs){
 const batch=JSON.parse(await readFile(path,'utf8'));
 for(const [file,hash] of Object.entries(batch.identity.sources))assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),hash,`source mismatch: ${file}`);
 assert.equal(batch.complete,true,`${path}: batch is incomplete`);
 const expected=batch.identity.matchups.length*batch.identity.openings.length*2;assert.equal(batch.games.length,expected);
 for(const [a,b] of batch.identity.matchups)for(const opening of batch.identity.openings)for(const color of [1,2])assert.equal(batch.games.filter(g=>g.shortMs===a&&g.longMs===b&&g.openingId===opening.id&&g.longColor===color&&g.winner).length,1,`missing paired game ${opening.id} ${color}`);
 batches.push(batch);
}
const out={schema:2,createdAt:new Date().toISOString(),batches};const checked=validateTournament(out);
await writeFile('reports/real-games-latest.json',JSON.stringify(out,null,2)+'\n');
for(const batch of batches)for(const [a,b] of batch.identity.matchups){const s=summarizePair(checked.games,a,b);console.log(`${a} vs ${b}: ${s.wins}W ${s.draws}D ${s.losses}L in ${s.total} games`);}
