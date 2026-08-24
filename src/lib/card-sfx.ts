// Card sound effects synthesised at runtime — no audio files to host or load.
//
// Browsers refuse to start an AudioContext outside a user gesture, so the context
// is created lazily on the first call (which is always a tap or click) and reused.
// Every entry point is a no-op on the server, when the user prefers reduced motion,
// or if Web Audio is unavailable.

import { useCallback, useEffect, useState } from "react";
import { editionCelebrates } from "./card-edition";

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
    // Same tab: module state is already authoritative, just mirror it into React.
    const mine = () => setIsMuted(isCardSfxMuted());
    // Another tab: storage is the only thing that changed, so the module flag —
    // which is what actually gates playback in `audio()` — has to be caught up
    // too, or this tab shows muted while it keeps making noise.
    const theirs = () => {
      muted = readMuted();
      setIsMuted(muted);
    };
    theirs();
    window.addEventListener("wwbh:sfx-muted-changed", mine);
    window.addEventListener("storage", theirs);
    return () => {
      window.removeEventListener("wwbh:sfx-muted-changed", mine);
      window.removeEventListener("storage", theirs);
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

/**
 * Short burst of filtered white noise — reads as card stock sliding against card
 * stock.
 *
 * `afterSec` schedules the burst against the AudioContext's own clock rather than
 * the caller waiting on a timer. That clock is sample-accurate and keeps running
 * when the tab is throttled, which a `setTimeout` chain does not: backgrounded,
 * several short timers coalesce and fire together, turning a sequence of taps into
 * one thud. It also means a scheduled burst needs no cleanup — it is already in
 * the audio graph, not in a pending callback.
 */
function noiseBurst(durationSec: number, fromHz: number, toHz: number, gain: number, afterSec = 0) {
  const ac = audio();
  if (!ac) return;
  const frames = Math.floor(ac.sampleRate * durationSec);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) channel[i] = Math.random() * 2 - 1;

  const source = ac.createBufferSource();
  source.buffer = buffer;

  const start = ac.currentTime + afterSec;

  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(fromHz, start);
  filter.frequency.exponentialRampToValueAtTime(toHz, start + durationSec);

  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);

  source.connect(filter).connect(amp).connect(ac.destination);
  source.start(start);
  source.stop(start + durationSec);
}

/**
 * A tone with a body, for the hits that need weight rather than texture.
 *
 * Everything above this point is filtered noise, which is right for foil and card
 * stock — those are broadband sounds. An impact is not: it is a pitch that drops,
 * and the drop is what the ear reads as mass. Sine rather than triangle at the
 * bottom of the range, because a triangle's harmonics turn to buzz on a phone
 * speaker at these frequencies.
 */
function thud(fromHz: number, toHz: number, durationSec: number, gain: number) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  osc.type = "sine";
  const start = ac.currentTime;
  osc.frequency.setValueAtTime(fromHz, start);
  osc.frequency.exponentialRampToValueAtTime(toHz, start + durationSec);

  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);

  osc.connect(amp).connect(ac.destination);
  osc.start(start);
  osc.stop(start + durationSec + 0.02);
}

/**
 * Buzz the phone, if it has one and the user has not asked for less motion.
 *
 * Every haptic in this file goes through here, because the guards are easy to
 * forget and a phone that vibrates for somebody who asked it not to is a far
 * worse bug than a missing tick.
 *
 * Deliberately *not* gated on `muted`. That toggle is the sound one, and the
 * commonest reason to reach for it here is standing in a garden next to someone
 * else's phone — which is a reason to silence the chimes and no reason at all to
 * stop the handset tapping back.
 */
function buzz(pattern: number | number[]) {
  if (typeof navigator === "undefined" || prefersReducedMotion()) return;
  navigator.vibrate?.(pattern);
}

/** Card flip: a fast upward noise sweep plus a light haptic tick. */
export function playFlip() {
  noiseBurst(0.12, 800, 4000, 0.09);
  buzz([8]);
}

/**
 * The pack being handled, before anything happens to it.
 *
 * Very quiet, and the only sound in this file that is not the consequence of a
 * gesture. It plays under the anticipation squash — the pack taking the strain —
 * so the sequence opens with something rather than with silence.
 */
function playPackHandle() {
  noiseBurst(0.18, 1800, 600, 0.035);
  buzz([6]);
}

/**
 * The seam under tension.
 *
 * Rises where every other burst in this file falls, and stops rather than
 * resolving — it is the intake of breath before the rip, and a sound that
 * finished would release the tension it exists to build.
 */
function playSeamTension(durationSec = 0.18) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  osc.type = "sawtooth";
  const start = ac.currentTime;
  osc.frequency.setValueAtTime(220, start);
  osc.frequency.exponentialRampToValueAtTime(660, start + durationSec);

  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1400;

  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(0.05, start + durationSec * 0.9);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);

  osc.connect(filter).connect(amp).connect(ac.destination);
  osc.start(start);
  osc.stop(start + durationSec + 0.02);
}

/**
 * A card arriving on the stand — the deck being caught.
 *
 * Low and short. This is the only sound in the sequence that happens to the
 * *stand* rather than to the pack, so it is the one that says the ceremony is
 * over and the card is now yours to turn.
 */
