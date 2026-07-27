// Card sound effects synthesised at runtime — no audio files to host or load.
//
// Browsers refuse to start an AudioContext outside a user gesture, so the context
// is created lazily on the first call (which is always a tap or click) and reused.
// Every entry point is a no-op on the server, when the user prefers reduced motion,
// or if Web Audio is unavailable.

let ctx: AudioContext | null = null;
let muted = false;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function audio(): AudioContext | null {
  if (typeof window === "undefined" || muted || prefersReducedMotion()) return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  // Safari suspends the context until a gesture resumes it.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setCardSfxMuted(next: boolean) {
  muted = next;
}

export function isCardSfxMuted() {
  return muted;
}

// Short burst of filtered white noise — reads as card stock sliding against card stock.
function noiseBurst(durationSec: number, fromHz: number, toHz: number, gain: number) {
  const ac = audio();
  if (!ac) return;
  const frames = Math.floor(ac.sampleRate * durationSec);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) channel[i] = Math.random() * 2 - 1;

  const source = ac.createBufferSource();
  source.buffer = buffer;

  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(fromHz, ac.currentTime);
  filter.frequency.exponentialRampToValueAtTime(toHz, ac.currentTime + durationSec);

  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, ac.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + durationSec);

  source.connect(filter).connect(amp).connect(ac.destination);
  source.start();
  source.stop(ac.currentTime + durationSec);
}

/** Card flip: a fast upward noise sweep plus a light haptic tick. */
export function playFlip() {
  noiseBurst(0.12, 800, 4000, 0.09);
  if (typeof navigator !== "undefined" && !prefersReducedMotion()) {
    navigator.vibrate?.([8]);
  }
}

/** Foil wrapper tearing open — longer, rougher, downward. */
export function playTear() {
  noiseBurst(0.42, 5200, 700, 0.13);
  if (typeof navigator !== "undefined" && !prefersReducedMotion()) {
    navigator.vibrate?.([12, 30, 18]);
  }
}

// Triads chosen so better pulls sound brighter and more resolved.
const CHIMES: Record<string, number[]> = {
  champion: [523.25, 659.25, 987.77],
  podium: [523.25, 659.25, 783.99],
  stationKing: [493.88, 622.25, 739.99],
  base: [392.0, 493.88, 587.33],
  penaltyBox: [311.13, 369.99, 415.3],
  dnf: [261.63, 311.13, 349.23],
};

/** Rarity reveal chime — three detuned sines with an exponential tail. */
export function playReveal(tier: string) {
  const ac = audio();
  if (!ac) return;
  const notes = CHIMES[tier] ?? CHIMES.base;
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    osc.type = "sine";
    // Slight detune per voice so the triad shimmers instead of sounding synthetic.
    osc.frequency.value = freq * (1 + (i - 1) * 0.0015);

    const amp = ac.createGain();
    const start = ac.currentTime + i * 0.06;
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);

    osc.connect(amp).connect(ac.destination);
    osc.start(start);
    osc.stop(start + 0.95);
  });
}
