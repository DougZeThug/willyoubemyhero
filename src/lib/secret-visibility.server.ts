// Who may see which secret card. The one place a face is withheld: the Trading
// Post and the marketplace both render other people's secrets, and `secret_cards`
// is server-only because anything that hands out faces by id lets one GET per
// member walk the catalogue. Every ids-in, faces-out path goes through here.
import { adminDb } from "./admin-db.server";
import { VARIANT_WIDTHS } from "./media";
import { signPath } from "./media.functions";
import type { SecretCardRow, SecretPullRow } from "./secret-cards-rows";

/** What a card the viewer may not see is called, and what a retired one falls back to. */
export const SECRET_PLACEHOLDER_NAME = "Secret card";

/** Secret card ids the caller already holds a copy of. Their own rows only. */
export async function viewerSecretCardIds(me: string): Promise<ReadonlySet<string>> {
  const sb = await adminDb();
  const { data } = await sb
    .from("secret_card_pulls")
    .select("secret_card_id")
    .eq("participant_id", me)
    .returns<Pick<SecretPullRow, "secret_card_id">[]>();
  return new Set((data ?? []).map((r) => r.secret_card_id));
}

export type SecretFace = {
  name: string;
  /** Signed thumbnail, null unless the card is shown. */
  artUrl: string | null;
  /** The set, null unless the card is shown: a pile of unknowns is a step towards counting them. */
  collection: string | null;
};

/**
 * Faces for a set of secret cards, withholding what the viewer may not see.
 *
 * `shown` decides who gets art and set. A card that is not shown keeps its
 * name only when `nameUnshown` is on — an offer or a spares list is judged by
 * name ("Dragon, mythic" on a face-down tile), a marketplace shelf is not and
 * says nothing. Rows are fetched only for the cards whose name or art will be
 * used, and art is signed only for the ones shown.
 *
 * The ids come from rows the caller is already entitled to see, never from a
 * request: that is what keeps "no member-facing handler accepts a secret card
 * id" true.
 */
export async function secretFaces(
  cardIds: Iterable<string>,
  options: { shown: (cardId: string) => boolean; nameUnshown: boolean },
): Promise<Map<string, SecretFace>> {
  const ids = [...new Set(cardIds)];
  const out = new Map<string, SecretFace>();
  if (ids.length === 0) return out;

  const fetchIds = options.nameUnshown ? ids : ids.filter(options.shown);
  const sb = await adminDb();
  const { data: cards } = fetchIds.length
    ? await sb
        .from("secret_cards")
        .select("id, name, art_path, collection")
        .in("id", fetchIds)
        .returns<Pick<SecretCardRow, "id" | "name" | "art_path" | "collection">[]>()
    : { data: [] as Pick<SecretCardRow, "id" | "name" | "art_path" | "collection">[] };
  const byId = new Map((cards ?? []).map((c) => [c.id, c]));

  await Promise.all(
    ids.map(async (id) => {
      const card = byId.get(id);
      const shown = options.shown(id);
      out.set(id, {
        // A retired card still trades and sells; it just has no row left to name it.
        name: shown || options.nameUnshown ? (card?.name ?? SECRET_PLACEHOLDER_NAME) : SECRET_PLACEHOLDER_NAME, // prettier-ignore
        // thumb rather than large: these are tiles in a picker or on a shelf, not the reveal.
        artUrl: shown ? await signPath(card?.art_path ?? null, VARIANT_WIDTHS.thumb) : null,
        collection: shown ? (card?.collection ?? null) : null,
      });
    }),
  );
  return out;
}
