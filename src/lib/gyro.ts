import { useEffect, useState } from "react";

/**
 * Whether a device can actually lean a card, and whether it will.
 *
 * `granted`     — orientation events are arriving.
 * `denied`      — the device can, the person said no.
 * `unsupported` — there is no gyroscope behind the API. Desktop Chrome and
 *                 Firefox both expose `DeviceOrientationEvent` and never fire
 *                 it, which is why feature-detecting the TYPE is not enough:
 *                 the chip lit, nothing moved, and nothing said why.
 */
export type GyroAccess = "granted" | "denied" | "unsupported";

/** How long to wait for a first reading before calling it no gyroscope. */
const FIRST_EVENT_TIMEOUT_MS = 600;

/**
 * Request access to device-orientation events.
 *
 * iOS 13+ gates `deviceorientation` behind an explicit permission prompt that
 * must be triggered by a user gesture — call this from a click handler, not on
 * mount. Every other browser either exposes the event freely or not at all, so
 * feature-detect rather than assuming the prompt exists.
 */
export async function requestGyroAccess(): Promise<GyroAccess> {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
    return "unsupported";
  }
  const D = window.DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<"granted" | "denied">;
  };
  if (typeof D.requestPermission === "function") {
    try {
      return (await D.requestPermission()) === "granted" ? "granted" : "denied";
    } catch {
      return "denied";
    }
  }
  // No prompt to answer, so the only honest test is whether a reading arrives.
  // A browser with no gyroscope behind the API stays silent forever.
  return awaitReading();
}

/**
 * Wait for one real orientation reading, or give up.
 *
 * Asks for nothing: it only listens. Shared by `requestGyroAccess`'s no-prompt
 * branch and by `hasLiveGyro` below, which is the whole reason it is its own
 * function — the two want the same evidence for different questions.
 */
function awaitReading(): Promise<GyroAccess> {
  return new Promise<GyroAccess>((resolve) => {
    let settled = false;
    const done = (result: GyroAccess) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("deviceorientation", onReading);
      clearTimeout(timer);
      resolve(result);
    };
    const onReading = (e: DeviceOrientationEvent) => {
      // A device with no sensor can still fire one event with every angle null.
      if (e.beta == null && e.gamma == null && e.alpha == null) return;
      done("granted");
    };
    const timer = setTimeout(() => done("unsupported"), FIRST_EVENT_TIMEOUT_MS);
    window.addEventListener("deviceorientation", onReading);
  });
}

/**
 * Whether orientation events are arriving RIGHT NOW, without asking for anything.
 *
 * The question a stored preference cannot answer on its own. A grant does not
 * outlive a browsing session on iOS, and there is no way to query one — so a
 * remembered "tilt wanted" restored straight into an active tilt is a chip lit
 * over a card that never moves, which is the exact failure the top of this file
 * says the old boolean caused.
 *
 * Deliberately never calls `requestPermission`: a prompt outside a user gesture
 * is refused anyway, and a screen the person merely opened is not a screen they
 * asked a question on. Silence for 600ms reads as "not live", the tilt stays off
 * and the card's own chip is still there to ask properly from a tap.
 */
export function hasLiveGyro(): Promise<boolean> {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
    return Promise.resolve(false);
  }
  return awaitReading().then((access) => access === "granted");
}

// ------- The preference, as opposed to the permission -------

const TILT_KEY = "wwbh:tilt";

let tiltWanted = false;

/**
 * "Tilt wanted", never "permission held".
 *
 * The two are genuinely different and conflating them would be a lie on both
 * platforms. iOS grants orientation per gesture and there is no way to ask
 * whether a grant survives, so a stored "granted" would be a guess; everywhere
 * else there is no prompt at all and the only question left IS the preference.
 * So this stores what the person asked for, and `requestGyroAccess` still runs
 * from the tap that sets it — which is the gesture iOS requires.
 *
 * Stored the way every other device preference in this app is — see the header
 * of nav-shape.ts: a `wwbh:` key, storage in a try/catch so a locked private
 * window degrades to "works for this page load", a module flag because that is
 * all there is left to trust when a write is refused, and a custom event because
 * `storage` only fires in *other* tabs.
 */
export function setTiltWanted(next: boolean) {
  tiltWanted = next;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TILT_KEY, next ? "1" : "0");
  } catch {
    /* private mode with storage blocked still holds for this page load */
  }
  window.dispatchEvent(new Event("wwbh:tilt-changed"));
}

export function isTiltWanted() {
  return tiltWanted;
}

function readTiltWanted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TILT_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Reactive view of the preference.
 *
 * Starts false so the server and the first client render agree, then reads
 * storage in an effect — the same hydration dance as `useMemberSession`. A card
 * seeded from this therefore starts flat and leans a tick later, which is the
 * right way round: the other order is a card that leans and then snaps back.
 */
export function useTiltWanted() {
  const [wanted, setWanted] = useState(false);

  useEffect(() => {
    const mine = () => setWanted(isTiltWanted());
    const theirs = () => {
      tiltWanted = readTiltWanted();
      setWanted(tiltWanted);
    };
    theirs();
    window.addEventListener("wwbh:tilt-changed", mine);
    window.addEventListener("storage", theirs);
    return () => {
      window.removeEventListener("wwbh:tilt-changed", mine);
      window.removeEventListener("storage", theirs);
    };
  }, []);

  return wanted;
}
