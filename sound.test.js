import test from "node:test";
import assert from "node:assert/strict";
import { createSoundFeedback } from "./sound.js";

class FakeAudioContext {
  static instances = 0;
  constructor() { FakeAudioContext.instances += 1; this.state = "running"; this.currentTime = 1; this.sampleRate = 8000; this.destination = {}; this.oscillators = 0; }
  createGain() { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  createBuffer() { return { getChannelData: () => new Float32Array(440) }; }
  createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
  createBiquadFilter() { return { frequency: { value: 0 }, Q: { value: 0 }, connect() {} }; }
  createOscillator() { this.oscillators += 1; return { frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
}

test("sound is opt-in, persists its preference and never creates a context while muted", () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  FakeAudioContext.instances = 0;
  const sound = createSoundFeedback({ storage, AudioContext: FakeAudioContext });
  assert.equal(sound.enabled, false); assert.equal(sound.playStone(), false); assert.equal(FakeAudioContext.instances, 0);
  assert.equal(sound.setEnabled(true), true); assert.equal(FakeAudioContext.instances, 1); assert.equal(sound.playStone(), true);
  assert.equal(values.get("gomoku-sound"), "true");
  assert.equal(createSoundFeedback({ storage, AudioContext: FakeAudioContext }).enabled, true);
  sound.setEnabled(false); assert.equal(values.get("gomoku-sound"), "false"); assert.equal(sound.playStone(), false);
});

test("unsupported or blocked audio and storage never prevent play", () => {
  const storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const sound = createSoundFeedback({ storage, AudioContext: null });
  assert.doesNotThrow(() => sound.setEnabled(true)); assert.equal(sound.playStone(), false);
});

test('recorded samples load only when enabled, avoid immediate repeats, and fall back when unavailable', async () => {
  let requests=0; const played=[];
  class SampleContext extends FakeAudioContext {
    decodeAudioData(bytes) { return Promise.resolve({id:new Uint8Array(bytes)[0]}); }
    createBufferSource() { const source={playbackRate:{value:1},connect(){},start(){played.push(this.buffer.id);},stop(){}};return source; }
  }
  const fetch=async url=>{requests++;const id=Number(String(url).match(/stone-(\d)/)[1]);return {ok:true,arrayBuffer:async()=>new Uint8Array([id]).buffer};};
  const s=createSoundFeedback({AudioContext:SampleContext,fetch,random:()=>0});assert.equal(requests,0);assert.equal(s.playStone(),false);assert.equal(requests,0);
  s.setEnabled(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,5);
  assert.equal(s.playStone(),true);assert.equal(s.playStone(),true);assert.deepEqual(played,[1,2]);s.setEnabled(false);assert.equal(s.playStone(),false);
  const failed=createSoundFeedback({AudioContext:SampleContext,fetch:async()=>{throw Error('offline');}});failed.setEnabled(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(failed.playStone(),true);
});
