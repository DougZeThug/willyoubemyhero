# Secrets in the pack

## Summary

A secret card is art an admin uploaded that is not a person on the roster. It
used to be a fourth slot bolted onto every pack — one a day, never one you
already owned while one was left to find. Now it is simply a card that can be
in the pack: the three slots are drawn from one pool of roster cards and
secrets, owned or not, and a pack can hold none, one, or all three.

This document owns what a secret is as a slot in the pack — how it gets there,
what turning one means, and what is withheld. The stand's treatment of it
belongs to [opening a pack](opening-a-pack.md); what a secret card _is_ belongs
to [the card](../foundations/the-card.md#what-a-secret-card-is).

## The simple case

You tear a pack. Three identical backs fly out. On the stand the second card
sits face-down, and the room goes dark around it: its edge starts to breathe.
That is the first you hear of it. You turn it. A rainbow prism edge, a foil the
commissioner chose, and under it the level of _your_ copy — Mythic, Legendary,
Epic, Rare or Common.

Tomorrow's pack might hold another, or two, or none. The hat decides.

## How a secret gets into the pack

The pack is dealt on the server from one pool: every roster card of the active
event, and every active secret with its art uploaded. Roster cards go in at
weight 100, which is the secrets' default weight, so a default-weight secret and
a roster card are equally likely to be drawn. The commissioner's weights still
tune secrets against each other — and against the roster.

Three distinct cards come out. There is no guaranteed-new slot any more, and no
rule that keeps a secret you own out of the hat. A duplicate is a duplicate; a
duplicate that rolls a better level than the copy you hold is an
[upgrade](opening-a-pack.md#new-better-or-another-one).

> Technical note: the deal is one Postgres function, `open_pack`. It draws the
> three slots with the same weighted sampling the old daily pull used, mints a
> member's roster copies through the same path the old pack did, files each
> secret slot exactly as the old pull did minus the one-a-day gate, and stores
> the dealt slots on the day's pack row. Asking again the same league day
> answers the same three cards.

## What decides it

The deal takes **no input at all**. Whoever is asking comes from a verified
token and every card is chosen by Postgres. Nothing on the phone names a roster
id to be minted or a secret id to be signed.

That is the whole security design of the feature, and it now covers the whole
pack rather than one slot of it. A guest gets a pack as readily as a member does:
the pack screen mints an anonymous identity for an unclaimed device the moment
it lands.

Calling twice in one league day returns **the same pack**, marked as not fresh,
rather than failing — so a double tap, a retried request, a reload, or a second
phone resumes rather than deals again.

The day is the league's, decided in the database. It is the pack's day too now:
the old split — the pack on the device's midnight, the secret on the league's —
is gone, and a tab left open across midnight re-seals on one clock.

## The level

Every secret slot rolls a level for _your copy_, on the same ladder as before:
Mythic 0.5%, Legendary 3.5%, Epic 8%, Rare 18%, Common 70%. A duplicate that
rolls better than the copy you own upgrades that copy; one that rolls worse
leaves it alone. Two people can hold the same secret at two different levels,
which is the whole point of a level belonging to the copy rather than the card.

## Modifiers

| Modifier                                                          | At arrival                                                                                                                                                                   | Changed during                                                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Who you are (guest · member · account · commissioner)             | A member's secret slots are filed against their name; a guest's against a server-minted identity. A member's secrets follow them to a new phone, a guest's follow the token. | Claiming mid-pack moves everything the guest pulled onto the participant — secrets, packs, and the streak milestones those packs already paid. |
| The event's state                                                 | The roster half of the pool is the active event's. Out of season the pool is the secrets alone, and a pack is still dealt.                                                   | No effect on a pack already dealt.                                                                                                             |
| Dust switched on or off                                           | A duplicate credits nothing either way. Its worth is realised only when somebody sells it, and the stand says what it would fetch.                                           | No effect.                                                                                                                                     |
| The device (phone · desktop · reduced motion · presentation mode) | Reduced motion drops the breathing ring's motion and the slam; the dark room still arrives, because that is what says "secret".                                              | No effect.                                                                                                                                     |

## Cancel and interrupt

The secret is a slot in the pack, so everything in
[the sealed pack's](the-sealed-pack.md#cancel-and-interrupt) and
[opening a pack's](opening-a-pack.md#cancel-and-interrupt) tables applies to it
unchanged. Two things are specific to it:

- **Its art expires.** A secret's image is a signed URL. A reload asks the
  server for the pack again — the same pack, with fresh URLs — before the stand
  draws anything, which is why a resume shows a beat of "dealing" first.
- **A set it finished is remembered.** The deal answers with the set at the
  tear, the ceremony waits for the card to be turned, and the row records that
  the ceremony is still owed so a reload in that gap does not swallow it.

## Interactions with other systems

**Who you have to be.** Somebody the server can name: a member, or a guest with a
signed identity. The wrapper is not tearable until one exists.

**Realtime.** None. The pack is a request, not a broadcast.

**Offline and reconnection.** The deal needs the network. So does a resume, for
the art. Turning cards already on the stand does not.

**Optimistic updates and rollback.** Nothing about a secret is optimistic. The
card on screen is the card the server chose.

**The card economy.** A duplicate credits nothing at the moment it lands. Its
worth is realised only when somebody sells it; see
[milling and selling](../dust/milling-and-selling.md). Streak milestones still
pay bonus secrets, granted rather than dealt, so they never cost a pack.

**Motion and sound.** The secret has its own chime, called explicitly rather than
derived from a tier — the value the app stores on a secret's look is a
placeholder that nothing may branch on. A plain duplicate has a quieter chime of
its own; an upgrade gets the fresh one, because the level is the news.

**Notifications and badges.** The Pack tab and the vault's button carry a dot
while today's pack is unopened. It says "unopened" and nothing about what is
inside — whether a secret is in the pack is the pack's news to break.

**Sharing.** A secret can be shared like any card. The response that carries it
is the only one in the app permitted to say a set has been completed — see below.

**The second device.** A member's secrets follow their name. A guest's follow
their token, which means clearing site data loses them.

## The one number that is withheld

**How many secret cards exist is never sent.** No screen shows a total, no
response carries a set size, and a shelf shows how many of a set you hold without
a denominator. A set you own nothing from does not appear at all, because an
empty heading leaks the shape of what you have not pulled yet.

The pack itself gives nothing away either: three identical backs in the fan, no
bezel, no colour. The one place a secret's existence is admitted before it is
turned is the stand going dark around it, and by then it is already yours.

There is exactly one exception to the silence, and it is narrow: a slot that has
just _finished_ a set says so. On every other slot — which is all but one in a
season — that field is empty. Even then the order is the point: the completed set
is held back until the card has been turned over. See
[collection trophies](collection-trophies.md).

## Edge cases

- **An empty pool.** No roster and no secrets with art means nothing to deal;
  the screen says there is nothing today rather than showing an error, and the
  day is not spent.
- **A retired card.** Removed from future deals, never from anybody's vault. You
  pulled it, you keep it.
- **Three secrets in one pack.** Allowed. The one-a-day rule that used to refuse
  it is gone; ownership is still one row per card.
- **A guest who clears site data** loses the identity and, with it, the secrets
  attached to it. Nothing server-side can tell that apart from a new phone.
- **Two tabs tearing at once.** Both deals return the same pack.
- **A deal that times out and then lands.** The retry finds it and returns it.

## Open questions and verification

- How often a secret should appear is now a function of the catalogue's size and
  weights. The equal-weight default means a big catalogue makes secrets common;
  whether that is the cadence the league wants is a commissioner's call.
- Whether the dark room alone is enough of a tell — with the bezel gone from the
  fan — has been read from the stand and not watched in a garden.
- Assumption: no response anywhere in the app carries a secret set size. This was
  checked against every secret-facing server function at this commit, and there
  are key-exact assertions in the test suite that exist to keep it true.

Verified against willyoubemyhero commit `752d4fb`.
