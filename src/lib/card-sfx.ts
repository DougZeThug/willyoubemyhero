// Card sound effects synthesised at runtime — no audio files to host or load.
//
// Browsers refuse to start an AudioContext outside a user gesture, so the context
// is created lazily on the first call (which is always a tap or click) and reused.
// Every entry point is a no-op on the server, when the user prefers reduced motion,
// or if Web Audio is unavailable.

import { useCallback, useEffect, useState } from "react";

const MUTE_KEY = "wwbh:sfx-muted";

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
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    /* private mode with storage blocked still mutes for this page load */
  }
  // Storage events only fire in *other* tabs, so the hook below listens for
  // this instead. Same pattern as member-token.ts's token-changed event.
  window.dispatchEvent(new Event("wwbh:sfx-muted-changed"));
}

export function isCardSfxMuted() {
  return muted;
}

function readMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Restore the saved preference into module state. Call once, high in the tree —
 * the setting has to be live before the first card is ever tapped.
 */
export function hydrateCardSfxMuted() {
  muted = readMuted();
}

/**
 * Reactive view of the mute preference for a toggle button.
 *
 * Starts unmuted so the server and the first client render agree, then reads
 * storage in an effect — the same hydration dance as `useMemberSession`.
 */
export function useCardSfx() {
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const sync = () => setIsMuted(readMuted());
    sync();
    window.addEventListener("wwbh:sfx-muted-changed", sync);
    // Covers the app being open in two tabs.
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("wwbh:sfx-muted-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !isCardSfxMuted();
    setCardSfxMuted(next);
    // Unmuting is itself a user gesture, so it is the ideal moment to unlock
    // Safari's suspended AudioContext — otherwise the first sound after
    // unmuting is silently dropped.
    if (!next) audio();
  }, []);

  return { muted: isMuted, toggle };
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

/**
 * The mouth of the pack parting, a beat after the rip.
 *
 * Two voices, because one of them is a rip and this is the moment *after* it: a
 * long downward body — foil letting go — under a short bright crackle, which is
 * the fibre. `playTear` is the gesture; this is the consequence of it.
 */
export function playPackOpen() {
  noiseBurst(0.5, 3800, 240, 0.14);
  noiseBurst(0.09, 7000, 3000, 0.06);
  if (typeof navigator !== "undefined" && !prefersReducedMotion()) {
    navigator.vibrate?.([20, 40, 30]);
  }
}

/**
 * The cards leaving the pack.
 *
 * One sweep for all of them, not one each. Three staggered whooshes inside 200ms
 * stack into a single smear anyway — the same mistake `playTearTick` exists to
 * avoid. Upward, which nothing else in this file does: every other burst falls,
 * so a rising one reads as the only thing coming toward you.
 */
export function playPackBurst() {
  noiseBurst(0.38, 420, 2800, 0.075);
}

/**
 * The fan gathering into a deck — a riffle, not a chime.
 *
 * Three near-identical taps 45ms apart. Scheduled rather than fired as one burst
 * because a riffle is a countable number of edges and a single burst is a
 * shuffle.
 */
export function playDeckGather() {
  for (let i = 0; i < 3; i++) {
    setTimeout(() => noiseBurst(0.06, 2600, 900, 0.05), i * 45);
  }
  if (typeof navigator !== "undefined" && !prefersReducedMotion()) {
    navigator.vibrate?.([6, 30, 6]);
  }
}

/**
 * One crinkle of foil, fired repeatedly as the rip travels under a finger.
 *
 * Quiet and very short on purpose: this plays eight or so times across a single
 * drag, so anything with a tail stacks into mush before the tear itself lands.
 */
export function playTearTick() {
  noiseBurst(0.05, 6000, 2400, 0.05);
  if (typeof navigator !== "undefined" && !prefersReducedMotion()) {
    navigator.vibrate?.([4]);
  }
}

// Triads chosen so better pulls sound brighter and more resolved.
//
// `secret` is the exception, deliberately: four voices where everything else has
// three, and an open stack of fifths and octaves with no third in it at all, so
// it rings rather than lands. Its lowest note is the champion triad's middle note
// and its top note is an exact octave above the champion's top. Every other entry
// resolves; this one does not, which is what "there is more of this" sounds like.
const CHIMES: Record<string, number[]> = {
  secret: [659.25, 987.77, 1318.51, 1975.53], // E5 B5 E6 B6
  secretDupe: [1318.51, 1975.53], // the top half of the same bell
  champion: [523.25, 659.25, 987.77],
  podium: [523.25, 659.25, 783.99],
  stationKing: [493.88, 622.25, 739.99],
  base: [392.0, 493.88, 587.33],
  penaltyBox: [311.13, 369.99, 415.3],
  dnf: [261.63, 311.13, 349.23],
};

/**
 * The room going quiet before a secret lands.
 *
 * The 900ms hold before a hit is silent, which carries one beat; the secret's
 * hold is nearly twice that, and silence over that long reads as a dropped frame
 * rather than as suspense. Peak gain sits under the chime's on purpose — this is
 * the intake of breath, not a second instrument.
 */
export function playSecretRiser(durationSec = 0.9) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  osc.type = "triangle";
  const start = ac.currentTime;
  osc.frequency.setValueAtTime(164.81, start); // E3
  osc.frequency.exponentialRampToValueAtTime(659.25, start + durationSec); // up to E5

  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(0.055, start + durationSec * 0.8);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);

  osc.connect(amp).connect(ac.destination);
  osc.start(start);
  osc.stop(start + durationSec + 0.05);
}

/** Rarity reveal chime — three or four detuned sines with an exponential tail. */
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
