export function formatTime(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  const totalSec = ms / 1000;
  const minutes = Math.floor(totalSec / 60);
  const secs = totalSec - minutes * 60;
  const hundredths = Math.floor((secs - Math.floor(secs)) * 100);
  const wholeSec = Math.floor(secs);
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  if (minutes > 0) {
    return `${minutes}:${pad(wholeSec)}.${pad(hundredths)}`;
  }
  return `${pad(wholeSec)}.${pad(hundredths)}`;
}

export function initialsOf(name: string): string {
  return name
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
  (globalThis.crypto ?? { getRandomValues: (a: Uint8Array) => a.map(() => (Math.random() * 256) | 0) }).getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}