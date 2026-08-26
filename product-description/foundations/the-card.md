# The card

## Summary

Everything in this app is a card. There are two kinds — *roster cards*, which are
people on the combine roster, and *secret cards*, which are admin-curated art
that is not a person — and three independent axes decide how any one of them
looks and what it is worth. This document owns those axes. Every other document
uses their words and links here.

The three axes are deliberately kept in separate vocabularies that never share a
term: a **tier** is earned on the course and is the same on every phone in the
garden; an **edition** is luck and belongs to one person's copy; a **level** is
the same idea as an edition but for secrets, and is named differently so the two
can never be confused. A secret card carries a **look** instead of a tier,
chosen by the commissioner rather than earned.

## The simple case

You look at a roster card. Its foil, its colour and its bezel come from the
holder's tier: gold and magenta with a spinning prismatic sheen for the champion,
warm gold for a podium finish, violet scanlines for a station king, hazard amber
for the penalty box, dead slate for a DNF, and the house cyan for everybody else.
Under the card is a badge naming the tier and a line saying what earned it.

If your copy happens to wear a special finish, the badge changes. The finish
takes the headline in its own metal — Platinum, Gold, Silver, Bronze — and the
tier drops to the line underneath. Seventy per cent of copies are Standard and
print no finish badge at all, so the tier keeps the headline exactly as it
always did.

A secret card looks like nothing else: a rainbow prism edge around an opaque
chrome bezel, green-into-magenta foil in a rosette pattern, and a label under it
naming the level of your copy — Mythic, Legendary, Epic, Rare or Common.

## What a tier is

A tier is what a player did on the course. Nothing about it is random.

| Tier | Label | What earned it |
| --- | --- | --- |
| `champion` | 1 of 1 | Fastest official time |
| `podium` | Gold | Top three finish |
| `stationKing` | Station King | Fastest at a station |
| `penaltyBox` | Penalty Box | Most penalty time |
| `dnf` | DNF | Did not finish |
| `base` | Base | Combine athlete |

Tiers are computed from the live event rather than stored, so a card upgrades
itself mid-combine the moment somebody takes the lead — the screen is watching
the event, and a new fastest time redraws every card that it changes.

Three rules matter enough to state plainly:

- **Anybody out of contention is out of all of it.** A scratched, disqualified,
  did-not-play or absent athlete cannot hold the champion slot, a station crown
  or the penalty box, not merely their own tier. Before that rule existed, a
  disqualified athlete who had posted the fastest clock still consumed the
  champion slot, and the honest winner shipped as a podium card.
- **A dead heat shares the place.** Two identical clocks both count as first;
  neither is arbitrarily demoted.
- **The commissioner can override a tier**, and an override always wins.

The six tier strings are persisted on the event roster, which is why they may
never be renamed: renaming one orphans every card already wearing it.

## What an edition is

An edition is the finish on one copy of a roster card, rolled when you pull it.

| Edition | Pull rate | Milled for |
| --- | --- | --- |
| Platinum | 0.5% | 100 dust |
| Gold | 3.5% | 40 dust |
| Silver | 8% | 20 dust |
| Bronze | 18% | 10 dust |
| Standard | 70% | 5 dust |

Postgres decides the roll, not the phone. It used to be decided on the device
from the pack seed, and that stopped being acceptable the moment a finish started
paying out in dust: a value the client chooses is a value anybody can reroll by
refreshing.

**Best wins.** Pulling a worse finish of a card you already hold is a duplicate,
not a downgrade — the value only ever moves up the ladder, and the same rule runs
in Postgres so the device and the server agree about which copy you own.

The two axes never merge. The vault sorts on tier first and only tie-breaks on
edition, so a platinum DNF can never outrank a base champion. The tier keeps the
outer bezel, the foil texture, the ribbon, the reason line and the chime; the
edition gets an inner metal frame and its own chip.

Gold and above fires the confetti on reveal, whatever the tier did. That is the
point of the ladder: a base card can stop the garden if the roll was good enough.

## What a secret card is

A secret card is art an admin uploaded that is not a person on the roster. It is
pulled and never derived, so it lives entirely outside the tier system — a
seventh tier would have meant a tier a commissioner could hand to a player who
never earned it.

Two things describe it:

- **Its look**, chosen by the commissioner: a foil colour, and a prism edge that
  can spin, pulse, shimmer or sit steady. The prism edge is the invariant that
  marks a secret across every foil, and no earned tier may carry one. It is
  opaque chrome rather than a blend mode, which is why it survives being looked
  at outdoors — every other foil layer is filmed over the artwork and ambient
  light destroys it.
- **The level of your copy**, rolled by Postgres per copy at exactly the same
  rates as the edition ladder: Mythic 0.5%, Legendary 3.5%, Epic 8%, Rare 18%,
  Common 70%. Unlike an edition, a secret always prints its level, because the
  level is the new fact the card is announcing.

A secret is filed into a *set*, or into none, in which case it shows under
"Secrets". See [secret sets](../cards/secret-sets.md).

**How many secret cards exist is withheld.** No screen and no server response
carries a set size. A shelf shows how many of a set you hold and never a
denominator, and a set you own nothing from does not appear at all — an empty
"Pets" header would leak the shape of what you have not pulled yet, which is the
one thing the whole feature keeps back.

