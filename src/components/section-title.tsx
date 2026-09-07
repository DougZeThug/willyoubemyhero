/**
 * The card register's section heading.
 *
 * The count sits BESIDE the h2 rather than inside it, and that is not a styling
 * preference: the e2e suite reaches these headings by anchored accessible name
 * (`/^the market$/i`), and a count folded into the heading would make that name
 * "The market 3" and fail every one of them.
 */
export function SectionTitle({
  icon,
  label,
  count,
}: {
  icon?: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 text-primary">
      {icon}
      <h2 className="font-display text-badge font-bold uppercase tracking-[0.08em]">{label}</h2>
      {count !== undefined && (
        <span className="rounded-full bg-primary px-2 py-0.5 font-display text-meta font-black tabular text-background">
          {count}
        </span>
      )}
    </div>
  );
}