function playCardLand() {
  thud(180, 70, 0.16, 0.09);
  noiseBurst(0.06, 2200, 700, 0.04);
  buzz([10]);
}

/**
 * The face of a card hitting front-on.
 *
 * Crisp rather than heavy: the weight was spent on `playCardLand`, and this is
 * the snap of card stock landing flat. It sits directly under the chime, so it
 * has to be short enough not to smear the triad's first note.
 */
function playCardFace() {
  noiseBurst(0.05, 5200, 1600, 0.06);
  thud(140, 90, 0.09, 0.05);
  buzz([14]);
}

/**
 * The pack turning out not to be over.
 *
 * Detuned on purpose — two sines a semitone and a bit apart, which beat against
 * each other rather than making a chord. Every other tone in this file is
 * consonant; this is the one that is meant to sound wrong, because it is the
 * moment the screen stops telling the truth.
 */
function playFakeEnding() {
  thud(110, 55, 0.5, 0.085);
  thud(116.5, 58, 0.5, 0.06);
  // Two pulses rather than one. A single buzz reads as a notification; a pair
  // reads as something knocking.
  buzz([18, 90, 26]);
}

/**
 * The secret landing. The loudest thing the app does, and deliberately so.
 *
 * Roughly twice the gain of anything else here, over a longer fall, with a noise
 * transient on top so it has an edge as well as a body. It fires on the exact
 * frame the card slams face-forward — the flash, the shake and this are one
 * event, and anything that separates them by more than a frame or two stops the
 * whole thing landing as an impact.
 */
function playSecretImpact() {
  thud(210, 42, 0.7, 0.2);
  noiseBurst(0.12, 6000, 900, 0.11);
  buzz([30, 40, 60]);
}

/**
 * The last card of a set seating into it.
 *
 * Lower and longer than secretImpact, with the shine above it dropped: a secret
 * lands, and this closes. The buzz is the longest pattern in the file for the
 * same reason — it is the only one that is not marking a single frame, and a
 * handset that shudders once and stops reads as an impact rather than as an
 * arrival.
 */
function playCollectionComplete() {
  thud(150, 34, 1.1, 0.24);
  noiseBurst(0.3, 2600, 400, 0.07);
  buzz([40, 60, 40, 60, 120]);
}

/** Foil wrapper tearing open — longer, rougher, downward. */
export function playTear() {
  noiseBurst(0.42, 5200, 700, 0.13);
  buzz([12, 30, 18]);
}

/**
 * The mouth of the pack parting, a beat after the rip.
 *
 * Two voices, because one of them is a rip and this is the moment *after* it: a
 * long downward body — foil letting go — under a short bright crackle, which is
 * the fibre. `playTear` is the gesture; this is the consequence of it.
 */
function playPackOpen() {
  noiseBurst(0.5, 3800, 240, 0.14);
  noiseBurst(0.09, 7000, 3000, 0.06);
  buzz([20, 40, 30]);
}

/**
 * The tear travelling, from wherever the finger stopped to the far edge.
 *
 * The rip is a *progression* now rather than an event, and a single burst over
 * it is a photograph of a thing that takes four hundred milliseconds. So this is
 * six overlapping crinkles across that window, brightening and shortening as
 * they go: foil tears louder and thinner as the remaining material narrows, and
 * the last two are close enough together to run into each other, which is what
 * the ear reads as the tear letting go.
 *
 * All six are queued on the AudioContext clock in one call rather than chained
 * through timers — same reason `playDeckGather` is: 60ms apart is well inside
 * the window a throttled tab coalesces timers into, and a coalesced rip is one
 * flat smack.
 *
 * The haptic is the same shape: light taps that tighten up toward the break.
 */
function playTearRip() {
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const u = i / (steps - 1);
    noiseBurst(0.14 - u * 0.05, 2600 + u * 3600, 700 + u * 900, 0.04 + u * 0.05, u * 0.3);
  }
  buzz([5, 55, 6, 45, 8, 35, 12]);
}

/**
 * The cards leaving the pack.
 *
 * One sweep for all of them, not one each. Three staggered whooshes inside 200ms
 * stack into a single smear anyway — the same mistake `playTearTick` exists to
 * avoid. Upward, which nothing else in this file does: every other burst falls,
 * so a rising one reads as the only thing coming toward you.
 */
function playPackBurst() {
  noiseBurst(0.38, 420, 2800, 0.075);
}

/**
 * The fan gathering into a deck — a riffle, not a chime.
 *
 * Three near-identical taps 45ms apart, because a riffle is a countable number of
 * edges where a single burst is a shuffle. All three are queued on the audio clock
 * in one call rather than chained through `setTimeout`: 45ms apart is inside the
 * window a throttled tab coalesces timers into, which would collapse the riffle
 * into exactly the one smear this exists to avoid — and timers started here would
 * outlive the caller's own cleanup.
 */
function playDeckGather() {
  for (let i = 0; i < 3; i++) noiseBurst(0.06, 2600, 900, 0.05, i * 0.045);
  buzz([6, 30, 6]);
}

