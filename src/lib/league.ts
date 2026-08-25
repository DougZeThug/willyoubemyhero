// The combine screens, one tap off the nav rather than three tabs of it.
//
// Here rather than in the route file so a test can assert the destinations
// without the router's file scan picking a `league.test.ts` up as a route and
// warning about it on every dev boot.

import { Award, BarChart3, ClipboardList, ListOrdered, Radio, type LucideIcon } from "lucide-react";

export type LeagueLink = {
  to: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
};

/**
 * Every screen the nav gave up when the tabs went to the cards.
 *
 * These five are now the only way in to /live, /order, /draft, /awards and
 * /analytics, and a tile quietly dropped from a link hub strands a whole page at
 * a URL nobody can reach from inside the app — which is the one failure a hub is
 * worst at showing you. Hence the test.
 *
 * Analytics carries the recap archive rather than the archive getting a tile of
 * its own: it already lives on that page, and a second door to one room reads as
 * two rooms.
 */
export const LEAGUE_LINKS = [
  { to: "/live", label: "Live", icon: Radio, blurb: "Race-day timing" },
  { to: "/order", label: "Order", icon: ListOrdered, blurb: "Running order" },
  { to: "/draft", label: "Draft", icon: ClipboardList, blurb: "Pick selection" },
  { to: "/awards", label: "Awards", icon: Award, blurb: "League superlatives" },
  { to: "/analytics", label: "Analytics", icon: BarChart3, blurb: "Stats and the recap archive" },
  // `as const` so each `to` stays a literal the router can typecheck against its
  // route tree; `satisfies` so the shape is still checked rather than inferred.
] as const satisfies readonly LeagueLink[];
