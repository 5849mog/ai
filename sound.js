const STORAGE_KEY = "gomoku-sound";

// Three locally hosted recordings, prepared after sound is enabled. A short
// synthesized fallback keeps play responsive if decoding or loading fails.
export function createSoundFeedback({ storage, AudioContext: AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext, fetch: fetchAudio = globalThis.fetch, random = Math.random } = {}) {
  let enabled = false, context = null, master = null, samples = [], loading = null, loadAttempted = false, previous = -1;
  try { enabled = storage?.getItem(STORAGE_KEY) === "true"; } catch { /* Sound remains optional when storage is blocked. */ }

  function ensureContext() {
    if (!AudioContextClass) return null;
    if (!context) {
      try { context = new AudioContextClass(); master = context.createGain(); master.gain.value = .55; master.connect(context.destination); }
      catch { context = null; master = null; return null; }
    }
    if (context.state === "suspended") void context.resume().catch(() => {});
    return context;
  }

  function prepareSamples(audio) {
    if (loading || samples.length || loadAttempted || !fetchAudio || typeof audio.decodeAudioData !== "function") return;
    loadAttempted = true;
    const urls = [1, 2, 3].map(n => new URL(`./assets/sounds/stone-${n}.mp3`, import.meta.url));
    loading = Promise.allSettled(urls.map(async url => {
      const response = await fetchAudio(url); if (!response.ok) throw new Error("sound unavailable");
      return audio.decodeAudioData(await response.arrayBuffer());
    })).then(results => { samples = results.filter(r => r.status === "fulfilled").map(r => r.value); })
      .finally(() => { loading = null; });
  }

  function setEnabled(value) {
    const wasEnabled = enabled; enabled = Boolean(value);
    if (enabled && !wasEnabled && !samples.length) loadAttempted = false;
    try { storage?.setItem(STORAGE_KEY, String(enabled)); } catch { /* The current session still honors the choice. */ }
    if (enabled) { const audio = ensureContext(); if (audio) prepareSamples(audio); }
    else if (context?.state === "running") void context.suspend().catch(() => {});
    return enabled;
  }

  function playStone() {
    if (!enabled) return false;
    const audio = ensureContext(); if (!audio) return false;
    prepareSamples(audio);
    try {
      if (samples.length) {
        const available = samples.map((_,i)=>i).filter(i=>samples.length===1 || i!==previous);
        const index=available[Math.min(available.length-1,Math.floor(random()*available.length))]; previous=index;
        const source=audio.createBufferSource(), gain=audio.createGain();
        source.buffer=samples[index]; source.playbackRate.value=.99+random()*.02; gain.gain.value=.38;
        source.connect(gain); gain.connect(master); source.start(audio.currentTime+.004); return true;
      }
      const now = audio.currentTime + .004;
      const noiseLength = Math.floor(audio.sampleRate * .055);
      const buffer = audio.createBuffer(1, noiseLength, audio.sampleRate), noiseSamples = buffer.getChannelData(0);
      for (let i = 0; i < noiseSamples.length; i += 1) noiseSamples[i] = (Math.random() * 2 - 1) * Math.exp(-i / (noiseLength * .16));
      const contact = audio.createBufferSource(), filter = audio.createBiquadFilter(), contactGain = audio.createGain();
      contact.buffer = buffer; filter.type = "bandpass"; filter.frequency.value = 1450 + Math.random() * 180; filter.Q.value = .75;
      contactGain.gain.setValueAtTime(.16, now); contactGain.gain.exponentialRampToValueAtTime(.0001, now + .06);
      contact.connect(filter); filter.connect(contactGain); contactGain.connect(master); contact.start(now); contact.stop(now + .065);

      // Low wood resonance plus two quieter stone modes; slight variation avoids repetition.
      const variation = 1 + (Math.random() - .5) * .035;
      for (const [frequency, level, decay] of [[410, .12, .12], [785, .07, .075], [1320, .035, .045]]) {
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        oscillator.type = "sine"; oscillator.frequency.value = frequency * variation;
        gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(level, now + .002);
        gain.gain.exponentialRampToValueAtTime(.0001, now + decay);
        oscillator.connect(gain); gain.connect(master); oscillator.start(now); oscillator.stop(now + decay + .01);
      }
      return true;
    } catch { return false; }
  }

  return { get enabled() { return enabled; }, setEnabled, playStone };
}
