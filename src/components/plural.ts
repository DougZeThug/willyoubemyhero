/** "1 station", "2 stations". Regular plurals only: add an argument the day a noun needs one. */
export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
