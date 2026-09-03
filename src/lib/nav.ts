// What the bottom bar holds, and which of it the chrome lights.
//
// Extracted rather than inlined in site-nav.tsx so both rules can be tested
// without standing a router up, and so that file keeps exporting components and
// nothing else — a mixed module breaks fast refresh for everything importing it,
// which here is the app shell.

import { Layers, PackageOpen, ArrowLeftRight, Sparkles, Timer, Trophy, type LucideIcon } from "lucide-react"; // prettier-ignore

/**
 * The rows the bar can hold, as ids rather than paths.
 *
 * `to` used to be the only identity a row had, and it still keys the React list,
 * the badge lookup and the active-tab match. It cannot also be what the database
 * stores: a commissioner's hidden set would then be a list of URLs, and moving a
 * route would silently un-hide whatever it used to name.
 */
export const NAV_ROW_IDS = ["vault", "pack", "trade", "shop", "board", "league"] as const;
export type NavRowId = (typeof NAV_ROW_IDS)[number];

/**
 * Rows the commissioner cannot switch off.
 *
 * The vault is the wordmark's target, the shop's way back, and what activeTab
 * falls back to for every /players/* screen without a tab of its own. A bar
 * without it has three dangling references and no home.
 */
export const PINNED_ROW_IDS: readonly NavRowId[] = ["vault"];

/**
 * The row whose switch is the dust economy's, not the nav's.
 *
 * Shop is gated by events.dust_enabled, which also stops dust accruing and hides
 * the vault chip. Giving it a second switch would make "why is Shop missing" a
 * question with two answers.
 */
export const DUST_ROW_ID = "shop" as const satisfies NavRowId;

/** The rows a commissioner may actually hide. */
export const TOGGLEABLE_ROW_IDS = NAV_ROW_IDS.filter(
  (id) => !PINNED_ROW_IDS.includes(id) && id !== DUST_ROW_ID,
) as readonly NavRowId[] as readonly [NavRowId, ...NavRowId[]];

export type NavTab = { id: NavRowId; to: string; label: string; icon: LucideIcon };

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

/** Every row the bar knows about, in order, before anything is switched off. */
const ALL_ROWS: NavTab[] = [
  { id: "vault", to: "/players", label: "Vault", icon: Layers },
  { id: "pack", to: "/players/pack", label: "Pack", icon: PackageOpen },
  { id: "trade", to: "/players/trade", label: "Trade", icon: ArrowLeftRight },
  { id: "shop", to: "/players/shop", label: "Shop", icon: Sparkles },
  { id: "board", to: "/leaderboard", label: "Board", icon: Timer },
  { id: "league", to: "/league", label: "League", icon: Trophy },
];

/**
 * The tabs, in order, for a given state of the dust economy and the
 * commissioner's hidden set.
 *
 * The combine is a week a year and the collection is every other day of it, so
 * the first slots belong to the vault, the pack and the trading post. The board
 * keeps a tab because a card's whole claim to a tier is a time on it; the rest of
 * the combine sits one tap away behind /league, and Admin lives in the account
 * menu where a PIN-gated screen belongs.
 *
 * Shop appears only while the commissioner has dust switched on, which is a
 * deliberate trade and worth naming: the bar reflows when that switch flips. A
 * tab that is present but dead for most of the year is the worse of the two, and
 * the switch is a once-a-season commissioner action rather than something a
 * player sees move under their thumb. That argument is why the rest of the bar
 * is switchable too — a league that never trades carries a Trade tab all year on
 * the strength of nothing.
 *
 * Shop sits after Trade because dust is card-economy business — burning spares
 * and settling finishes — and putting it past League would file it with the
 * combine.
 *
 * Order is the array's, never the hidden set's: hiding a row removes it and
 * moves nothing, so the bar a player learned stays the bar they know.
 */
export function navTabs({
  dustOn = false,
  hidden = [],
}: { dustOn?: boolean; hidden?: readonly string[] } = {}): NavTab[] {
  const off = new Set(hidden);
  return ALL_ROWS.filter((row) => {
    // Two rules that outrank the hidden set, in this order: the shop answers to
    // dust alone, and the pinned rows answer to nobody. An id the client has
    // never heard of is simply not in ALL_ROWS, so a stale hidden set from an
    // older deploy is ignored rather than fatal.
    if (row.id === DUST_ROW_ID) return dustOn;
    if (PINNED_ROW_IDS.includes(row.id)) return true;
    return !off.has(row.id);
  });
}

/**
 * The commissioner's hidden set, off the active event.
 *
 * `unknown` and a cast for the same reason dustLive takes one: declaring the
 * parameter as `{ nav_hidden?: string[] }` is an all-optional type, which trips
 * TypeScript's weak-type check and rejects an event carrying none of those
 * properties. The cast lives here once. It stops being needed the next time
 * src/integrations/supabase/types.ts is regenerated.
 *
 * Anything that is not an array of strings reads as "nothing hidden" — an event
 * that has not answered yet, and an event from before the column existed, both
 * have to render the whole bar rather than none of it.
 */
export function navHidden(event: unknown): string[] {
  const raw = (event as { nav_hidden?: unknown } | null | undefined)?.nav_hidden;
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}
