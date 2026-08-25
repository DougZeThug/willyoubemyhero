// What the bottom bar holds, and which of it the chrome lights.
//
// Extracted rather than inlined in site-nav.tsx so both rules can be tested
// without standing a router up, and so that file keeps exporting components and
// nothing else — a mixed module breaks fast refresh for everything importing it,
// which here is the app shell.

import { Layers, PackageOpen, ArrowLeftRight, Sparkles, Timer, Trophy, type LucideIcon } from "lucide-react"; // prettier-ignore

export type NavTab = { to: string; label: string; icon: LucideIcon };

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

/**
 * The tabs, in order, for a given state of the dust economy.
 *
 * The combine is a week a year and the collection is every other day of it, so
 * the first slots belong to the vault, the pack and the trading post. The board
 * keeps a tab because a card's whole claim to a tier is a time on it; the rest of
 * the combine sits one tap away behind /league, and Admin lives in the account
 * menu where a PIN-gated screen belongs.
 *
 * Shop appears only while the commissioner has dust switched on, which is a
 * deliberate trade and worth naming: the bar reflows from five columns to six
 * when that switch flips. A tab that is present but dead for most of the year is
 * the worse of the two, and the switch is a once-a-season commissioner action
 * rather than something a player sees move under their thumb.
 *
 * It sits after Trade because dust is card-economy business — burning spares and
 * settling finishes — and putting it past League would file it with the combine.
 */
export function navTabs(dustOn: boolean): NavTab[] {
  return [
    { to: "/players", label: "Vault", icon: Layers },
    { to: "/players/pack", label: "Pack", icon: PackageOpen },
    { to: "/players/trade", label: "Trade", icon: ArrowLeftRight },
    ...(dustOn ? [{ to: "/players/shop", label: "Shop", icon: Sparkles }] : []),
    { to: "/leaderboard", label: "Board", icon: Timer },
    { to: "/league", label: "League", icon: Trophy },
  ];
}
