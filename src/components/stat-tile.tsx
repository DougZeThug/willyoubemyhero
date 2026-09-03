/**
 * The bezelled number tile used across a card page.
 *
 * Lifted out of players.$id.tsx when the pack stats section needed the same
 * thing. The border deliberately mixes `--tier` rather than taking a colour prop:
 * the card page sets that variable once on its root, so a tile picks up the
 * player's rarity wherever it is dropped.
 */
export function StatTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      className="surface-panel rounded-xl border px-4 py-2 text-center"
      style={{ borderColor: "color-mix(in oklab, var(--tier) 30%, oklch(1 0 0 / 10%))" }}
    >
      <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
        {label}
      </div>
      <div
        className={"font-display text-xl font-black " + (mono ? "timer-digits tabular" : "")}
        style={{ color: "var(--tier)" }}
      >
        {value}
      </div>
    </div>
  );
}
