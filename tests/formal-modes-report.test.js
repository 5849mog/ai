import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { replaySession } from '../opening-session.js';
import { moveVerdict } from '../renju-rules.js';

test('formal-mode native evidence is complete, fingerprinted and replayable without forbidden AI stones', async () => {
  const report=JSON.parse(await readFile(new URL('../reports/formal-modes-v35.json',import.meta.url),'utf8'));
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(report.status,'passed'); assert.equal(report.cases.length,10);
  assert.equal(digest(JSON.stringify(report.cases)),report.casesSha256);
  for(const [path,sha] of Object.entries(report.sources)) assert.equal(digest(await readFile(new URL('../'+path,import.meta.url))),sha,path);
  for(const [path,sha] of Object.entries(report.engineAssets)) assert.equal(digest(await readFile(new URL('../'+path,import.meta.url))),sha,path);
  assert.equal(report.models.length,2);
  assert.equal(report.cases.filter(c=>c.rule==='rif').length,4);
  assert.equal(report.cases.filter(c=>c.rule==='taraguchi10').length,6);
  assert.ok(report.cases.some(c=>c.negativeControl));
  for(const c of report.cases) {
    assert.equal(c.status,'passed'); assert.equal(c.checks.undo,true);
    const s=replaySession(c.record); assert.equal(s.stage,c.final.stage); assert.equal(s.winner,c.final.winner);
    assert.equal(s.moves.length,c.final.moves); assert.equal(s.forbidden,'');
    assert.ok(s.moves.length>=6); assert.ok(c.normalPlies>0);
    assert.equal(c.checks.replay,c.record.events.length);
    const offered=c.record.events.filter(e=>e.type==='offer');
    assert.equal(offered.length,c.rule==='rif'?2:c.prefix?10:0);
    const replay=replaySession({...c.record,events:[]});
    for(const e of c.record.events) {
      if(['stone','select'].includes(e.type)) assert.equal(moveVerdict(replay.board,e.index,replay.color,replay.rule).forbidden,'');
      if(e.automatic) assert.equal(replay.actor,0);
      replay.apply(e);
    }
    for(const search of c.searches) {
      assert.match(search.result.weight,/mix9svqrenju_bs15_(black|white)\.bin\.lz4$/);
      assert.ok(search.timeMs>=1 && search.timeMs<=report.timeMs);
      if(search.phase==='play') {assert.equal(search.multiPV,1); assert.equal(search.balance,false);}
    }
  }
});
