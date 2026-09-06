// The offer being built, before it is an offer.
//
// Pure and client-safe, like `trades.ts` next door — but a different job. That
// file holds the view types and the labels rendered from them; this one holds the
// half-built trade: which copies are staged, which the picker may show, and what
// is stopping the flow moving on.
//
// It lives here rather than inside trade-builder.tsx because the ROUTE needs it
// too — it hands an intent down — and a module that exports components must
// export nothing else or fast refresh stops working for everything importing it
// (`react-refresh/only-export-components`; `allowConstantExport` covers
// MAX_PER_SIDE and not the two builders below). It is deliberately NOT imported
// by trades.functions.ts: the RPC has its own zod schema, and a shared
// constructor between the two would be a way for the client to decide what the
// server accepts.
import { editionRank } from "./card-edition";
import { secretTierRank } from "./secret-rarity";
import type { TradeIntent } from "./trade-intent";
import type { BlockedSpare, RosterSpare, SecretSpare, TradeItemView, TradeSpares } from "./trades";

/** Matches the RPC and the zod schema. Enforced here so the button can go quiet first. */
export const MAX_PER_SIDE = 4;

/** A staged item, keyed so a tap can toggle it back off. */
export type Staged = { key: string; item: TradeItemView; payload: Record<string, unknown> };

// Both sides of the table are built from these, and so is the intent pre-stage.
// One place, because the payload is what `create_trade_offer` reads and a second
// copy of it is a second thing to get wrong.
export const stagedSecret = (s: SecretSpare): Staged => ({
  key: `s:${s.pullId}`,
  item: {
    kind: "secret",
    pullId: s.pullId,
    name: s.name,
    artUrl: s.artUrl,
    tier: s.tier,
    collection: s.collection,
    lastCopy: s.lastCopy,
    viewerOwns: s.viewerOwns,
  },
  payload: { kind: "secret", secretPullId: s.pullId },
});

export const stagedRoster = (r: RosterSpare): Staged => ({
  key: `c:${r.copyId}`,
  item: {
    kind: "roster",
    copyId: r.copyId,
    eventParticipantId: r.eventParticipantId,
    edition: r.edition,
    viewerOwns: r.viewerOwns,
  },
  payload: { kind: "roster", cardCopyId: r.copyId },
});

/**
 * Everything one person has on the table, in the order the picker shows it.
 *
 * Secrets lead, rarest copy first: they are what anyone opening the picker is
 * actually scrolling for, and on a phone the base cards used to bury them. Every
 * secret they hold, single copies included — `lastCopy` carries through so the
 * tile can say which ones they cannot get back.
 *
 * Then one tile per COPY, so "my gold Alice" and "my standard Alice" are
 * separately pickable. Earned tier first, then the card, then the finish — so the
 * champion's card leads and the copies of one card still sit together.
 *
 * Takes a RANK function rather than a card lookup, so nothing in src/lib has to
 * know what a rendered card looks like. Callers pass
 * `(id) => rarityRank(lookup(id).rarity.tier)`.
 */
export function pickerItems(
  spares: TradeSpares | undefined,
  rosterRank: (eventParticipantId: string) => number,
): Staged[] {
  return [
    ...[...(spares?.secrets ?? [])]
      .sort(
        (a, b) => secretTierRank(a.tier) - secretTierRank(b.tier) || a.name.localeCompare(b.name),
      ) // prettier-ignore
      .map(stagedSecret),
    // Annotated by `stagedRoster`'s return type rather than cast — an
    // `as TradeItemView` here once silently dropped `lastCopy` off the secret
    // tiles above and the marker simply never rendered.
    ...[...(spares?.roster ?? [])]
      .sort(
        (a, b) =>
          rosterRank(a.eventParticipantId) - rosterRank(b.eventParticipantId) ||
          a.eventParticipantId.localeCompare(b.eventParticipantId) ||
          editionRank(a.edition) - editionRank(b.edition),
      )
      .map(stagedRoster),
  ];
}

/**
 * The cards this person owns and cannot stake, with the reason.
 *
 * Defaulted here rather than at each call site: `getTradeSpares` sends `blocked`
 * empty for anybody but you, and several test fixtures omit the field entirely.
 */