## The card back

Turning a card over shows what the front cannot: the reason line for the tier,
the pull odds for a special finish ("0.5% pull"), the date you first pulled it,
any award badges the holder has won, and — on a secret — how many people have
found that card.

The odds line is derived from the same table that produced the roll, so the copy
on the back of a card cannot drift from the rate that actually made it.

For a roster card the back also carries the station-by-station breakdown: the
holder's split at each station, how far it is from the field median, and their
place there. See [time and the clock](time-and-the-clock.md).

## Modifiers

| Modifier | At arrival | Changed during |
| --- | --- | --- |
| Who you are (guest · member · account · commissioner) | Tiers and looks are the same for everybody. What differs is which copies you hold, and therefore which editions and levels you see. A guest can hold secrets but never a roster copy. | A claim brings a guest's secrets onto their name; the cards look identical afterwards. |
| The event's state (before the combine · running · finished) | Before any official run exists every roster card is `base`. | Cards upgrade themselves mid-combine as results land. Nothing about the card is animated on the change; it simply redraws. |
| Dust switched on or off | No effect on how a card looks. It decides whether the card's finish is worth anything. | No effect. |
| The device (phone · desktop · reduced motion · presentation mode) | The resting sheen and the platinum animation are only drawn at hero size, never in a grid of thirty. Reduced motion drops the animated layers. | No effect on the card's identity. |

## Cancel and interrupt

Cards are not an interaction; they are what interactions are about. The rows
below say what happens to the *display* of a card when each event occurs, so the
documents that do describe interactions can link here instead of repeating it.

| Event | Effect |
| --- | --- |
| Back, or closing a sheet | None. |
| Navigating away inside the app | None. Tier data is cached and shared between screens. |
| Reload | Tiers are recomputed from the event; editions and levels are re-read from the device and the server. |
| Backgrounded | Idle animation stops and resumes. |
| Network lost mid-request | Cards already on screen keep their tier. A tier that would have changed does not. |
| The request fails or times out | Same: the card holds its last known tier rather than falling back to base. |
| The token expires or is cleared | A roster card is public and still renders. Your copies stop resolving, so finishes disappear from the badges. |
| Changed by someone else | A result landing anywhere in the combine can change any card's tier, live, without a refresh. |
| A second tab or device | Tiers agree everywhere. Editions agree wherever the server can name you. |
| Reduced motion or presentation mode changes | The idle sheen and the prism animation start or stop. Colours and badges never change. |

## Interactions with other systems

**Who you have to be.** Nobody, to look at a roster card. A copy — and therefore
an edition or a level — belongs to a guest or a member, and roster copies can
only belong to a member.

**Realtime.** Tier changes arrive over the event channel without a refresh. Level
and edition do not change after the pull.

**Offline and reconnection.** A card renders offline from cached data. Its tier
is whatever was last known.

**Optimistic updates and rollback.** None at this level.

**The card economy.** Edition and level are what a spare is worth. See
[milling and selling](../dust/milling-and-selling.md).

**Motion and sound.** The tier chooses the reveal chime; a secret has its own,
called explicitly rather than derived, because a secret's internal tier value is
a placeholder that nothing may branch on. The edition chooses the confetti.

**Notifications and badges.** None.

**Sharing.** A card can be exported as an image. See [sharing](../cross-cutting/sharing.md).

**The second device.** Tiers are identical everywhere. Editions follow the
account, or the member, not the handset.

**Accessibility.** Tier and finish are announced as text on the badge, not left
to colour alone. The foil layers are decorative and hidden from assistive
technology.

## Edge cases

- **A champion and a base card once looked alike at a glance.** Colour alone was
  never enough to separate two tiers — both swept one rainbow band, just in
  different hues — which is why each tier now wears a distinct foil *pattern*.
- **A gold finish on a podium card** would once have read "Gold · Gold". It
  cannot happen now: a special finish takes the headline and the tier drops to
  the line under it, so the two labels are never side by side.
- **A corrupt stored finish** falls back to Standard rather than being preserved,
  which is what lets the best-wins rule upgrade it on the next pull.
- **A tier value the app does not recognise**, arriving from an archived
  snapshot, sorts last rather than crashing. Archived events may contain statuses
  the live app never writes.
- **A secret carries no edition, and a roster card carries no prism edge.** These
  are reciprocal rules, each stated in the code that enforces the other.
- **A platinum on the dimmest tier** still clears the threshold that lifts the
  room on reveal. A 0.5% pull has to land.

## Open questions and verification

- That a card visibly upgrades mid-combine, without a refresh, was read from the
  live-recompute path and not watched during a real run. It is the single most
  worthwhile thing in this document to check on race day.
- The claim that the six foil patterns are distinguishable at a glance on a phone
  in daylight is a design intent stated in the source; it has not been checked
  outdoors, which is where this app is used.
- Whether an admin tier override survives a later result that would have earned a
  different tier was read as "an override always wins" and not tested.
- Assumption: no screen displays a secret set's total. This was checked across
  the vault, the pack and the trading post at this commit.

Verified against willyoubemyhero commit `b46f330`.
