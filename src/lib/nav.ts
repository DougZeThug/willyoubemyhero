// Which tab the chrome lights, given where you are.
//
// Extracted rather than inlined in site-nav.tsx so the rule can be tested without
// standing a router up, and so that file keeps exporting components and nothing
// else — a mixed module breaks fast refresh for everything importing it, which
// here is the app shell.

/**
 * The longest whole-segment prefix wins.
 *
 * The old rule was a bare `startsWith`, which was fine while the card screens
 * lived under a single Players tab and became wrong the moment they got tabs of
 * their own: `/players/pack` starts with `/players`, so a naive test lights Vault
 * and Pack at once. Longest-match settles it — /players/pack lights Pack,
 * /players/$id lights Vault.
 *
 * Whole-segment, so a future `/players-archive` never lights the Vault on the
 * strength of a shared prefix that stops mid-word.
 */
export function activeTab(path: string, tos: readonly string[]): string | null {
  const hit = tos.filter((to) => path === to || path.startsWith(to + "/"));
  return hit.sort((a, b) => b.length - a.length)[0] ?? null;
}
