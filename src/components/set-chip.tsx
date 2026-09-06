import { SECRET_RARITY, secretCollectionLabel, setAccent } from "@/lib/secret-cards";
import type { SecretCollection } from "@/lib/secret-cards";
import { cn } from "@/lib/utils";

/**
 * Which set a secret belongs to, printed on the card rather than on the shelf.
 *
 * A set used to be legible in exactly one place — the tinted panel the card was
 * sitting under — so the moment a card left the vault for the viewer, a trade or
 * the shop, it stopped saying what it was part of (§14). This is the set
 * travelling with the card.
 *
 * It says a name and nothing else. A set's name is not a secret — getSecretCollections
 * ships the whole list to any phone that opens the vault — and a name carries no
 * size, which is the fact the feature actually withholds.
 *
 * Nothing at all for an unfiled card. The unsorted pile is headed "Secrets" on the
 * vault, but that is a pile rather than a set, and a chip saying so would dress a
 * shelf label up as something the card belongs to.
 */
export function SetChip({
  collection,
  sets,
  className,
}: {
  collection: string | null | undefined;
  /**
   * The live set list, or undefined while it is still in the air — in which case
   * the helpers below fall back to the sets that shipped. See useSecretCollections.
   */
  sets?: readonly SecretCollection[];
  className?: string;
}) {
  if (!collection) return null;
  // The live list first, then the sets that shipped, then the id itself.
  //
  // An admin can HIDE a set, which takes it out of getSecretCollections' answer
  // — it only returns active ones — while the cards filed into it are still in
  // somebody's vault. Handing the helpers a list that does not contain this id
  // would print `legacyPets` on the card, which reads as a bug rather than as a
  // label. Passing undefined instead drops them onto SECRET_COLLECTIONS, which
  // is exactly the fallback they were written with.
  const list = sets?.some((c) => c.id === collection) ? sets : undefined;
  // The shelf's own fallback, so a card from an untinted set wears the shared
  // secret green rather than going colourless on its own.
  const accent = setAccent(collection, list) ?? SECRET_RARITY.accent;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full border px-1.5 py-px align-middle",
        "text-label font-bold uppercase tracking-[0.08em]",
        className,
      )}
      style={{
        color: accent,
        borderColor: `color-mix(in oklab, ${accent} 35%, transparent)`,
        background: `color-mix(in oklab, ${accent} 18%, transparent)`,
      }}
    >
      {secretCollectionLabel(collection, list)}
    </span>
  );
}
