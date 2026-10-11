import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { replaySession } from '../opening-session.js';
import { moveVerdict } from '../renju-rules.js';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
test('native deep/review evidence matches shipped code and preserves legal fixed-position comparisons',async()=>{
  const r=JSON.parse(await readFile(new URL('../reports/deep-review-v36.json',import.meta.url)));
  for(const [path,expected] of Object.entries({...r.sources,...r.assets}))assert.equal(digest(await readFile(new URL('../'+path,import.meta.url))),expected,path);
  assert.equal(r.budgets.length,2);assert.equal(r.reviews.length,2);
  for(const entry of r.budgets){const s=replaySession(entry.record);assert.equal(digest(s.board),entry.boardSha256);assert.equal(s.color,entry.sideToMove);
    assert.deepEqual(entry.searches.map(t=>t.timeMs),[1000,10000,30000]);
    for(const trial of entry.searches){assert.equal(moveVerdict(s.board,trial.result.index,s.color,s.rule).forbidden,'');assert.ok(s.canPoint(trial.result.index));assert.ok(Number.isFinite(trial.result.assessment.winRate));}
  }
  for(const entry of r.reviews){assert.ok(replaySession(entry.record).winner);assert.equal(entry.rows.length,3);assert.ok(entry.rows.every(row=>Number.isFinite(row.loss)));
    const selected=entry.rows.find(row=>row.stage==='choose');assert.ok(replaySession(selected.record).candidates.includes(selected.best));
  }
  const control=r.reviews.find(entry=>entry.name.includes('negative-control')).rows.find(row=>row.stage==='route4');assert.notEqual(control.choice,'ten');assert.ok(control.loss>.2);
});
