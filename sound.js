const STORAGE_KEY = "gomoku-sound";

// A short, locally synthesized stone-on-wood contact. No media request is made,
// and an AudioContext is only created after the user explicitly enables sound.
export function createSoundFeedback({ storage, AudioContext: AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) {
  let enabled = false, context = null, master = null;
  try { enabled = storage?.getItem(STORAGE_KEY) === "true"; } catch { /* Sound remains optional when storage is blocked. */ }

  function ensureContext() {
    if (!AudioContextClass) return null;
    if (!context) {
      context = new AudioContextClass();
      master = context.createGain(); master.gain.value = .55; master.connect(context.destination);
    }
    if (context.state === "suspended") void context.resume().catch(() => {});
    return context;
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    try { storage?.setItem(STORAGE_KEY, String(enabled)); } catch { /* The current session still honors the choice. */ }
    if (enabled) ensureContext();
    else if (context?.state === "running") void context.suspend().catch(() => {});
    return enabled;
  }

  function playStone() {
    if (!enabled) return false;
    const audio = ensureContext(); if (!audio) return false;
    try {
      const now = audio.currentTime + .004;
      const noiseLength = Math.floor(audio.sampleRate * .055);
      const buffer = audio.createBuffer(1, noiseLength, audio.sampleRate), samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) samples[i] = (Math.random() * 2 - 1) * Math.exp(-i / (noiseLength * .16));
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
