export function formatTime(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  // Integer maths all the way down. Deriving the hundredths from a float
  // remainder printed 101_320 ms as 1:41.31, because 101.32 - 101 lands on
  // 0.3199999999999932 — which reads to a commissioner as "my edit did not
  // save" right after they typed 1:41.32.
  const sign = ms < 0 ? "-" : "";
  const totalHundredths = Math.floor(Math.abs(ms) / 10);
  const hundredths = totalHundredths % 100;
  const totalSec = (totalHundredths - hundredths) / 100;
  const wholeSec = totalSec % 60;
  const minutes = (totalSec - wholeSec) / 60;
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  if (minutes > 0) {
    return `${sign}${minutes}:${pad(wholeSec)}.${pad(hundredths)}`;
  }
  return `${sign}${pad(wholeSec)}.${pad(hundredths)}`;
}

/**
 * The inverse of `formatTime`, for the commissioner typing a correction.
 *
 * Accepts what people actually type on a phone: `1:23.45`, `83.45`, `83`,
 * `1:23`. The station boxes open a numeric keypad with no `:` key, so the
 * dotted `1.23.45` form is accepted as minute.second.fraction too, and a
 * colon-less seconds value may run past 99 (`138.25` is 2:18.25). Returns null
 * for anything it cannot read, so the caller can keep the field red rather
 * than silently writing a zero into a saved result.
 */
export function parseTime(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  // Dotted minutes form first: two dots can only mean m.ss.hh.
  const dotted = /^(\d+)\.(\d{1,2})\.(\d{1,3})$/.exec(s);
  if (dotted) {
    const minutes = Number(dotted[1]);
    const seconds = Number(`${dotted[2]}.${dotted[3]}`);
    if (seconds >= 60) return null;
    return Math.round((minutes * 60 + seconds) * 1000);
  }
  const m = /^(?:(\d+):)?(\d{1,6}(?:\.\d{1,3})?)$/.exec(s);
  if (!m) return null;
  const minutes = m[1] ? Number(m[1]) : 0;
  const seconds = Number(m[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  // Only an explicit minutes part caps the seconds; a bare value like 138.25 is
  // deliberately allowed to run over a minute.
  if (m[1] && seconds >= 60) return null;
  return Math.round((minutes * 60 + seconds) * 1000);
}


export function initialsOf(name: string): string {
  // Trim first: splitting " Doug Weidensaul" on whitespace leads with an empty
  // string, which eats one of the two slots and renders a single initial.
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

// Deterministic hue from a string for participant avatar background.
export function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

// Unbiased Fisher-Yates.
export function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Seeded RNG (mulberry32) — deterministic replay of a shuffle from a seed.
export function seededRng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function newClientKey(): string {
  const bytes = new Uint8Array(16);
  (
    globalThis.crypto ?? {
      getRandomValues: (a: Uint8Array) => a.map(() => (Math.random() * 256) | 0),
    }
  ).getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
