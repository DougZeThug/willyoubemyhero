/** Resolve after `ms`. For the ceremony's beats, which are awaited in sequence. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