/**
 * One crinkle of foil, fired repeatedly as the rip travels under a finger.
 *
 * Quiet and very short on purpose: this plays eight or so times across a single
 * drag, so anything with a tail stacks into mush before the tear itself lands.
 */
export function playTearTick() {
  noiseBurst(0.05, 6000, 2400, 0.05);
  buzz([4]);
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
  // THE RESOLUTION OF THE SECRET BELL, and the only reason this entry is worth a
  // fifth voice. `secret` is an open stack of fifths on E with no third in it,
  // which is what makes it ring instead of land — "there is more of this". A
  // finished set is the moment there is not, so this is the same E, with the G#
  // the bell has been missing dropped into the middle of it. Somebody who has
  // pulled cards all season has heard the unresolved version dozens of times and
  // will not be able to say why this one feels like an ending.
  collectionComplete: [329.63, 659.25, 830.61, 987.77, 1318.51], // E4 E5 G#5 B5 E6
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

/**
 * A rising two-note shine, laid over the tier's chime on a rare finish.
 *
 * A second cue rather than thirty chimes. The tier and the finish are separate
 * facts and the ear should hear them that way, and a 6x5 chime matrix would need
 * thirty triads that all had to stay distinguishable from each other — which they
 * would not.
 *
 * Deliberately a gliss and not a chord: CHIMES.secret is the one entry that
 * stacks fifths and octaves with no third, and that unresolved ring is the
 * secret's signature. A stacked shine here would encroach on it. Two notes
 * sliding upward is a different gesture entirely.
 *
 * Silent below gold. Bronze and silver are 18% and 8% of pulls, and a sound on
 * one pull in four stops being a reward and becomes the noise the app makes.
 */
export function playEditionShine(edition: string) {
  // The same predicate the confetti gate uses, rather than a second list of
  // which finishes are a big deal — two would drift, and a card that threw
  // confetti in silence is exactly how you would notice, far too late.
  if (!editionCelebrates(edition)) return;
  const ac = audio();
  if (!ac) return;
  // Platinum climbs further and rings a little longer. Both sit above the
  // chime's own register so they read as a highlight over it, not a third voice
  // inside it.
  const top = edition === "platinum" ? 2637.02 : 1975.53; // E7 / B6
  const dur = edition === "platinum" ? 0.7 : 0.45;

  const osc = ac.createOscillator();
  osc.type = "sine";
  const start = ac.currentTime + 0.12;
  osc.frequency.setValueAtTime(1318.51, start); // E6
  osc.frequency.exponentialRampToValueAtTime(top, start + dur);

  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  // Under the chime's 0.12 peak on purpose: this decorates the reveal, it does
  // not announce it.
  amp.gain.exponentialRampToValueAtTime(0.05, start + dur * 0.35);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  osc.connect(amp).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/**
 * Every sound the pack sequence makes, by the name of the thing it is the sound
 * of.
 *
 * Two reasons this exists rather than the sequence calling the synths directly.
 *
 * The call sites read as direction — `cue("secretImpact")` beside the frame the
 * card slams — instead of as a list of oscillator functions, which matters
 * because the whole grammar is about a sound landing in the same ~30ms window as
 * a picture and a buzz. And every one of these is synthesised today because no
 * audio files ship with this app: nothing to host, nothing to wait on, works
 * offline, and the mute and reduced-motion guards are already inside. If sampled
 * versions are ever worth it, they get swapped in here and nothing that calls a
 * cue has to change.
 */
const CUES = {
  /** The pack being picked up, under the anticipation squash. */
  packHandle: playPackHandle,
  /** The tear line under tension, before it parts. */
  seamTension: playSeamTension,
  /** The rip travelling across the pack, for as long as it takes. */
  tearRip: playTearRip,
  /** The wrapper coming apart. */
  packOpen: playPackOpen,
  /** The cards leaving the pack, all of them, once. */
  packBurst: playPackBurst,
  /** The fan squaring up into a deck. */
  deckGather: playDeckGather,
  /** The deck arriving on the stand. */
  cardLand: playCardLand,
  /** A card's face hitting front-on. */
  cardFace: playCardFace,
  /** The pack turning out not to be over. */
  fakeEnding: playFakeEnding,
  /** The secret landing. */
  secretImpact: playSecretImpact,
  /** A set closing: the last card seating into it. */
  collectionComplete: playCollectionComplete,
} as const;

export type SfxCue = keyof typeof CUES;

/**
 * Every cue there is.
 *
 * Exported so the guards in card-sfx.test.ts can be exhaustive rather than
 * hand-listed. The hand-listed version silently stopped covering the whole table
 * the first time a cue was added, which is the one way this file can regress
 * without anybody noticing: a cue that throws takes the ceremony's timer chain
 * down with it.
 */
export const SFX_CUES = Object.keys(CUES) as SfxCue[];

/**
 * Play a named cue.
 *
 * Muting silences the *audio* only — the haptic still fires, deliberately; see
 * `buzz`. Reduced motion and the server suppress both.
 */
export function cue(name: SfxCue) {
  CUES[name]();
}
