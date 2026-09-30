import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    // The floor, as a hit box rather than a size.
    //
    // A switch is 20px tall because that is what a switch looks like — growing
    // it to 44 would draw a pill the size of a button. So the target grows
    // instead of the control: a `::before` centred on the track, 44px square,
    // invisible and transparent to the eye but not to a thumb. `relative` is
    // what anchors it, and it is released on `pointer-fine:` like every other
    // floor in this directory (see ui/button.tsx for the argument).
    //
    // Nothing else may sit within 12px of a switch, or the two hit boxes
    // overlap. Two consumers, and BOTH of them stack switches: nav-rows-panel
    // and the stations edit sheet. Each gives its row `min-h-11` so the box is
    // the row -- which is the only reason 12px of space-y between them is
    // enough. A bare `flex items-center` row is 20px and puts the next switch's
    // box under this one; when this comment first said "today the only one is
    // the nav-rows panel", the stations sheet had already been doing that for a
    // month, unmeasured because the sheet is closed by default.
    className={cn(
      "peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      "before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] pointer-fine:before:hidden",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
