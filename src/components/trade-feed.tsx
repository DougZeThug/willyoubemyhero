import { tradeSummaryParts, type TradeFeedEntry } from "@/lib/trades";

/**
 * The league-wide record of what has actually changed hands.
 *
 * Its own tab now (§10). It used to be the last section of one long scrolling
 * page, clamped to `max-h-72` so it did not push everything else off the bottom —
 * a scroll region inside a scrolling page, which on a phone means two gestures
 * that look identical and do different things. A tab has the whole screen, so the
 * clamp is gone.
 *
 * Names both sides, counts the player cards and names the secrets — the summary
 * has carried a secret's name since the trade-feed-secret-names migration, with
 * the old count wording as the fallback for trades settled before it.
 */
export function TradeFeedPanel({
  entries,
  nameOf,
  loading = false,
  failed = false,
}: {
  entries: TradeFeedEntry[];
  nameOf: (participantId: string) => string;
  loading?: boolean;
  /** The read failed. Distinct from empty, which is a fact about the league. */
  failed?: boolean;
}) {
  if (loading && entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Reading the ledger…</p>;
  }
  if (failed && entries.length === 0) {
    // A failed read is not an empty ledger, and saying "nothing has changed
    // hands yet" when the request fell over is a claim about the league that
    // happens to be untrue. The old screen hid the section entirely on an
    // error, which was quieter but not more honest.
    //
    // No retry button: the query already refetches on window focus, and party
    // phones lock and unlock constantly.
    return (
      <p role="status" className="text-sm text-warn">
        Couldn&apos;t read the ledger. It will fill in when the connection does.
      </p>
    );
  }
  if (entries.length === 0) {
    // An empty section used to vanish entirely (§10 problem 7). A tab cannot
    // vanish, so it has to say what it is waiting for.
    return <p className="text-sm text-muted-foreground">Nothing has changed hands yet.</p>;
  }
  return (
    <div className="surface-panel overflow-hidden rounded-xl border">
      <ul className="divide-y divide-white/10">
        {entries.map((t) => (
          <li key={t.id} className="px-3 py-2.5 text-meta leading-relaxed text-foreground">
            <span className="font-display font-black uppercase tracking-wide">
              {nameOf(t.proposerId)}
            </span>{" "}
            <span className="text-muted-foreground">sent</span>{" "}
            <SummaryText items={t.proposerGave} /> <span className="text-muted-foreground">to</span>{" "}
            <span className="font-display font-black uppercase tracking-wide">
              {nameOf(t.recipientId)}
            </span>{" "}
            <span className="text-muted-foreground">for</span>{" "}
            <SummaryText items={t.recipientGave} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The feed's summary, with the traded card named in the accent colour.
 *
 * `tradeSummaryParts` already decides the wording, piece by piece, so each one
 * can be lit up rather than reading as one grey run of text. It used to take the
 * joined label and split it back apart on " + ", which cut a secret named
 * "Salt + Pepper" in half.
 */
function SummaryText({ items }: { items: Parameters<typeof tradeSummaryParts>[0] }) {
  const parts = tradeSummaryParts(items);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="text-muted-foreground"> + </span>}
          <span className="font-semibold text-primary">{part}</span>
        </span>
      ))}
    </>
  );
}
