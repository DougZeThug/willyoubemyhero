import { CollectionComplete } from "@/components/collection-complete";
import { PresentationMode } from "@/components/presentation-mode";
import { useCollectionTrophyWatcher } from "@/hooks/use-collection-trophies";

/**
 * The ceremony for a set that finished while you were looking somewhere else.
 *
 * Mounted once by __root.tsx, so it reaches a phone on any screen — which is the
 * whole point. The pack and trade routes fire their own ceremony from the
 * response they already hold, and neither of those paths exists for the two ways
 * a set most often closes for somebody who did not press the button: an admin
 * grant, which runs on the commissioner's handset, and the far side of a two-way
 * trade. Before this, both landed as a silently refreshed badge.
 *
 * Rendered inside PresentationProvider rather than beside the Toaster, because
 * PresentationMode is what fades the nav out from under a full-screen moment and
 * its context default is a no-op — mounted outside, the dimming would silently do
 * nothing.
 *
 * Returns null almost always. A member finishes a handful of sets a season.
 */
export function TrophyCeremonyHost() {
  const { queue, shift } = useCollectionTrophyWatcher();
  const current = queue[0];

  return (
    <>
      <PresentationMode active={!!current} />
      {current && (
        // Keyed, and it is load-bearing: CollectionComplete latches its confetti
        // and its chime on a ref that is set once per MOUNT. Without a key that
        // changes, the second set in a queue would arrive silent.
        <CollectionComplete
          key={current.collection}
          label={current.label}
          size={current.size}
          onDone={shift}
        />
      )}
    </>
  );
}
