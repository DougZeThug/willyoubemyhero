// The sound and haptic grammar's guards.
//
// The synthesis itself is not testable and is not worth testing — jsdom has no
// Web Audio, and asserting oscillator frequencies would pin the tuning rather
// than the behaviour. What is worth pinning is that every cue is a safe no-op in
// the three situations where making a noise would be a bug, and that the two
// preferences mean what they say.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cue, playEditionShine, playFlip, setCardSfxMuted, SFX_CUES } from "./card-sfx";
import { setMatchMedia } from "@/test/setup";

// Read off the registry rather than hand-listed. The hand-listed version stopped
// covering the whole table the first time a cue was added, and the guards below
// are worth nothing if they only cover the cues somebody remembered.
const CUES = SFX_CUES;

let vibrate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vibrate = vi.fn();
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  setCardSfxMuted(false);
});

afterEach(() => {
  setCardSfxMuted(false);
});

describe("every cue", () => {
  /**
   * jsdom has no AudioContext at all, which is the same shape as an old browser
   * that has none — so this doubles as the "Web Audio is unavailable" case. A cue
   * that threw here would take the whole ceremony's timer chain with it.
   */
  it("is silent rather than fatal when there is no audio to be had", () => {
    for (const name of CUES) {
      expect(() => cue(name)).not.toThrow();
    }
  });

  it("stops buzzing when the user has asked for less motion", () => {
    // Haptics are motion, so this setting governs them. Sound is NOT — gating
    // audio on it too made "a still screen that still makes a noise"
    // inexpressible, and the mute toggle could not give the sound back.
    setMatchMedia((q) => q.includes("reduce"));
    for (const name of CUES) cue(name);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("buzzes on the beats that are meant to be felt", () => {
    // Not every cue has a haptic — a riser is a sound, not a tap — but the ones
    // that mark a physical event do.
    for (const name of ["cardLand", "cardFace", "fakeEnding", "secretImpact"] as const) {
      vibrate.mockClear();
      cue(name);
      expect(vibrate, `${name} should buzz`).toHaveBeenCalled();
    }
  });

  /**
   * The secret has to be the heaviest thing the phone does, in exactly the same
   * way it is the loudest and the brightest.
   */
  it("hits hardest for the secret", () => {
    const total = (name: (typeof CUES)[number]) => {
      vibrate.mockClear();
      cue(name);
      const arg = vibrate.mock.calls[0][0] as number[];
      return arg.reduce((n, ms) => n + ms, 0);
    };
    expect(total("secretImpact")).toBeGreaterThan(total("cardFace"));
    expect(total("secretImpact")).toBeGreaterThan(total("cardLand"));
  });
});

describe("the mute toggle", () => {
  /**
   * It is the *sound* toggle. The commonest reason to reach for it here is
   * standing in a garden next to somebody else's phone, which is a reason to
   * silence the chimes and no reason at all to stop the handset tapping back.
   */
  it("does not take the haptics with it", () => {
    setCardSfxMuted(true);
    cue("secretImpact");
    expect(vibrate).toHaveBeenCalled();
  });

  it("still lets a flip be felt", () => {
    setCardSfxMuted(true);
    playFlip();
    expect(vibrate).toHaveBeenCalled();
  });
});

describe("the edition shine", () => {
  /**
   * Same reasoning as the cue tests above: the synthesis is not testable here and
   * the tuning is not worth pinning. What is worth pinning is that the reveal's
   * second cue can never be the thing that takes the ceremony's timer chain down
   * — it fires from the same tick as playReveal, on every card in every pack.
   */
  it("is a safe no-op with no Web Audio, on every rung and on nonsense", () => {
    for (const edition of ["standard", "bronze", "silver", "gold", "platinum", "legendary", ""]) {
      expect(() => playEditionShine(edition)).not.toThrow();
    }
  });

  it("is silent when the user has muted the app", () => {
    setCardSfxMuted(true);
    expect(() => playEditionShine("platinum")).not.toThrow();
  });
});