export function blockedItems(spares: TradeSpares | undefined): BlockedSpare[] {
  return spares?.blocked ?? [];
}

/** A stable key for a blocked tile — the same shape `Staged.key` uses. */
export function blockedKey(b: BlockedSpare): string {
  return b.item.kind === "secret" ? `bs:${b.item.pullId}` : `bc:${b.item.copyId}`;
}

/**
 * Add or remove one card from a side, refusing past the cap.
 *
 * `capped` is separate from `next` so the caller can say why nothing happened.
 * A tap that removes is never capped, however full the side is — otherwise
 * somebody at four cards could not swap one out for another.
 */
export function toggleStaged(
  list: readonly Staged[],
  staged: Staged,
  max: number = MAX_PER_SIDE,
): { next: Staged[]; capped: boolean } {
  if (list.some((s) => s.key === staged.key)) {
    return { next: list.filter((s) => s.key !== staged.key), capped: false };
  }
  if (list.length >= max) return { next: [...list], capped: true };
  return { next: [...list, staged], capped: false };
}

/**
 * The spare an intent means, once the spares for that side have landed.
 *
 * The MODEST copy on both sides: hand over the plainest spare you hold rather
 * than your platinum, and ask for their plainest rather than their best. You
 * asked for the card, not for the metal — and either can be swapped in the
 * picker, which is one tap away.
 */
export function spareForIntent(want: TradeIntent, spares: TradeSpares | undefined): Staged | null {
  if (!spares) return null;
  if (want.kind === "secret") {
    // By id, because two secrets may share a name and staging the wrong card
    // into a real trade is not a mistake somebody would spot. The name is the
    // fallback for a spares response older than the id field.
    const isThisCard = (s: SecretSpare) =>
      s.cardId ? s.cardId === want.secretCardId : s.name === want.name;
    // Sorted, not found: `getTradeSpares` answers with one row per PULL and no
    // promised order, so somebody holding a mythic and a common of the same card
    // had an arbitrary one of them staged — and half the time it was the mythic,
    // which is the opposite of what the roster branch does. secretTierRank counts
    // UP from the rarest, so sorting by it descending puts the plainest first.
    const copies = (spares.secrets ?? [])
      .filter(isThisCard)
      .sort((a, b) => secretTierRank(b.tier) - secretTierRank(a.tier));
    return copies[0] ? stagedSecret(copies[0]) : null;
  }
  const copies = (spares.roster ?? [])
    .filter((r) => r.eventParticipantId === want.eventParticipantId)
    .sort((a, b) => editionRank(b.edition) - editionRank(a.edition));
  return copies[0] ? stagedRoster(copies[0]) : null;
}

/**
 * Whether anything on this side is its owner's only copy.
 *
 * Roster copies cannot be — `trade_leaves_a_copy` refuses them before they reach
 * a tray — so this is the secrets question, which is the one worth asking twice:
 * a secret you hold once is still tradeable, and Review is the last place to say
 * so before it goes.
 */
export function hasLastCopy(list: readonly Staged[]): boolean {
  return list.some((s) => s.item.kind === "secret" && s.item.lastCopy);
}

export type BuilderStep = "who" | "trays" | "review";

/** Who → trays → review, and back. Linear, so the order is the array. */
export const BUILDER_STEPS: readonly BuilderStep[] = ["who", "trays", "review"];

/**
 * What is stopping this step moving on, in words, or null when nothing is.
 *
 * A sentence rather than a boolean because it is rendered: a disabled control
 * with no stated reason is exactly what the offline work rejected. Pure so the
 * three rules can be read in one place and tested without a render.
 */
export function stepBlocker(
  step: BuilderStep,
  state: { theirId: string | null; give: readonly Staged[]; want: readonly Staged[] },
): string | null {
  if (step === "who") return state.theirId ? null : "Pick who to trade with.";
  if (step === "trays") {
    if (state.give.length === 0) return "Add at least one of your cards.";
    if (state.want.length === 0) return "Ask for at least one of theirs.";
  }
  return null;
}
